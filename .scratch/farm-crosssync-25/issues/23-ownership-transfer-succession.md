# 23: Ownership transfer and succession

**What to build:** Immediate owner-chosen ownership transfer, plus automatic succession to the earliest-joined remaining member when the owner leaves.

**Priority:** P0

**Blocked by:** 22

**Status:** pending

- [ ] `POST /farms/:farmId/transfer-owner` moves ownership to the chosen member and demotes the previous owner to member
- [ ] Only the current owner can transfer ownership
- [ ] When the owner leaves and members remain, ownership goes to the earliest-joined remaining member
- [ ] The new owner can immediately accept/deny requests and kick

## Work Log
