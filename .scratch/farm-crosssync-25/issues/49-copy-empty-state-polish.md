# 49: Copy and empty-state polish

**What to build:** Final user-facing copy pass so every message matches the spec and every destructive confirmation is unambiguous.

**Priority:** P2

**Blocked by:** 33, 39

**Status:** done

- [x] All user-facing strings match the spec wording or are listed as deliberate deviations
- [x] Empty states for farm, saves, and requests are informative
- [x] Destructive confirmations are unambiguous about what will be deleted or replaced

## Work Log
- Done: Copy audit in `docs/copy-audit.md`; fixed offline copy to exact spec sentence; unified `EMPTY_STATES` (no farm / no saves / no requests) across screens; action-specific `confirmLabel` on `ConfirmDialog` (Download & Replace / Leave Farm / Kick / Make owner) with unambiguous consequences. `node --test` 98 passed, check/build clean; all spec strings present in source + build.
- Deviations (documented): farm-not-found/already-member/pending-request omit local-save promise (no local files touched); upload/download use "unchanged and safe/recoverable" phrasing; transfer confirmation adds consequences; button order action-then-Cancel. Visual rendering not verified (headless).
