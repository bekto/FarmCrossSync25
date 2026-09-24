# 81: Enforce farm capacity under concurrent invitations

**What to build:** Make the 16-member farm limit hold when multiple owners or requests accept members at the same time.

**Priority:** P1

**Blocked by:** 71

**Status:** done

- [x] Concurrent invitation acceptance cannot produce a farm with more than 16 members.
- [x] A farm at capacity returns a deterministic conflict response.
- [x] The acceptance result and membership state remain consistent when two acceptance requests race.
- [x] The implementation includes a concurrency regression test or an equivalent database-level invariant test.

**Verify:** Run backend authorization tests and the new concurrent-capacity test.

## Work Log

TOCTOU removed from `POST /invites/:inviteId/accept`
(FarmCrossSync25-backend/src/index.ts:385-431). The old check-then-write
(SELECT COUNT → `isAtCapacity` → batch of unconditional UPDATE+INSERT, former
index.ts:382-405) is replaced by a single batch of two self-conditional
statements (D1 has no interactive transactions; each statement's predicate is
evaluated atomically with its write, so even interleaved execution of racing
batches is safe):

- `INSERT INTO farm_members (farm_id, user_id, role, joined_at) SELECT ?1, ?2, 'member', ?3 WHERE (SELECT COUNT(*) FROM farm_members WHERE farm_id = ?1) < 16 AND NOT EXISTS (member row) AND EXISTS (invite ?5 still pending)` (src/index.ts:399-405) — capacity is enforced inside the insert itself; a race can never exceed 16.
- `UPDATE farm_invites SET status = 'accepted' WHERE id = ?1 AND status = 'pending' AND EXISTS (farm_members row)` (src/index.ts:406-410) — the invite only resolves with the membership actually in place, and only once.

Insertion/resolution success is read from the batch result: the invite
transition (`results[1].meta.changes`) is the observable success, and it is
impossible without the membership existing (src/index.ts:413-416 → `200
{"invite": {..., "status": "accepted"}}`). When nothing resolves, the handler
disambiguates deterministically (src/index.ts:418-430): invite no longer
pending (a concurrent request resolved it) → `409 {"error":"invite_not_pending"}`,
exactly matching a sequential repeat accept; invite still pending (the only
remaining cause is the capacity guard) → `409 {"error":"farm_full","max":16}`
— nothing inserted, so the loser's invite stays `pending` and no membership is
created: acceptance result and membership state always agree. The fail-open
`isAtCapacity(row?.count ?? 0)` is gone from the accept path (no pre-count
remains; the statement guard is authoritative) and fixed in the join early-out
to fail closed (`row === null || isAtCapacity(row.count)`, src/index.ts:287-298).

Concurrency regression tests (src/capacity.test.mjs, in `npm test`):
(1) `Promise.all` of two `app.request()` accepts at 15 members (two invites) →
statuses exactly `[200, 409]`, loser `farm_full`, farm has exactly 16 members,
winner is a member + invite `accepted`, loser is not a member + invite still
`pending`; a subsequent join at 16 → `409 farm_full`;
(2) `Promise.all` of two accepts of the SAME invite → `[200, 409
invite_not_pending]`, member added exactly once, invite `accepted`;
(3) stale pending invite after the farm filled → `409 farm_full`, no
membership, invite still `pending`;
(4) five concurrent accepts of five invites with one slot left → exactly one
200, four `409 farm_full`, 16 members max.
Evidence: `node --test src/capacity.test.mjs` → 5 tests / 5 pass / 0 fail,
stable across 5 consecutive runs (race assertion).

README: "Member cap" (two-layer enforcement) and new "Accepting a join
request" section documenting the conditional batch and the deterministic
conflict codes.
