# 48: Window and theme polish

**What to build:** Visual consistency pass — dark gaming-utility theme everywhere, clean layout at target and minimum window sizes.

**Priority:** P2

**Blocked by:** 33

**Status:** done

- [x] Layout is clean at 1000x700 and usable at 900x600 with no clipped controls
- [x] Dark theme is consistent across all screens
- [x] No enterprise-dashboard or social-feed styling remains

## Work Log
- Done: Consolidated all theme tokens in `+layout.svelte` (added `--info/--warn/--danger/--shadow`, restyled controls/modals/toasts/progress/scrollbar/validation), removed hardcoded colors from components, made layout responsive (`min-width:0`, `minmax(0,1fr)`, wrap, `max-width:720px`); `app.html` title. New `scripts/audit-styles.mjs` (`npm run audit:styles`). check/build clean.
- Assumption: modal overlay markup refactor is styling only (callbacks unchanged); visual paint at both resolutions not verifiable headless. No fixed widths >= 900px, no hardcoded colors outside theme file.
