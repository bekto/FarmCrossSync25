# FS25 Local Save

## Purpose
Reliably find, validate, fingerprint, back up, and replace the local FS25 savegame so cloud sync can never corrupt or silently overwrite the player's farm.

## User-facing behaviour
- Onboarding picks the **FS25 folder** (the folder containing `savegame1`…`savegame20`), not a single save. Auto-detect proposes it; "Select Folder" is always available. Picking a `savegameN` folder by mistake uses its parent.
- The folder is shown as **slots** 1–20 (plus any `savegameN` with N > 20 found on disk). Each slot is **Used** (folder exists, with map name + last modified) or **Empty**.
- **Every farm is bound to exactly one slot.** Create farm picks a Used slot; join farm picks any slot, Used or Empty. Upload uses the farm's slot.
- Download opens a slot picker with the farm's slot preselected. Empty slot: the save is installed as `<root>/savegameN`, no backup needed. Used slot: overwrite confirmation (or the conflict gate when it is the farm's own slot), then backup, verify, replace. The chosen slot becomes the farm's slot.
- A slot belongs to at most one farm; a slot linked to another farm is shown as "Linked to <farm>" and cannot be picked.
- Saves are validated per slot, never trusted just because the folder exists.
- Validation states shown to the user: Valid (detected, with map and last-modified), Suspicious (looks like an FS25 save but expected files are missing — usable with a warning), Invalid (not an FS25 savegame), Inaccessible (cannot read the folder).
- Before any cloud-driven replace, a timestamped backup is created automatically.
- Settings shows and changes both the FS25 folder and the farm's slot.

## Data it manages
- FS25 folder (one per installation) and each farm's slot (`SyncState.slot`, the source of truth). `bound_save_path` is derived as `<root>/savegame<slot>`; changing the FS25 folder keeps slot numbers and re-derives paths. Paths are only ever built in Rust (`SlotInfo.path`).
- Save metadata: save slot, map, last modified, path, size, content hash. Extracted lightly — never parse the entire save.
- Content hash: SHA-256 over the save folder's contents in stable path order (relative path + bytes). This is the single hash used for upload metadata, download verification, and conflict detection.
- Backups on disk: timestamped copies under the configured backup directory (user-configurable in Settings; default is the app data directory). Keep the latest 5; prune older ones.

## Interfaces
- All access goes through Tauri commands in Rust (module layout: per-OS discovery, validator, metadata, hash, backup). The frontend never touches the filesystem.
- Consumes: user selection of a save folder; downloaded save archives from Cloud Save Sync.
- Emits: candidate list, validation state, metadata, content hash, backup results, and the result of a safe replace to Desktop UI; packed/unpacked save bytes and hashes to Cloud Save Sync.
- Safe replace: extract to a temporary location, verify, swap into place, then update local sync state. Any failure leaves the original save untouched.
- Install into an Empty slot: same staging and verification; a failure leaves no `savegameN` folder behind.
- Archives are independent of the slot folder name (paths are relative to the save folder, and the hash covers contents only), so a save from `savegame1` can be installed into `savegame2` unchanged. Checked on a real FS25 save: it never names its own folder (ticket 69).

## Edge cases & constraints
- Exact FS25 validation markers and metadata fields must be determined from real FS25 savegames during implementation. Do not hardcode assumptions before inspecting real save structures.
- Keep three paths distinct: FS25 installation ≠ FS25 user data folder ≠ specific savegame slot. The app works with the user data folder and its slots.
- Auto-scan must cover Windows (Documents / My Games) and Linux (including common Steam/Proton layouts).
- Suspicious saves may be bound, packed, and uploaded with a warning; Invalid and Inaccessible block those actions.
- Replacing must be transactional from the user's point of view: interrupted download, corrupt archive, hash mismatch, permission failure, disk failure, or network timeout must leave the original recoverable.
- Backup directory is user-configurable; changing it does not move existing backups.
- Two farms cannot bind the same slot.
- If the bound path disappears or becomes unreadable at use time, surface an error and offer to pick another slot rather than failing silently.
