# 87: Remove redundant download backups

**What to build:** Ensure a cloud-driven replacement creates exactly one backup and reports the backup created by the authoritative filesystem operation.

**Priority:** P2

**Blocked by:** 75

**Status:** done

- [x] A used-slot download creates one backup rather than a TypeScript backup plus a replacement backup.
- [x] The configured backup location is honored by the authoritative replacement operation.
- [x] Empty-slot downloads still create no backup.
- [x] Download progress and success copy describe the actual backup behavior.

**Verify:** Run download tests with backup spies and compare the resulting backup directories.

## Work Log

## Work Log

- `src/lib/download.ts:80-90` — `DownloadDeps.createBackup` removed (no TS-side backup at all) and `installSaveToSlot` gains the `backupDir` parameter; `download.ts:226-232` passes `input.backupDir` (new `DownloadInput.backupDir`, download.ts:107-108) to the authoritative Rust replacement, which creates the single backup under the configured location.
- `DownloadSuccess.backupPath` now reports `InstallResult.backupPath` — the backup the replacement actually created (download.ts:311-315); null for an empty slot.
- `src/routes/+page.svelte:366-367` — the download input fills `backupDir` from `getBackupLocation()` (Settings); the TS `createBackup` binding (previously `+page.svelte:207-208`) is gone. `src/lib/components/DownloadProgress.svelte:14-38` — the "backing-up" phase/label removed (`DownloadPhase` is now confirming/downloading/unpacking/verifying/replacing) and the note reads "An existing save is backed up before it is replaced." (true for used slots; empty installs have nothing to back up). Confirmation copy already promised "A backup will automatically be created first" and stays accurate: the replacement backs up before the swap.
- Tests (`download.test.ts`): "a used-slot download creates exactly one backup under the configured dir" (install spy records the single backup; `backupDir` "/my/backups" reaches `installSaveToSlot`; `result.backupPath` equals the created backup), "an empty-slot download creates no backup" (zero backups, `backupPath: null`).
- Changed tests (intentional, ticket 87): the happy-path flow no longer includes a `backup` call or the "backing-up" phase (its name now says "(one backup)" for the replacement's backup); the hash-mismatch test dropped "backup ran before verification" (there is no TS backup to run); conflict.test.ts's proceed test asserts `install` instead of `backup`. All other assertions unchanged.
