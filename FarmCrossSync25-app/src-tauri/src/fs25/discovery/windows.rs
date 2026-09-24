//! Windows savegame discovery (Documents / My Games).

use std::path::{Path, PathBuf};

use super::slot_of;
use crate::fs25::contract::SaveCandidate;

/// Scan a Windows FS25 user-data directory for `savegameN` folders.
///
/// Accepts the base directory so the scan is testable off-Windows. A missing
/// or unreadable base directory yields an empty list rather than an error.
pub fn scan_windows_in(base: &Path) -> Vec<SaveCandidate> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };

    let mut candidates: Vec<SaveCandidate> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            let slot = slot_of(&path)?;
            let last_modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());
            Some(SaveCandidate {
                slot: Some(slot),
                map_name: None,
                path: path.to_string_lossy().into_owned(),
                last_modified,
            })
        })
        .collect();

    candidates.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.path.cmp(&b.path)));
    candidates
}

/// Scan the standard Windows FS25 user-data location.
pub fn scan_windows() -> Vec<SaveCandidate> {
    match windows_base_dir() {
        Some(base) => scan_windows_in(&base),
        None => Vec::new(),
    }
}

/// `%USERPROFILE%\Documents\My Games\FarmingSimulator2025`, honouring a
/// redirected/localized Documents folder via the known-folder API.
pub fn windows_base_dir() -> Option<PathBuf> {
    Some(
        dirs::document_dir()?
            .join("My Games")
            .join("FarmingSimulator2025"),
    )
}

/// Existing FS25 user-data roots on Windows.
pub fn windows_roots() -> Vec<PathBuf> {
    windows_base_dir()
        .filter(|root| root.is_dir())
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_fixture_savegames() {
        let root = std::env::temp_dir().join(format!("fs25-win-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("savegame1")).unwrap();
        std::fs::create_dir_all(root.join("savegame2")).unwrap();
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::write(root.join("savegame3"), b"not a directory").unwrap();

        let found = scan_windows_in(&root);
        assert_eq!(
            found.iter().map(|c| c.slot).collect::<Vec<_>>(),
            vec![Some(1), Some(2)]
        );
        assert!(found.iter().all(|c| c.last_modified.is_some()));
        assert!(found[0].path.ends_with("savegame1"));
        assert!(found[1].path.ends_with("savegame2"));

        let _ = std::fs::remove_dir_all(&root);
        assert!(scan_windows_in(&root).is_empty());
    }
}
