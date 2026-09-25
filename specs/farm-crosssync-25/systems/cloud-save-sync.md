# Cloud Save Sync

## Purpose
Publish one current cloud save per player per farm and let farm members fetch each other's saves safely — with verification and backups — instead of merging or diffing FS25 data.

## User-facing behaviour
- Upload My Save: shows two-phase progress (zipping, then uploading), then a success state with the new timestamp. Re-uploading replaces the previous cloud save.
- Farm Saves list shows each player and when they last uploaded; each row has Download (own row is upload-focused).
- Downloading another player's save asks for confirmation: "This will replace your current local FS25 save. A backup will automatically be created first." Actions: Cancel / Download & Replace.
- If the local save changed since the last sync, a conflict warning appears first: Keep My Save / Download Cloud Save / Cancel. Never silently destroy a newer local save.
- A size warning appears above ~200 MB but the operation can proceed.
- While the farm screen is open, saves and requests refresh on a 20-second poll.

## Data it manages
- Player save metadata (one row per player per farm): farm_id, user_id, object_key, file_size, sha256, save_name, uploaded_at.
- R2 object: a single zip archive at `farms/{farm_id}/players/{user_id}/save` (immutable IDs, never display names).
- Local sync state per farm: the bound FS25 **slot** (source of truth; `bound_save_path` is derived from it), last_synced_hash, last_synced_at, and the last cloud save downloaded. A slot belongs to at most one farm.
- No cloud history: a new upload replaces the previous object and metadata.

## Interfaces
- `GET /farms/:farmId/saves` — save list for the farm.
- `POST /saves/upload-authorize` — Worker verifies authentication, farm membership, and that the caller owns the slot; returns temporary authorization to write the R2 object.
- `POST /saves/upload-complete` — after a successful put; Worker updates D1 metadata and replaces any previous entry.
- `POST /saves/:playerId/download-authorize` — Worker verifies membership; returns temporary authorization to read the R2 object.
- Consumes: packed save bytes and content hash from FS25 Local Save; membership facts from Farms & Membership; session token from Identity & Auth.
- Emits: fetched archives to FS25 Local Save for verification and replace; timestamps and hashes to Desktop UI.
- Save bytes move directly between client and R2. The Worker never streams them.

## Edge cases & constraints
- Content hash is SHA-256 over the save folder's contents in stable path order. Upload stores it; download verifies it after extract; conflict detection compares it to `last_synced_hash`. One definition everywhere.
- Upload failure before `upload-complete`: the previous cloud save remains authoritative. Orphaned R2 objects from abandoned uploads are acceptable in MVP.
- Download failure at any step (backup, fetch, verify, replace): the original local save remains untouched and recoverable.
- Hash mismatch on download: abort, do not replace, tell the user verification failed.
- Only the owner of a slot can upload to it; any authenticated member of the farm can download another member's save. Members cannot modify another player's metadata or save.
- Leaving, being kicked, or farm deletion removes that player's R2 object and metadata row.
- Local sync state updates only after a successful replace (download) or a completed upload.
- Concurrent activity is last-write-wins per player slot; two members uploading at once is fine (separate slots). A download in flight while the owner re-uploads simply gets whatever was fetched.
- No WebSockets; polling only. No mod contents awareness — the archive is opaque to the backend.
