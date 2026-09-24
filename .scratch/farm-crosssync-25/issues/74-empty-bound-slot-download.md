# 74: Fix downloads into empty bound slots

**What to build:** Allow a farm bound to an empty slot to download into that slot without attempting to read or back up nonexistent local content.

**Priority:** P0

**Blocked by:** 71

**Status:** pending

- [ ] A bound empty slot follows the empty-slot installation path.
- [ ] A download into a bound empty slot succeeds and creates the selected slot.
- [ ] A download into a bound empty slot does not show a replacement confirmation or create a backup for nonexistent content.
- [ ] Used slots continue to require replacement confirmation and backup behavior.

**Verify:** Run the slot-flow unit tests and the empty-bound-slot download E2E case.

## Work Log
