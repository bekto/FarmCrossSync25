# 20: Join request

**What to build:** Requesting to join a farm with a farm code, producing a pending invite for the owner to review.

**Priority:** P0

**Blocked by:** 18

**Status:** done

- [x] `POST /farms/:farmId/join` with a valid code creates a pending invite for the caller
- [x] Unknown code returns "farm not found"
- [x] Joining while already a member returns "already a member"
- [x] A second request while one is pending returns "pending request"
- [x] A previously denied user can request again

## Work Log
- Done: `POST /farms/:farmId/join` resolves farm by case-insensitive code, inserts pending invite; 404 farm not found, 409 already-a-member/pending-request, denied re-request creates fresh pending row; 16-cap checked after conflicts. `decideJoinRequest` helper + tests. `npm test` 12/12, typecheck clean.
- Assumption: body `{code}`; `:farmId` must match code-resolved farm else 404; handlers live in `src/index.ts` (testable logic in `farms.ts`).
