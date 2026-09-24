# 64: TS — download flow installs into a chosen slot

**What to build:** Change `runDownload` (`src/lib/download.ts`) to take a target slot instead of a target path. It uses `installSaveToSlot` (ticket 51) so an Empty slot works. On success it binds the farm to that slot.

**Priority:** P0

**Blocked by:** 51, 54

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Changes:**
- `DownloadInput`: replace `targetSavePath` with `fs25Root: string; slot: number; slotPath: string; slotUsed: boolean`
- `DownloadDeps`:
  - Remove `replaceSave`.
  - Add `installSaveToSlot(root, slot, stagedPath, expectedHash) : Promise<InstallResult>` and `setFarmSlot(farmId, root, slot): Promise<SyncState>`.
- Flow when `slotUsed` is true: same as today (preflight `readMetadata(slotPath)` and backup), then install.
- Flow when `slotUsed` is false: skip the preflight and the backup, then install.
- After install: call `setFarmSlot`, then write the sync state exactly as today, but with `boundSavePath: install.path` and `slot`. `backupPath` in the result comes from the flow backup, or `null` for an empty slot.
- `DOWNLOAD_CONFIRMATION_MESSAGE` stays for used slots. Add `DOWNLOAD_TO_EMPTY_SLOT_MESSAGE(slot)` = "This will install the save into empty Slot N." and use it in `confirm` when the slot is empty.
- Update `download.test.ts` and `conflict.test.ts` fakes. Keep every existing safety test and adapt it to `slotUsed: true`.
- Update `scripts/download-e2e.mjs` and `scripts/reliability-e2e.mjs` if they build `DownloadInput`/`DownloadDeps` (`grep -n targetSavePath scripts`).

**Acceptance:**
- [x] Empty slot: no createBackup and no readMetadata preflight; installSaveToSlot is called with the expected hash; the sync state has the slot
- [x] Used slot: backup happens before install. On a hash mismatch, install is never called.
- [x] setFarmSlot and writeSyncState are not called on any failure
- [x] Temp archive and staging cleanup still happen on every path

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check` — all pass, 0 errors.
**Note:** `+page.svelte` will not compile against the new input until ticket 66. In this ticket, make the minimal adapter there: pass the current bound slot with `slotUsed: true`, so `npm run check` stays clean.

## Work Log
- Done: `runDownload` now targets a slot via `installSaveToSlot` + `setFarmSlot`; empty-slot branch skips preflight/backup; `+page.svelte` minimal adapter; node tests 112 pass, check clean.
