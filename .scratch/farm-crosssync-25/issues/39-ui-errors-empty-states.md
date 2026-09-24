# 39: UI errors and empty states

**What to build:** Spec-mandated error toasts and non-broken empty states, with failure copy that always tells the truth about local-save safety.

**Priority:** P0

**Blocked by:** None

**Status:** done

- [x] All spec error messages appear as toasts or inline errors in their situations
- [x] Failure copy states that the local save is safe wherever that is true
- [x] Empty farm, no saves, and no requests have informative empty states
- [x] Offline blocks cloud actions with the no-internet message

## Work Log
- Done: New `errors.ts` (9-message catalog, `LOCAL_SAVE_SAFE_ERRORS`, `EMPTY_STATES`, `friendlyErrorMessage`) + tests, `Toast.svelte`/`Toasts.svelte`; empty states in `FarmScreen.svelte`/`JoinRequestsPanel.svelte`; no-internet mapping at farm/upload/download surfaces. `node --test` 79 passed, check/build clean.
- Assumption: no-internet copy composes `NEED_INTERNET_MESSAGE` + `LOCAL_SAVE_SAFE_MESSAGE`; `already-member`/`pending-request` catalog-only (no create/join flow yet); toasts manually dismissed.
