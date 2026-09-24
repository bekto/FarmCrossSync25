# 13: GUI prototype — onboarding and farm flows

**What to build:** Browser-only prototype with fake data covering welcome, save location, save picker, validation states, create farm, join farm, and join request approval. Validates UX before the real app exists.

**Priority:** P1

**Blocked by:** None

**Status:** done

- [x] Opening one HTML entry point in a browser shows all listed screens with navigation between them
- [x] Create farm and join farm flows complete against fake data
- [x] Copy-farm-code and accept/deny request interactions give fake feedback
- [x] No Tauri, Rust, or network is required to run it

## Work Log
- Done: Standalone browser prototype `FarmCrossSync25-app/prototype/{index.html,styles.css,app.js}` — 6 screens (welcome/location/picker/create/join/dashboard), hash-router nav, fake create/join flows, copy + accept/deny feedback, validation-state badges. No Tauri/Rust/network; `node --check` clean, static ID/nav audit 0 missing.
- Assumption: prototype untracked outside `src/` (does not affect SvelteKit build); `file://`-safe plain script/link; clipboard best-effort with fake "Copied!" feedback. Visual rendering not verified (headless).
