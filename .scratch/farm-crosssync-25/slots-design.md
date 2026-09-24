# Save Slots — Design (tickets 50–70)

Source of truth for the slot rework. Every ticket from 50 onward points here.
Read this section by section. Do not redesign anything described here.

## What changes for the user
1. **Onboarding:** the user picks the **FS25 folder** (the folder that *contains*
   `savegame1`, `savegame2`, …), not a single savegame. Auto-detect proposes it;
   "Select Folder" is always available. If they pick a `savegameN` folder by
   mistake, its parent is used.
2. The app shows **slot cards**. FS25 supports up to 20 slots (`savegame1` to
   `savegame20`). Each slot is either **Used** (the folder exists, with map name
   + last modified) or **Empty**. By default only a short list is shown (see
   "Slot display" below).
3. **Create farm:** the user picks a **Used** slot to start the farm with.
4. **Join farm:** the user picks any slot, Used or Empty.
5. **Download a friend's save:** a slot picker opens with the farm's slot
   preselected. The user can keep it or pick another slot:
   - Empty slot: the save is installed as `<root>/savegameN`. No backup is needed.
   - Used slot: overwrite confirmation, then backup, verify and replace (the flow that exists today).
   - After success, that slot becomes the farm's slot.
6. **Every farm is bound to exactly one slot.** Upload uses that slot. Settings
   shows and changes both the FS25 folder and the farm's slot.

## Rules
- **Slot count:** `FS25_SLOT_COUNT = 20` (Rust constant in `fs25/slots.rs`,
  matching FS25's `savegame1`..`savegame20`). Rust always lists slots 1..=20.
  Any `savegameN` folder with N > 20 found on disk is listed too, so no data is
  hidden. Hiding slots is purely a UI concern (next section).
- **The archive is independent of the slot folder name.** `pack.rs` zips paths
  relative to the save folder, so the archive never contains `savegame1/`.
  A save uploaded from `savegame1` can be unpacked into `savegame2` unchanged.
  The content hash covers folder contents only, so the folder name does not
  affect it.
  (Ticket 69 also checks that no XML inside a real save hardcodes its own
  folder name.)
- **Slot is the binding; the path is derived.** `SyncState.slot` is the source
  of truth. `bound_save_path` is kept in sync as `<root>/savegame<slot>` for
  compatibility. If the FS25 folder changes, slot numbers stay and paths are
  re-derived.
- **Never build paths in TypeScript.** Always use `SlotInfo.path` returned by
  Rust, because Windows and Linux use different separators.
- **A slot belongs to at most one farm.** A slot bound to a different farm is
  shown as "Linked to <farm name>" and cannot be selected (the card is disabled).
- **When the conflict gate runs:** the existing conflict check (`conflict.ts`)
  runs only when the download target is the farm's **currently bound slot**. For
  any other Used slot, use the overwrite confirmation instead. An Empty slot gets
  no confirmation beyond the normal download confirm.
- **Failure safety is unchanged.** A failed install into an Empty slot must leave
  no `savegameN` folder behind. A failed install into a Used slot must leave the
  original untouched (already guaranteed by `replace.rs`).

## Slot display (keeps 20 slots easy to choose from)
- **Compact view (default):** show every slot that is Used or linked to a
  farm, plus **one** Empty slot (the lowest-numbered one that is selectable in
  the current mode), labelled "Slot N · Empty (next free)". Sort by slot number.
- If the list has no Used slots (fresh install), the compact view shows just
  that next free Empty slot.
- A **"Show all 20 slots"** toggle under the cards expands the view to every
  slot. The toggle reads "Show fewer" when expanded, and is hidden when the
  compact view already shows everything.
- A preselected card (the farm's own slot) is always visible, even in the
  compact view.
- Expanded view uses small tiles in a 5-column grid (4 rows for 20 slots).
  The compact view uses the full-size cards.
- Pure helper: `visibleCards(cards, expanded)` in `src/lib/slots.ts`
  (ticket 56). Components never filter cards themselves.

## Selectability matrix (implemented in `src/lib/slots.ts`)
| Slot state                 | mode `create` | mode `join` | mode `download`              |
|----------------------------|---------------|-------------|------------------------------|
| Empty                      | disabled      | selectable  | selectable                   |
| Used, valid/suspicious     | selectable    | selectable  | selectable (overwrite confirm unless it is this farm's slot) |
| Used, invalid/inaccessible | disabled      | disabled    | selectable (overwrite confirm) |
| Linked to another farm     | disabled      | disabled    | disabled                     |
| Linked to this farm        | selectable    | selectable  | selectable, preselected      |

## New Rust surface (all in `src-tauri/src/fs25/`, registered in `src-tauri/src/lib.rs`)
| Command                 | Params                                             | Ok result        | Ticket |
|-------------------------|----------------------------------------------------|------------------|--------|
| `list_slots`            | `root: string`                                     | `SlotInfo[]`     | 50 |
| `install_save_to_slot`  | `root: string, slot: number, stagedPath: string, expectedHash?: string, backupDir?: string` | `InstallResult` | 51 |
| `detect_fs25_roots`     | none                                               | `string[]`       | 53 |
| `set_farm_slot`         | `farmId: string, root: string, slot: number`       | `SyncState`      | 54 |
| `list_slot_bindings`    | none                                               | `SlotBinding[]`  | 55 |
| `get_fs25_root` / `set_fs25_root` | `path` for set                           | `string \| null` / `Identity` | 52 |

```rust
pub struct SlotInfo {            // camelCase over IPC
    pub slot: u32,
    pub path: String,            // <root>/savegame<slot>, absolute
    pub used: bool,              // folder exists
    pub validation: Option<ValidationState>, // None when !used
    pub map_name: Option<String>,
    pub last_modified: Option<String>,
}
pub struct InstallResult {
    pub path: String,            // final savegame folder
    pub content_hash: String,
    pub backup_path: Option<String>, // None when the slot was empty
    pub was_empty: bool,
}
pub struct SlotBinding { pub farm_id: String, pub slot: u32 }
```

## Frontend state (after ticket 59)
- `fs25Root` store (`uiState.ts`): loaded from `get_fs25_root` at startup.
  While it is null, the Farm tab shows the FS25 folder onboarding.
- `boundSave` store: this is **no longer global**. It is derived from the active
  farm's `SyncState.slot` plus `list_slots(fs25Root)`. It is null when the farm
  has no slot yet.
- `SaveLocation.svelte`, the in-memory global `boundSave`, and the `$effect`
  that copies it into every farm are unwired in ticket 60 and deleted in ticket 69.

## Deliberately out of scope
- Migrating old `boundSavePath`-only sync state. The app is not released yet,
  so farms without a slot simply show "Choose a slot" (ticket 61).
- Backend changes. The backend does not need to know about slots.
- Moving or renaming the user's existing slot folders.
