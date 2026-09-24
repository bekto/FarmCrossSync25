# 72: Restore the production save-hash contract

**What to build:** Ensure the desktop application uses the same canonical folder-content hash for upload metadata, conflict detection, and download verification.

**Priority:** P0

**Blocked by:** 71

**Status:** pending

- [ ] Production metadata exposes a valid canonical hash or the conflict flow obtains the hash through the dedicated hashing operation.
- [ ] An unchanged save produces no conflict after a successful sync.
- [ ] A changed save produces the conflict warning before a cloud download replaces it.
- [ ] The production Rust-to-TypeScript command path is covered by a regression test using the real command contract.

**Verify:** Run the desktop Rust tests, desktop unit tests, and the cross-layer hash regression test.

## Work Log
