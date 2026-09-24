# 72: Restore the production save-hash contract

**What to build:** Ensure the desktop application uses the same canonical folder-content hash for upload metadata, conflict detection, and download verification.

**Priority:** P0

**Blocked by:** 71

**Status:** done

- [x] Production metadata exposes a valid canonical hash or the conflict flow obtains the hash through the dedicated hashing operation.
- [x] An unchanged save produces no conflict after a successful sync.
- [x] A changed save produces the conflict warning before a cloud download replaces it.
- [x] The production Rust-to-TypeScript command path is covered by a regression test using the real command contract.

**Verify:** Run the desktop Rust tests, desktop unit tests, and the cross-layer hash regression test.

## Work Log

## Work Log

- `src-tauri/src/fs25/metadata.rs:42-49` — `extract` now populates `content_hash` from the canonical `hash::hash_folder` digest (`.ok()`: unknown/unhashable -> `None`), replacing the empty-string placeholder; module docs updated (metadata.rs:1-8).
- `src-tauri/src/fs25/contract.rs:130-135` — `SaveMetadata.content_hash` is `Option<String>` ("never an empty string"); TS mirror `src/lib/fs25.ts:31-33` `contentHash: string | null`.
- `src/lib/conflict.ts:58-74` — empty-string hashes normalize to "unknown" (null) so a placeholder can never silently compare as a differing hash.
- Regression tests (real command contract): `contract.rs:562-606` `read_metadata_exposes_the_canonical_folder_hash` drives the same `read_metadata` command fn the TS wrapper invokes and asserts `content_hash == hash_folder` plus the camelCase `contentHash` JSON key; `read_metadata_reports_an_unknown_hash_as_null` pins null-not-"" semantics. `metadata.rs:101-121` asserts extract equals `hash_folder` and an unhashable folder yields `None`.
- TS tests: `conflict.test.ts:231-289` "an unchanged save after a successful sync produces no conflict" and "a changed save warns before a cloud download replaces it" (dialog before any dep call).
