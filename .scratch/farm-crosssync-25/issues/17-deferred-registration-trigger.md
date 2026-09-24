# 17: Deferred registration trigger

**What to build:** Local tools work with no account; registration happens on the first cloud action (create/join/upload/download) and that action continues afterward.

**Priority:** P0

**Blocked by:** 15, 16

**Status:** done

- [x] Scan, select, validate, backup, and replace work with no registration and no network
- [x] First cloud action shows the display-name screen when unregistered
- [x] After successful registration the cloud action continues without restarting the app
- [x] Offline on first cloud action shows a need-internet error and does not lose local work

## Work Log
- Done: New DOM-free `src/lib/session.ts` state machine (DI deps) + `DisplayNamePrompt.svelte` + `config.ts`; wired gate into `+page.svelte`. `node --test src/lib/session.test.ts` 5 passed; `npm run check`/`build` clean.
- Assumption: error state = still unregistered with pending action retained for retry; `session.ts` takes base URL as a param so it runs under `node --test` (no Vite env import); display-name wiring uses a placeholder cloud action until farm/upload/download screens land.
