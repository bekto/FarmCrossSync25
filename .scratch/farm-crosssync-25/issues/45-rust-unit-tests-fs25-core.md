# 45: Rust unit tests for FS25 core

**What to build:** Automated checks for hashing, validation classification, backup retention, and replace abort behaviour on fixture folders.

**Priority:** P2

**Blocked by:** 07, 09, 10, 11

**Status:** pending

- [ ] Tests cover hash stability and change detection on fixture folders
- [ ] Tests cover validator state classification on fixture folders
- [ ] Tests cover backup retention keeping five copies and replace abort on hash mismatch
- [ ] `cargo test` exits 0

## Work Log
