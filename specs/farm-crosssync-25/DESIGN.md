# Farm CrossSync 25 — Design Summary

Project slug: farm-crosssync-25

## Concept
- Cross-platform desktop app so FS25 multiplayer friends share their latest savegame via cloud — no manual folder copying
- Not a merger: one complete cloud save per player per farm; download replaces local save only after backup + SHA-256 verify
- Core promise: everyone on our FS25 farm can safely share their latest save
- Hard rule: a failed cloud operation never destroys the existing local save
- Security: no cloud secrets in client; server verifies membership/ownership; never trust client-supplied IDs

## Primary Workflow / Usage Model
- Short utility sessions (1–5 min) around a play session
- Flow: discover/bind save → create or join farm → upload after playing → download a friend's save before playing
- Session ends when a save is uploaded or a friend's save is safely installed
- Eight supported actions: find save, create farm, join farm, approve members, upload save, see saves, download save, safely replace local

## Systems
- **Identity & Auth**
  - Purpose: passwordless identity per installation
  - Behaviour: on first cloud action generate random installation UUID + display name, register, receive opaque session token; re-register with same installation_id restores same user; no email/OAuth
  - Data: users(id, installation_id, display_name, created_at, last_seen_at); session token hashed server-side
  - Interfaces: POST /register, GET /me; token kept in OS secure storage
- **FS25 Local Save**
  - Purpose: find, validate, hash, back up, replace local savegames
  - Behaviour: OS auto-scan first (Windows Documents/My Games, Linux Steam/Proton), manual folder pick fallback; states Valid / Suspicious / Invalid / Inaccessible; SHA-256; timestamped backup before every replace; any failure leaves original untouched
  - Data: bound save path; metadata (slot, map, last_modified, size, hash); local sync state (last_synced_hash/at)
  - Interfaces: Tauri commands only (scan, validate, metadata, hash, backup, replace) — no FS logic in frontend
  - Note: exact FS25 validation markers taken from real savegames at implementation, not assumed
- **Farms & Membership**
  - Purpose: small trusted group that can see each other's saves
  - Behaviour: create (name + bound save) yields short case-insensitive code (X7K9-PQ2 style); join via code → pending request → owner accept/deny; max 16 members; multi-farm membership with one active farm (dropdown); owner can transfer ownership to any member (confirm dialog, immediate); previous owner stays as member; leave-succession remains fallback (ownership to earliest-joined remaining member); kick = leave = that player's cloud save deleted; last member leaving deletes farm + all cloud saves
  - Data: farms(id, code, name, owner_id, created_at); farm_members(farm_id, user_id, role, joined_at); farm_invites(id, farm_id, user_id, status, created_at)
  - Interfaces: POST /farms, GET /farms/:id, POST /farms/:id/join, GET invites, POST invites/:id/accept|deny, GET members, DELETE members/:userId, POST /farms/:farmId/transfer-owner
- **Cloud Save Sync**
  - Purpose: one current cloud save per player per farm
  - Behaviour: upload = zip local save (progress) → SHA-256 → authorized direct-to-R2 put (zip+upload progress shown) → complete metadata, replaces prior object; download = confirm → backup local → fetch zip → verify SHA-256 → replace local → update sync state; conflict warning when local hash ≠ last_synced_hash (Keep Mine / Download Cloud / Cancel); poll farm data every 20s while farm screen open; warn above ~200 MB but allow
  - Data: player_saves(farm_id, user_id, object_key, file_size, sha256, save_name, uploaded_at); R2 key farms/{farm_id}/players/{user_id}/save (single zip)
  - Interfaces: GET /farms/:id/saves, POST /saves/upload-authorize, POST /saves/upload-complete, POST /saves/:playerId/download-authorize
- **Desktop UI**
  - Purpose: minimal gaming-utility shell
  - Behaviour: Farm screen (name + code copy, latest upload, player list, upload/download), farm switcher dropdown, owner-only "Make owner" action on player rows, Settings (display name, save path, backup location, farm info, change save, leave farm), confirmations for destructive ops, two-phase zip/upload progress, listed error toasts (offline, invalid farm, hash mismatch, …)
  - Data: settings + local sync state only
  - Interfaces: Svelte pages → Tauri commands + API client

## Tech Stack
- Desktop: Tauri 2, Rust (src-tauri/fs25/ discovery per-OS, validator, metadata, hash, backup), Svelte + TypeScript
- Backend: Cloudflare Workers + Hono + TypeScript; D1 metadata; R2 save zips; Wrangler local dev (local Worker/D1/R2 simulation)
- Upload/download: client ↔ R2 direct via short-lived authorized URLs; Worker never streams save bytes
- Two repos (local Git first, remotes later): FarmCrossSync25 (desktop, eventually public), FarmCrossSync25-backend (stays private)
- Environments: local → Cloudflare staging → production (human checkpoint before prod infra); client holds only API_BASE_URL
- Installers: Windows NSIS .exe, Linux AppImage

## Art & Audio
- Dark modern gaming utility (Steam / Discord / launcher feel); no audio
- Target ~1000×700, usable at 900×600; no stock art, system fonts + simple icons
- Browser HTML/CSS/JS prototype with fake data before the real Tauri app (welcome, create/join, dashboard, players, requests, upload, download, confirm, conflict, settings, errors)

## Scope
- MVP: all Systems above; DoD = 2+ players install, name themselves, discover or pick save, validate, create/join, approve, upload, see timestamps, download, backup, verify, replace, conflict warning, recover from failed transfers, Windows + Linux
- Cut: mods sync, save/cloud history, merging, chat/voice, dedicated servers, matchmaking, public discovery, global friends, mobile, WebSockets, analytics/ads, email/OAuth accounts, auto-update, farm-code rotation, self-hosting
- Timeline: solo, stage-by-stage (1 FS25 local → 2 GUI prototype → 3 local backend → 4 CF staging → 5 Tauri integration → 6 production → 7 reliability tests), no hard deadline

## Persistence
- D1: users, farms, farm_members, farm_invites, player_saves — metadata only, never save contents
- R2: one zip object per player per farm, replaced on upload, cascade-deleted on leave/kick/farm deletion
- Local: per-farm sync state (bound save path, last_synced_hash/at), settings, session token in secure storage
- Backups: user-configurable directory (default app data), keep latest 5 timestamped copies, created before every cloud-driven replace
- Offline: scan / validate / backup / replace work locally; farm and cloud actions need network
