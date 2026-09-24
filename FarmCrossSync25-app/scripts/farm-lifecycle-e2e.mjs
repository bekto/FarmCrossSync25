#!/usr/bin/env node
// Farm lifecycle end-to-end integration (ticket 43).
//
// Drives the real client code paths — `createApiClient`, `httpFarmApi`,
// `httpOwnerApi`, `createFarmScreen`, `createOwnerActions`, `createSettings`,
// and `createPutToR2` — against the local Worker/D1/R2, with two registered
// users (A, B) exercising the whole farm lifecycle.
//
// What it checks:
//   1. A creates a farm; B joins by code; A approves; both screens see each
//      other; B sees A's uploaded save.
//   2. A (owner) kicks B, then B rejoins and leaves: in both cases B's
//      membership, `player_saves` row, and R2 object disappear while A's
//      survive.
//   3. Ownership transfer A -> B -> A (B acts as owner), then owner leaves with
//      members remaining and the earliest-joined survivor inherits ownership.
//   4. The last member leaving deletes the farm row, memberships, invites, and
//      player saves (asserted directly against local D1) and its R2 objects;
//      `GET /farms/:id` then 404s.
//
// Usage: node scripts/farm-lifecycle-e2e.mjs   (starts and stops its own Worker)
// Requires: backend deps installed; ENABLE_R2_TEST is set by this script.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiClient } from "../src/lib/api.ts";
import { createFarmScreen, httpFarmApi } from "../src/lib/farmScreen.ts";
import { createOwnerActions, httpOwnerApi } from "../src/lib/ownerActions.ts";
import { createSettings } from "../src/lib/settings.ts";
import { createPutToR2 } from "../src/lib/uploadTransport.ts";

const BACKEND_DIR = fileURLToPath(
  new URL("../../FarmCrossSync25-backend", import.meta.url),
);
const PORT = Number(process.env.PORT ?? 8793);
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

function d1Count(sql) {
  const res = spawnSync(
    NPX,
    ["wrangler", "d1", "execute", "DB", "--local", "--json", "--command", sql],
    { cwd: BACKEND_DIR, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(`d1 execute failed: ${res.stderr || res.stdout}`);
  }
  const parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf("[")));
  return parsed[0].results[0].n;
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "farm-lifecycle-e2e-"));
  const keyFor = (farmId, userId) => `farms/${farmId}/players/${userId}/save`;
  const r2Exists = async (key) =>
    (await fetch(`${BASE}/r2-test/${encodeURIComponent(key)}`)).ok;

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

    // --- Shared client plumbing -------------------------------------------
    const publicApi = createApiClient({ baseUrl: BASE });
    const stamp = Date.now();
    const putToR2 = createPutToR2({
      baseUrl: BASE,
      readFile: async (path) => new Uint8Array(readFileSync(path)),
    });
    // No-op scheduler: farm screens load on demand and never leave a live timer.
    const noopScheduler = { setInterval: () => 0, clearInterval: () => {} };

    async function registerUser(label) {
      const res = await publicApi.post(
        "/register",
        { installationId: `life-${label}-${stamp}`, displayName: label },
        { auth: false },
      );
      return {
        user: res.user,
        token: res.token,
        getToken: async () => res.token,
        client: createApiClient({ baseUrl: BASE, getToken: async () => res.token }),
      };
    }

    const screenFor = (getToken) =>
      createFarmScreen(
        {
          ...httpFarmApi(BASE, getToken),
          copyToClipboard: async () => {},
          runUpload: async () => ({ ok: true }),
          runDownload: async () => ({ ok: true }),
        },
        { scheduler: noopScheduler },
      );

    const ownerActionsFor = (getToken) =>
      createOwnerActions({
        ...httpOwnerApi(BASE, getToken),
        confirm: () => true,
      });

    const settingsFor = (getToken) => {
      const api = httpOwnerApi(BASE, getToken);
      const farmApi = httpFarmApi(BASE, getToken);
      return createSettings({
        getIdentity: async () => ({
          installationId: "e2e",
          displayName: "E2E",
          backupLocation: null,
        }),
        setDisplayName: async (name) => ({
          installationId: "e2e",
          displayName: name,
          backupLocation: null,
        }),
        getSyncState: async () => null,
        pickFolder: async () => null,
        validateSave: async (path) => ({
          state: "valid",
          path,
          mapName: null,
          lastModified: null,
          missingFiles: [],
          message: null,
        }),
        readMetadata: async () => ({
          slot: 1,
          mapName: "E2E",
          path: "",
          lastModified: new Date().toISOString(),
          sizeBytes: 0,
          contentHash: "",
        }),
        getBackupLocation: async () => null,
        setBackupLocation: async () => ({}),
        fetchFarm: (farmId) => farmApi.fetchFarm(farmId),
        // Mirrors +page.svelte: leave = DELETE own membership.
        leaveFarm: async (farmId) => {
          const me = await api.fetchCurrentUserId();
          if (!me) throw new Error("could not resolve the signed-in player");
          await api.kickMember(farmId, me);
        },
        confirm: () => true,
      });
    };

    async function joinAndAccept(ownerActions, farm, member) {
      await member.client.post(`/farms/${farm.id}/join`, { code: farm.code });
      await ownerActions.loadInvites(farm.id, true);
      const invites = ownerActions.snapshot().invites;
      const invite = invites.find((i) => i.user_id === member.user.id);
      if (!invite) throw new Error(`no pending invite for ${member.user.displayName}`);
      await ownerActions.accept(farm.id, invite.id);
      return invites;
    }

    // Seeds a cloud save through the real authorize + R2 transport +
    // upload-complete path (the ticket-41 upload sequence, minus zip packing).
    async function seedSave(client, farmId, userId, saveName, bytes) {
      const key = keyFor(farmId, userId);
      const archivePath = join(workDir, `seed-${farmId}-${userId}.zip`);
      writeFileSync(archivePath, bytes);
      const { authorization } = await client.post("/saves/upload-authorize", {
        farmId,
      });
      if (authorization.presigned !== false) {
        throw new Error("expected the local-dev (non-presigned) authorization");
      }
      await putToR2({ archivePath, sizeBytes: bytes.length, authorization });
      const sha = sha256(bytes);
      await client.post("/saves/upload-complete", {
        farmId,
        objectKey: key,
        fileSize: bytes.length,
        sha256: sha,
        saveName,
      });
      return { key, sha };
    }

    async function expectStatus(promise, status) {
      try {
        await promise;
        return { ok: false, got: "success" };
      } catch (error) {
        return { ok: error.status === status, got: error.status ?? String(error) };
      }
    }

    function memberNames(screen) {
      return screen.snapshot().players.map((p) => p.display_name).sort();
    }

    const A = await registerUser("Owner A");
    const B = await registerUser("Member B");
    const bytesA = Buffer.from(`owner-a-save-${stamp}`);
    const bytesB = Buffer.from(`member-b-save-${stamp}`);

    // === Criterion 1: create, join, approve, sees each other's saves ========
    const ownerA = ownerActionsFor(A.getToken);
    const farm1 = (
      await A.client.post("/farms", { name: "Lifecycle Farm 1" })
    ).farm;
    const screenA1 = screenFor(A.getToken);
    await screenA1.selectFarm(farm1.id);
    check(
      "criterion 1: A sees the created farm",
      screenA1.snapshot().farm?.name === "Lifecycle Farm 1",
      JSON.stringify(screenA1.snapshot().farm),
    );

    const invites1 = await joinAndAccept(ownerA, farm1, B);
    check(
      "criterion 1: A lists B's pending join request",
      invites1.some((i) => i.user_id === B.user.id),
      JSON.stringify(invites1),
    );
    await screenA1.refresh();
    check(
      "criterion 1: A sees both members after approving",
      JSON.stringify(memberNames(screenA1)) === JSON.stringify(["Member B", "Owner A"]),
      JSON.stringify(memberNames(screenA1)),
    );

    const screenB1 = screenFor(B.getToken);
    await screenB1.selectFarm(farm1.id);
    check(
      "criterion 1: B sees both members",
      JSON.stringify(memberNames(screenB1)) === JSON.stringify(["Member B", "Owner A"]),
      JSON.stringify(memberNames(screenB1)),
    );

    const saveA1 = await seedSave(A.client, farm1.id, A.user.id, "A Map", bytesA);
    await screenB1.refresh();
    const aRow = screenB1
      .snapshot()
      .players.find((p) => p.user_id === A.user.id);
    check(
      "criterion 1: B's farm screen shows A's save with A's hash",
      aRow?.save?.sha256 === saveA1.sha,
      JSON.stringify(aRow?.save),
    );
    const savesB1 = (await B.client.get(`/farms/${farm1.id}/saves`)).saves;
    check(
      "criterion 1: GET /saves as B contains A's row",
      savesB1.some((s) => s.user_id === A.user.id && s.sha256 === saveA1.sha),
      JSON.stringify(savesB1),
    );

    // === Criterion 2: kick and leave delete membership + cloud save =========
    const ownerA2 = ownerActionsFor(A.getToken);
    const farm2 = (
      await A.client.post("/farms", { name: "Lifecycle Farm 2" })
    ).farm;
    await joinAndAccept(ownerA2, farm2, B);
    const saveA2 = await seedSave(A.client, farm2.id, A.user.id, "A Map", bytesA);
    const saveB2 = await seedSave(B.client, farm2.id, B.user.id, "B Map", bytesB);

    const kicked = await ownerA2.kick(farm2.id, B.user.id, "Member B");
    check("criterion 2: A kicks B (confirmed)", kicked === true);
    const members2 = (await A.client.get(`/farms/${farm2.id}/members`)).members;
    check(
      "criterion 2 (kick): B's membership is gone",
      !members2.some((m) => m.user_id === B.user.id),
      JSON.stringify(members2),
    );
    const saves2 = (await A.client.get(`/farms/${farm2.id}/saves`)).saves;
    check(
      "criterion 2 (kick): B's cloud save row is deleted",
      !saves2.some((s) => s.user_id === B.user.id),
      JSON.stringify(saves2),
    );
    check(
      "criterion 2 (kick): A's cloud save row survives",
      saves2.some((s) => s.user_id === A.user.id && s.sha256 === saveA2.sha),
      JSON.stringify(saves2),
    );
    check(
      "criterion 2 (kick): B's R2 object is deleted",
      !(await r2Exists(saveB2.key)),
    );
    check(
      "criterion 2 (kick): A's R2 object survives",
      await r2Exists(saveA2.key),
    );
    check(
      "criterion 2 (kick): B can no longer read the farm",
      (await expectStatus(B.client.get(`/farms/${farm2.id}/members`), 403)).ok,
    );

    // Separately: B rejoins, uploads, then leaves under their own power.
    await joinAndAccept(ownerA2, farm2, B);
    const saveB2b = await seedSave(B.client, farm2.id, B.user.id, "B Map", bytesB);
    const settingsB2 = settingsFor(B.getToken);
    await settingsB2.load(farm2.id);
    const leftB = await settingsB2.leave(farm2.id);
    check("criterion 2: B leaves (confirmed)", leftB === true);
    const members2b = (await A.client.get(`/farms/${farm2.id}/members`)).members;
    check(
      "criterion 2 (leave): B's membership is gone",
      !members2b.some((m) => m.user_id === B.user.id),
      JSON.stringify(members2b),
    );
    const saves2b = (await A.client.get(`/farms/${farm2.id}/saves`)).saves;
    check(
      "criterion 2 (leave): B's cloud save row is deleted",
      !saves2b.some((s) => s.user_id === B.user.id),
      JSON.stringify(saves2b),
    );
    check(
      "criterion 2 (leave): B's R2 object is deleted",
      !(await r2Exists(saveB2b.key)),
    );
    check(
      "criterion 2 (leave): the farm survives for A",
      (await A.client.get(`/farms/${farm2.id}`)).farm.id === farm2.id,
    );

    // === Criterion 3: ownership transfer and leave-succession ==============
    const ownerA3 = ownerActionsFor(A.getToken);
    const farm3 = (
      await A.client.post("/farms", { name: "Lifecycle Farm 3" })
    ).farm;
    await joinAndAccept(ownerA3, farm3, B);

    const transferred = await ownerA3.makeOwner(farm3.id, B.user.id, "Member B");
    check("criterion 3: A transfers ownership to B (confirmed)", transferred === true);
    const farm3AsB = (await B.client.get(`/farms/${farm3.id}`)).farm;
    check(
      "criterion 3: farm owner_id is now B",
      farm3AsB.owner_id === B.user.id,
      JSON.stringify(farm3AsB),
    );
    const members3 = (await B.client.get(`/farms/${farm3.id}/members`)).members;
    const roleOf = (list, id) => list.find((m) => m.user_id === id)?.role;
    check(
      "criterion 3: roles swapped (B owner, A member)",
      roleOf(members3, B.user.id) === "owner" && roleOf(members3, A.user.id) === "member",
      JSON.stringify(members3),
    );

    const ownerB3 = ownerActionsFor(B.getToken);
    await ownerB3.loadInvites(farm3.id, true);
    check(
      "criterion 3: B can act as owner (lists invites)",
      ownerB3.snapshot().error === null,
      JSON.stringify(ownerB3.snapshot()),
    );
    check(
      "criterion 3: A lost owner-only access (invites 403)",
      (await expectStatus(A.client.get(`/farms/${farm3.id}/invites`), 403)).ok,
    );

    const transferredBack = await ownerB3.makeOwner(farm3.id, A.user.id, "Owner A");
    check("criterion 3: B transfers ownership back to A", transferredBack === true);
    check(
      "criterion 3: farm owner_id is A again",
      (await A.client.get(`/farms/${farm3.id}`)).farm.owner_id === A.user.id,
    );

    // Owner leaves while a member remains: earliest-joined survivor inherits.
    const saveA3 = await seedSave(A.client, farm3.id, A.user.id, "A Map", bytesA);
    const settingsA3 = settingsFor(A.getToken);
    await settingsA3.load(farm3.id);
    const ownerLeft = await settingsA3.leave(farm3.id);
    check("criterion 3: A (owner) leaves with B remaining", ownerLeft === true);
    check(
      "criterion 3: leave-succession makes B the owner",
      (await B.client.get(`/farms/${farm3.id}`)).farm.owner_id === B.user.id,
    );
    const members3b = (await B.client.get(`/farms/${farm3.id}/members`)).members;
    check(
      "criterion 3: B is the sole remaining owner",
      members3b.length === 1 && roleOf(members3b, B.user.id) === "owner",
      JSON.stringify(members3b),
    );
    const ownerB3b = ownerActionsFor(B.getToken);
    await ownerB3b.loadInvites(farm3.id, true);
    check(
      "criterion 3: successor B can act as owner",
      ownerB3b.snapshot().error === null,
      JSON.stringify(ownerB3b.snapshot()),
    );
    check(
      "criterion 3: departing owner's R2 object is deleted",
      !(await r2Exists(saveA3.key)),
    );

    // === Criterion 4: last member leaving deletes the farm and its saves ====
    const ownerA4 = ownerActionsFor(A.getToken);
    const farm4 = (
      await A.client.post("/farms", { name: "Lifecycle Farm 4" })
    ).farm;
    await joinAndAccept(ownerA4, farm4, B);
    const saveA4 = await seedSave(A.client, farm4.id, A.user.id, "A Map", bytesA);
    const saveB4 = await seedSave(B.client, farm4.id, B.user.id, "B Map", bytesB);

    const settingsB4 = settingsFor(B.getToken);
    await settingsB4.load(farm4.id);
    check("criterion 4: B (member) leaves first", (await settingsB4.leave(farm4.id)) === true);
    check(
      "criterion 4: farm survives after a non-last member leaves",
      (await A.client.get(`/farms/${farm4.id}`)).farm.id === farm4.id,
    );
    check(
      "criterion 4: departing member's R2 object is deleted",
      !(await r2Exists(saveB4.key)),
    );
    check(
      "criterion 4: remaining owner's R2 object survives",
      await r2Exists(saveA4.key),
    );

    const settingsA4 = settingsFor(A.getToken);
    await settingsA4.load(farm4.id);
    check("criterion 4: A (last member) leaves", (await settingsA4.leave(farm4.id)) === true);
    check(
      "criterion 4: GET /farms/:id now 404s",
      (await expectStatus(A.client.get(`/farms/${farm4.id}`), 404)).ok,
    );
    check(
      "criterion 4: both R2 objects are deleted",
      !(await r2Exists(saveA4.key)) && !(await r2Exists(saveB4.key)),
    );

    // Direct D1 assertions for the row-level cascade. Run after the Worker is
    // stopped so the local SQLite file is not held open concurrently.
    console.log("\nstopping worker for direct D1 assertions...");
    stopWorker();
    await sleep(1000);
    const countIn = (table) =>
      d1Count(`SELECT COUNT(*) AS n FROM ${table} WHERE farm_id = '${farm4.id}'`);
    check("criterion 4: farm row deleted", d1Count(`SELECT COUNT(*) AS n FROM farms WHERE id = '${farm4.id}'`) === 0);
    check("criterion 4: memberships deleted", countIn("farm_members") === 0);
    check("criterion 4: invites deleted", countIn("farm_invites") === 0);
    check("criterion 4: player_saves deleted", countIn("player_saves") === 0);

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
