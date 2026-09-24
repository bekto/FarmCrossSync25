# 88: Remove unused dependencies, commands, and capabilities

**What to build:** Delete code and dependency registrations that are not used by the product after the slot rework and API consolidation.

**Priority:** P2

**Blocked by:** 87

**Status:** done

- [x] The unused opener dependency and capability are removed if no product feature requires them.
- [x] Unused legacy scan, replace, and identity commands have no production or test callers.
- [x] The standalone poller, fabricated presence indicator, and unused error catalog entries are removed or retained only when a real consumer exists.
- [x] Lockfiles and dependency manifests match the code after cleanup.

**Verify:** Run dependency auditing, desktop typecheck, Rust tests, and the complete unit suite.

## Work Log

Desktop cleanup in `FarmCrossSync25-app` (follow-up desktop agent). Every deletion below was preceded by a caller check across `src/`, `src-tauri/src/`, `scripts/`, `docs/`, and `README.md`; every claim here was verified against the code before recording.

### Investigate-and-decide items

- **Standalone poller `src/lib/poll.ts` — RETAINED (real consumer).** `src/lib/farmScreen.ts:19` imports `createPoll` and `farmScreen.ts` drives the spec-mandated 20-second refresh with it (tickets 28/35 acceptance: "refreshed on the 20-second poll"); `poll.test.ts` and `farmScreen.test.ts` cover it through the production path. Deleting it would remove live product behavior.
- **Fabricated presence indicator — REMOVED (no real consumer of presence).** `PlayerRow.online` was fabricated from a 5-minute upload-recency window (`RECENT_UPLOAD_WINDOW_MS`) because the backend has no presence endpoint; the only consumer was the decorative dot in `MemberRow.svelte` itself, and ticket 35's acceptance requires only "each member and last upload time" (its Work Log lists the dot as an *assumption*, not an acceptance item). The member list keeps the real signal (last upload time / size).
- **Error catalog — TRIMMED to rendered entries.** Retained `no-internet` (rendered via `showError("no-internet")` in `src/routes/+page.svelte:141` and `friendlyErrorMessage`) and `farm-not-found` (mapped in `friendlyErrorMessage`); removed 7 entries with zero renderers: `upload-failed`, `download-failed`, `savegame-not-found`, `invalid-save`, `hash-mismatch`, `already-member`, `pending-request` — upload/download/validation failures surface the copy owned by `upload.ts`/`download.ts` instead. `LOCAL_SAVE_SAFE_ERRORS` was also removed: after the trim it had one member and its only reader was its own test; the safety wording of `no-internet` is pinned by its dedicated exact-wording test.

### Deleted (exact symbol + file list)

Rust (`FarmCrossSync25-app/src-tauri/src/`):

- `fn greet` + `generate_handler!` entry — `lib.rs` (Tauri scaffold leftover, zero callers).
- `pub fn scan_saves` command + `generate_handler!` entry + contract-table row — `fs25/contract.rs` (legacy scan, superseded by `list_slots` + `detect_fs25_roots`; zero callers).
- `pub fn create_backup` command + `generate_handler!` entry + contract-table row — `fs25/contract.rs` (legacy manual backup step; its frontend binding's last caller died with ticket 87's cutover to `install_save_to_slot`'s `backupDir`; zero callers repo-wide).
- `pub fn replace_save` command + `generate_handler!` entry + contract-table row — `fs25/contract.rs` (legacy replace, superseded by `install_save_to_slot`; zero callers).
- `pub fn secret_store_kind` command + `generate_handler!` entry + test `secret_store_kind_is_reported` + stale module-doc sentence — `identity.rs` (no TS wrapper ever, zero callers).
- `Fs25Error::NotImplemented` variant + `Fs25Error::not_implemented()` constructor + its `Display` arm — `fs25/contract.rs` (never constructed anywhere).
- `pub struct SaveCandidate` — `fs25/contract.rs` (only the deleted scan commands produced it).
- Orphaned scan implementation left dead by `scan_saves`' deletion (callers were only each other + the deleted command): `scan_linux_in`, `scan_linux`, `scan_steam_root_in`, `merge_candidates` and tests `scans_fixture_savegames`, `missing_or_unreadable_yields_empty`, `scans_steam_proton_fixture`, `merge_dedupes_identical_paths` — `fs25/discovery/linux.rs`; `scan_windows_in`, `scan_windows` and test `scans_fixture_savegames` — `fs25/discovery/windows.rs`. Kept everything the product uses: `linux_base_dir`, `steam_roots`, `steam_save_dirs_in`, `linux_roots` (+ test `steam_fixture_yields_fs25_root`), `windows_base_dir`, `windows_roots`, `slot_of`, `has_savegame`, `detect_roots`.
- Stale comment "Tauri commands (stubs -- all return NotImplemented until later tickets land)" — `fs25/contract.rs` → "Tauri commands".

TypeScript (`FarmCrossSync25-app/src/lib/`):

- `scanSaves` + `SaveCandidate` — `fs25.ts`.
- `createBackup` + `BackupResult` (TS interface) — `fs25.ts`.
- `replaceSave` + `ReplaceResult` (TS interface) — `fs25.ts`.
- `{ kind: "notImplemented"; command: string }` member of the `Fs25Error` union — `fs25.ts`.
- `online` field on `PlayerRow`, `RECENT_UPLOAD_WINDOW_MS`, the recency derivation in `buildFarmView`, `buildFarmView`'s `now` parameter and the `FarmScreenDeps.now` clock seam — `farmScreen.ts` (they existed only for the fabricated dot).
- Online dot markup, sr-only text, and `.dot`/`.dot.online`/`.sr-only` styles — `components/MemberRow.svelte`.
- `ErrorKey`/`ERROR_MESSAGES` entries `upload-failed`, `download-failed`, `savegame-not-found`, `invalid-save`, `hash-mismatch`, `already-member`, `pending-request`, plus `LOCAL_SAVE_SAFE_ERRORS` and the now-unused `upload.ts`/`download.ts` copy-constant imports — `errors.ts`.
- Tests of removed behavior: `farmScreen.test.ts` "a member with an old upload is not shown as online" + `online` assertions + `now` arguments; `errors.test.ts` "upload / download / verify failures state the local save is safe" and "every local-save-safe entry carries a safety promise" (KEYS trimmed to the two rendered entries).
- Stale symbol reference `replaceSave` → `installSaveToSlot` — `docs/reliability-pass.md:79` (the download e2e injects its failures at `installSaveToSlot` now). Final sweep for every deleted symbol across `src/`, `src-tauri/src/`, `scripts/`, `docs/`, `README.md` is clean (the only `create_backup` mentions left point at the kept Rust core `backup::create_backup` in `backup.rs`/`replace.rs` docs).

### Kept deliberately (verified real consumers)

- `clear_session_token` (Rust) + `clearSessionToken` (TS) — ticket 83's sign-out depends on them (`src/lib/session.ts` `clearToken` dep, `src/routes/+page.svelte:132`).
- `src/lib/poll.ts` — see verdict above.
- `fs25/backup.rs` (`backup::create_backup`, `BackupResult`) — called by `fs25/replace.rs:73` on every used-slot install; `fs25/replace.rs` (`replace`, `ReplaceResult`) — called by `fs25/slots.rs:94` in `install_to_slot`. Only their dead Tauri command wrappers were deleted.

### Opener

Already removed by ticket 79; re-verified now: zero `opener`/`tauri-plugin-opener`/`@tauri-apps/plugin-opener` references in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/capabilities/`. Nothing to do.

### Manifests / lockfiles

No dependency became orphaned: every Cargo dependency still has direct users after the cleanup (chrono 4 files, dirs 6, keyring 1, sha2 1, uuid 2, ureq 1, zip 4, serde_json 3, tauri-plugin-dialog 1) and the npm dependencies (`@tauri-apps/api`, `@tauri-apps/plugin-dialog`, Svelte toolchain) are untouched. No manifest or lockfile change was needed.

### Evidence (all run after the cleanup)

- `npm run check` — 205 files, 0 errors, 0 warnings.
- `node --test src/lib/*.test.ts` — 185 passed, 0 failed.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 87 passed, 0 failed (lib unittests; 6 tests deleted together with the scan/`secret_store_kind` code they covered).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — clean, 0 warnings.
- `npm run build` — success.
- `npm run upload:e2e` 17 passed / 0 failed; `npm run download:e2e` 17 / 0; `npm run reliability:e2e` 28 / 0; `npm run lifecycle:e2e` 41 / 0. (Note: upload and download e2e must not run concurrently — both migrate the same local miniflare D1 state and the loser fails with "migrations failed"; every sequential run is clean.)
