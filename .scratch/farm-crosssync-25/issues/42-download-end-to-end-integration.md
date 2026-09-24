# 42: Download end-to-end integration

**What to build:** Full download path from a running desktop app against the local backend, including backup, verification, and safe replace.

**Priority:** P1

**Blocked by:** 31, 40

**Status:** done

- [x] Downloading another member's save replaces the local save after backup and verify
- [x] A corrupted or tampered archive fails verification and does not replace
- [x] Backup directory contains a timestamped copy after a successful download
- [x] Failure paths leave the original save recoverable

## Work Log
- Done: New `downloadTransport.ts` (`createGetToDisk` presigned GET + local-dev `/r2-test` fallback) + tests, `scripts/download-e2e.mjs` (21/21: A uploads, B downloads/replaces, tamper → no replace, timestamped backup, failure paths keep original); fixed download `{ authorization }` unwrap in `+page.svelte`; added Rust `write_temp_archive`. `node --test` 98 passed, backend `npm test` 28, check/build clean.
- Build blocker fixed (orchestrator): ticket 41 enabled `assetProtocol` in `tauri.conf.json` without the matching crate feature, so `cargo build` failed. Added `protocol-asset` to `tauri` features in `src-tauri/Cargo.toml`; `cargo build` exit 0, `cargo test --lib` 53 passed.
- Assumption: local dev no R2 creds → GET Worker dev route (`ENABLE_R2_TEST=true`); production GETs presigned URL; Rust FS steps faked in e2e (real temp dirs + canonical hash) since GUI/Tauri runtime unavailable headless.
