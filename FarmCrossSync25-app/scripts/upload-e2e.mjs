#!/usr/bin/env node
// Upload end-to-end integration (ticket 41).
//
// Drives the real client code path — `runUpload` + `createApiClient` +
// `createPutToR2` — against the local Worker/D1/R2. Only the Tauri filesystem
// commands (validate/metadata/pack/hash/sync-state) are faked, because they
// cannot run outside the desktop app, and `putArchive` — the file-based byte
// transport, streamed from disk in production by Rust — is a node stream here.
// The network, auth, target selection, error mapping, and orchestration are
// the production modules.
//
// What it checks:
//   1. A uploads; member B sees the published save via GET /farms/:id/saves.
//   2. runUpload emits phase `zipping` then `uploading` (both reach 100%).
//   3. An interrupted upload (PUT fails) leaves the previous cloud metadata
//      authoritative.
//   4. A happy path writes local sync state with the uploaded hash/time.
//   5. A mock archive larger than the size-warning threshold streams through
//      the transport without growing process memory with the archive (85).
//
// Usage: node scripts/upload-e2e.mjs   (starts and stops its own Worker)
// Requires: backend deps installed; ENABLE_R2_TEST is set by this script.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  ftruncateSync,
  mkdtempSync,
  openSync,
  statSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "../src/lib/api.ts";
import { runUpload } from "../src/lib/upload.ts";
import { createPutToR2 } from "../src/lib/uploadTransport.ts";

// File-based streaming PUT: the production `putArchiveFile` command streams the
// archive from disk in bounded buffers; node streams it the same way here so
// the transport never materializes the body in this process.
async function putArchive({ url, method, headers, archivePath }) {
  const res = await fetch(url, {
    method,
    headers,
    body: createReadStream(archivePath),
    duplex: "half",
  });
  return res.status;
}

const BACKEND_DIR = fileURLToPath(
  new URL("../../FarmCrossSync25-backend", import.meta.url),
);
const PORT = Number(process.env.PORT ?? 8789);
const BASE = `http://127.0.0.1:${PORT}`;
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Fake local filesystem deps (the real ones are Tauri commands). Sync state is
// kept in memory so the flow's write can be inspected.
function localDeps({ archivePath, savePath, hash, onSyncState }) {
  let syncState = null;
  let packProgress = null;
  // True byte length of the staged archive: upload-complete verifies fileSize
  // against the stored object size (backend ticket 78).
  const sizeBytes = statSync(archivePath).size;
  return {
    deps: {
      validateSave: async () => ({
        state: "valid",
        path: savePath,
        mapName: "E2E Map",
        lastModified: new Date().toISOString(),
        missingFiles: [],
        message: null,
      }),
      readMetadata: async () => ({
        slot: 1,
        mapName: "E2E Map",
        path: savePath,
        lastModified: new Date().toISOString(),
        sizeBytes,
        contentHash: hash,
      }),
      packSave: async () => {
        packProgress?.({ savePath, percent: 50 });
        return { archivePath, sizeBytes, fileCount: 1 };
      },
      onPackProgress: async (handler) => {
        packProgress = handler;
        return () => {};
      },
      computeHash: async () => ({ hash }),
      readSyncState: async () => syncState,
      writeSyncState: async (farmId, state) => {
        syncState = state;
        onSyncState?.(farmId, state);
        return state;
      },
      cleanupPack: async () => {},
    },
    getSyncState: () => syncState,
  };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "upload-e2e-"));
  const archivePath = join(workDir, "save.zip");
  const savePath = join(workDir, "savegame1");
  const archiveBytes = Buffer.from("fake-fs25-save-archive\n");
  writeFileSync(archivePath, archiveBytes);
  const hash = sha256(archiveBytes);

  console.log(`backend: ${BACKEND_DIR}`);
  console.log(`worker:  ${BASE} (ENABLE_R2_TEST=true)`);

  const migrate = spawnSync(
    NPX,
    ["wrangler", "d1", "migrations", "apply", "DB", "--local"],
    { cwd: BACKEND_DIR, stdio: "inherit" },
  );
  if (migrate.status !== 0) throw new Error("migrations failed");

  const logFd = openSync(join(workDir, "worker.log"), "w");
  const worker = spawn(
    NPX,
    [
    "wrangler",
    "dev",
    "--port",
    String(PORT),
    "--var",
    "ENABLE_R2_TEST:true",
    "--var",
    "FARM_CROSSSYNC_LOCAL_DEV:true",
  ],
    { cwd: BACKEND_DIR, detached: true, stdio: ["ignore", logFd, logFd] },
  );
  closeSync(logFd);

  const stopWorker = () => {
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {
      // already gone
    }
    try {
      process.kill(-worker.pid, "SIGKILL");
    } catch {
      // already gone
    }
  };

  try {
    if (!(await waitForHealth())) {
      throw new Error(`Worker did not start on ${BASE}`);
    }
    console.log("worker healthy\n");

    // --- Register A (owner) and B (member) --------------------------------
    const publicApi = createApiClient({ baseUrl: BASE });
    const stamp = Date.now();
    const regA = await publicApi.post(
      "/register",
      { installationId: `e2e-owner-${stamp}`, displayName: "Owner A" },
      { auth: false },
    );
    const regB = await publicApi.post(
      "/register",
      { installationId: `e2e-member-${stamp}`, displayName: "Member B" },
      { auth: false },
    );
    const clientA = createApiClient({ baseUrl: BASE, getToken: async () => regA.token });
    const clientB = createApiClient({ baseUrl: BASE, getToken: async () => regB.token });

    // --- Farm with A, accept B --------------------------------------------
    const { farm } = await clientA.post("/farms", { name: "E2E Upload Farm" });
    await clientB.post(`/farms/${farm.id}/join`, { code: farm.code });
    const { invites } = await clientA.get(`/farms/${farm.id}/invites`);
    await clientA.post(`/invites/${invites[0].id}/accept`);
    console.log(`farm: ${farm.id}\n`);

    const putToR2 = createPutToR2({
      baseUrl: BASE,
      putArchive,
    });

    // --- Happy-path upload as A -------------------------------------------
    const phases = [];
    const progress = [];
    let syncWrites = [];
    const happy = localDeps({
      archivePath,
      savePath,
      hash,
      onSyncState: (farmId, state) => syncWrites.push({ farmId, state }),
    });
    const uploadDeps = {
      ...happy.deps,
      uploadAuthorize: async ({ farmId }) => {
        const body = await clientA.post("/saves/upload-authorize", { farmId });
        return body.authorization;
      },
      putToR2,
      uploadComplete: async (input) => {
        const body = await clientA.post("/saves/upload-complete", input);
        return { uploadedAt: body.save.uploadedAt };
      },
    };

    const result = await runUpload({ farmId: farm.id, savePath }, uploadDeps, {
      onPhase: (phase) => phases.push(phase),
      onProgress: (p) => progress.push(p),
    });

    check("happy-path upload succeeds", result.ok === true, JSON.stringify(result));
    check(
      "upload emits zipping then uploading",
      phases.join(",") === "zipping,uploading",
      `got ${phases.join(",")}`,
    );
    check(
      "both phases report 100%",
      progress.some((p) => p.phase === "zipping" && p.percent === 100) &&
        progress.some((p) => p.phase === "uploading" && p.percent === 100),
      JSON.stringify(progress),
    );

    // Criterion 4: local sync state updated with the uploaded hash/time.
    check("sync state written once after happy path", syncWrites.length === 1);
    const written = syncWrites[0]?.state;
    check(
      "sync state carries uploaded hash",
      written?.lastUploadedHash === hash,
      JSON.stringify(written),
    );
    check(
      "sync state carries uploaded timestamp",
      typeof written?.lastUploadedAt === "string" && written.lastUploadedAt.length > 0,
      JSON.stringify(written),
    );
    console.log(`sync state: ${JSON.stringify(written)}\n`);

    // Criterion 1: B sees A's published save.
    const listAsB = await clientB.get(`/farms/${farm.id}/saves`);
    const aSave = listAsB.saves.find((s) => s.user_id === regA.user.id);
    check("member B sees A's published save", Boolean(aSave), JSON.stringify(listAsB.saves));
    check("B's view carries A's hash", aSave?.sha256 === hash, JSON.stringify(aSave));
    check("B's view carries A's save name", aSave?.save_name === "E2E Map", JSON.stringify(aSave));

    // Confirm the bytes really landed in R2 under A's key (local-dev route).
    const objectUrl = `${BASE}/r2-test/${encodeURIComponent(aSave.object_key)}`;
    const objectRes = await fetch(objectUrl);
    const objectBytes = new Uint8Array(await objectRes.arrayBuffer());
    check(
      "R2 object matches the uploaded archive",
      objectRes.ok && Buffer.compare(Buffer.from(objectBytes), archiveBytes) === 0,
      `status ${objectRes.status}`,
    );

    // --- Criterion 3: interrupted upload leaves prior metadata authoritative
    const before = JSON.stringify(listAsB.saves);
    const interrupted = localDeps({ archivePath, savePath, hash, onSyncState: () => {} });
    const failResult = await runUpload(
      { farmId: farm.id, savePath },
      {
        ...interrupted.deps,
        uploadAuthorize: async ({ farmId }) => {
          const body = await clientA.post("/saves/upload-authorize", { farmId });
          return body.authorization;
        },
        putToR2: async () => {
          throw new Error("connection lost mid-upload");
        },
        uploadComplete: async () => {
          throw new Error("must not be called");
        },
      },
    );
    check("interrupted upload fails", failResult.ok === false, JSON.stringify(failResult));
    check(
      "interrupted upload does not write sync state",
      interrupted.getSyncState() === null,
    );
    const after = JSON.stringify((await clientB.get(`/farms/${farm.id}/saves`)).saves);
    check("previous cloud save metadata unchanged after interruption", before === after);

    // --- Criterion 5: a large mock archive streams with bounded memory -----
    // A save above the 200 MB size-warning threshold flows through the real
    // `runUpload` + `createPutToR2` into a local sink: the warning must prompt,
    // both phases must progress, and the client heap must not grow with the
    // archive (ticket 85).
    {
      const LARGE_BYTES = 220 * 1024 * 1024;
      const bigPath = join(workDir, "large-save.zip");
      const fd = openSync(bigPath, "w");
      ftruncateSync(fd, LARGE_BYTES); // sparse mock archive
      closeSync(fd);
      const bigHash = sha256(Buffer.from("large-mock-save"));

      let sinkBytes = 0;
      const sink = http.createServer((req, res) => {
        req.on("data", (chunk) => {
          sinkBytes += chunk.length;
        });
        req.on("end", () => {
          res.statusCode = 200;
          res.end();
        });
      });
      await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
      const sinkUrl = `http://127.0.0.1:${sink.address().port}/sink`;

      let sizeWarnings = 0;
      const largePhases = [];
      const large = localDeps({
        archivePath: bigPath,
        savePath,
        hash: bigHash,
        onSyncState: () => {},
      });
      const heapBefore = process.memoryUsage().heapUsed;
      let heapPeak = heapBefore;
      const sampler = setInterval(() => {
        heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
      }, 20);
      const largeResult = await runUpload(
        { farmId: farm.id, savePath },
        {
          ...large.deps,
          uploadAuthorize: async () => ({
            objectKey: "mock/large-save",
            presigned: true,
            url: sinkUrl,
            method: "PUT",
            headers: {},
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          putToR2: createPutToR2({ baseUrl: BASE, putArchive }),
          uploadComplete: async () => ({ uploadedAt: new Date().toISOString() }),
        },
        {
          onPhase: (phase) => largePhases.push(phase),
          confirmSizeWarning: (sizeBytes) => {
            sizeWarnings += 1;
            return sizeBytes === LARGE_BYTES;
          },
        },
      );
      clearInterval(sampler);
      await new Promise((resolve) => sink.close(resolve));

      check(
        "large archive: upload succeeds through the size-warning path",
        largeResult.ok === true && sizeWarnings === 1,
        JSON.stringify({ sizeWarnings, result: largeResult }),
      );
      check(
        "large archive: zipping and uploading phases both progress",
        largePhases.join(",") === "zipping,uploading",
        largePhases.join(","),
      );
      check(
        "large archive: the whole mock archive streamed to storage",
        sinkBytes === LARGE_BYTES,
        `sink received ${sinkBytes} of ${LARGE_BYTES}`,
      );
      const growth = heapPeak - heapBefore;
      check(
        "large archive: process memory stays bounded while streaming",
        growth < LARGE_BYTES / 4,
        `heap grew ${growth} bytes moving ${LARGE_BYTES} bytes`,
      );
      rmSync(bigPath, { force: true });
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    stopWorker();
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
