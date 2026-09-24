//! Linux FS25 user-data roots (including common Steam/Proton layouts).

use std::path::{Path, PathBuf};

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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("fs25-linux-{name}-{}", std::process::id()))
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
}
