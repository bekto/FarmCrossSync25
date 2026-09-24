#!/usr/bin/env node
// Reliability failure-mode pass integration (ticket 47).
//
// Fills the Stage 7 checklist gaps not already covered by the three ticket
// e2e scripts: duplicate join requests over HTTP, simultaneous uploads
// (two members / same slot last-write-wins), backend 5xx and network failure
// during upload, and multiple installations (PCs) / multiple farms.
//
// Drives the real client code paths — `runUpload`, `createApiClient`, and
// `createPutToR2` — against the local Worker/D1/R2. Only the Tauri filesystem
// commands validate/read-metadata/pack/hash/sync-state are faked, exactly as in
// `upload-e2e.mjs`. Local save recoverability is asserted by keeping the real
// cloud metadata row and R2 object intact across each failure.
//
// Usage: node scripts/reliability-e2e.mjs   (starts and stops its own Worker)
// Requires: backend deps installed; ENABLE_R2_TEST is set by this script.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "../src/lib/api.ts";
import { runUpload, LOCAL_SAVE_SAFE_MESSAGE } from "../src/lib/upload.ts";
import { createPutToR2 } from "../src/lib/uploadTransport.ts";

const BACKEND_DIR = fileURLToPath(
  new URL("../../FarmCrossSync25-backend", import.meta.url),
);
const PORT = Number(process.env.PORT ?? 8795);
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
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

// Fake local filesystem deps (the real ones are Tauri commands). Mirrors
// upload-e2e.mjs so the orchestration being exercised is the production module.
function localDeps({ archivePath, savePath, hash }) {
  let syncState = null;
  return {
    deps: {
      validateSave: async () => ({
        state: "valid",
        path: savePath,
        mapName: "Reliability Map",
        lastModified: new Date().toISOString(),
        missingFiles: [],
        message: null,
      }),
      readMetadata: async () => ({
        slot: 1,
        mapName: "Reliability Map",
        path: savePath,
        lastModified: new Date().toISOString(),
        sizeBytes: 16,
        contentHash: hash,
      }),
      packSave: async () => ({ archivePath, sizeBytes: 16, fileCount: 1 }),
      onPackProgress: async () => () => {},
      computeHash: async () => ({ hash }),
      readSyncState: async () => syncState,
      writeSyncState: async (farmId, state) => {
        syncState = state;
        return state;
      },
      cleanupPack: async () => {},
    },
    getSyncState: () => syncState,
  };
}

function uploadDepsFor(client, fs, putToR2) {
  return {
    ...fs.deps,
    uploadAuthorize: async ({ farmId }) => {
      const body = await client.post("/saves/upload-authorize", { farmId });
      return body.authorization;
    },
    putToR2,
    uploadComplete: async (input) => {
      const body = await client.post("/saves/upload-complete", input);
      return { uploadedAt: body.save.uploadedAt };
    },
  };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "reliability-e2e-"));
  const saveA = join(workDir, "saveA");
  const saveB = join(workDir, "saveB");

  // Distinct archive bytes per upload so hashes are distinguishable.
  const archive = (name, contents) => {
    const path = join(workDir, name);
    writeFileSync(path, contents);
    const bytes = Buffer.from(contents);
    return { path, hash: sha256(bytes) };
  };
  const a1 = archive("a1.zip", "owner-a-save-v1");
  const a2 = archive("a2.zip", "owner-a-save-v2");
  const a3 = archive("a3.zip", "owner-a-save-v3");
  const a4 = archive("a4.zip", "owner-a-save-v4");
  const a5 = archive("a5.zip", "owner-a-save-v5");
  const b1 = archive("b1.zip", "member-b-save-v1");

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

    const publicApi = createApiClient({ baseUrl: BASE });
    const stamp = Date.now();
    async function register(label, installationId) {
      const res = await publicApi.post(
        "/register",
        { installationId, displayName: label },
        { auth: false },
      );
      return {
        user: res.user,
        token: res.token,
        client: createApiClient({ baseUrl: BASE, getToken: async () => res.token }),
      };
    }

    const A = await register("Owner A", `rel-owner-${stamp}`);
    const B = await register("Member B", `rel-member-${stamp}`);
    const putToR2 = createPutToR2({
      baseUrl: BASE,
      readFile: async (path) => new Uint8Array(await readFile(path)),
    });

    const { farm } = await A.client.post("/farms", { name: "Reliability Farm" });

    async function expectStatus(promise, status) {
      try {
        await promise;
        return { ok: false, got: "success" };
      } catch (error) {
        return { ok: error.status === status, got: error.status ?? String(error) };
      }
    }

    // --- Duplicate join requests -----------------------------------------
    const firstJoin = await B.client.post(`/farms/${farm.id}/join`, {
      code: farm.code,
    });
    check(
      "duplicate join: first join creates a pending request",
      firstJoin.invite?.status === "pending",
      JSON.stringify(firstJoin),
    );
    const secondJoin = await expectStatus(
      B.client.post(`/farms/${farm.id}/join`, { code: farm.code }),
      409,
    );
    check("duplicate join: second join is rejected while pending (409)", secondJoin.ok, JSON.stringify(secondJoin));

    const wrongCode = await expectStatus(
      B.client.post(`/farms/${farm.id}/join`, { code: "ZZZZ-ZZZ" }),
      404,
    );
    check("duplicate join: a wrong code is 404 (farm not found)", wrongCode.ok, JSON.stringify(wrongCode));

    const { invites } = await A.client.get(`/farms/${farm.id}/invites`);
    await A.client.post(`/invites/${invites[0].id}/accept`);
    const afterAccept = await expectStatus(
      B.client.post(`/farms/${farm.id}/join`, { code: farm.code }),
      409,
    );
    check("duplicate join: joining once already a member is 409", afterAccept.ok, JSON.stringify(afterAccept));

    // --- Simultaneous uploads: two members, one slot each -----------------
    const fsA1 = localDeps({ archivePath: a1.path, savePath: saveA, hash: a1.hash });
    const fsB1 = localDeps({ archivePath: b1.path, savePath: saveB, hash: b1.hash });
    const [upA, upB] = await Promise.all([
      runUpload({ farmId: farm.id, savePath: saveA }, uploadDepsFor(A.client, fsA1, putToR2)),
      runUpload({ farmId: farm.id, savePath: saveB }, uploadDepsFor(B.client, fsB1, putToR2)),
    ]);
    check("simultaneous uploads: both members' uploads succeed", upA.ok && upB.ok, JSON.stringify({ upA, upB }));

    const rowsAfterConcurrent = (await A.client.get(`/farms/${farm.id}/saves`)).saves;
    const rowOf = (list, id) => list.filter((s) => s.user_id === id);
    check(
      "simultaneous uploads: exactly one slot row per member",
      rowOf(rowsAfterConcurrent, A.user.id).length === 1 &&
        rowOf(rowsAfterConcurrent, B.user.id).length === 1,
      JSON.stringify(rowsAfterConcurrent),
    );
    check(
      "simultaneous uploads: each slot holds that member's hash",
      rowOf(rowsAfterConcurrent, A.user.id)[0]?.sha256 === a1.hash &&
        rowOf(rowsAfterConcurrent, B.user.id)[0]?.sha256 === b1.hash,
      JSON.stringify(rowsAfterConcurrent),
    );

    const objectSha = async (key) => {
      const res = await fetch(`${BASE}/r2-test/${encodeURIComponent(key)}`);
      if (!res.ok) return null;
      return sha256(Buffer.from(new Uint8Array(await res.arrayBuffer())));
    };
    for (const row of rowsAfterConcurrent) {
      check(
        `simultaneous uploads: R2 object matches the slot row for ${row.user_id === A.user.id ? "A" : "B"}`,
        (await objectSha(row.object_key)) === row.sha256,
      );
    }

    // --- Last-write-wins per slot (sequential, distinct hashes) -----------
    const fsA2 = localDeps({ archivePath: a2.path, savePath: saveA, hash: a2.hash });
    await runUpload({ farmId: farm.id, savePath: saveA }, uploadDepsFor(A.client, fsA2, putToR2));
    const fsA3 = localDeps({ archivePath: a3.path, savePath: saveA, hash: a3.hash });
    await runUpload({ farmId: farm.id, savePath: saveA }, uploadDepsFor(A.client, fsA3, putToR2));
    const rowsAfterRewrite = (await A.client.get(`/farms/${farm.id}/saves`)).saves;
    const aSlot = rowOf(rowsAfterRewrite, A.user.id);
    check("last-write-wins: still one slot row after two more uploads", aSlot.length === 1, JSON.stringify(rowsAfterRewrite));
    check("last-write-wins: the latest upload's hash wins", aSlot[0]?.sha256 === a3.hash, JSON.stringify(aSlot[0]));
    check("last-write-wins: R2 object matches the winning hash", (await objectSha(aSlot[0].object_key)) === a3.hash);

    // --- Concurrent same-slot uploads: still a single, coherent slot ------
    const fsA4 = localDeps({ archivePath: a4.path, savePath: saveA, hash: a4.hash });
    const fsA5 = localDeps({ archivePath: a5.path, savePath: saveA, hash: a5.hash });
    const [upA4, upA5] = await Promise.all([
      runUpload({ farmId: farm.id, savePath: saveA }, uploadDepsFor(A.client, fsA4, putToR2)),
      runUpload({ farmId: farm.id, savePath: saveA }, uploadDepsFor(A.client, fsA5, putToR2)),
    ]);
    check("concurrent same-slot uploads: both calls resolve", upA4.ok && upA5.ok, JSON.stringify({ upA4, upA5 }));
    const rowsAfterSameSlot = (await A.client.get(`/farms/${farm.id}/saves`)).saves;
    const aSlotConcurrent = rowOf(rowsAfterSameSlot, A.user.id);
    check(
      "concurrent same-slot uploads: exactly one slot row remains",
      aSlotConcurrent.length === 1,
      JSON.stringify(rowsAfterSameSlot),
    );
    check(
      "concurrent same-slot uploads: the row is one of the concurrent uploads",
      [a4.hash, a5.hash].includes(aSlotConcurrent[0]?.sha256),
      JSON.stringify(aSlotConcurrent[0]),
    );
    const concurrentObjectSha = aSlotConcurrent[0]
      ? await objectSha(aSlotConcurrent[0].object_key)
      : null;
    check(
      "concurrent same-slot uploads: R2 object matches the winning row",
      concurrentObjectSha === aSlotConcurrent[0]?.sha256,
      `object=${concurrentObjectSha} row=${aSlotConcurrent[0]?.sha256}`,
    );

    // --- Backend failure during upload leaves the local save safe ---------
    const beforeFailure = JSON.stringify(
      (await A.client.get(`/farms/${farm.id}/saves`)).saves,
    );

    const serverErrorClient = createApiClient({
      baseUrl: BASE,
      getToken: async () => A.token,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });
    const fsFail1 = localDeps({ archivePath: a2.path, savePath: saveA, hash: a2.hash });
    const failed500 = await runUpload(
      { farmId: farm.id, savePath: saveA },
      uploadDepsFor(serverErrorClient, fsFail1, putToR2),
    );
    check("backend 5xx: upload resolves as a failure", failed500.ok === false, JSON.stringify(failed500));
    check(
      "backend 5xx: failure copy promises the local save is safe",
      failed500.message.includes(LOCAL_SAVE_SAFE_MESSAGE),
      failed500.message,
    );
    check("backend 5xx: no sync state written", fsFail1.getSyncState() === null);

    const networkErrorClient = createApiClient({
      baseUrl: BASE,
      getToken: async () => A.token,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const fsFail2 = localDeps({ archivePath: a2.path, savePath: saveA, hash: a2.hash });
    const failedOffline = await runUpload(
      { farmId: farm.id, savePath: saveA },
      uploadDepsFor(networkErrorClient, fsFail2, putToR2),
    );
    check("network failure: upload resolves as a failure", failedOffline.ok === false, JSON.stringify(failedOffline));
    check(
      "network failure: failure copy promises the local save is safe",
      failedOffline.message.includes(LOCAL_SAVE_SAFE_MESSAGE),
      failedOffline.message,
    );
    check("network failure: no sync state written", fsFail2.getSyncState() === null);

    const afterFailure = JSON.stringify(
      (await A.client.get(`/farms/${farm.id}/saves`)).saves,
    );
    check("backend failure: previous cloud save metadata unchanged", beforeFailure === afterFailure);

    // --- Multiple installations (multiple PCs) ----------------------------
    const PC1 = await register("PC One", `rel-pc1-${stamp}`);
    const PC2 = await register("PC Two", `rel-pc2-${stamp}`);
    check("multiple PCs: separate installation IDs register distinct users", PC1.user.id !== PC2.user.id);
    const pc1Again = await publicApi.post(
      "/register",
      { installationId: `rel-pc1-${stamp}`, displayName: "PC One" },
      { auth: false },
    );
    check(
      "multiple PCs: re-registering the same installation keeps the same user",
      pc1Again.user.id === PC1.user.id,
    );
    check(
      "multiple PCs: each installation receives its own session token",
      pc1Again.token !== PC2.token && PC1.token !== PC2.token,
    );
    const pcFarm = (await PC1.client.post("/farms", { name: "PC One Farm" })).farm;
    const pcFarm2 = (await PC2.client.post("/farms", { name: "PC Two Farm" })).farm;
    check("multiple PCs: each PC owns its own farm", pcFarm.id !== pcFarm2.id);

    // --- Multiple farms per user: separate slots --------------------------
    const farm2 = (await A.client.post("/farms", { name: "Reliability Farm 2" })).farm;
    const fsFarm2 = localDeps({ archivePath: a3.path, savePath: saveA, hash: a3.hash });
    await runUpload({ farmId: farm2.id, savePath: saveA }, uploadDepsFor(A.client, fsFarm2, putToR2));

    const farm1Saves = (await A.client.get(`/farms/${farm.id}/saves`)).saves;
    const farm2Saves = (await A.client.get(`/farms/${farm2.id}/saves`)).saves;
    check(
      "multiple farms: a user's save is scoped to its farm",
      farm1Saves.length === 2 &&
        farm2Saves.length === 1 &&
        farm2Saves[0].user_id === A.user.id &&
        farm2Saves[0].sha256 === a3.hash,
      JSON.stringify({ farm1Saves, farm2Saves }),
    );

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
