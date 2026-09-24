# Farm CrossSync 25 — Development Spec

Project slug: farm-crosssync-25

## Overview
Desktop utility for Farming Simulator 25 multiplayer groups. Friends on the same farm share their latest savegame through the cloud instead of copying folders by hand. Cross-platform (Windows, Linux), aimed at small friend groups who already play together. Not a save merger and not a social platform — a safe swap tool.

## Primary Workflow / Usage Model
- Short sessions (1–5 minutes) wrapped around a play session.
- Typical use: pick the FS25 folder → create a farm (choosing a Used slot) or join one with a code (choosing any slot) → upload after playing → download a friend's save before playing.
- A use ends when a save is uploaded, or a friend's save is safely installed locally (backup + verify + replace).
- Eight supported actions only: find save, create farm, join farm, approve members, upload save, see saves, download save, safely replace local.

## Systems
- Identity & Auth — `systems/identity-and-auth.md`
- FS25 Local Save — `systems/fs25-local-save.md`
- Farms & Membership — `systems/farms-and-membership.md`
- Cloud Save Sync — `systems/cloud-save-sync.md`
- Desktop UI — `systems/desktop-ui.md`

## Art & Audio Direction
- Dark, modern gaming-utility look (Steam / Discord / launcher feel). Avoid enterprise SaaS, social feeds, text-heavy dashboards.
- No audio.
- Target window ~1000×700, usable down to 900×600.
- System fonts and simple icons; no stock art, no illustration pipeline.
- Placeholder strategy: a browser HTML/CSS/JS prototype with fake data (welcome, create/join, dashboard, players, join request, upload, download, download confirmation, conflict, settings, error states) is built before the real Tauri app to validate UX and visuals.

## Tech Architecture
- Desktop: Tauri 2 + Rust core + Svelte/TypeScript frontend.
- Rust owns all filesystem work under a dedicated FS25 module: per-OS discovery, validator, metadata reader, hasher, backup, safe replace. Frontend never performs privileged filesystem operations.
- Backend: Cloudflare Worker (Hono, TypeScript) + D1 (metadata) + R2 (save archives). Worker authorizes transfers but never streams save bytes.
- Upload/download: client ↔ R2 directly via short-lived authorized URLs issued by the Worker.
- Two Git repositories, local-first, remotes added later: `FarmCrossSync25` (desktop, eventually public) and `FarmCrossSync25-backend` (stays private). The client embeds only `API_BASE_URL`; all secrets live in Worker secret storage or local dev files excluded from Git.
- Environments: local (Wrangler local Worker/D1/R2 simulation) → Cloudflare staging → production (human checkpoint before production infrastructure).
- Installers: Windows NSIS `.exe`, Linux AppImage.

## Integration & cross-cutting
- Shared auth: every protected API call carries the server-issued session token; identity is always derived from that token, never from client-supplied IDs.
- One hash definition serves every system: SHA-256 over the save folder's contents in stable path order (not the zip envelope). Upload metadata, download verification after extract, and local conflict detection all use it.
- Failure-safety rule spans UI, FS25 Local Save, and Cloud Save Sync: a failed cloud operation must never destroy the existing local save. Original remains recoverable on failed, interrupted, or corrupt transfers and on hash mismatch.
- Local sync state is written only after a successful replace (download) or a completed upload; partial operations leave it unchanged.
- Farm screen freshness uses 20-second polling of invites and saves — no WebSockets in MVP.
- API contract is the seam between the two repos; backend must not interpret FS25 save contents.

## MVP Scope
- Ships: everything in the five systems above — device identity, FS25 discovery/validation/backup/replace, farms with codes and join requests, ownership transfer, one cloud save per player per farm, zip-based upload/download with progress, SHA-256 verification, conflict warning, minimal settings, Windows + Linux.
- Definition of done: two or more players can install, name themselves, discover or pick a save, validate it, create/join a farm, approve members, upload, see timestamps, download another player's save, get an automatic backup, verify, replace safely, see a conflict warning when their local save changed, and recover from failed uploads/downloads — on both OSes.
- Cut: mods sync, save/cloud history, save merging, chat/voice, dedicated servers, matchmaking, public farm discovery, global friends, mobile app, WebSockets, analytics, ads, email/OAuth accounts, auto-update, farm-code rotation, self-hosting.
- Placeholder: FS25 validation markers and metadata fields stay stubbed until real savegames are inspected (see FS25 Local Save).

## Open questions
- FS25 validation markers and exact metadata fields are unknown; they must be taken from real savegames before the validator is implemented. Do not hardcode assumptions.
- Binding or uploading a "Suspicious" save is allowed with a warning; only "Invalid" and "Inaccessible" block the flow. This policy was not stated in the design summary.
- The content-hash definition (folder contents in stable path order) is assumed so one hash serves transfer verification and conflict detection; the design summary only said "SHA-256".
- Local R2 simulation approach for Wrangler development is not yet chosen (in-process mock vs. S3-compatible local stand-in).
