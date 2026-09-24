# 80: Enforce one farm per local slot

**What to build:** Prevent two farms from being bound to the same local FS25 slot, including when state is written through commands or recovered after interrupted setup.

**Priority:** P1

**Blocked by:** 71

**Status:** pending

- [ ] Binding a farm to a slot already owned by another farm fails with a clear user-facing error.
- [ ] Existing conflicting bindings are detected and reported during recovery rather than silently overwritten.
- [ ] The slot view model and list-bindings output cannot represent two owners for one slot.
- [ ] Unbinding or changing a farm slot leaves the remaining bindings accurate.

**Verify:** Run local sync-state tests for duplicate binding, rebinding, and recovery cases.

## Work Log
