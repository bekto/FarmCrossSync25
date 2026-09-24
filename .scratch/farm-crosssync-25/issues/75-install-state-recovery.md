# 75: Recover safely when installation succeeds but state persistence fails

**What to build:** Keep local installation, slot binding, and sync state consistent when a replacement succeeds but a later bookkeeping operation fails.

**Priority:** P0

**Blocked by:** 73, 74

**Status:** pending

- [ ] A successful replacement never leaves the user with a false failure that claims the original save is unchanged.
- [ ] The application can recover or reconcile a completed installation when slot binding or sync-state persistence fails.
- [ ] The user receives an accurate partial-success or recovery message.
- [ ] A failed pre-install operation still leaves the original save untouched and recoverable.

**Verify:** Run download failure-path tests with injected binding and state-write failures.

## Work Log
