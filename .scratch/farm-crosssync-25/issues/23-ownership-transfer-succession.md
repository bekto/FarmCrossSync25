# 23: Ownership transfer and succession

**What to build:** Immediate owner-chosen ownership transfer, plus automatic succession to the earliest-joined remaining member when the owner leaves.

**Priority:** P0

**Blocked by:** 22

**Status:** done

- [x] `POST /farms/:farmId/transfer-owner` moves ownership to the chosen member and demotes the previous owner to member
- [x] Only the current owner can transfer ownership
- [x] When the owner leaves and members remain, ownership goes to the earliest-joined remaining member
- [x] The new owner can immediately accept/deny requests and kick

## Work Log
- Done: `POST /farms/:farmId/transfer-owner` (owner-gated batch: promote target, demote previous, update `farms.owner_id`; 403 non-owner, 404 non-member, 400 self). Owner-leave succession hardened with `ORDER BY joined_at, user_id`. New owner can accept/deny/kick (e2e). `npm test` 22/22, typecheck clean.
- Assumption: body `{userId}`; 403 checked before target lookup; ticket 22 succession reused with deterministic tie-break; last-member cascade is ticket 24.
