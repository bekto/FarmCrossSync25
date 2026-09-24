# Desktop UI

## Purpose
A minimal gaming-utility shell where farm and save actions are obvious — the user does in one or two clicks what they came to do.

## User-facing behaviour
- Navigation is tiny: Farm and Settings. Players live on the Farm screen. A dropdown on the Farm screen switches the active farm.
- Farm screen: farm name + code with copy, latest upload, player list (name, last upload time, online-dot style indicator), primary actions Upload My Save and Download on rows.
- Owner-only row actions: "Make owner" and kick.
- Join Requests panel for the owner: Accept / Deny.
- Onboarding screens: FS25 folder (auto-detect / Select Folder), Welcome / display name (shown at first cloud action).
- Slot cards (create, join, download pickers): compact view shows Used and linked slots plus one "Slot N · Empty (next free)"; "Show all 20 slots" expands to a 5-column tile grid. The farm's own slot is always visible and preselected. Selectability per mode follows `slots-design.md`.
- Sidebar shows the active farm's slot ("Slot N · <map>", or "Slot N · empty" before the first download).
- Settings: player name, FS25 folder, the farm's slot (change), backup location, farm ID, farm code, Leave Farm.
- Confirmation dialogs before every destructive or replacing action (download & replace, leave, kick, transfer ownership).
- Two-phase progress for upload (zip, then upload). Matching progress for download (fetch, verify, replace).
- Toasts / error states for: no internet, upload failed (local save safe), download failed (existing save not replaced), farm not found, already a member, pending request, savegame not found, invalid save, hash mismatch.

## Data it manages
- Settings only: display name, FS25 folder, slot per farm, backup directory, active farm selection.
- Local sync state is stored by the Rust core and displayed here; the UI does not own it.

## Interfaces
- Svelte + TypeScript pages and components calling:
  - Tauri commands for all filesystem work (scan, validate, metadata, hash, backup, replace) and secure token storage.
  - The API client for Identity & Auth, Farms & Membership, and Cloud Save Sync endpoints.
- Consumes: view models from every other system. Emits: user intent only. No privileged filesystem logic in the frontend.

## Edge cases & constraints
- Offline: local tools remain usable; farm and cloud actions show "Unable to connect to cloud. Your local save has not been changed."
- Failed cloud operations always state that local data is safe — that promise is part of the UI copy.
- Conflict dialog is mandatory when the local save changed since last sync; never proceed silently.
- Window target ~1000×700, usable at 900×600; no complex navigation, no social feed, no enterprise dashboards.
- Destructive actions require explicit confirmation (design principle: never silently overwrite changed local data).
- A browser HTML/CSS/JS prototype with fake data comes first and covers: welcome, create farm, join farm, farm dashboard, players, join request, upload, download, download confirmation, conflict, settings, error states — including fake progress, toasts, and copy-farm-code.
- English-only in MVP; no theming toggle (dark only).
