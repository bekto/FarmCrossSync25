# 02: Scaffold backend repository

**What to build:** Cloudflare Worker API repository with Hono, TypeScript, Wrangler, D1 and R2 bindings, a migrations folder, and Git initialized.

**Priority:** P0

**Blocked by:** None

**Status:** done

- [x] `npm install && npx wrangler dev` starts the local Worker
- [x] `GET /health` returns 200 with a JSON status body
- [x] `npx wrangler d1 migrations list` runs without error against local D1
- [x] Wrangler config declares D1 and R2 bindings usable in local development
- [x] `git init` has been run and an initial commit exists

## Work Log
- Done: Scaffolded Hono/TS Cloudflare Worker in `FarmCrossSync25-backend/` with D1 + R2 bindings, `migrations/0001_init.sql`, `/health` route, and initial commit `5ecc36a`.
- Assumption: `wrangler d1 migrations list` run with `--local` (wrangler v4 targets remote otherwise); D1 `database_id` is a placeholder UUID for local dev.
