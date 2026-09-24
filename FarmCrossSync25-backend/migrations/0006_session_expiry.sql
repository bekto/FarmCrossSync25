-- Ticket 83: bounded session lifetime and revocation.
--
-- `expires_at` is an ISO-8601 UTC timestamp in the same format `created_at`
-- already uses (e.g. 2026-09-24T12:34:56.789Z), so expiry is a plain
-- timestamp comparison. Sessions issued before this migration remain valid:
-- their expiry is backfilled to migration run time + 30 days, matching the
-- SESSION_TTL_MS lifetime that `POST /register` grants to new sessions
-- (src/index.ts).
ALTER TABLE sessions ADD COLUMN expires_at TEXT;

UPDATE sessions
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')
WHERE expires_at IS NULL;
