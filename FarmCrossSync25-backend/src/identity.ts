// Identity-domain constants (tickets 83/84). These live in a non-entry module
// on purpose: Cloudflare Workers treat every named export of the entry module
// (`src/index.ts`) as a request handler, so exported constants there crash
// workerd at boot. Pure module — no bindings, no side effects.

/**
 * Lifetime of a session issued by `POST /register` (ticket 83): a session is
 * valid until its `sessions.expires_at` (= issue time + this constant, 30
 * days). Once past, `requireAuth` rejects it with the same 401
 * `{"error":"unauthorized"}` as a missing or revoked token, so callers cannot
 * distinguish expiry from revocation and can route both through one recovery
 * path. Migration `0006_session_expiry.sql` backfills pre-existing rows with
 * the same 30-day window measured from the migration run.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Maximum display-name length (ticket 84), shared with the desktop client's
 * Settings input cap. `PATCH /me` rejects longer names with a 400 rather than
 * silently truncating.
 */
export const MAX_DISPLAY_NAME_LENGTH = 64;
