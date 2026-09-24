# 14: GUI prototype — sync and settings flows

**What to build:** Browser-only prototype screens for dashboard, player list, upload, download, conflict, settings, and error states with fake progress and toasts.

**Priority:** P1

**Blocked by:** 13

**Status:** done

- [x] Dashboard, player list, upload with fake progress, download confirmation, conflict dialog, settings, and error states are all reachable
- [x] Fake upload shows two-phase (zip then upload) progress and a success state
- [x] Conflict dialog offers Keep My Save / Download Cloud Save / Cancel
- [x] All error toasts from the spec are represented

## Work Log
- Done: Extended `prototype/{index.html,app.js,styles.css}` with dashboard/player list, two-phase fake upload progress + success timestamp, download confirmation, conflict dialog (Keep My Save / Download Cloud Save / Cancel), settings, and all 9 spec error toasts. `node --check` clean, static audit all pass, no Tauri/network.
- Assumption: non-quoted error copy is reasonable placeholder; download shows phase text (only confirmation required); Leave Farm has no confirm dialog (not in ticket). Visual rendering not verified (headless).
