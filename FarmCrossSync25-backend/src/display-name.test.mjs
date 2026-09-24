// Display-name cloud sync tests for the Worker HTTP surface (ticket 84).
//
// Integration-style: the real Hono app driven through `app.request()` with the
// in-process D1/R2 stand-ins from `test-harness.mjs` (see its header for the
// rationale). The rename path is verified end to end: `PATCH /me` updates
// `users.display_name`, and every list that renders names reads it back out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DISPLAY_NAME_LENGTH } from "./identity.ts";
import {
  makeEnv,
  req,
  registerUser,
  createFarm,
  requestJoin,
  addMember,
} from "./test-harness.mjs";

const patchName = (env, token, body) => req(env, "PATCH", "/me", { token, body });

test("display-name cloud sync (integration)", async (t) => {
  await t.test("PATCH /me stores the trimmed display name and returns the user", async () => {
    const env = makeEnv();
    const alice = await registerUser(env, "inst-rename", "Old Name");

    const res = await patchName(env, alice.token, {
      displayName: "  Renamed User  ",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.user).sort(), [
      "createdAt",
      "displayName",
      "id",
      "installationId",
      "lastSeenAt",
    ]);
    assert.equal(res.json.user.displayName, "Renamed User", "trimmed");
    assert.equal(res.json.user.id, alice.user.id);
    assert.equal(res.json.user.installationId, alice.user.installationId);

    // The change is confirmed in the cloud: reads show the new name.
    const me = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(me.json.user.displayName, "Renamed User");
  });

  await t.test("farm member lists show the new name after the next refresh", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "inst-owner", "Owner");
    const member = await registerUser(env, "inst-member", "Member");
    const farm = await createFarm(env, owner.token, "Rename Farm");
    await addMember(env, owner, member.token, farm);

    const res = await patchName(env, member.token, { displayName: "Member Two" });
    assert.equal(res.status, 200);

    const list = await req(env, "GET", `/farms/${farm.id}/members`, {
      token: owner.token,
    });
    assert.equal(list.status, 200);
    const row = list.json.members.find((m) => m.user_id === member.user.id);
    assert.equal(row.display_name, "Member Two", "member list reflects the rename");
    const ownerRow = list.json.members.find((m) => m.user_id === owner.user.id);
    assert.equal(ownerRow.display_name, "Owner", "other members unchanged");
  });

  await t.test("pending join-request lists show the new name after the next refresh", async () => {
    const env = makeEnv();
    const owner = await registerUser(env, "inst-inv-owner", "Owner");
    const joiner = await registerUser(env, "inst-joiner", "Old Joiner");
    const farm = await createFarm(env, owner.token, "Invite Farm");
    await requestJoin(env, joiner.token, farm);

    const res = await patchName(env, joiner.token, { displayName: "New Joiner" });
    assert.equal(res.status, 200);

    const list = await req(env, "GET", `/farms/${farm.id}/invites`, {
      token: owner.token,
    });
    assert.equal(list.status, 200);
    const row = list.json.invites.find((i) => i.user_id === joiner.user.id);
    assert.equal(row.display_name, "New Joiner", "invite list reflects the rename");
  });

  await t.test("missing, non-string, and blank names are rejected and the stored name survives", async () => {
    const env = makeEnv();
    const alice = await registerUser(env, "inst-invalid", "Kept Name");

    const bodies = [undefined, null, {}, { displayName: 42 }, { displayName: "" }, { displayName: " \t  " }];
    for (const body of bodies) {
      const res = await patchName(env, alice.token, body);
      assert.equal(res.status, 400, `${JSON.stringify(body)} is rejected`);
      assert.deepEqual(res.json, { error: "displayName is required" });
    }

    // A failed update is unambiguous: the cloud name is unchanged, so the
    // client can keep the local setting clearly marked as not-yet-synced.
    const me = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(me.json.user.displayName, "Kept Name");
  });

  await t.test("over-long names get a distinct 400 and are never truncated; 64 chars are accepted", async () => {
    assert.equal(MAX_DISPLAY_NAME_LENGTH, 64, "matches the client's input cap");

    const env = makeEnv();
    const alice = await registerUser(env, "inst-length", "Kept Name");

    const tooLong = "n".repeat(MAX_DISPLAY_NAME_LENGTH + 1);
    const res = await patchName(env, alice.token, { displayName: tooLong });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, {
      error: "displayName must be at most 64 characters",
    });
    const me = await req(env, "GET", "/me", { token: alice.token });
    assert.equal(me.json.user.displayName, "Kept Name", "no silent truncation");

    const exactly = "n".repeat(MAX_DISPLAY_NAME_LENGTH);
    const ok = await patchName(env, alice.token, { displayName: exactly });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.user.displayName, exactly);
  });

  await t.test("PATCH /me requires a valid session", async () => {
    const env = makeEnv();
    const missing = await patchName(env, undefined, { displayName: "Nope" });
    assert.equal(missing.status, 401);
    assert.deepEqual(missing.json, { error: "unauthorized" });

    const bogus = await patchName(env, "not-a-real-token", { displayName: "Nope" });
    assert.equal(bogus.status, 401);
    assert.deepEqual(bogus.json, { error: "unauthorized" });
  });
});
