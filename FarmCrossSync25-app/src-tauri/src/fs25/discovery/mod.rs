//! Per-OS discovery of FS25 savegame folders.

pub mod linux;
pub mod windows;

use std::path::{Path, PathBuf};

/// Extract the slot number from a `savegameN` folder name.
pub(crate) fn slot_of(path: &Path) -> Option<u32> {
    path.file_name()?.to_str()?.strip_prefix("savegame")?.parse().ok()
}

/// Existing FS25 user-data folders on this machine, deduped, with roots that
/// contain at least one `savegameN` folder first.
pub fn detect_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    let mut roots = windows::windows_roots();
    #[cfg(target_os = "linux")]
    let mut roots = linux::linux_roots();
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let mut roots: Vec<PathBuf> = Vec::new();

    roots.sort();
    roots.dedup();
    // `sort_by_key` is stable: roots with saves float up, the rest keep order.
    roots.sort_by_key(|root| !has_savegame(root));
    roots
}

/// Whether `root` directly contains at least one `savegameN` folder.
fn has_savegame(root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(root) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        path.is_dir() && slot_of(&path).is_some()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_savegame_detects_slot_folders() {
        let root = std::env::temp_dir().join(format!("fs25-roots-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("savegame1")).unwrap();
        assert!(has_savegame(&root));

        let empty = root.join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(!has_savegame(&empty));
        assert!(!has_savegame(&root.join("missing")));

        let _ = std::fs::remove_dir_all(&root);
    }
}
