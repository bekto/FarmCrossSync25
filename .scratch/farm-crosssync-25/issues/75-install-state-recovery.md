# 75: Recover safely when installation succeeds but state persistence fails

**What to build:** Keep local installation, slot binding, and sync state consistent when a replacement succeeds but a later bookkeeping operation fails.

**Priority:** P0

**Blocked by:** 73, 74

**Status:** done

- [x] A successful replacement never leaves the user with a false failure that claims the original save is unchanged.
- [x] The application can recover or reconcile a completed installation when slot binding or sync-state persistence fails.
- [x] The user receives an accurate partial-success or recovery message.
- [x] A failed pre-install operation still leaves the original save untouched and recoverable.

**Verify:** Run download failure-path tests with injected binding and state-write failures.

## Work Log

## Work Log

- `src/lib/download.ts` — the flow is split in two structural phases: `installPhase` (download.ts:163-258: confirm, preflight, fetch, unpack, verify, install + temp cleanup) and the recovery phase in `runDownload` (download.ts:282-322: `setFarmSlot` -> `readSyncState` -> `writeSyncState`, retried once). Bookkeeping failures can no longer reach the pre-install catch, so the "Your original save is unchanged and recoverable." copy is only produced before/for a rolled-back install.
- Result type distinguishes the outcomes (download.ts:119-161): `DownloadComplete { outcome: "complete", state }` vs `DownloadPartial { outcome: "partial", state: null, message }` vs `DownloadFailure { ok: false }`. `INSTALLED_NOT_RECORDED_MESSAGE` (download.ts:49-51) is accurate partial-success copy ("The cloud save was installed to Slot N, but the app could not record the sync state: ... Your new save is in place.") and never mentions an unchanged original; the shared constant is pinned by a test.
- `src/routes/+page.svelte:415-425` — `refreshBoundSave()` now runs on both success outcomes (the save is installed in each), and a partial result surfaces its accurate message through the farm-screen action result.
- Tests (`download.test.ts`): "binding failure after install reports partial success, never the unchanged-original copy" (retry once: `setSlot` attempted twice, no state write after a failed binding), "state-write failure after install reports partial success with accurate copy" (retry once), "a transient bookkeeping failure is reconciled by the retry" (outcome `complete`), "a pre-install failure keeps the unchanged-original copy and leaves state untouched" (JSON snapshot equal), "the partial-success copy is the shared contract constant".
- Changed test: `setFarmSlot failure reports the error and writes no state` was replaced by the binding-failure partial-success test — ticket 75 explicitly changes this outcome from a false failure to a partial success (the assertion "no sync state is written when the binding fails" is preserved).
