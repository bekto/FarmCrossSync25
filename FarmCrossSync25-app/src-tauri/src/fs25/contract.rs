//! FS25 command contract: the single source of truth for the Tauri command
//! surface the desktop UI builds against, plus every shared param/result type.
//!
//! Every command returns `Result<T, Fs25Error>`:
//! - `Ok(T)` resolves the JS promise with the typed result `T`.
//! - `Err(Fs25Error)` rejects it with the serialized `Fs25Error` (tagged by `kind`).
//!
//! | Command            | Params                                             | Ok result          |
//! |--------------------|----------------------------------------------------|--------------------|
//! | `scan_saves`       | `root?: string`                                    | `SaveCandidate[]`  |
//! | `validate_save`    | `path: string`                                     | `ValidationResult` |
//! | `read_metadata`    | `path: string`                                     | `SaveMetadata`     |
//! | `compute_hash`     | `path: string`                                     | `HashResult`       |
//! | `create_backup`    | `savePath: string`, `backupDir?: string`           | `BackupResult`     |
//! | `replace_save`     | `targetPath: string`, `stagedPath: string`, `expectedHash?: string` | `ReplaceResult` |
//! | `pack_save`        | `savePath: string`, `outDir?: string`              | `PackResult`       |
//! | `cleanup_pack`     | `archivePath: string`                              | `()`               |
//! | `write_temp_archive` | `contents: number[]`                             | `string`           |
//! | `unpack_save`      | `archivePath: string`, `destDir?: string`          | `UnpackResult`     |
//! | `cleanup_unpack`   | `destPath: string`                                 | `()`               |
//! | `read_sync_state`  | `farmId: string`                                   | `SyncState \| null` |
//! | `write_sync_state` | `farmId: string`, `state: SyncState`               | `SyncState`        |
//! | `set_farm_slot`    | `farmId: string`, `root: string`, `slot: number`   | `SyncState`        |
//! | `list_slots`       | `root: string`                                     | `SlotInfo[]`       |
//! | `install_save_to_slot` | `root: string`, `slot: number`, `stagedPath: string`, `expectedHash?: string`, `backupDir?: string` | `InstallResult` |
//! | `detect_fs25_roots` | none                                              | `string[]`         |
//! | `list_slot_bindings` | none                                             | `SlotBinding[]`    |
//!
//! All structs serialize as camelCase. Sync-state access is only available
//! through the `*_sync_state` / `set_farm_slot` commands; the frontend has no
//! filesystem plugin.

use serde::{Deserialize, Serialize};

/// Structured, serializable error shared by every FS25 command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Fs25Error {
    /// The command exists but its implementation has not landed yet.
    NotImplemented { command: String },
    /// The path does not exist or cannot be read.
    Inaccessible { path: String, message: String },
    /// Any other failure.
    Internal { message: String },
    /// The requested slot is already bound to a different farm (ticket 80).
    #[serde(rename_all = "camelCase")]
    SlotConflict {
        /// Slot that is already taken.
        slot: u32,
        /// Farm that currently owns the slot.
        owner_farm_id: String,
    },
}

impl Fs25Error {
    /// Convenience constructor for the stub `NotImplemented` variant.
    pub fn not_implemented(command: &str) -> Self {
        Fs25Error::NotImplemented {
            command: command.to_string(),
        }
    }
}

impl std::fmt::Display for Fs25Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Fs25Error::NotImplemented { command } => {
                write!(f, "not implemented: {command}")
            }
            Fs25Error::Inaccessible { path, message } => {
                write!(f, "inaccessible: {path} ({message})")
            }
            Fs25Error::Internal { message } => write!(f, "internal: {message}"),
            Fs25Error::SlotConflict {
                slot,
                owner_farm_id,
            } => write!(f, "slot {slot} is already bound to farm {owner_farm_id}"),
        }
    }
}

impl std::error::Error for Fs25Error {}

/// A candidate savegame found by scanning the current OS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCandidate {
    /// Save slot number, when it can be determined.
    pub slot: Option<u32>,
    /// Human-readable map name, when it can be determined.
    pub map_name: Option<String>,
    /// Absolute path to the savegame folder.
    pub path: String,
    /// Last-modified timestamp (RFC 3339), when available.
    pub last_modified: Option<String>,
}

/// Validation states surfaced to the user (see FS25 Local Save spec).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValidationState {
    /// Detected as a valid FS25 savegame.
    Valid,
    /// Looks like an FS25 save but expected files are missing.
    Suspicious,
    /// Not an FS25 savegame.
    Invalid,
    /// The folder cannot be read.
    Inaccessible,
}

/// Result of validating a folder as an FS25 savegame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    /// Overall validation state.
    pub state: ValidationState,
    /// The path that was validated.
    pub path: String,
    /// Detected map name, if any.
    pub map_name: Option<String>,
    /// Last-modified timestamp (RFC 3339), if available.
    pub last_modified: Option<String>,
    /// Expected files that were missing (relevant for `Suspicious`).
    pub missing_files: Vec<String>,
    /// Human-readable detail for the state, if any.
    pub message: Option<String>,
}

/// Lightweight metadata extracted from a save folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMetadata {
    /// Save slot number, when it can be determined.
    pub slot: Option<u32>,
    /// Human-readable map name, when it can be determined.
    pub map_name: Option<String>,
    /// Absolute path to the savegame folder.
    pub path: String,
    /// Last-modified timestamp (RFC 3339), when available.
    pub last_modified: Option<String>,
    /// Total size of the save folder in bytes.
    pub size_bytes: u64,
    /// SHA-256 content hash over the folder contents — the same canonical
    /// digest `compute_hash` returns. `None` when the hash is unknown (e.g. a
    /// folder with no regular files); never an empty string.
    pub content_hash: Option<String>,
}

/// Result of hashing a save folder's contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashResult {
    /// The path that was hashed.
    pub path: String,
    /// SHA-256 hex digest over the folder contents in stable path order.
    pub hash: String,
}

/// Result of creating a timestamped backup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    /// Absolute path of the created backup.
    pub backup_path: String,
    /// Creation timestamp (RFC 3339).
    pub created_at: String,
    /// Backup paths pruned to honour the keep-latest-5 rule.
    pub pruned: Vec<String>,
}

/// Result of a safe (transactional) replace into the bound save path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    /// True once the swap completed successfully.
    pub replaced: bool,
    /// Backup created before the swap, if any.
    pub backup_path: Option<String>,
    /// Content hash of the save now in place.
    pub content_hash: String,
}

/// Result of packing a save folder into a temporary zip archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResult {
    /// Absolute path of the temporary archive; remove it with `cleanup_pack`.
    pub archive_path: String,
    /// Size of the archive in bytes.
    pub size_bytes: u64,
    /// Number of files packed.
    pub file_count: u32,
}

/// Result of extracting a save archive into a staging directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnpackResult {
    /// Absolute path of the directory the archive was extracted into.
    pub dest_path: String,
    /// Number of files extracted.
    pub file_count: u32,
}

/// Progress payload emitted on [`PACK_PROGRESS_EVENT`] while packing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackProgress {
    /// Save folder being packed.
    pub save_path: String,
    /// Completion percentage, 0-100.
    pub percent: u8,
}

/// Local sync state tracked per farm (owned by the Rust core).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    /// Farm this state belongs to.
    pub farm_id: String,
    /// Hash of the current local save, if known.
    pub local_hash: Option<String>,
    /// Hash of the save at last successful upload.
    pub last_uploaded_hash: Option<String>,
    /// Timestamp (RFC 3339) of the last successful upload.
    pub last_uploaded_at: Option<String>,
    /// Hash of the save at last successful download/replace.
    pub last_downloaded_hash: Option<String>,
    /// Timestamp (RFC 3339) of the last successful download/replace.
    pub last_downloaded_at: Option<String>,
    /// Absolute path of the farm's currently bound local save folder.
    #[serde(default)]
    pub bound_save_path: Option<String>,
    /// FS25 save slot the farm is bound to; the source of truth for binding.
    #[serde(default)]
    pub slot: Option<u32>,
    /// Hash of the save at the most recent successful sync (upload or download).
    #[serde(default)]
    pub last_synced_hash: Option<String>,
    /// Timestamp (RFC 3339) of the most recent successful sync.
    #[serde(default)]
    pub last_synced_at: Option<String>,
    /// Timestamp (RFC 3339) this state was last written.
    pub updated_at: Option<String>,
}

/// One FS25 save slot: always present for 1..=20, plus on-disk extras above 20.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotInfo {
    /// Slot number.
    pub slot: u32,
    /// Absolute path `<root>/savegame<slot>`.
    pub path: String,
    /// Whether the slot folder exists on disk.
    pub used: bool,
    /// Validation of the slot folder; `None` when `used` is false.
    pub validation: Option<ValidationState>,
    /// Detected map name, when the slot is used.
    pub map_name: Option<String>,
    /// Last-modified timestamp (RFC 3339), when the slot is used.
    pub last_modified: Option<String>,
}

/// Result of installing an extracted save into a slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    /// Absolute path of the final savegame folder.
    pub path: String,
    /// Content hash of the save now in place.
    pub content_hash: String,
    /// Backup created before an overwrite; `None` when the slot was empty.
    pub backup_path: Option<String>,
    /// True when the target slot did not exist and was created fresh.
    pub was_empty: bool,
}

/// A farm bound to an FS25 save slot.
///
/// The output is single-owner-per-slot: when pre-existing state files claim one
/// slot for several farms, the alphabetically first farm is listed as the owner
/// and the others surface in `conflicting_farm_ids` — they are reported, never
/// silently overwritten (ticket 80).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotBinding {
    /// Farm that owns the slot.
    pub farm_id: String,
    /// Slot the farm is bound to.
    pub slot: u32,
    /// Other farms whose state also claims this slot (pre-existing conflict).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflicting_farm_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Tauri commands (stubs -- all return NotImplemented until later tickets land).
// ---------------------------------------------------------------------------

/// List the save slots in an FS25 folder: 1..=20 plus any `savegameN` with N > 20.
///
/// A missing or unreadable `root` is an error; an existing root with no
/// savegames returns 20 empty slots.
#[tauri::command]
pub fn list_slots(root: String) -> Result<Vec<SlotInfo>, Fs25Error> {
    let root = std::path::Path::new(&root);
    if !root.is_dir() {
        return Err(Fs25Error::Inaccessible {
            path: root.to_string_lossy().into_owned(),
            message: "FS25 folder is not a readable directory".into(),
        });
    }
    Ok(crate::fs25::slots::list_slots(root))
}

/// Install an already-extracted save into `<root>/savegame<slot>`.
///
/// An Empty slot is created fresh (no backup); a Used slot is replaced
/// transactionally with a backup. A hash mismatch aborts before anything is
/// written.
#[tauri::command]
pub fn install_save_to_slot(
    root: String,
    slot: u32,
    staged_path: String,
    expected_hash: Option<String>,
    backup_dir: Option<String>,
) -> Result<InstallResult, Fs25Error> {
    let backup_root = backup_dir
        .filter(|dir| !dir.is_empty())
        .map(std::path::PathBuf::from);
    crate::fs25::slots::install_to_slot(
        std::path::Path::new(&root),
        slot,
        std::path::Path::new(&staged_path),
        expected_hash.as_deref(),
        backup_root.as_deref(),
    )
}

/// Detect the existing FS25 user-data folders on this machine, most likely first.
///
/// Never fails: a machine with no FS25 folder returns an empty list.
#[tauri::command]
pub fn detect_fs25_roots() -> Result<Vec<String>, Fs25Error> {
    Ok(crate::fs25::discovery::detect_roots()
        .into_iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect())
}

/// List which farm owns which slot, from every stored sync-state file.
///
/// A missing state directory or a malformed file is not an error; those farms
/// are simply omitted. Farms with no slot are omitted too. The output never
/// lists two owners for one slot: pre-existing conflicting claimants are
/// reported in `SlotBinding::conflicting_farm_ids` instead (ticket 80).
#[tauri::command]
pub fn list_slot_bindings() -> Result<Vec<SlotBinding>, Fs25Error> {
    crate::fs25::sync_state::SyncStateStore::default_store().list_bindings()
}

/// Scan the current OS for candidate FS25 savegames.
///
/// When `root` is given, the native user-data layout is scanned under that
/// directory instead of the OS default.
#[tauri::command]
pub fn scan_saves(root: Option<String>) -> Result<Vec<SaveCandidate>, Fs25Error> {
    use crate::fs25::discovery;
    use std::path::Path;

    if let Some(root) = root.filter(|r| !r.is_empty()) {
        let base = Path::new(&root);
        #[cfg(target_os = "windows")]
        return Ok(discovery::windows::scan_windows_in(base));
        #[cfg(target_os = "linux")]
        return Ok(discovery::linux::scan_linux_in(base));
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        return Ok(Vec::new());
    }

    #[cfg(target_os = "windows")]
    return Ok(discovery::windows::scan_windows());
    #[cfg(target_os = "linux")]
    return Ok(discovery::linux::scan_linux());
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    return Ok(Vec::new());
}

/// Validate a folder as an FS25 savegame.
///
/// Always resolves `Ok`: unreadable paths surface as
/// [`ValidationState::Inaccessible`] rather than an error.
#[tauri::command]
pub fn validate_save(path: String) -> Result<ValidationResult, Fs25Error> {
    Ok(crate::fs25::validator::validate(std::path::Path::new(&path)))
}

/// Read lightweight metadata from a save folder.
#[tauri::command]
pub fn read_metadata(path: String) -> Result<SaveMetadata, Fs25Error> {
    crate::fs25::metadata::extract(std::path::Path::new(&path))
}

/// Compute the SHA-256 content hash of a save folder.
#[tauri::command]
pub fn compute_hash(path: String) -> Result<HashResult, Fs25Error> {
    crate::fs25::hash::compute(std::path::Path::new(&path))
}

/// Create a timestamped backup of a save folder.
///
/// `backup_dir` is the user-configured backup directory (Settings); when
/// omitted or empty, the app data directory is used.
#[tauri::command]
pub fn create_backup(save_path: String, backup_dir: Option<String>) -> Result<BackupResult, Fs25Error> {
    let save = std::path::Path::new(&save_path);
    let root = backup_dir
        .filter(|dir| !dir.is_empty())
        .map(std::path::PathBuf::from);
    crate::fs25::backup::create_backup(save, root.as_deref())
}

/// Transactionally replace a save folder, leaving the original recoverable on failure.
///
/// `staged_path` is an already-extracted directory of the new save content. The
/// original is verified, backed up, and swapped out transactionally; sync-state
/// persistence is owned by the calling flow, not this command.
#[tauri::command]
pub fn replace_save(
    target_path: String,
    staged_path: String,
    expected_hash: Option<String>,
) -> Result<ReplaceResult, Fs25Error> {
    crate::fs25::replace::replace(
        std::path::Path::new(&target_path),
        std::path::Path::new(&staged_path),
        expected_hash.as_deref(),
        None,
    )
}

/// Event name for pack progress, emitted while `pack_save` runs.
pub const PACK_PROGRESS_EVENT: &str = "fs25-pack-progress";

/// Pack a save folder into a temporary zip archive, emitting progress 0-100.
///
/// The archive is written under `out_dir` when given, else the system temp dir,
/// and its path is returned in [`PackResult`]. Packing only reads the save
/// folder; the caller must remove the archive with [`cleanup_pack`] once done.
#[tauri::command]
pub fn pack_save(
    app: tauri::AppHandle,
    save_path: String,
    out_dir: Option<String>,
) -> Result<PackResult, Fs25Error> {
    use tauri::Emitter;

    let save = std::path::Path::new(&save_path);
    let out = out_dir
        .filter(|dir| !dir.is_empty())
        .map(std::path::PathBuf::from);
    crate::fs25::pack::pack_save(save, out.as_deref(), |percent| {
        let _ = app.emit(
            PACK_PROGRESS_EVENT,
            PackProgress {
                save_path: save_path.clone(),
                percent,
            },
        );
    })
}

/// Remove a temporary archive produced by [`pack_save`]. Idempotent.
#[tauri::command]
pub fn cleanup_pack(archive_path: String) -> Result<(), Fs25Error> {
    crate::fs25::pack::cleanup_pack(std::path::Path::new(&archive_path))
}

/// Persist downloaded archive bytes to a fresh temporary file and return its
/// path, ready for [`unpack_save`]. The frontend has no filesystem plugin, so
/// the download transport stages the fetched bytes through this scoped command.
///
/// ponytail: `contents` arrives as a JSON number array; fine for typical
/// savegame archives. If multi-100 MB downloads make IPC the bottleneck, switch
/// to Tauri's raw IPC (`tauri::ipc::Request`) rather than changing callers.
#[tauri::command]
pub fn write_temp_archive(contents: Vec<u8>) -> Result<String, Fs25Error> {
    crate::fs25::pack::write_temp_archive(&contents)
}

/// Extract a save archive into a staging directory for verification and replace.
///
/// When `dest_dir` is omitted or empty a fresh temporary directory is created
/// and returned in [`UnpackResult`]; the caller owns both the archive and the
/// staging directory and should remove the latter with [`cleanup_unpack`].
#[tauri::command]
pub fn unpack_save(
    archive_path: String,
    dest_dir: Option<String>,
) -> Result<UnpackResult, Fs25Error> {
    let dest = dest_dir
        .filter(|dir| !dir.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(crate::fs25::pack::new_unpack_dir);
    crate::fs25::pack::unpack_save(std::path::Path::new(&archive_path), &dest)
}

/// Remove a staging directory produced by [`unpack_save`]. Idempotent.
#[tauri::command]
pub fn cleanup_unpack(dest_path: String) -> Result<(), Fs25Error> {
    crate::fs25::pack::cleanup_unpack(std::path::Path::new(&dest_path))
}

/// Read the local sync state for a farm, or `None` if none is stored yet.
#[tauri::command]
pub fn read_sync_state(farm_id: String) -> Result<Option<SyncState>, Fs25Error> {
    crate::fs25::sync_state::SyncStateStore::default_store().read(&farm_id)
}

/// Write the local sync state for a farm, stamping `updated_at` to now.
#[tauri::command]
pub fn write_sync_state(farm_id: String, state: SyncState) -> Result<SyncState, Fs25Error> {
    crate::fs25::sync_state::SyncStateStore::default_store().write(&farm_id, state)
}

/// Bind a farm to an FS25 save slot, recording `slot` and deriving
/// `bound_save_path` as `<root>/savegame<slot>`. Creates state if none exists.
///
/// One farm per slot (ticket 80): the command fails with
/// [`Fs25Error::SlotConflict`] when a different farm already owns the slot,
/// leaving every stored binding untouched.
#[tauri::command]
pub fn set_farm_slot(farm_id: String, root: String, slot: u32) -> Result<SyncState, Fs25Error> {
    crate::fs25::sync_state::SyncStateStore::default_store().set_farm_slot(
        &farm_id,
        std::path::Path::new(&root),
        slot,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_state_commands_reject_unsafe_farm_id() {
        assert!(read_sync_state("../escape".into()).is_err());
        assert!(write_sync_state("../escape".into(), SyncState {
            farm_id: "x".into(),
            local_hash: None,
            last_uploaded_hash: None,
            last_uploaded_at: None,
            last_downloaded_hash: None,
            last_downloaded_at: None,
            bound_save_path: None,
            slot: None,
            last_synced_hash: None,
            last_synced_at: None,
            updated_at: None,
        })
        .is_err());
    }

    #[test]
    fn detect_fs25_roots_never_errors() {
        assert!(detect_fs25_roots().is_ok());
    }

    #[test]
    fn list_slots_on_missing_root_is_inaccessible() {
        assert!(matches!(
            list_slots("/nonexistent/fs25/folder".into()),
            Err(Fs25Error::Inaccessible { .. })
        ));
    }

    #[test]
    fn read_metadata_on_missing_path_is_inaccessible() {
        assert!(matches!(
            read_metadata("/nonexistent/fs25/savegame1".into()),
            Err(Fs25Error::Inaccessible { .. })
        ));
    }

    #[test]
    fn read_metadata_exposes_the_canonical_folder_hash() {
        // Drives the same command-level function the TS wrapper invokes, and
        // asserts the exposed hash equals `hash_folder` for the same folder.
        let root = std::env::temp_dir().join(format!(
            "fs25-contract-metadata-hash-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let save = root.join("savegame1");
        std::fs::create_dir_all(save.join("sub")).unwrap();
        std::fs::write(save.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
        std::fs::write(save.join("sub").join("map.gdm"), vec![7u8; 1024]).unwrap();

        let exposed = read_metadata(save.to_string_lossy().into_owned()).unwrap();
        let canonical = crate::fs25::hash::hash_folder(&save).unwrap();
        assert_eq!(exposed.content_hash.as_deref(), Some(canonical.as_str()));

        // The command contract serializes camelCase: TS receives `contentHash`.
        let json = serde_json::to_value(&exposed).unwrap();
        assert_eq!(json["contentHash"], serde_json::Value::String(canonical));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn read_metadata_reports_an_unknown_hash_as_null() {
        let root = std::env::temp_dir().join(format!(
            "fs25-contract-metadata-null-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // No regular files: the hash is unknown and must surface as `null`.
        let save = root.join("savegame2");
        std::fs::create_dir_all(&save).unwrap();

        let exposed = read_metadata(save.to_string_lossy().into_owned()).unwrap();
        assert_eq!(exposed.content_hash, None);
        let json = serde_json::to_value(&exposed).unwrap();
        assert_eq!(json["contentHash"], serde_json::Value::Null);

        let _ = std::fs::remove_dir_all(&root);
    }
}
