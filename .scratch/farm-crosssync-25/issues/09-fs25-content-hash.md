# 09: FS25 content hash

**What to build:** The single content hash used for upload metadata, download verification, and conflict detection — SHA-256 over the save folder's file contents in stable relative-path order (not the zip envelope).

**Priority:** P0

**Blocked by:** 04

**Status:** done

- [x] Hash is SHA-256 over file contents in stable relative-path order (not the zip envelope)
- [x] Hashing the same unchanged save twice yields the same value
- [x] Changing one file in the save changes the hash
- [x] Hashing an empty or missing folder returns a structured error

## Work Log
- Done: `hash::compute` = SHA-256 streaming over files sorted by normalized relative path; per file `u64 path_len | path | u64 file_len | bytes`; hex out. `compute_hash` command wired. Real save hashed twice equal; `cargo test --lib` 21 passed. Added `sha2` (already in Cargo.lock).
- Assumption: empty/only-empty-subdirs → `Fs25Error::Internal`; missing/non-dir → `Inaccessible`. Framing chosen is what all callers must share.
