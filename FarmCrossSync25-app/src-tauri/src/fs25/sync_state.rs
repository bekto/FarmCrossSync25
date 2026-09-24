//! Persistent local sync state, one JSON file per farm.
//!
//! State lives at `<root>/<farm_id>.json`, where the default root is
//! `dirs::data_dir()/com.farmcrosssync.desktop/sync-state` (the same app data
//! directory [`crate::fs25::backup`] uses). The root is injectable via
//! [`SyncStateStore::with_root`] so tests can use a temp directory.
//!
//! # Access boundary (criterion 4)
//!
//! The store is **only** reachable through the Tauri command layer
//! (`read_sync_state`, `write_sync_state`, `set_farm_slot` in
//! [`crate::fs25::contract`]). No filesystem plugin is enabled for the
//! frontend, and the store path is never returned to it, so the UI cannot use
//! these commands as an arbitrary file read/write API. `farm_id` is validated
//! to a single safe path component before any file access.
//!
//! Writes are atomic (temp file + rename) so an interrupted write can never
//! leave a truncated state file that would read back as a parse error.
//!
//! # Field meaning
//!
//! `bound_save_path` is the farm's currently bound local save folder.
//! `last_synced_hash` / `last_synced_at` describe the most recent successful
//! sync (upload or download/replace); they are written by the upload/download
//! flows, not here. `local_hash`, `last_uploaded_*` and `last_downloaded_*`
//! are retained for the existing contract. State is only updated after a
//! successful replace or a completed upload; partial operations leave it
//! unchanged.

use std::path::{Path, PathBuf};

use crate::fs25::contract::{Fs25Error, SlotBinding, SyncState};
use crate::fs25::slots::slot_path;

/// Owns the on-disk location of per-farm sync state.
#[derive(Debug, Clone)]
pub struct SyncStateStore {
    root: PathBuf,
}

impl SyncStateStore {
    /// Store backed by the default app data directory.
    pub fn default_store() -> Self {
        Self::with_root(default_root())
    }

    /// Store backed by an explicit root directory (used by tests).
    pub fn with_root(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
        }
    }

    /// Read a farm's state, or `None` when no state file exists yet.
    pub fn read(&self, farm_id: &str) -> Result<Option<SyncState>, Fs25Error> {
        let path = self.state_path(farm_id)?;
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path).map_err(|err| Fs25Error::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let state: SyncState = serde_json::from_str(&raw).map_err(|err| Fs25Error::Internal {
            message: format!("invalid sync state at {}: {err}", path.display()),
        })?;
        Ok(Some(state))
    }

    /// Persist a farm's state, stamping `updated_at` to now. Returns the stored
    /// state (with `farm_id` and `updated_at` normalised).
    pub fn write(&self, farm_id: &str, mut state: SyncState) -> Result<SyncState, Fs25Error> {
        state.farm_id = farm_id.to_string();
        state.updated_at = Some(chrono::Local::now().to_rfc3339());
        self.store(farm_id, &state)?;
        Ok(state)
    }

    /// Bind a farm to a save slot, creating state if none exists yet.
    ///
    /// `slot` is the source of truth; `bound_save_path` is kept equal to
    /// `<root>/savegame<slot>` for compatibility.
    pub fn set_farm_slot(
        &self,
        farm_id: &str,
        root: &Path,
        slot: u32,
    ) -> Result<SyncState, Fs25Error> {
        if slot == 0 {
            return Err(Fs25Error::Internal {
                message: "slot 0 is not a valid FS25 slot".into(),
            });
        }
        let mut state = self.read(farm_id)?.unwrap_or_else(|| SyncState {
            farm_id: farm_id.to_string(),
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
        });
        state.slot = Some(slot);
        state.bound_save_path = Some(slot_path(root, slot).to_string_lossy().into_owned());
        self.write(farm_id, state)
    }

    /// List every farm bound to a slot, from `<root>/*.json`.
    ///
    /// Unreadable or malformed files and states with no slot are skipped; a
    /// missing state directory yields an empty list.
    pub fn list_bindings(&self) -> Result<Vec<SlotBinding>, Fs25Error> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(_) => return Ok(Vec::new()),
        };
        let mut bindings = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(state) = serde_json::from_str::<SyncState>(&raw) else {
                continue;
            };
            if let Some(slot) = state.slot {
                bindings.push(SlotBinding {
                    farm_id: state.farm_id,
                    slot,
                });
            }
        }
        Ok(bindings)
    }

    fn state_path(&self, farm_id: &str) -> Result<PathBuf, Fs25Error> {
        validate_farm_id(farm_id)?;
        Ok(self.root.join(format!("{farm_id}.json")))
    }

    fn store(&self, farm_id: &str, state: &SyncState) -> Result<(), Fs25Error> {
        let path = self.state_path(farm_id)?;
        std::fs::create_dir_all(&self.root).map_err(|err| Fs25Error::Inaccessible {
            path: self.root.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let json = serde_json::to_string_pretty(state).map_err(|err| Fs25Error::Internal {
            message: format!("failed to serialize sync state: {err}"),
        })?;
        // ponytail: temp file in the same dir then rename; a crash mid-write
        // leaves the previous state intact rather than a truncated file.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|err| Fs25Error::Inaccessible {
            path: tmp.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        std::fs::rename(&tmp, &path).map_err(|err| Fs25Error::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        Ok(())
    }
}

/// Default root: app data dir + bundle id + `sync-state`, matching backup.rs.
fn default_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.farmcrosssync.desktop")
        .join("sync-state")
}

/// Reject any `farm_id` that is not a single safe path component.
fn validate_farm_id(farm_id: &str) -> Result<(), Fs25Error> {
    let safe = !farm_id.is_empty()
        && farm_id != "."
        && farm_id != ".."
        && farm_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if safe {
        Ok(())
    } else {
        Err(Fs25Error::Internal {
            message: format!("invalid farm id: {farm_id:?}"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fs25-sync-state-{name}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn empty_state(farm_id: &str) -> SyncState {
        SyncState {
            farm_id: farm_id.to_string(),
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
        }
    }

    #[test]
    fn missing_state_reads_as_none() {
        let root = fixture("missing");
        let store = SyncStateStore::with_root(&root);
        assert_eq!(store.read("farm-1").unwrap(), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_then_read_round_trips_and_stamps_updated_at() {
        let root = fixture("roundtrip");
        let store = SyncStateStore::with_root(&root);
        let mut state = empty_state("farm-1");
        state.bound_save_path = Some("/saves/savegame1".into());
        state.last_synced_hash = Some("abc123".into());
        state.last_synced_at = Some("2026-01-01T00:00:00+00:00".into());

        let written = store.write("farm-1", state).unwrap();
        assert!(written.updated_at.is_some(), "updated_at not stamped");

        let read = store.read("farm-1").unwrap().unwrap();
        assert_eq!(read.farm_id, "farm-1");
        assert_eq!(read.bound_save_path.as_deref(), Some("/saves/savegame1"));
        assert_eq!(read.last_synced_hash.as_deref(), Some("abc123"));
        assert_eq!(
            read.last_synced_at.as_deref(),
            Some("2026-01-01T00:00:00+00:00")
        );
        assert_eq!(read.updated_at, written.updated_at);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn state_survives_a_fresh_store_instance() {
        let root = fixture("persist");
        let written = SyncStateStore::with_root(&root)
            .write(
                "farm-1",
                SyncState {
                    bound_save_path: Some("/saves/bound".into()),
                    ..empty_state("farm-1")
                },
            )
            .unwrap();

        // A brand-new store over the same base dir reads the JSON from disk.
        let reopened = SyncStateStore::with_root(&root).read("farm-1").unwrap();
        let reopened = reopened.expect("state did not survive");
        assert_eq!(reopened.bound_save_path.as_deref(), Some("/saves/bound"));
        assert_eq!(reopened.updated_at, written.updated_at);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn partial_legacy_json_still_parses() {
        let root = fixture("legacy");
        std::fs::create_dir_all(&root).unwrap();
        // Old state with only farmId and no new/synced fields.
        std::fs::write(root.join("farm-1.json"), r#"{"farmId":"farm-1"}"#).unwrap();

        let state = SyncStateStore::with_root(&root)
            .read("farm-1")
            .unwrap()
            .unwrap();
        assert_eq!(state.farm_id, "farm-1");
        assert_eq!(state.bound_save_path, None);
        assert_eq!(state.slot, None);
        assert_eq!(state.last_synced_hash, None);
        assert_eq!(state.last_synced_at, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn set_farm_slot_creates_state_with_slot_and_derived_path() {
        let root = fixture("slot-create");
        let store = SyncStateStore::with_root(&root);
        let fs25_root = Path::new("/fs25");

        let created = store.set_farm_slot("farm-1", fs25_root, 3).unwrap();

        assert_eq!(created.slot, Some(3));
        assert_eq!(
            created.bound_save_path.as_deref(),
            Some("/fs25/savegame3")
        );

        let read = store.read("farm-1").unwrap().unwrap();
        assert_eq!(read.slot, Some(3));
        assert_eq!(read.bound_save_path.as_deref(), Some("/fs25/savegame3"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn set_farm_slot_keeps_hashes_and_timestamps() {
        let root = fixture("slot-preserve");
        let store = SyncStateStore::with_root(&root);
        let mut state = empty_state("farm-1");
        state.local_hash = Some("local".into());
        state.last_uploaded_hash = Some("up".into());
        state.last_uploaded_at = Some("2026-01-01T00:00:00+00:00".into());
        state.last_synced_hash = Some("sync".into());
        state.last_synced_at = Some("2026-01-02T00:00:00+00:00".into());
        store.write("farm-1", state).unwrap();

        let updated = store
            .set_farm_slot("farm-1", Path::new("/fs25"), 2)
            .unwrap();

        assert_eq!(updated.slot, Some(2));
        assert_eq!(updated.local_hash.as_deref(), Some("local"));
        assert_eq!(updated.last_uploaded_hash.as_deref(), Some("up"));
        assert_eq!(
            updated.last_uploaded_at.as_deref(),
            Some("2026-01-01T00:00:00+00:00")
        );
        assert_eq!(updated.last_synced_hash.as_deref(), Some("sync"));
        assert_eq!(
            updated.last_synced_at.as_deref(),
            Some("2026-01-02T00:00:00+00:00")
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn set_farm_slot_rejects_zero() {
        let root = fixture("slot-zero");
        let store = SyncStateStore::with_root(&root);
        assert!(matches!(
            store.set_farm_slot("farm-1", Path::new("/fs25"), 0),
            Err(Fs25Error::Internal { .. })
        ));
        assert_eq!(store.read("farm-1").unwrap(), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn list_bindings_returns_only_farms_with_a_slot() {
        let root = fixture("list-bindings");
        let store = SyncStateStore::with_root(&root);
        store.set_farm_slot("farm-1", Path::new("/fs25"), 1).unwrap();
        store.set_farm_slot("farm-2", Path::new("/fs25"), 2).unwrap();
        store
            .write(
                "farm-3",
                SyncState {
                    bound_save_path: Some("/saves/whatever".into()),
                    ..empty_state("farm-3")
                },
            )
            .unwrap();

        let mut bindings = store.list_bindings().unwrap();
        bindings.sort_by(|a, b| a.farm_id.cmp(&b.farm_id));

        assert_eq!(
            bindings,
            vec![
                SlotBinding { farm_id: "farm-1".into(), slot: 1 },
                SlotBinding { farm_id: "farm-2".into(), slot: 2 },
            ]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn list_bindings_on_missing_dir_is_empty() {
        let root = std::env::temp_dir().join(format!(
            "fs25-sync-state-list-missing-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(SyncStateStore::with_root(&root).list_bindings().unwrap(), Vec::new());
    }

    #[test]
    fn list_bindings_skips_corrupt_files() {
        let root = fixture("list-corrupt");
        let store = SyncStateStore::with_root(&root);
        store.set_farm_slot("farm-1", Path::new("/fs25"), 4).unwrap();
        std::fs::write(root.join("broken.json"), b"{not json").unwrap();

        let bindings = store.list_bindings().unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].farm_id, "farm-1");
        assert_eq!(bindings[0].slot, 4);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unsafe_farm_id_is_rejected() {
        let root = fixture("unsafe");
        let store = SyncStateStore::with_root(&root);
        for bad in ["", "..", "a/b", "a\\b", "farm id"] {
            assert!(
                store.read(bad).is_err(),
                "farm id {bad:?} should be rejected"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
