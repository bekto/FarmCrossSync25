# 52: Rust — persist the chosen FS25 folder

**What to build:** Store the user's FS25 folder (the root that contains `savegameN` folders) in the identity file, the same way `backup_location` is stored today.

**Priority:** P0

**Blocked by:** none

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src-tauri/src/identity.rs`: add field `fs25_root: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`, the store methods `set_fs25_root`/`get_fs25_root`, and the Tauri commands `get_fs25_root`/`set_fs25_root(path)`. Copy the `backup_location` code exactly, renamed.
- `lib.rs`: register both commands
- `src/lib/identity.ts`: add `fs25Root: string | null` to `Identity`, plus `getFs25Root()` and `setFs25Root(path)`

**Acceptance:**
- [x] Set then get round-trips the value, trimmed
- [x] An empty string is rejected with `Invalid`
- [x] An identity file without the field still loads (tests copied from the backup_location tests)
- [x] The value survives an app restart because it is stored in the identity file

**Verify:** `cd FarmCrossSync25-app/src-tauri && cargo test --lib` passes; `cd FarmCrossSync25-app && npm run check` clean.

## Work Log
- Done: added `fs25_root` to identity store (field, get/set methods, Tauri commands) + TS `fs25Root`/`getFs25Root`/`setFs25Root`; cargo test --lib 64 passed, npm run check clean.
