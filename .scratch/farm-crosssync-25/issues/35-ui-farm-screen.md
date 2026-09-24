# 35: UI farm screen

**What to build:** Farm dashboard with name, code, copy action, latest upload, player list, and obvious Upload / Download actions.

**Priority:** P0

**Blocked by:** 19, 20, 28, 30, 31

**Status:** done

- [x] Farm name, code, and copy-code action are visible
- [x] Player list shows each member and last upload time, refreshed on the 20-second poll
- [x] Upload My Save and Download actions are obvious and reachable in one click
- [x] The latest upload is surfaced at the top
- [x] Farm dropdown switches active farm and reloads that farm's state

## Work Log
- Done: New `farmScreen.ts` (+ tests), `FarmScreen.svelte`, `MemberRow.svelte`; `+page.svelte` shows name/code/copy, latest upload, player list with last-upload, Upload/Download wired to `runUpload`/`runDownloadWithConflict`, farm switch reloads + restarts poll. `node --test` 51 passed, check/build clean.
- Assumption: online dot derived from 5-min upload recency (no presence endpoint); direct fetch + bearer token (API client = ticket 40); R2 transport and conflict dialog are placeholders (tickets 38/40); own-row download distinction deferred (no current user id).
