# 33: UI shell and navigation

**What to build:** Minimal dark gaming-utility shell with Farm and Settings destinations and an active-farm dropdown.

**Priority:** P0

**Blocked by:** 01

**Status:** done

- [x] App shows Farm and Settings destinations with an active-farm dropdown on Farm
- [x] Dark gaming-utility theme is applied consistently
- [x] Window opens at about 1000x700 and remains usable at 900x600
- [x] Navigation state survives switching destinations

## Work Log
- Done: Shell with Farm/Settings nav + native active-farm `<select>` in `+page.svelte`; dark palette CSS in new `+layout.svelte`; `uiState.ts` Svelte stores + test (nav state persists); `tauri.conf.json` window 1000x700 / min 900x600. `npm run check`/`build` clean, `node --test` 37 passed.
- Assumption: farm dropdown uses stub list `[{id:"local", name:"My Farm"}]` (later tickets populate); theme/window visually unverifiable headless.
