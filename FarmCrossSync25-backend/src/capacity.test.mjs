// Farm capacity under concurrent invitation acceptance (ticket 81).
//
// The 16-member cap must hold when several accepts race. The guard is the
// conditional `INSERT ... SELECT ... WHERE COUNT(*) < 16` inside the same
// batch that resolves the invite (src/index.ts accept handler): each statement
// is self-contained, so even interleaved execution can never exceed the cap,
// and the invite transition requires the membership to exist. Racing accepts
// therefore resolve exactly like the sequential equivalent: one 200, and a
// deterministic conflict (409 `farm_full` at capacity, 409 `invite_not_pending`
// for an already-resolved invite) — never two memberships, never 17 members.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv,
  req,
  registerUser,
  createFarm,
  requestJoin,
  addMember,
} from "./test-harness.mjs";

const memberCount = async (env, farmId) => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM farm_members WHERE farm_id = ?1",
  )
    .bind(farmId)
    .first();
  return row.count;
};

const inviteStatus = async (env, inviteId) => {
  const row = await env.DB.prepare(
    "SELECT status FROM farm_invites WHERE id = ?1",
  )
    .bind(inviteId)
    .first();
  return row?.status;
};

const isMember = async (env, farmId, userId) =>
  (await env.DB.prepare(
    "SELECT 1 FROM farm_members WHERE farm_id = ?1 AND user_id = ?2",
  )
    .bind(farmId, userId)
    .first()) !== null;

// Owner + (size - 1) accepted members, so the farm stands at `size` members.
async function farmWithMembers(size) {
  const env = makeEnv();
  const owner = await registerUser(env, `cap-owner-${size}`, "Owner");
  const farm = await createFarm(env, owner.token, "Cap Farm");
  for (let i = 1; i < size; i++) {
    const user = await registerUser(env, `cap-m${size}-${i}`, `Member ${i}`);
    await addMember(env, owner, user.token, farm);
  }
  return { env, owner, farm };
}

test("farm capacity under concurrency (ticket 81)", async (t) => {
  await t.test("two concurrent accepts at 15 members never exceed 16", async () => {
    const { env, owner, farm } = await farmWithMembers(15);
    assert.equal(await memberCount(env, farm.id), 15);

    const userA = await registerUser(env, "cap-race-a", "A");
    const userB = await registerUser(env, "cap-race-b", "B");
    const inviteA = await requestJoin(env, userA.token, farm);
    const inviteB = await requestJoin(env, userB.token, farm);

    const [r1, r2] = await Promise.all([
      req(env, "POST", `/invites/${inviteA.id}/accept`, { token: owner.token }),
      req(env, "POST", `/invites/${inviteB.id}/accept`, { token: owner.token }),
    ]);

    // Exactly one accept wins; the other is a deterministic conflict.
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const winnerIsA = r1.status === 200;
    const winner = winnerIsA ? r1 : r2;
    const loser = winnerIsA ? r2 : r1;
    assert.equal(winner.json.invite.status, "accepted");
    assert.deepEqual(loser.json, { error: "farm_full", max: 16 });

    // Membership state is consistent: 16 members exactly, the loser's request
    // is untouched (still pending, not a member), and the farm is at capacity.
    assert.equal(await memberCount(env, farm.id), 16, "never more than 16");
    const winnerId = winnerIsA ? userA.user.id : userB.user.id;
    const loserId = winnerIsA ? userB.user.id : userA.user.id;
    assert.equal(await isMember(env, farm.id, winnerId), true);
    assert.equal(await isMember(env, farm.id, loserId), false);
    assert.equal(
      await inviteStatus(env, winnerIsA ? inviteA.id : inviteB.id),
      "accepted",
    );
    assert.equal(
      await inviteStatus(env, winnerIsA ? inviteB.id : inviteA.id),
      "pending",
    );

    // Deterministic conflict response when full: a fresh request is a 409.
    const userC = await registerUser(env, "cap-full-c", "C");
    const late = await req(env, "POST", `/farms/${farm.id}/join`, {
      token: userC.token,
      body: { code: farm.code },
    });
    assert.equal(late.status, 409);
    assert.deepEqual(late.json, { error: "farm_full", max: 16 });
  });

  await t.test("two concurrent accepts of the same invite stay consistent", async () => {
    const { env, owner, farm } = await farmWithMembers(14);
    const user = await registerUser(env, "cap-race-same", "Same");
    const invite = await requestJoin(env, user.token, farm);

    const [r1, r2] = await Promise.all([
      req(env, "POST", `/invites/${invite.id}/accept`, { token: owner.token }),
      req(env, "POST", `/invites/${invite.id}/accept`, { token: owner.token }),
    ]);

    // The race resolves exactly like two sequential accepts: one 200, the
    // repeat is invite_not_pending — never a duplicate membership.
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    assert.deepEqual(loser.json, { error: "invite_not_pending" });
    assert.equal(await memberCount(env, farm.id), 15, "member added exactly once");
    assert.equal(await inviteStatus(env, invite.id), "accepted");
    assert.equal(await isMember(env, farm.id, user.user.id), true);
  });

  await t.test("a stale invite at capacity gets farm_full and adds nobody", async () => {
    const { env, owner, farm } = await farmWithMembers(15);
    const userC = await registerUser(env, "cap-stale-c", "C");
    const inviteC = await requestJoin(env, userC.token, farm); // pending at 15

    const userD = await registerUser(env, "cap-stale-d", "D");
    await addMember(env, owner, userD.token, farm); // fills the farm to 16
    assert.equal(await memberCount(env, farm.id), 16);

    const res = await req(env, "POST", `/invites/${inviteC.id}/accept`, {
      token: owner.token,
    });
    assert.equal(res.status, 409);
    assert.deepEqual(res.json, { error: "farm_full", max: 16 });
    assert.equal(await memberCount(env, farm.id), 16, "no membership sneaks in");
    assert.equal(await isMember(env, farm.id, userC.user.id), false);
    assert.equal(await inviteStatus(env, inviteC.id), "pending");
  });

  await t.test("repeated racing accepts converge on one member", async () => {
    // Heavier variant: five concurrent accepts of five invites with only one
    // slot left — exactly one may succeed.
    const { env, owner, farm } = await farmWithMembers(15);
    const users = [];
    const invites = [];
    for (let i = 0; i < 5; i++) {
      const user = await registerUser(env, `cap-storm-${i}`, `Storm ${i}`);
      users.push(user);
      invites.push(await requestJoin(env, user.token, farm));
    }

    const results = await Promise.all(
      invites.map((invite) =>
        req(env, "POST", `/invites/${invite.id}/accept`, { token: owner.token }),
      ),
    );

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409, 409]);
    for (const res of results) {
      if (res.status === 409) {
        assert.deepEqual(res.json, { error: "farm_full", max: 16 });
      }
    }
    assert.equal(await memberCount(env, farm.id), 16, "never more than 16");
  });
});
