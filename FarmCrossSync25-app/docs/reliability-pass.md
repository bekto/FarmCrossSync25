# Reliability failure-mode pass (ticket 47)

> **Historical record.** This is a point-in-time pass recorded during Stage 7
> and its counts are frozen at that date. The failure-mode findings remain
> valid, but later work (the slot rework and tickets 71–90) changed the code
> and grew the suites. For current results run the commands in the root
> `README.md`; do not quote the counts below as current.

Recorded execution of the Stage 7 failure checklist (`docs/PRODUCT.md`, "Stage 7 —
Reliability Testing"), confirming every failure case leaves the local save
recoverable.

Environment: headless Linux, no GUI window. Because there is no GUI, the
equivalent client code paths (the DI services and HTTP sequences) and the Rust
commands were exercised directly. Each item below states which parts are
verified at the **code/test level** versus what a **live GUI** would add.

## How to reproduce

Run from `FarmCrossSync25-app/` unless noted.

| Command | Result |
| --- | --- |
| `node --test src/lib/*.test.ts` | 98 passed, 0 failed |
| `cd src-tauri && cargo test` | 54 passed, 0 failed |
| `cd ../FarmCrossSync25-backend && npm test` | 37 passed, 0 failed |
| `node scripts/upload-e2e.mjs` | 13 passed, 0 failed |
| `node scripts/download-e2e.mjs` | 21 passed, 0 failed |
| `node scripts/farm-lifecycle-e2e.mjs` | 41 passed, 0 failed |
| `node scripts/reliability-e2e.mjs` | 28 passed, 0 failed |

Each e2e script starts and stops its own `wrangler dev` Worker on a private port;
no background server remained after the pass. All commands exited 0.

`scripts/reliability-e2e.mjs` was added for this pass: it fills the checklist
gaps not already covered by the three ticket e2e scripts (duplicate join over
HTTP, simultaneous uploads, backend 5xx/network failure during upload, multiple
installations/PCs, multiple farms). It reuses the production `runUpload` +
`createApiClient` + `createPutToR2` modules and only fakes the Tauri filesystem
commands, exactly as `upload-e2e.mjs` does.

## Checklist results

| # | Stage 7 item | Method (exact command) | Observed result | Local save recoverable? |
| --- | --- | --- | --- | --- |
| 1 | Interrupted upload | `node scripts/upload-e2e.mjs` (criterion 3); `node --test src/lib/upload.test.ts` | PUT fails mid-upload ⇒ `ok:false`, sync state not written, previous cloud metadata byte-identical | Yes — upload only reads the local save; original untouched |
| 2 | Interrupted download | `node scripts/download-e2e.mjs` (criterion 4); `cargo test` `replace::interrupted_swap_rolls_back_and_leaves_original_untouched` | fetch / unpack / replace failure ⇒ original byte-unchanged, no sync state; failpoint after "move aside" rolls the original back | Yes |
| 3 | Offline mode | `node --test src/lib/session.test.ts src/lib/errors.test.ts`; `node scripts/reliability-e2e.mjs` (network failure) | Cloud action blocked with `NEED_INTERNET_MESSAGE` + local-save-safe copy; pending action retained; no token stored; `fs25.ts` has no network/session dependency | Yes — local tools are network-free |
| 4 | Corrupted saves | `node scripts/download-e2e.mjs` (tampered archive); `cargo test` `validator::*` | Verification fails, `replace` is not called, original unchanged | Yes |
| 5 | Hash mismatch | `node scripts/download-e2e.mjs` (criterion 2); `cargo test` `replace::hash_mismatch_aborts_and_leaves_original_untouched` | Aborts before touching the original; no backup created | Yes |
| 6 | Duplicate requests | `npm test` (backend `farms.test.mjs`); `node scripts/reliability-e2e.mjs` | 1st join ⇒ pending; 2nd while pending ⇒ 409 `pending request`; after acceptance ⇒ 409 `already a member` | Yes — cloud state only |
| 7 | Simultaneous uploads | `node scripts/reliability-e2e.mjs` | Two members concurrently ⇒ one slot row each, correct hashes; same-slot rewrite ⇒ last hash wins; concurrent same-slot ⇒ exactly one row, R2 object matches | Yes — uploads do not touch the local save |
| 8 | Large saves | `node --test src/lib/upload.test.ts` | >200 MB (`SIZE_WARNING_BYTES`) warns; proceeds on confirm, aborts cleanly on dismiss | Yes |
| 9 | Missing FS25 installation | `cargo test` `discovery::linux::missing_or_unreadable_yields_empty`, `discovery::windows::*` | Discovery yields empty, not an error; manual folder picker remains available | Yes |
| 10 | Missing savegame | `cargo test` `validator::missing_folder_is_inaccessible`, `contract::read_metadata_on_missing_path_is_inaccessible`, `replace::missing_paths_are_inaccessible...` | Inaccessible state / structured error; original untouched | Yes |
| 11 | Invalid paths | `cargo test` `validator::unrelated_folder_is_invalid`, `pack::unpack_rejects_entry_escaping_destination`, `sync_state::unsafe_farm_id_is_rejected` | Invalid save blocks; archive path traversal rejected; unsafe farm id rejected | Yes |
| 12 | Permission violations | `cargo test` `validator::unreadable_folder_is_inaccessible` | `chmod 000` folder ⇒ `inaccessible`; no write attempted | Yes |
| 13 | Multiple farms | `node scripts/reliability-e2e.mjs`; `node scripts/farm-lifecycle-e2e.mjs` | Per-farm save slots are independent (a save in farm A never appears in farm B) | Yes |
| 14 | Multiple PCs | `node scripts/reliability-e2e.mjs`; `cargo test` `identity::installation_id_survives_a_fresh_store_instance` | Separate installation ids ⇒ distinct users, tokens, and farms; re-registering the same installation keeps the same user | Yes |
| 15 | Leaving / rejoining | `node scripts/farm-lifecycle-e2e.mjs` (criteria 2 and 4) | Leave/kick deletes the member's membership, cloud save row, and R2 object; rejoin is allowed; last leaver deletes the farm and `GET /farms/:id` 404s | Yes — leaving deletes only cloud data |
| 16 | Backend failures | `node scripts/reliability-e2e.mjs` (5xx + network); `node scripts/download-e2e.mjs` (HTTP 500) | Upload/download resolve as failures with local-save-safe copy, no sync state, prior cloud metadata unchanged | Yes |

Every checklist item above observed the local save **recoverable / unchanged**.
No failure case destroyed or modified local data.

## Coverage details and honest limits

- **Code/test level (verified here).** All orchestration (`runUpload`,
  `runDownload`, conflict gate, session gate, API client), the Rust filesystem
  primitives (validate / hash / backup / pack / replace / sync-state), and the
  backend request handling were executed directly.
- **Live GUI not exercised (headless).** Toast rendering, dialog layout, and
  click-through of the conflict / confirmation dialogs are not visually
  verified. Their logic and copy are covered by unit tests
  (`errors.test.ts`, `conflict.test.ts`, `settings.test.ts`) and by the e2e
  scripts calling the same service functions the components call.
- **Interruptions are simulated, not a real byte-level kill.** Interrupted
  upload uses an injected `putToR2` that throws; interrupted download uses an
  injected failing `fetchArchive`/`unpackSave`/`replaceSave` and a Rust
  failpoint mid-swap. The exercised code path is identical to a real network
  drop; what is *not* covered is a process kill during the brief two-step rename
  in `replace.rs` (the original is renamed to an aside sibling and never
  deleted — recoverable, but manual recovery).
- **Large save is simulated.** The 200 MB warning path is driven by synthetic
  metadata size; no real >200 MB archive was packed. The threshold and branch
  logic are what is verified.
- **Permission test skips when run as root.** `unreadable_folder_is_inaccessible`
  returns early if `chmod 000` is ineffective (root). This pass ran as uid 1000,
  so the assertion executed and passed.
- **Offline is simulated.** A rejecting `fetch` and the session-gate unit test
  stand in for a real disconnected browser/Tauri client.

## Bugs found

None. No product defect was found that affects local-save recoverability, so no
in-place product fix was required. The only defect encountered was in the new
`scripts/reliability-e2e.mjs` itself (an early check treated HTTP 201 as an
error); it was corrected while writing the script, before the recorded run.

## Follow-up items (not fixed here)

- **F-47-1 — `upload-complete` trusts the client-supplied `sha256`.**
  The Worker only `head`s the R2 object and stores the hash the client sends
  (`src/index.ts:658-671`). If a concurrent/replaced PUT leaves object bytes
  different from the row hash, a later download's hash verification aborts
  safely (no data loss, original save kept), but the cloud slot advertises a
  hash until someone re-uploads. Hardening options: have the Worker verify the
  object hash before the upsert, or have the client re-verify the object after
  PUT. This is a cloud-metadata consistency hardening item, not a local-save
  safety bug, and is left as a follow-up because it touches the R2/Worker
  boundary. Observed row/object consistency under concurrent same-slot uploads
  in this pass was correct.
