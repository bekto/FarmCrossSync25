#!/usr/bin/env node
// Download end-to-end integration (ticket 42).
//
// Drives the real client code path — `runDownload` + `createApiClient` +
// `createGetToDisk` — against the local Worker/D1/R2. Only the Tauri filesystem
// commands (validate/metadata/pack/hash/unpack/install/backup/sync-state) are
// faked, because they cannot run outside the desktop app; the network, auth,
// transport, and orchestration are the production modules. The fake filesystem
// keeps real directories in a temp dir, so "unchanged/recoverable" assertions
// are checked byte-for-byte.
//
// What it checks:
//   1. A (owner) uploads; B (member) downloads it. After confirm -> backup ->
//      fetch -> unpack -> hash verify -> install, B's save content equals A's.
//   2. A tampered archive fails verification: install is not called and B's
//      original save is unchanged.
//   3. The configured backup directory holds a timestamped copy of the previous
//      local save after a successful download.
//   4. Fetch, unpack, and install failures each leave B's original save
//      unchanged and write no sync state.
//
// Usage: node scripts/download-e2e.mjs   (starts and stops its own Worker)
// Requires: backend deps installed; ENABLE_R2_TEST is set by this script.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "../src/lib/api.ts";
import { createGetToDisk } from "../src/lib/downloadTransport.ts";
import { runDownload } from "../src/lib/download.ts";
import { runUpload } from "../src/lib/upload.ts";
import { createPutToR2 } from "../src/lib/uploadTransport.ts";

const BACKEND_DIR = fileURLToPath(
  new URL("../../FarmCrossSync25-backend", import.meta.url),
);
const PORT = Number(process.env.PORT ?? 8791);
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// --- Fake FS: a canonical, deterministic save representation ---------------
// A save is a directory of files. `serializeDir` produces the canonical archive
// bytes (sorted relative paths + base64 bytes); `unpackSave` reconstructs the
// directory, so hashing the extracted content is a faithful stand-in for the
// real Rust content hash.

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) {
      out.push({
        path: relative(base, full).split("\\").join("/"),
        bytes: readFileSync(full),
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function serializeDir(dir) {
  const files = listFiles(dir).map((file) => ({
    path: file.path,
    data: file.bytes.toString("base64"),
  }));
  return Buffer.from(JSON.stringify(files));
}

function deserializeTo(dir, bytes) {
  for (const file of JSON.parse(Buffer.from(bytes).toString("utf8"))) {
    const full = join(dir, file.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(file.data, "base64"));
  }
}

const hashDir = (dir) => sha256(serializeDir(dir));

function writeSave(dir, files) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

// `runDownload` dependencies backed by a real temp directory tree. `overrides`
// let each failure scenario inject a throwing step.
function makeLocalFs({ backupDir, overrides = {} }) {
  let syncState = null;
  const syncWrites = [];
  const calls = [];

  const deps = {
    readMetadata: async (path) => {
      const files = listFiles(path);
      return {
        slot: 1,
        mapName: "E2E Map",
        path,
        lastModified: new Date().toISOString(),
        sizeBytes: files.reduce((n, f) => n + f.bytes.length, 0),
        contentHash: hashDir(path),
      };
    },
    computeHash: async (path) => ({ path, hash: hashDir(path) }),
    createBackup: async (savePath) => {
      calls.push("backup");
      const dest = join(
        backupDir,
        `${basename(savePath)}_${new Date().toISOString().replace(/[:.]/g, "-")}`,
      );
      cpSync(savePath, dest, { recursive: true });
      return { backupPath: dest, createdAt: new Date().toISOString(), pruned: [] };
    },
    unpackSave: async (archivePath) => {
      calls.push("unpack");
      const dest = mkdtempSync(join(tmpdir(), "download-unpack-"));
      deserializeTo(dest, readFileSync(archivePath));
      return { destPath: dest, fileCount: listFiles(dest).length };
    },
    installSaveToSlot: (root, slot, stagedPath, expectedHash) => {
      calls.push("install");
      const targetPath = join(root, `savegame${slot}`);
      const stagedHash = hashDir(stagedPath);
      if (
        expectedHash &&
        stagedHash.toLowerCase() !== expectedHash.toLowerCase()
      ) {
        throw new Error("staged content hash does not match the expected hash");
      }
      const wasEmpty = !existsSync(targetPath);
      if (wasEmpty) {
        cpSync(stagedPath, targetPath, { recursive: true });
      } else {
        const aside = `${targetPath}.aside-${Date.now()}`;
        cpSync(targetPath, aside, { recursive: true });
        try {
          rmSync(targetPath, { recursive: true, force: true });
          cpSync(stagedPath, targetPath, { recursive: true });
        } catch (error) {
          rmSync(targetPath, { recursive: true, force: true });
          cpSync(aside, targetPath, { recursive: true });
          throw error;
        } finally {
          rmSync(aside, { recursive: true, force: true });
        }
      }
      return {
        path: targetPath,
        contentHash: hashDir(targetPath),
        backupPath: null,
        wasEmpty,
      };
    },
    setFarmSlot: (farmId, _root, slot) => {
      calls.push("setSlot");
      return { ...(syncState ?? {}), farmId, slot };
    },
    readSyncState: async () => syncState,
    writeSyncState: async (farmId, state) => {
      syncState = state;
      syncWrites.push({ farmId, state });
      return state;
    },
    cleanupPack: async (archivePath) => {
      rmSync(archivePath, { force: true });
    },
    cleanupUnpack: async (destPath) => {
      rmSync(destPath, { recursive: true, force: true });
    },
    ...overrides,
  };

  // Upload-only deps for seeding A; the ticket's focus is the download side.
  const uploadDeps = {
    validateSave: async (path) => ({
      state: "valid",
      path,
      mapName: "E2E Map",
      lastModified: new Date().toISOString(),
      missingFiles: [],
      message: null,
    }),
    packSave: async (savePath) => {
      const archivePath = join(
        mkdtempSync(join(tmpdir(), "download-pack-")),
        "save.zip",
      );
      const bytes = serializeDir(savePath);
      writeFileSync(archivePath, bytes);
      return { archivePath, sizeBytes: bytes.length, fileCount: 1 };
    },
    onPackProgress: async () => () => {},
  };

  return { deps, uploadDeps, calls, syncWrites, getSyncState: () => syncState };
}

function stageArchive(bytes) {
  const path = join(mkdtempSync(join(tmpdir(), "download-stage-")), "save.zip");
  writeFileSync(path, bytes);
  return Promise.resolve(path);
}

// Tamper with a fetched archive while keeping it a valid serialized save: flip
// one byte of the first file's content so extraction succeeds but the content
// hash no longer matches what the cloud advertised.
function tamperingFetch(tamper) {
  return async (input, init) => {
    const res = await fetch(input, init);
    if (!res.ok) return res;
    const files = JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8"));
    files[0].data = tamper(files[0].data);
    return new Response(JSON.stringify(files), { status: 200 });
  };
}

function flipByte(base64) {
  const bytes = Buffer.from(base64, "base64");
  bytes[0] ^= 0xff;
  return bytes.toString("base64");
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "download-e2e-"));
  const backupDir = join(workDir, "backups");
  mkdirSync(backupDir);
  const aSave = join(workDir, "a", "savegame1");
  const bRoot = join(workDir, "b");
  const bSave = join(bRoot, "savegame1");
  const aFiles = {
    "savegame.xml": "<a-save-from-owner>",
    "careerSavegame.xml": "<career-a>",
  };
  const bFiles = {
    "savegame.xml": "<b-old-local-save>",
    "extra.txt": "old-b-extra",
  };
  writeSave(aSave, aFiles);
  writeSave(bSave, bFiles);
  const aHash = hashDir(aSave);
  const bBefore = serializeDir(bSave);
  const resetB = () => writeSave(bSave, bFiles);

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
    ["wrangler", "dev", "--port", String(PORT), "--var", "ENABLE_R2_TEST:true"],
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
      { installationId: `dl-owner-${stamp}`, displayName: "Owner A" },
      { auth: false },
    );
    const regB = await publicApi.post(
      "/register",
      { installationId: `dl-member-${stamp}`, displayName: "Member B" },
      { auth: false },
    );
    const clientA = createApiClient({ baseUrl: BASE, getToken: async () => regA.token });
    const clientB = createApiClient({ baseUrl: BASE, getToken: async () => regB.token });

    const { farm } = await clientA.post("/farms", { name: "E2E Download Farm" });
    await clientB.post(`/farms/${farm.id}/join`, { code: farm.code });
    const { invites } = await clientA.get(`/farms/${farm.id}/invites`);
    await clientA.post(`/invites/${invites[0].id}/accept`);
    console.log(`farm: ${farm.id}\n`);

    // Production download deps, mirroring +page.svelte (+ the envelope unwrap).
    const downloadDeps = (fs, fetchArchive) => ({
      readMetadata: fs.deps.readMetadata,
      computeHash: fs.deps.computeHash,
      createBackup: fs.deps.createBackup,
      downloadAuthorize: async ({ farmId, playerId }) => {
        const body = await clientB.post(
          `/saves/${playerId}/download-authorize`,
          { farmId },
        );
        return body.authorization;
      },
      fetchArchive,
      unpackSave: fs.deps.unpackSave,
      installSaveToSlot: fs.deps.installSaveToSlot,
      setFarmSlot: fs.deps.setFarmSlot,
      readSyncState: fs.deps.readSyncState,
      writeSyncState: fs.deps.writeSyncState,
      cleanupPack: fs.deps.cleanupPack,
      cleanupUnpack: fs.deps.cleanupUnpack,
    });

    // --- A uploads through the real upload flow + R2 transport ------------
    const putToR2 = createPutToR2({
      baseUrl: BASE,
      readFile: async (path) => new Uint8Array(readFileSync(path)),
    });
    const aFs = makeLocalFs({ backupDir });
    const uploadResult = await runUpload(
      { farmId: farm.id, savePath: aSave },
      {
        ...aFs.deps,
        ...aFs.uploadDeps,
        uploadAuthorize: async ({ farmId }) => {
          const body = await clientA.post("/saves/upload-authorize", { farmId });
          return body.authorization;
        },
        putToR2,
        uploadComplete: async (input) => {
          const body = await clientA.post("/saves/upload-complete", input);
          return { uploadedAt: body.save.uploadedAt };
        },
      },
    );
    check("A uploads the save", uploadResult.ok === true, JSON.stringify(uploadResult));

    const listAsB = await clientB.get(`/farms/${farm.id}/saves`);
    const aSaveRow = listAsB.saves.find((s) => s.user_id === regA.user.id);
    check("B sees A's save with A's hash", aSaveRow?.sha256 === aHash, JSON.stringify(aSaveRow));

    // --- Criterion 1: B downloads A's save and it replaces B's local save --
    const bFs = makeLocalFs({ backupDir });
    const getToDisk = createGetToDisk({ baseUrl: BASE, stageArchive });
    const phases = [];
    const download = await runDownload(
      {
        farmId: farm.id,
        playerId: regA.user.id,
        fs25Root: bRoot,
        slot: 1,
        slotPath: bSave,
        slotUsed: true,
        expectedSha256: aSaveRow.sha256,
        apiBaseUrl: BASE,
      },
      downloadDeps(bFs, (authorization) => getToDisk(authorization)),
      { onPhase: (phase) => phases.push(phase) },
    );

    check("criterion 1: B's download succeeds", download.ok === true, JSON.stringify(download));
    check(
      "criterion 1: download runs every phase in order",
      phases.join(",") ===
        "confirming,backing-up,downloading,unpacking,verifying,replacing",
      phases.join(","),
    );
    check(
      "criterion 1: B's local save now equals A's uploaded content",
      serializeDir(bSave).equals(serializeDir(aSave)),
      "content differs",
    );
    check(
      "criterion 1: install ran and sync state records the downloaded hash",
      bFs.calls.includes("install") &&
        bFs.getSyncState()?.lastDownloadedHash === aHash,
      JSON.stringify(bFs.getSyncState()),
    );

    // --- Criterion 3: configured backup dir holds a timestamped copy --------
    const backups = readdirSync(backupDir);
    check(
      "criterion 3: backup directory has one timestamped copy",
      backups.length === 1 && backups[0].startsWith("savegame1_"),
      backups.join(","),
    );
    check(
      "criterion 3: backup holds the pre-download local save",
      backups.length === 1 && serializeDir(join(backupDir, backups[0])).equals(bBefore),
      "backup content mismatch",
    );

    // --- Criterion 2: tampered archive fails verification, no replace ------
    resetB();
    const tamperFs = makeLocalFs({ backupDir });
    const tamperDownload = await runDownload(
      {
        farmId: farm.id,
        playerId: regA.user.id,
        fs25Root: bRoot,
        slot: 1,
        slotPath: bSave,
        slotUsed: true,
        expectedSha256: aSaveRow.sha256,
        apiBaseUrl: BASE,
      },
      downloadDeps(
        tamperFs,
        createGetToDisk({
          baseUrl: BASE,
          stageArchive,
          fetchImpl: tamperingFetch(flipByte),
        }),
      ),
    );
    check(
      "criterion 2: tampered archive fails with a verification error",
      tamperDownload.ok === false && tamperDownload.reason === "verification",
      JSON.stringify(tamperDownload),
    );
    check(
      "criterion 2: install is not called on verification failure",
      !tamperFs.calls.includes("install"),
      tamperFs.calls.join(","),
    );
    check(
      "criterion 2: B's original save is unchanged",
      serializeDir(bSave).equals(bBefore),
      "save changed unexpectedly",
    );
    check(
      "criterion 2: no sync state written",
      tamperFs.syncWrites.length === 0,
    );

    // --- Criterion 4: each failure path leaves the original recoverable -----
    async function failingDownload(label, fetchArchive, overrides) {
      resetB();
      const fs = makeLocalFs({ backupDir, overrides });
      const result = await runDownload(
        {
          farmId: farm.id,
          playerId: regA.user.id,
          fs25Root: bRoot,
          slot: 1,
          slotPath: bSave,
          slotUsed: true,
          expectedSha256: aSaveRow.sha256,
          apiBaseUrl: BASE,
        },
        downloadDeps(fs, fetchArchive),
      );
      check(`criterion 4: ${label} fails`, result.ok === false, JSON.stringify(result));
      check(
        `criterion 4: ${label} leaves B's original save unchanged`,
        serializeDir(bSave).equals(bBefore),
        "save changed unexpectedly",
      );
      check(
        `criterion 4: ${label} writes no sync state`,
        fs.syncWrites.length === 0,
      );
    }

    await failingDownload(
      "fetch failure",
      createGetToDisk({
        baseUrl: BASE,
        stageArchive,
        fetchImpl: async () => new Response("nope", { status: 500 }),
      }),
    );
    await failingDownload("unpack failure", getToDisk, {
      unpackSave: async () => {
        throw new Error("archive is not a zip");
      },
    });
    await failingDownload("install failure", getToDisk, {
      installSaveToSlot: async () => {
        throw new Error("swap failed");
      },
    });

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
