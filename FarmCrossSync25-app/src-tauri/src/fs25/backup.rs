//! Timestamped backups of a save folder and retention pruning.
//!
//! A backup is a recursive copy of the save folder into
//! `<backup_root>/<savegame_name>_backup<timestamp>`. The backup root defaults
//! to the app data directory (resolved via `dirs`, see [`default_backup_root`])
//! but callers may point it anywhere; changing it never moves existing backups.
//!
//! After each successful backup the root is pruned so only the five newest
//! backups *of that savegame* remain. Pruning only ever considers directories
//! whose name matches the `<savegame_name>_backup...` pattern this module
//! writes, so unrelated directories in the root are left alone.
//!
//! [`create_backup`] only reads the save folder. It writes to a brand-new
//! destination directory and, on any copy failure, removes the partial
//! destination before returning the structured error. The original save is
//! therefore never modified; aborting the operation it protected is the
//! caller's responsibility (see ticket 11, safe replace).

use std::path::{Path, PathBuf};

use crate::fs25::contract::{BackupResult, Fs25Error};

/// How many backups of a single savegame to keep.
const KEEP_LATEST: usize = 5;

/// Separator between the savegame name and the timestamp in a backup name.
const BACKUP_MARKER: &str = "_backup";

/// Timestamp format used in backup folder names. Fixed-width and lexicographic
/// order matches chronological order, so retention can sort by name.
const TIMESTAMP_FORMAT: &str = "%Y-%m-%d_%H-%M-%S-%3f";

/// Create a timestamped backup of `save_dir` under `backup_root`.
///
/// `backup_root` is honoured when given (this is how Settings points backups
/// elsewhere); when `None`, [`default_backup_root`] is used. Returns the
/// created backup path, the creation timestamp, and any pruned backup paths.
pub fn create_backup(
    save_dir: &Path,
    backup_root: Option<&Path>,
) -> Result<BackupResult, Fs25Error> {
    let meta = std::fs::metadata(save_dir).map_err(|err| Fs25Error::Inaccessible {
        path: save_dir.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    if !meta.is_dir() {
        return Err(Fs25Error::Inaccessible {
            path: save_dir.to_string_lossy().into_owned(),
            message: "not a directory".into(),
        });
    }

    let save_name = save_dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "savegame".into());

    let root = match backup_root {
        Some(root) => root.to_path_buf(),
        None => default_backup_root(),
    };
    std::fs::create_dir_all(&root).map_err(|err| Fs25Error::Inaccessible {
        path: root.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;

    let now = chrono::Local::now();
    let base = format!(
        "{save_name}{BACKUP_MARKER}{}",
        now.format(TIMESTAMP_FORMAT)
    );
    let dest = unique_destination(&root, &base);

    write_backup(save_dir, &dest)?;

    let pruned = prune(&root, &save_name, KEEP_LATEST)?;

    Ok(BackupResult {
        backup_path: dest.to_string_lossy().into_owned(),
        created_at: now.to_rfc3339(),
        pruned,
    })
}

/// Default backup root: the app data directory, matching Tauri's
/// `app_data_dir()` (`dirs::data_dir()` + the bundle identifier). Falls back to
/// a temp directory only if the platform has no data directory.
fn default_backup_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.farmcrosssync.desktop")
}

/// First `base`, then `base_1`, `base_2`, ... that is not already taken.
///
/// Pruning can free the unsuffixed `base` while `base_1`..`base_n` remain. Reusing
/// that freed name would make a newer backup sort before the still-present ones
/// (name order is used for retention), so a suffix above every existing sibling is
/// chosen instead of reusing `base`.
fn unique_destination(root: &Path, base: &str) -> PathBuf {
    let suffix_prefix = format!("{base}_");
    let mut highest = 0u32;
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == base {
                highest = highest.max(1);
            } else if let Some(n) = name
                .strip_prefix(&suffix_prefix)
                .and_then(|s| s.parse::<u32>().ok())
            {
                highest = highest.max(n + 1);
            }
        }
    }
    if highest == 0 {
        root.join(base)
    } else {
        root.join(format!("{base}_{highest}"))
    }
}

/// Recursively copy `src` into a fresh `dest`, cleaning up `dest` on failure so
/// a half-written backup is never left behind.
fn write_backup(src: &Path, dest: &Path) -> Result<(), Fs25Error> {
    match copy_dir(src, dest) {
        Ok(()) => Ok(()),
        Err(err) => {
            let _ = std::fs::remove_dir_all(dest);
            Err(err)
        }
    }
}

/// Recursive directory copy. Symlinks are skipped (as in `hash`) so a
/// self-referential link cannot loop forever.
pub(crate) fn copy_dir(src: &Path, dest: &Path) -> Result<(), Fs25Error> {
    std::fs::create_dir_all(dest).map_err(|err| Fs25Error::Inaccessible {
        path: dest.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    let entries = std::fs::read_dir(src).map_err(|err| Fs25Error::Inaccessible {
        path: src.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| Fs25Error::Inaccessible {
            path: src.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let file_type = entry.file_type().map_err(|err| Fs25Error::Inaccessible {
            path: entry.path().to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let to = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &to).map_err(|err| Fs25Error::Inaccessible {
                path: entry.path().to_string_lossy().into_owned(),
                message: err.to_string(),
            })?;
        }
    }
    Ok(())
}

/// Delete this savegame's backups beyond the newest `keep`, returning their
/// paths. Only directories named `<save_name>_backup...` are considered.
fn prune(root: &Path, save_name: &str, keep: usize) -> Result<Vec<String>, Fs25Error> {
    let prefix = format!("{save_name}{BACKUP_MARKER}");
    let mut backups: Vec<(String, PathBuf)> = Vec::new();
    let entries = std::fs::read_dir(root).map_err(|err| Fs25Error::Inaccessible {
        path: root.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| Fs25Error::Inaccessible {
            path: root.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_dir && name.starts_with(&prefix) {
            backups.push((name, entry.path()));
        }
    }
    // Fixed-width timestamp makes name order chronological.
    backups.sort_by(|a, b| a.0.cmp(&b.0));

    let mut pruned = Vec::new();
    let remove_count = backups.len().saturating_sub(keep);
    for (_, path) in backups.into_iter().take(remove_count) {
        std::fs::remove_dir_all(&path).map_err(|err| Fs25Error::Internal {
            message: format!("failed to prune {}: {err}", path.display()),
        })?;
        pruned.push(path.to_string_lossy().into_owned());
    }
    Ok(pruned)
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
            "fs25-backup-{name}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_save(dir: &Path) {
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
        std::fs::write(dir.join("sub").join("map.gdm"), vec![7u8; 256]).unwrap();
    }

    fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        for entry in walk(dir) {
            let rel = entry.strip_prefix(dir).unwrap().to_string_lossy().into_owned();
            files.push((rel, std::fs::read(&entry).unwrap()));
        }
        files.sort();
        files
    }

    fn walk(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                out.extend(walk(&entry.path()));
            } else {
                out.push(entry.path());
            }
        }
        out
    }

    fn backup_dirs(root: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn creates_timestamped_copy_and_leaves_original() {
        let parent = fixture("create");
        let save = parent.join("savegame1");
        make_save(&save);
        let root = parent.join("backups");
        let before = snapshot(&save);

        let result = create_backup(&save, Some(&root)).unwrap();

        let dest = PathBuf::from(&result.backup_path);
        assert!(dest.is_dir(), "backup dir missing");
        assert!(dest.starts_with(&root), "backup not under configured root");
        let name = dest.file_name().unwrap().to_string_lossy();
        assert!(name.starts_with("savegame1_backup"), "name: {name}");
        assert!(!result.created_at.is_empty());
        assert!(result.pruned.is_empty());

        // Byte-for-byte copy.
        assert_eq!(snapshot(&save), snapshot(&dest));
        // Original untouched.
        assert_eq!(before, snapshot(&save));

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn retention_keeps_five_newest() {
        let parent = fixture("retention");
        let save = parent.join("savegame1");
        make_save(&save);
        let root = parent.join("backups");

        let mut created = Vec::new();
        for _ in 0..7 {
            let result = create_backup(&save, Some(&root)).unwrap();
            created.push(PathBuf::from(result.backup_path));
        }

        let remaining = backup_dirs(&root);
        assert_eq!(remaining.len(), 5, "remaining: {remaining:?}");
        for oldest in &created[..2] {
            assert!(!oldest.exists(), "oldest backup not pruned: {oldest:?}");
        }
        for newest in &created[2..] {
            assert!(newest.exists(), "newest backup wrongly pruned: {newest:?}");
        }

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn failed_backup_returns_err_and_leaves_original_untouched() {
        let parent = fixture("failed");
        let save = parent.join("savegame1");
        make_save(&save);
        let before = snapshot(&save);

        // A file (not a directory) as the backup root makes create_dir_all fail.
        let bad_root = parent.join("not-a-dir");
        std::fs::write(&bad_root, b"x").unwrap();

        assert!(matches!(
            create_backup(&save, Some(&bad_root)),
            Err(Fs25Error::Inaccessible { .. })
        ));
        assert_eq!(before, snapshot(&save), "original save was modified");

        // Missing source is a structured error too.
        assert!(matches!(
            create_backup(&parent.join("gone"), Some(&parent.join("backups"))),
            Err(Fs25Error::Inaccessible { .. })
        ));
        assert_eq!(before, snapshot(&save));

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn changing_backup_dir_does_not_move_existing() {
        let parent = fixture("changedir");
        let save = parent.join("savegame1");
        make_save(&save);
        let root_a = parent.join("backups-a");
        let root_b = parent.join("backups-b");

        let first = PathBuf::from(create_backup(&save, Some(&root_a)).unwrap().backup_path);
        let second = PathBuf::from(create_backup(&save, Some(&root_b)).unwrap().backup_path);

        assert!(first.exists(), "backup under A was moved/removed");
        assert!(second.exists());
        assert!(first.starts_with(&root_a));
        assert!(second.starts_with(&root_b));
        assert_eq!(backup_dirs(&root_a).len(), 1);
        assert_eq!(backup_dirs(&root_b).len(), 1);

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn prune_ignores_foreign_directories() {
        let parent = fixture("foreign");
        let save = parent.join("savegame1");
        make_save(&save);
        let root = parent.join("backups");
        std::fs::create_dir_all(root.join("important-user-folder")).unwrap();

        for _ in 0..7 {
            create_backup(&save, Some(&root)).unwrap();
        }

        assert!(root.join("important-user-folder").is_dir());
        assert_eq!(backup_dirs(&root).len(), 6); // 5 backups + the foreign folder

        let _ = std::fs::remove_dir_all(&parent);
    }
}
