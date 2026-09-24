# 19: Create farm and farm code

**What to build:** Farm creation where the caller becomes owner and first member, and receives a short, case-insensitive, unique invite code.

**Priority:** P0

**Blocked by:** 15, 18

**Status:** done

- [x] `POST /farms` with a name creates a farm and makes the caller owner and first member
- [x] Response includes a short, case-insensitive, unique code in the `X7K9-PQ2` shape
- [x] A code colliding with an existing farm is regenerated
- [x] Only authenticated users can create a farm

## Work Log
- Done: `POST /farms` creates farm + owner `farm_members` row via `DB.batch`, returns `201 {farm}`; `generateUniqueFarmCode` (shape `^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{3}$`, check-then-insert retry). `npm test` 8/8, typecheck clean.
- Assumption: response envelope `{ farm: {...} }` matching `{ user }` convention; code stored uppercase; rare insert race surfaces as 500 (acceptable for single-user create).
