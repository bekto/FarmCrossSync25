# 86: Add cross-layer regression and QA coverage

**What to build:** Add automated coverage for the real desktop/backend boundaries that existing injected unit fakes do not exercise.

**Priority:** P1

**Blocked by:** 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 89

**Status:** done

- [x] Regression tests cover the production Rust hash metadata contract used by the UI.
- [x] Regression tests cover upload baseline updates and download conflicts after local modification.
- [x] Regression tests cover empty bound-slot downloads and installation/state recovery failures.
- [x] Regression tests cover unauthorized recovery, farm capacity races, duplicate requests, and upload metadata mismatch.
- [x] A documented verification pass records desktop, backend, Rust, and E2E results from a clean run.

**Verify:** Run the complete desktop check, Rust tests, backend tests/typecheck, and applicable E2E suites.

## Work Log

- 2026-09-25: Done. The regression coverage this ticket asks for was built into
  the tickets themselves rather than added afterwards; this pass verifies it
  exists and records a full clean-run result in `docs/verification-pass.md`.
  - Rust hash-metadata contract (`src-tauri/src/fs25/contract.rs`):
    `read_metadata_exposes_the_canonical_folder_hash`,
    `read_metadata_reports_an_unknown_hash_as_null` — the command the TS wrapper
    invokes, not a private helper.
  - Upload baseline / download conflicts (`src/lib/upload.test.ts`): "a
    successful upload advances the sync baseline", "a failed upload leaves the
    previous sync baseline byte-identical", "upload-then-modify triggers
    conflict detection before a download".
  - Empty bound-slot downloads and recovery (`src/lib/download.test.ts`): "a
    bound-but-empty slot installs through the empty path…", "an empty-slot
    download creates no backup", and the three partial-success / pre-install
    recovery cases.
  - Unauthorized recovery (`src/lib/session.test.ts`, `src/lib/api.test.ts`),
    capacity races (`src/capacity.test.mjs`, 4 cases), duplicate requests
    (`src/join-requests.test.mjs`, 5 cases), upload metadata mismatch
    (`src/upload-integrity.test.mjs`).
  - **Clean-run results** (fresh `git clone` into a temp dir, 2026-09-25):
    svelte-check 205 files/0 errors; 185 TS tests; `npm run build` OK; 87 Rust
    tests; clippy `-D warnings` clean; backend typecheck clean; 87 backend
    tests; `npm ci` OK for both projects; deploy guard refuses the placeholder
    D1 id (11 guard tests). E2E: upload 17, download 23, reliability 28,
    lifecycle 41 — all 0 failed. Full table in `docs/verification-pass.md`.
