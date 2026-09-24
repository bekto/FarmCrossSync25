# 34: UI onboarding screens

**What to build:** Save-location and display-name onboarding — auto scan, manual folder pick, validation states, and the welcome name screen at first cloud action.

**Priority:** P0

**Blocked by:** 04, 05, 06, 07, 16

**Status:** done

- [x] FS25 Save Location screen offers Scan Automatically and Select Folder
- [x] Scan results list candidates and let the user pick one
- [x] Validation states Valid, Suspicious, Invalid, and Inaccessible are each shown as specified
- [x] Welcome display-name screen appears at first cloud action
- [x] Selected save and its metadata are visible in Settings

## Work Log
- Done: New `onboarding.ts` (+ tests), `folderPicker.ts`, `SaveLocation.svelte`; bound-save store in `uiState.ts`; `+page.svelte` wires save-location onboarding, reuses ticket-17 display-name gate, shows selected save metadata in Settings. Added `@tauri-apps/plugin-dialog` (registered + capability). `node --test` 46 passed, check/build clean.
- Assumption: folder picker injected for tests, production uses plugin-dialog `open({directory:true})`; criterion 5 satisfied minimally (full Settings = ticket 37); bound save in-memory for session, durable binding in Rust sync state.
