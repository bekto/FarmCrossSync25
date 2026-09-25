# Farm CrossSync 25 — Progress

Last updated: 2026-09-25

## Summary
- Total tickets: 90
- Pending: 0
- In progress: 0
- Done: 90
- Failed: 0

## Pending (in dependency order)
(none)

## In Progress
(none)

## Done
- [x] [P0] 1: Scaffold desktop repository
- [x] [P0] 2: Scaffold backend repository
- [x] [P0] 3: Local development environment
- [x] [P0] 4: FS25 command contract
- [x] [P0] 5: FS25 auto-discovery on Windows
- [x] [P0] 6: FS25 auto-discovery on Linux
- [x] [P0] 7: FS25 savegame validator
- [x] [P0] 8: FS25 save metadata extraction
- [x] [P0] 9: FS25 content hash
- [x] [P0] 10: Local backup with retention
- [x] [P0] 11: Safe replace of local save
- [x] [P0] 12: Local sync state store
- [x] [P1] 13: GUI prototype — onboarding and farm flows
- [x] [P1] 14: GUI prototype — sync and settings flows
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
- [x] [P1] 40: API client and environment wiring
- [x] [P1] 41: Upload end-to-end integration
- [x] [P1] 42: Download end-to-end integration
- [x] [P1] 43: Farm lifecycle end-to-end integration
- [x] [P1] 44: Desktop installers
- [x] [P2] 45: Rust unit tests for FS25 core
- [x] [P2] 46: Backend authorization tests
- [x] [P2] 47: Reliability failure-mode pass
- [x] [P2] 48: Window and theme polish
- [x] [P2] 49: Copy and empty-state polish
- [x] [P0] 50: Rust — list save slots in an FS25 folder
- [x] [P0] 51: Rust — install a staged save into a slot (empty or used)
- [x] [P0] 52: Rust — persist the chosen FS25 folder
- [x] [P0] 53: Rust — auto-detect FS25 folder candidates
- [x] [P0] 54: Rust — bind a farm to a slot in sync state
- [x] [P0] 55: Rust — list which farm owns which slot
- [x] [P0] 56: TS — slot view model (selectability rules)
- [x] [P0] 57: TS — FS25 folder selection controller
- [x] [P0] 58: UI — SlotPicker component
- [x] [P0] 59: UI — onboarding picks the FS25 folder, not a single save
- [x] [P0] 60: UI shell — the bound save comes from the active farm's slot
- [x] [P1] 61: UI — Farm screen asks for a slot when the farm has none
- [x] [P0] 62: UI — Create Farm requires choosing a used slot
- [x] [P0] 63: UI — Join Farm lets the user pick a slot (empty or used)
- [x] [P0] 64: TS — download flow installs into a chosen slot
- [x] [P0] 65: UI — slot picker dialog for downloads
- [x] [P0] 66: UI — wire slot choice into Download
- [x] [P1] 67: TS — Settings logic for FS25 folder and farm slot
- [x] [P1] 68: UI — Settings shows the FS25 folder and the farm's slot
- [x] [P2] 69: Cleanup of the single-save code + real-save folder-name check
- [x] [P1] 70: Slots end-to-end QA + spec update
- [x] [P0] 71: Make the repository reproducible from a clean checkout
- [x] [P0] 72: Restore the production save-hash contract
- [x] [P0] 73: Persist the sync baseline after successful uploads
- [x] [P0] 74: Fix downloads into empty bound slots
- [x] [P0] 75: Recover safely when installation succeeds but state persistence fails
- [x] [P1] 76: Consolidate API clients and wire 401 recovery
- [x] [P0] 77: Isolate the development-only R2 route
- [x] [P0] 78: Validate R2 upload metadata and object integrity
- [x] [P0] 79: Harden Tauri CSP and command permissions
- [x] [P1] 80: Enforce one farm per local slot
- [x] [P1] 81: Enforce farm capacity under concurrent invitations
- [x] [P1] 82: Prevent duplicate pending join requests
- [x] [P1] 83: Add session expiry and revocation
- [x] [P1] 84: Synchronize display-name changes with the backend
- [x] [P1] 85: Stream large upload and download archives
- [x] [P1] 86: Add cross-layer regression and QA coverage
- [x] [P2] 87: Remove redundant download backups
- [x] [P2] 88: Remove unused dependencies, commands, and capabilities
- [x] [P1] 89: Refresh documentation, deployment configuration, and CI
- [x] [P2] 90: Remove generated artifacts and stale point-in-time docs

## Failed
(none)

