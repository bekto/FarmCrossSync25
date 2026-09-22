# 04: FS25 command contract

**What to build:** The Tauri command surface and shared result types for all FS25 work (scan, validate, metadata, hash, backup, replace, sync-state read/write) so the UI can be built against a stable API. Stubs return structured not-implemented results.

**Priority:** P0

**Blocked by:** 01

**Status:** pending

- [ ] The frontend can invoke every listed command and receive a typed success or error result
- [ ] Each command's parameters and result fields are named and documented in one place
- [ ] `cargo build` exits 0
- [ ] Calling a stub returns a structured not-implemented error rather than crashing

## Work Log
