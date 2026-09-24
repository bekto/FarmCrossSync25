# 38: UI progress and confirmations

**What to build:** Two-phase upload progress, download progress, confirmations for every destructive action, and the conflict dialog.

**Priority:** P0

**Blocked by:** 29, 30, 31, 32

**Status:** done

- [x] Upload shows two-phase zip then upload progress with a completion state
- [x] Download shows progress and a completion state
- [x] Download & Replace, Leave, Kick, and Transfer ownership all require confirmation
- [x] Conflict dialog implements Keep Mine / Download Cloud / Cancel

## Work Log
- Done: Wired `runUpload`/`runDownload` phase+progress callbacks and completion states into `+page.svelte`; new `DownloadProgress.svelte`; all destructive actions route through `ConfirmDialog`; `ConflictDialog` Keep My Save / Download Cloud Save / Cancel wired via `runDownloadWithConflict`. `node --test` 71 passed, check/build clean.
- Assumption: kept spec labels (`Keep My Save`/`Download Cloud Save`) over ticket shorthand; no new tests (logic already covered in DOM-free modules, new code is Svelte wiring only); upload size-warning confirm left for later.
