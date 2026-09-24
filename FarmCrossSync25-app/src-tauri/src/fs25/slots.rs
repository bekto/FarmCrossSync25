//! List the FS25 save slots in a folder.
//!
//! Rust always lists slots 1..=20; any `savegameN` folder with N > 20 found on
//! disk is listed too so no data is hidden. Hiding slots is a UI concern.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::fs25::contract::{Fs25Error, InstallResult, SlotInfo};
use crate::fs25::discovery::slot_of;
use crate::fs25::{backup, hash, replace, validator};

/// Number of slots FS25 always exposes (`savegame1`..`savegame20`).
pub const FS25_SLOT_COUNT: u32 = 20;

/// Absolute path of a slot folder: `<root>/savegame<slot>`.
pub fn slot_path(root: &Path, slot: u32) -> PathBuf {
    root.join(format!("savegame{slot}"))
}

/// One [`SlotInfo`] per slot: 1..=20 always, plus any on-disk `savegameN` > 20.
pub fn list_slots(root: &Path) -> Vec<SlotInfo> {
    let mut slots: BTreeMap<u32, PathBuf> = (1..=FS25_SLOT_COUNT)
        .map(|slot| (slot, slot_path(root, slot)))
        .collect();

    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(slot) = slot_of(&path) {
                if slot > FS25_SLOT_COUNT {
                    slots.insert(slot, path);
                }
            }
        }
    }

    slots
        .into_iter()
        .map(|(slot, path)| slot_info(slot, path))
        .collect()
}

fn slot_info(slot: u32, path: PathBuf) -> SlotInfo {
    let used = path.is_dir();
    let (validation, map_name, last_modified) = if used {
        let result = validator::validate(&path);
        (Some(result.state), result.map_name, result.last_modified)
    } else {
        (None, None, None)
    };

    SlotInfo {
        slot,
        path: path.to_string_lossy().into_owned(),
        used,
        validation,
        map_name,
        last_modified,
    }
}

/// Install an already-extracted save into `<root>/savegame<slot>`.
///
/// A Used slot delegates to the transactional [`replace::replace`] (backup,
/// verify, swap). An Empty slot is created directly: the staged content is
/// verified, copied into a unique sibling temp dir, re-hashed, then renamed into
/// place. On any error no `savegame<slot>` folder and no temp leftovers remain.
pub fn install_to_slot(
    root: &Path,
    slot: u32,
    staged: &Path,
    expected_hash: Option<&str>,
    backup_root: Option<&Path>,
) -> Result<InstallResult, Fs25Error> {
    if slot == 0 {
        return Err(Fs25Error::Internal {
            message: "slot 0 is not a valid FS25 slot".into(),
        });
    }
    if !root.is_dir() {
        return Err(Fs25Error::Inaccessible {
            path: root.to_string_lossy().into_owned(),
            message: "FS25 folder is not a readable directory".into(),
        });
    }

    let target = slot_path(root, slot);

    if target.exists() {
        let result = replace::replace(&target, staged, expected_hash, backup_root)?;
        return Ok(InstallResult {
            path: target.to_string_lossy().into_owned(),
            content_hash: result.content_hash,
            backup_path: result.backup_path,
            was_empty: false,
        });
    }

    // Empty slot: verify staged, build in a temp sibling, then rename into place.
    let staged_hash = hash::hash_folder(staged)?;
    if let Some(expected) = expected_hash {
        if !expected.eq_ignore_ascii_case(&staged_hash) {
            return Err(Fs25Error::Internal {
                message: format!("hash mismatch: expected {expected}, staged {staged_hash}"),
            });
        }
    }

    let temp = replace::unique_sibling(&target, "new")?;
    let temp_guard = replace::TempDir::arm(temp.clone());
    backup::copy_dir(staged, &temp)?;

    let temp_hash = hash::hash_folder(&temp)?;
    if temp_hash != staged_hash {
        return Err(Fs25Error::Internal {
            message: format!("hash mismatch after staging copy: {staged_hash} != {temp_hash}"),
        });
    }

    std::fs::rename(&temp, &target).map_err(|err| Fs25Error::Internal {
        message: format!("could not move new save into place: {err}"),
    })?;
    drop(temp_guard);

    Ok(InstallResult {
        path: target.to_string_lossy().into_owned(),
        content_hash: temp_hash,
        backup_path: None,
        was_empty: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs25::contract::ValidationState;

    fn fixture_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fs25-slots-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_save(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
        for marker in ["farms.xml", "players.xml", "environment.xml"] {
            std::fs::write(dir.join(marker), b"<xml/>").unwrap();
        }
    }

    #[test]
    fn only_savegame1_yields_twenty_slots_slot1_used() {
        let root = fixture_dir("one");
        write_save(&root.join("savegame1"));

        let slots = list_slots(&root);
        assert_eq!(slots.len(), 20);
        assert_eq!(slots[0].slot, 1);
        assert!(slots[0].used);
        assert_eq!(slots[0].validation, Some(ValidationState::Valid));
        for slot in &slots[1..] {
            assert!(!slot.used);
            assert!(slot.validation.is_none());
            assert!(slot.map_name.is_none());
            assert!(slot.last_modified.is_none());
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn extra_slots_above_twenty_are_listed() {
        let root = fixture_dir("extra");
        for slot in [1, 5, 23] {
            write_save(&root.join(format!("savegame{slot}")));
        }

        let slots = list_slots(&root);
        assert_eq!(slots.len(), 21);
        assert_eq!(
            slots.iter().map(|s| s.slot).collect::<Vec<_>>(),
            (1..=20).chain(std::iter::once(23)).collect::<Vec<_>>()
        );
        for slot in &slots {
            assert_eq!(slot.used, matches!(slot.slot, 1 | 5 | 23));
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn non_slot_folders_and_files_are_ignored() {
        let root = fixture_dir("ignore");
        std::fs::create_dir_all(root.join("savegameX")).unwrap();
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::write(root.join("savegame2"), b"not a directory").unwrap();

        let slots = list_slots(&root);
        assert_eq!(slots.len(), 20);
        assert!(!slots[1].used);
        assert_eq!(slots[1].slot, 2);

        let _ = std::fs::remove_dir_all(&root);
    }

    fn write_tagged_save(dir: &Path, tag: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("careerSavegame.xml"), format!("<careerSavegame>{tag}</careerSavegame>"))
            .unwrap();
    }

    fn leftovers(root: &Path, target_name: &str) -> Vec<String> {
        let prefix = format!(".{target_name}.fs25-");
        std::fs::read_dir(root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&prefix))
            .collect()
    }

    #[test]
    fn empty_slot_creates_folder_with_staged_hash_and_no_backup() {
        let root = fixture_dir("install-empty");
        let staged = root.join("staged");
        write_tagged_save(&staged, "new");
        let expected = hash::hash_folder(&staged).unwrap();

        let result = install_to_slot(&root, 2, &staged, Some(&expected), None).unwrap();

        assert!(result.was_empty);
        assert!(result.backup_path.is_none());
        assert_eq!(result.content_hash, expected);
        let target = slot_path(&root, 2);
        assert!(target.is_dir());
        assert_eq!(hash::hash_folder(&target).unwrap(), expected);
        assert!(leftovers(&root, "savegame2").is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn used_slot_replaces_and_reports_backup() {
        let root = fixture_dir("install-used");
        let target = root.join("savegame1");
        write_tagged_save(&target, "old");
        let staged = root.join("staged");
        write_tagged_save(&staged, "new");
        let expected = hash::hash_folder(&staged).unwrap();
        let backups = root.join("backups");

        let result =
            install_to_slot(&root, 1, &staged, Some(&expected), Some(&backups)).unwrap();

        assert!(!result.was_empty);
        assert_eq!(result.content_hash, expected);
        assert_eq!(hash::hash_folder(&target).unwrap(), expected);
        let backup = PathBuf::from(result.backup_path.expect("backup path"));
        assert!(backup.is_dir());
        assert!(backup.starts_with(&backups));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hash_mismatch_on_empty_slot_leaves_nothing() {
        let root = fixture_dir("install-empty-mismatch");
        let staged = root.join("staged");
        write_tagged_save(&staged, "new");

        let result = install_to_slot(&root, 2, &staged, Some("deadbeef"), None);

        assert!(result.is_err());
        assert!(!slot_path(&root, 2).exists(), "savegame2 must not exist");
        assert!(leftovers(&root, "savegame2").is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hash_mismatch_on_used_slot_leaves_original_untouched() {
        let root = fixture_dir("install-used-mismatch");
        let target = root.join("savegame1");
        write_tagged_save(&target, "old");
        let before = hash::hash_folder(&target).unwrap();
        let staged = root.join("staged");
        write_tagged_save(&staged, "new");
        let backups = root.join("backups");

        let result = install_to_slot(&root, 1, &staged, Some("deadbeef"), Some(&backups));

        assert!(result.is_err());
        assert_eq!(hash::hash_folder(&target).unwrap(), before);
        assert!(!backups.exists(), "no backup on mismatch");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn slot_zero_is_rejected() {
        let root = fixture_dir("install-zero");
        let staged = root.join("staged");
        write_tagged_save(&staged, "new");

        assert!(matches!(
            install_to_slot(&root, 0, &staged, None, None),
            Err(Fs25Error::Internal { .. })
        ));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_root_is_inaccessible() {
        let missing = std::env::temp_dir().join("fs25-slots-install-missing-root");
        assert!(matches!(
            install_to_slot(&missing, 1, &missing, None, None),
            Err(Fs25Error::Inaccessible { .. })
        ));
    }
}
