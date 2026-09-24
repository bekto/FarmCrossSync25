# Farm CrossSync 25 — Progress

Last updated: 2026-09-24

## Summary
- Total tickets: 90
- Pending: 20
- In progress: 0
- Done: 70
- Failed: 0

## Pending (in dependency order)
- [ ] [P0] 71: Make the repository reproducible from a clean checkout
- [ ] [P0] 72: Restore the production save-hash contract
- [ ] [P0] 73: Persist the sync baseline after successful uploads
- [ ] [P0] 74: Fix downloads into empty bound slots
- [ ] [P0] 75: Recover safely when installation succeeds but state persistence fails
- [ ] [P1] 76: Consolidate API clients and wire 401 recovery
- [ ] [P0] 77: Isolate the development-only R2 route
- [ ] [P0] 78: Validate R2 upload metadata and object integrity
- [ ] [P0] 79: Harden Tauri CSP and command permissions
- [ ] [P1] 80: Enforce one farm per local slot
- [ ] [P1] 81: Enforce farm capacity under concurrent invitations
- [ ] [P1] 82: Prevent duplicate pending join requests
- [ ] [P1] 83: Add session expiry and revocation
- [ ] [P1] 84: Synchronize display-name changes with the backend
- [ ] [P1] 85: Stream large upload and download archives
- [ ] [P1] 89: Refresh documentation, deployment configuration, and CI
- [ ] [P1] 86: Add cross-layer regression and QA coverage
- [ ] [P2] 87: Remove redundant download backups
- [ ] [P2] 88: Remove unused dependencies, commands, and capabilities
- [ ] [P2] 90: Remove generated artifacts and stale point-in-time docs

## In Progress
(none)

## Done
- [x] [P0] 01: Scaffold desktop repository
- [x] [P0] 02: Scaffold backend repository
- [x] [P0] 03: Local development environment
- [x] [P0] 04: FS25 command contract
- [x] [P0] 05: FS25 auto-discovery on Windows
- [x] [P0] 06: FS25 auto-discovery on Linux
- [x] [P0] 07: FS25 savegame validator
- [x] [P0] 08: FS25 save metadata extraction
- [x] [P0] 09: FS25 content hash
- [x] [P0] 10: Local backup with retention
- [x] [P0] 11: Safe replace of local save
- [x] [P0] 12: Local sync state store
- [x] [P0] 15: Backend identity endpoints
- [x] [P0] 16: Client identity and secure storage
- [x] [P0] 17: Deferred registration trigger
- [x] [P0] 18: Farms schema and contract
- [x] [P0] 19: Create farm and farm code
- [x] [P0] 20: Join request
- [x] [P0] 21: Invite list and accept/deny
- [x] [P0] 22: Members list, kick, and leave
- [x] [P0] 23: Ownership transfer and succession
- [x] [P0] 24: Farm deletion cascade
- [x] [P0] 25: Saves schema and contract
- [x] [P0] 26: Upload authorize and complete
- [x] [P0] 27: Download authorize
- [x] [P0] 28: Saves list and polling
- [x] [P0] 29: Client zip pack with progress
- [x] [P0] 30: Client upload flow
- [x] [P0] 31: Client download and safe replace
- [x] [P0] 32: Conflict detection
- [x] [P0] 33: UI shell and navigation
- [x] [P0] 34: UI onboarding screens
- [x] [P0] 35: UI farm screen
- [x] [P0] 36: UI owner actions and join requests
- [x] [P0] 37: UI settings
- [x] [P0] 38: UI progress and confirmations
- [x] [P0] 39: UI errors and empty states
- [x] [P1] 13: GUI prototype — onboarding and farm flows
- [x] [P1] 14: GUI prototype — sync and settings flows
- [x] [P1] 40: API client and environment wiring
- [x] [P1] 41: Upload end-to-end integration
- [x] [P1] 42: Download end-to-end integration
- [x] [P1] 43: Farm lifecycle end-to-end integration
- [x] [P2] 45: Rust unit tests for FS25 core
- [x] [P2] 46: Backend authorization tests
- [x] [P2] 47: Reliability failure-mode pass
- [x] [P2] 48: Window and theme polish
- [x] [P2] 49: Copy and empty-state polish
- [x] [P1] 44: Desktop installers
- [x] [P0] 50: Rust — list save slots in an FS25 folder
- [x] [P0] 52: Rust — persist the chosen FS25 folder
- [x] [P0] 53: Rust — auto-detect FS25 folder candidates
- [x] [P0] 51: Rust — install a staged save into a slot
- [x] [P0] 54: Rust — bind a farm to a slot in sync state
- [x] [P0] 57: TS — FS25 folder selection controller
- [x] [P0] 55: Rust — list which farm owns which slot
- [x] [P0] 64: TS — download installs into a chosen slot
- [x] [P0] 56: TS — slot view model (selectability rules)
- [x] [P0] 58: UI — SlotPicker component
- [x] [P0] 59: UI — onboarding picks the FS25 folder
- [x] [P0] 65: UI — slot picker dialog
- [x] [P0] 60: UI shell — bound save comes from active farm's slot
- [x] [P0] 62: UI — Create Farm requires a used slot
- [x] [P0] 63: UI — Join Farm picks a slot
- [x] [P2] 69: Cleanup + real-save folder-name check (asks user for save path or zip)
- [x] [P1] 70: Slots end-to-end QA + spec update
- [x] [P0] 66: UI — wire slot choice into Download
- [x] [P1] 61: UI — Farm screen asks for a slot when none
- [x] [P1] 67: TS — Settings logic for folder and slot
- [x] [P1] 68: UI — Settings shows folder and slot

## Failed

## Post-completion session (2026-09-23)
UI wiring review + local install/test pass (not ticketed).

Fixed:
- [x] Onboarding save binding persisted to per-farm sync state when a farm becomes active (`+page.svelte` `$effect` → `set_bound_save`); Settings no longer shows "No save selected yet" after onboarding
- [x] Upload warnings wired: >200 MB size warning → ConfirmDialog, suspicious-save → toast (both previously unreachable); removed dead `sizeWarningBytes` block from `UploadProgress`
- [x] Removed unreachable `error` props/branches from `UploadProgress`/`DownloadProgress` — toasts are the single error surface
- [x] Backend CORS: added hono `cors()` middleware — desktop webview preflights (`OPTIONS /register`) were 404ing, producing a false "Unable to connect to cloud" toast on register/create-farm
- [x] Local upload 404 fixed: `ENABLE_R2_TEST=true` moved into `.dev.vars` (wrangler only exposes `--var`/`.dev.vars` to `c.env`, not shell env); `PUT /r2-test/:key` round-trip verified 200

Verified:
- svelte-check 0 errors; app 98 unit tests; backend 37 tests + typecheck; `lifecycle:e2e` 41/41
- Rebuilt + reinstalled Linux AppImage → `~/Applications/FarmCrossSync25.AppImage` (local env, `http://localhost:8787`); desktop entry/icon unchanged
- Local test stack: `wrangler dev` on `:8787` with local D1/R2 (`.wrangler/state/v3/`), `ENABLE_R2_TEST=true`; mock onboarding save at `/tmp/opencode/fs25-mock/savegame1` (4 marker XMLs → validates "valid")

Skipped (known, untouched):
- Dead code: `greet` IPC, `clearSessionToken`, `secret_store_kind` warning surface
- Stale docs/comments: backend README `501` stub claims, `src/index.ts` "not_implemented" comment, `contract.rs` "stubs" comment, `docs/copy-audit.md` size-warning surface entry

## Review remediation (2026-09-24)

The project review identified correctness, security, deployment, performance, and cleanup work that was not covered by the original 70 tickets. Tickets 71–90 are pending in dependency order.

- P0 release and safety work: 71, 72, 73, 74, 75, 77, 78, 79
- P1 integration and reliability work: 76, 80, 81, 82, 83, 84, 85, 86, 89
- P2 cleanup work: 87, 88, 90

Start with `/project-worker 71` and keep the active ticket index in this file current as work progresses.
