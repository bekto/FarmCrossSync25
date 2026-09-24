# 04: FS25 command contract

**What to build:** The Tauri command surface and shared result types for all FS25 work (scan, validate, metadata, hash, backup, replace, sync-state read/write) so the UI can be built against a stable API. Stubs return structured not-implemented results.

**Priority:** P0

**Blocked by:** 01

**Status:** done

- [x] The frontend can invoke every listed command and receive a typed success or error result
- [x] Each command's parameters and result fields are named and documented in one place
- [x] `cargo build` exits 0
- [x] Calling a stub returns a structured not-implemented error rather than crashing

## Work Log
- Done: Added `fs25/contract.rs` (typed params/results + 8 Tauri commands returning structured `NotImplemented`), registered in `lib.rs`, typed TS wrappers in `src/lib/fs25.ts`. `cargo build`, `cargo test --lib fs25::contract`, `npm run build`/`check` all pass.
- Assumption: command set (scan, validate, metadata, hash, backup, replace, sync-state read/write) and fields derived from FS25 spec; camelCase over the wire.
