# Cross-layer verification pass (ticket 86)

Recorded verification of the real desktop/backend boundaries — the production
Rust command path, the Worker API, and the end-to-end client flows — rather
than the injected unit fakes. Every number below was produced by running the
stated command, on a clean `git clone` of the repository into a fresh
temporary directory, on 2026-09-25.

## Clean run

A fresh clone contains the desktop app, backend, specifications, documentation
and ticket pool; `npm ci` succeeds for both projects; `npm install` is not
required to be run first.

| Layer | Command | Result |
| --- | --- | --- |
| Desktop typecheck | `npm run check` | 205 files, 0 errors, 0 warnings |
| Desktop unit tests | `node --test src/lib/*.test.ts` | 185 pass, 0 fail |
| Desktop build | `npm run build` | OK (adapter-static) |
| Desktop lockfile | `npm ci` | exit 0 |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | 87 pass, 0 fail |
| Rust lint | `cargo clippy --all-targets -- -D warnings` | clean |
| Backend typecheck | `npm run typecheck` | clean |
| Backend tests | `npm test` | 87 pass, 0 fail |
| Backend lockfile | `npm ci` | exit 0 |
| Deploy guard | `node scripts/deploy-guard.mjs` | refuses the placeholder D1 id (exit 1) |
| Deploy guard unit tests | `node --test src/deploy-guard.test.mjs` | 11 pass, 0 fail |

## End-to-end suites

Each suite starts its own local Worker (Wrangler/Miniflare) and drives the
real client code — `runUpload`/`runDownload` plus the shared API client and
transports — against it.

| Suite | Result |
| --- | --- |
| `npm run upload:e2e` | 17 passed, 0 failed |
| `npm run download:e2e` | 23 passed, 0 failed |
| `npm run reliability:e2e` | 28 passed, 0 failed |
| `npm run lifecycle:e2e` | 41 passed, 0 failed |

The four suites must be run sequentially: each migrates the same local
Miniflare D1 state, so concurrent runs make the loser fail with "migrations
failed" — an artifact of sharing one local state directory, not a product
behaviour.

## Cross-layer regression coverage

The tests that pin each boundary the injected unit fakes do not exercise.

**Production Rust hash-metadata contract used by the UI** —
`src-tauri/src/fs25/contract.rs`:
- `read_metadata_exposes_the_canonical_folder_hash` — the command the TS wrapper
  invokes returns the same digest as `hash::hash_folder` for the same folder.
- `read_metadata_reports_an_unknown_hash_as_null` — unknown is `null`, never
  `""`, so it cannot silently force a conflict.

**Upload baseline and download conflicts after a local change** —
`src/lib/upload.test.ts`, `src/lib/conflict.test.ts`:
- "a successful upload advances the sync baseline"
- "a failed upload leaves the previous sync baseline byte-identical"
- "upload-then-modify triggers conflict detection before a download"

**Empty bound-slot downloads and installation/state recovery** —
`src/lib/download.test.ts`:
- "a bound-but-empty slot installs through the empty path without touching local content"
- "an empty-slot download creates no backup" / "empty slot installs, binds the slot, and reports no backup"
- "binding failure after install reports partial success, never the unchanged-original copy"
- "state-write failure after install reports partial success with accurate copy"
- "a pre-install failure keeps the unchanged-original copy and leaves state untouched"

**Unauthorized recovery, capacity races, duplicate requests, upload metadata
mismatch** — `src/lib/session.test.ts`, `src/lib/api.test.ts`,
`FarmCrossSync25-backend/src/{capacity,join-requests,upload-integrity}.test.mjs`:
- "a 401 mid-action re-queues the action and resumes it after re-registration"
- "handleUnauthorized drops the cached token and returns to the prompt"
- "two concurrent accepts at 15 members never exceed 16" and three further race cases
- "concurrent duplicate joins create exactly one pending request" and four further cases
- "incorrect size is rejected and the previous row survives", "oversized object is rejected…", "missing object is rejected…"

## Known limitations recorded rather than hidden

- `src-tauri/src/fs25/replace.rs` uses a two-step rename swap; a power loss
  mid-swap can leave the original at an aside path (documented in the module).
- Sync-state writes use temp-file-plus-rename; a crash mid-write leaves the
  previous state intact but may leave a temp file behind.
- `sha256` on upload is **client-asserted** and not verified by the Worker —
  a deliberate trust boundary, because archive bytes never pass through the
  Worker. Integrity is enforced by the downloading client.
