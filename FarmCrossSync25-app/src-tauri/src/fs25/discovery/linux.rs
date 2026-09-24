//! Linux savegame discovery (including common Steam/Proton layouts).

use std::path::{Path, PathBuf};

use super::slot_of;
use crate::fs25::contract::SaveCandidate;

/// Scan a single FS25 user-data directory for `savegameN` folders.
///
/// Accepts the base directory so the scan is testable off-Linux. A missing or
/// unreadable base directory yields an empty list rather than an error.
pub fn scan_linux_in(base: &Path) -> Vec<SaveCandidate> {
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

/// Aggregate the native FS25 user-data location with every discovered
/// Steam/Proton compatdata location, deduping identical paths.
pub fn scan_linux() -> Vec<SaveCandidate> {
    let mut candidates = match linux_base_dir() {
        Some(base) => scan_linux_in(&base),
        None => Vec::new(),
    };
    for root in steam_roots() {
        candidates.extend(scan_steam_root_in(&root));
    }
    merge_candidates(candidates)
}

/// Native FS25 user-data location: `$XDG_DATA_HOME/FarmingSimulator2025`
/// (default `~/.local/share/FarmingSimulator2025`).
pub fn linux_base_dir() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("FarmingSimulator2025"))
}

/// Common Steam installation roots that may hold Proton compatdata.
fn steam_roots() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    [
        home.join(".steam").join("steam"),
        home.join(".local").join("share").join("Steam"),
        home.join(".var")
            .join("app")
            .join("com.valvesoftware.Steam")
            .join("data")
            .join("Steam"),
    ]
    .into_iter()
    .filter(|root| root.is_dir())
    .collect()
}

/// Every `.../Documents/My Games/FarmingSimulator2025` folder under a Steam
/// root's Proton compatdata trees. The app id is deliberately not hardcoded:
/// every `compatdata/*` entry is globbed. Paths need not exist yet.
fn steam_save_dirs_in(steam_root: &Path) -> Vec<PathBuf> {
    let compatdata = steam_root.join("steamapps").join("compatdata");
    let Ok(apps) = std::fs::read_dir(&compatdata) else {
        return Vec::new();
    };

    let mut dirs = Vec::new();
    for app in apps.flatten() {
        let users = app.path().join("pfx").join("drive_c").join("users");
        let Ok(users) = std::fs::read_dir(&users) else {
            continue;
        };
        for user in users.flatten() {
            dirs.push(
                user.path()
                    .join("Documents")
                    .join("My Games")
                    .join("FarmingSimulator2025"),
            );
        }
    }
    dirs
}

/// Scan a Steam root for Proton-compat FS25 saves.
fn scan_steam_root_in(steam_root: &Path) -> Vec<SaveCandidate> {
    let mut candidates = Vec::new();
    for save_dir in steam_save_dirs_in(steam_root) {
        candidates.extend(scan_linux_in(&save_dir));
    }
    merge_candidates(candidates)
}

/// Existing FS25 user-data roots: the native base dir plus every Steam/Proton
/// `FarmingSimulator2025` folder that is a directory.
pub fn linux_roots() -> Vec<PathBuf> {
    let mut roots = match linux_base_dir() {
        Some(base) => vec![base],
        None => Vec::new(),
    };
    for steam_root in steam_roots() {
        roots.extend(steam_save_dirs_in(&steam_root));
    }
    roots.retain(|root| root.is_dir());
    roots
}

/// Dedupe candidates by path, then order by slot and path for a stable shape.
fn merge_candidates(mut candidates: Vec<SaveCandidate>) -> Vec<SaveCandidate> {
    candidates.sort_by(|a, b| a.path.cmp(&b.path));
    candidates.dedup_by(|a, b| a.path == b.path);
    candidates.sort_by(|a, b| a.slot.cmp(&b.slot).then_with(|| a.path.cmp(&b.path)));
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fs25-linux-{name}-{}", std::process::id()))
    }

    #[test]
    fn scans_fixture_savegames() {
        let root = fixture_dir("native");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("savegame1")).unwrap();
        std::fs::create_dir_all(root.join("savegame2")).unwrap();
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::create_dir_all(root.join("savegameX")).unwrap();
        std::fs::write(root.join("savegame3"), b"not a directory").unwrap();

        let found = scan_linux_in(&root);
        assert_eq!(
            found.iter().map(|c| c.slot).collect::<Vec<_>>(),
            vec![Some(1), Some(2)]
        );
        assert!(found.iter().all(|c| c.last_modified.is_some()));
        assert!(found[0].path.ends_with("savegame1"));
        assert!(found[1].path.ends_with("savegame2"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_or_unreadable_yields_empty() {
        let missing = fixture_dir("missing");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(scan_linux_in(&missing).is_empty());

        let file = fixture_dir("file");
        let _ = std::fs::remove_dir_all(&file);
        std::fs::write(&file, b"not a dir").unwrap();
        assert!(scan_linux_in(&file).is_empty());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn scans_steam_proton_fixture() {
        let root = fixture_dir("steam");
        let _ = std::fs::remove_dir_all(&root);

        let mk = |app: &str, user: &str, slot: &str| {
            root.join("steamapps")
                .join("compatdata")
                .join(app)
                .join("pfx")
                .join("drive_c")
                .join("users")
                .join(user)
                .join("Documents")
                .join("My Games")
                .join("FarmingSimulator2025")
                .join(slot)
        };
        std::fs::create_dir_all(mk("1234567", "steamuser", "savegame2")).unwrap();
        std::fs::create_dir_all(mk("7654321", "steamuser", "savegame5")).unwrap();
        // A compatdata app with no FS25 save tree must be skipped, not panic.
        std::fs::create_dir_all(root.join("steamapps").join("compatdata").join("99")).unwrap();

        let found = scan_steam_root_in(&root);
        assert_eq!(
            found.iter().map(|c| c.slot).collect::<Vec<_>>(),
            vec![Some(2), Some(5)]
        );
        assert!(found.iter().all(|c| c.path.contains("compatdata")));

        let _ = std::fs::remove_dir_all(&root);
        assert!(scan_steam_root_in(&root).is_empty());
    }

    #[test]
    fn steam_fixture_yields_fs25_root() {
        let root = fixture_dir("steam-roots");
        let _ = std::fs::remove_dir_all(&root);

        let fs25 = root
            .join("steamapps")
            .join("compatdata")
            .join("1234567")
            .join("pfx")
            .join("drive_c")
            .join("users")
            .join("steamuser")
            .join("Documents")
            .join("My Games")
            .join("FarmingSimulator2025");
        std::fs::create_dir_all(fs25.join("savegame2")).unwrap();
        // A compatdata app with no FS25 save tree must be skipped, not panic.
        std::fs::create_dir_all(root.join("steamapps").join("compatdata").join("99")).unwrap();

        let roots = steam_save_dirs_in(&root);
        assert_eq!(roots, vec![fs25.clone()]);
        assert!(roots.iter().all(|r| r.is_dir()));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn merge_dedupes_identical_paths() {
        let c = |slot: u32, path: &str| SaveCandidate {
            slot: Some(slot),
            map_name: None,
            path: path.to_string(),
            last_modified: None,
        };
        let merged = merge_candidates(vec![c(2, "/b"), c(1, "/a"), c(2, "/b")]);
        assert_eq!(
            merged.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(),
            vec!["/a", "/b"]
        );
    }
}
