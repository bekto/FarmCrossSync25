//! Transactional replacement of the bound local save folder.
//!
//! The download flow extracts the archive into a staged directory, then calls
//! [`replace`] with that directory. Replacement is ordered so the original save
//! is never destroyed unless the swap fully succeeds:
//!
//! 1. Hash the staged content and compare against `expected_hash` (when given).
//!    A mismatch aborts before the original is touched.
//! 2. Copy the staged content into a unique temporary sibling of the target
//!    (this is the spec's "extract to a temporary location" step; the archive
//!    itself is already unpacked by the caller). Re-hash the copy to guard
//!    against a corrupt copy.
//! 3. Create a timestamped backup of the original via
//!    [`crate::fs25::backup::create_backup`] *before* moving it aside.
//! 4. Rename the original aside, rename the new content into place, then delete
//!    the moved-aside original. If the swap fails, the original is renamed back
//!    so the folder is byte-for-byte intact.
//!
//! `staged_path` is therefore an already-extracted directory of the new save
//! content; this module never handles archive envelopes (see the pack/unpack
//! ticket). Temporary siblings are cleaned up on both success and failure.
//!
//! Sync-state persistence is *not* this module's concern: the caller/flow
//! records the new local hash after this command resolves. [`ReplaceResult`]
//! reports `replaced = true` only once the swap has completed, so a failed or
//! interrupted replace can never signal success.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::fs25::backup;
use crate::fs25::contract::{Fs25Error, ReplaceResult};
use crate::fs25::hash;

/// Perform a transactional replace of `target` with the content of `staged`.
///
/// `expected_hash` is checked against the staged content before anything is
/// touched; when `None`, the check is skipped but the hash is still computed
/// and returned. `backup_root` selects the backup directory (Settings); when
/// `None`, [`backup::create_backup`]'s default app-data location is used.
pub fn replace(
    target: &Path,
    staged: &Path,
    expected_hash: Option<&str>,
    backup_root: Option<&Path>,
) -> Result<ReplaceResult, Fs25Error> {
    ensure_dir(target)?;

    // 1. Verify staged content before touching the original.
    let staged_hash = hash::hash_folder(staged)?;
    if let Some(expected) = expected_hash {
        if !expected.eq_ignore_ascii_case(&staged_hash) {
            return Err(Fs25Error::Internal {
                message: format!("hash mismatch: expected {expected}, staged {staged_hash}"),
            });
        }
    }

    // 2. Build the new content in a temporary sibling of the target.
    let temp = unique_sibling(target, "new")?;
    let temp_guard = TempDir::arm(temp.clone());
    backup::copy_dir(staged, &temp)?;

    // Guard against a corrupt/partial copy before it can reach the target.
    let temp_hash = hash::hash_folder(&temp)?;
    if temp_hash != staged_hash {
        return Err(Fs25Error::Internal {
            message: format!("hash mismatch after staging copy: {staged_hash} != {temp_hash}"),
        });
    }

    // 3. Backup the original before it is moved aside.
    let backup_result = backup::create_backup(target, backup_root)?;

    // 4. Swap: original aside, new in, then drop the old content.
    let aside = unique_sibling(target, "old")?;
    swap_into_place(&temp, target, &aside)?;
    let _ = std::fs::remove_dir_all(&aside);
    drop(temp_guard);

    Ok(ReplaceResult {
        replaced: true,
        backup_path: Some(backup_result.backup_path),
        content_hash: temp_hash,
    })
}

/// Ensure `path` is an accessible directory, so a swap has something to replace.
fn ensure_dir(path: &Path) -> Result<(), Fs25Error> {
    let meta = std::fs::metadata(path).map_err(|err| Fs25Error::Inaccessible {
        path: path.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    if !meta.is_dir() {
        return Err(Fs25Error::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: "not a directory".into(),
        });
    }
    Ok(())
}

/// Rename-based swap with rollback: move the original aside, move the new
/// content in, and on any failure rename the original back so it is intact.
///
/// Directory renames cannot be atomic across the same path on all platforms,
/// so there is a brief window where the target name is absent.
/// ponytail: two-step rename swap; a power-loss mid-swap can leave the original
/// at the aside path (never deleted). Add journaled recovery if that matters.
fn swap_into_place(temp: &Path, target: &Path, aside: &Path) -> Result<(), Fs25Error> {
    std::fs::rename(target, aside).map_err(|err| Fs25Error::Internal {
        message: format!("could not move original aside: {err}"),
    })?;

    #[cfg(test)]
    if FAIL_SWAP.with(|flag| flag.replace(false)) {
        return rollback(aside, target, "simulated interruption after original moved aside");
    }

    match std::fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(err) => rollback(
            aside,
            target,
            &format!("could not swap new content into place: {err}"),
        ),
    }
}

/// Restore the moved-aside original. On success the original is back in place;
/// on failure the original is left at `aside` (recoverable) and named in the
/// error, never deleted.
fn rollback(aside: &Path, target: &Path, reason: &str) -> Result<(), Fs25Error> {
    match std::fs::rename(aside, target) {
        Ok(()) => Err(Fs25Error::Internal {
            message: reason.to_string(),
        }),
        Err(restore_err) => Err(Fs25Error::Internal {
            message: format!(
                "{reason}; failed to restore original from {}: {restore_err}",
                aside.display()
            ),
        }),
    }
}

/// A unique, hidden sibling path of `target` for temporary working content.
pub(crate) fn unique_sibling(target: &Path, tag: &str) -> Result<PathBuf, Fs25Error> {
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| Fs25Error::Internal {
            message: format!("target has no parent directory: {}", target.display()),
        })?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "savegame".into());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let mut candidate = parent.join(format!(".{name}.fs25-{tag}-{}-{stamp}", std::process::id()));
    let mut counter = 1u32;
    while candidate.exists() {
        candidate = parent.join(format!(
            ".{name}.fs25-{tag}-{}-{stamp}-{counter}",
            std::process::id()
        ));
        counter += 1;
    }
    Ok(candidate)
}

/// Removes its directory on drop, so a failed replace leaves no temp dirs.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn arm(path: PathBuf) -> Self {
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
thread_local! {
    /// Test failpoint: when set, the swap fails after the original is moved
    /// aside, exercising the rollback path. Thread-local so parallel tests do
    /// not interfere.
    static FAIL_SWAP: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fs25-replace-{name}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_save(dir: &Path, tag: &str) {
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(
            dir.join("careerSavegame.xml"),
            format!("<careerSavegame>{tag}</careerSavegame>"),
        )
        .unwrap();
        std::fs::write(dir.join("sub").join("map.gdm"), tag.as_bytes()).unwrap();
    }

    fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        for path in walk(dir) {
            let rel = path.strip_prefix(dir).unwrap().to_string_lossy().into_owned();
            files.push((rel, std::fs::read(&path).unwrap()));
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

    /// Any `.savegame1.fs25-*` working directories left next to the target.
    fn leftover_siblings(parent: &Path, target_name: &str) -> Vec<String> {
        let prefix = format!(".{target_name}.fs25-");
        std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with(&prefix))
            .collect()
    }

    #[test]
    fn replace_swaps_content_and_reports_new_hash_and_backup() {
        let parent = fixture("success");
        let target = parent.join("savegame1");
        let staged = parent.join("staged");
        make_save(&target, "old");
        make_save(&staged, "new");
        let expected = hash::hash_folder(&staged).unwrap();
        let backups = parent.join("backups");
        let before = snapshot(&target);

        let result = replace(&target, &staged, Some(&expected), Some(&backups)).unwrap();

        assert!(result.replaced);
        assert_eq!(result.content_hash, expected);
        assert_eq!(hash::hash_folder(&target).unwrap(), expected);
        assert_eq!(snapshot(&target), snapshot(&staged));
        assert_ne!(snapshot(&target), before, "content was not swapped");

        let backup = PathBuf::from(result.backup_path.expect("backup path"));
        assert!(backup.is_dir(), "backup missing");
        assert!(backup.starts_with(&backups), "backup under wrong root");
        assert_eq!(snapshot(&backup), before, "backup is not the old content");

        assert!(staged.is_dir(), "staged input should be left alone");
        assert!(
            leftover_siblings(&parent, "savegame1").is_empty(),
            "temp dirs left behind"
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn replace_without_expected_hash_still_computes_and_swaps() {
        let parent = fixture("nohash");
        let target = parent.join("savegame1");
        let staged = parent.join("staged");
        make_save(&target, "old");
        make_save(&staged, "new");
        let expected = hash::hash_folder(&staged).unwrap();
        let backups = parent.join("backups");

        let result = replace(&target, &staged, None, Some(&backups)).unwrap();

        assert!(result.replaced);
        assert_eq!(result.content_hash, expected);
        assert_eq!(snapshot(&target), snapshot(&staged));

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn hash_mismatch_aborts_and_leaves_original_untouched() {
        let parent = fixture("mismatch");
        let target = parent.join("savegame1");
        let staged = parent.join("staged");
        make_save(&target, "old");
        make_save(&staged, "new");
        let before = snapshot(&target);
        let backups = parent.join("backups");

        let result = replace(&target, &staged, Some("deadbeef"), Some(&backups));

        assert!(result.is_err(), "mismatch must not signal success");
        assert_eq!(before, snapshot(&target), "original was modified");
        assert!(!backups.exists(), "no backup should be created on mismatch");
        assert!(
            leftover_siblings(&parent, "savegame1").is_empty(),
            "temp dirs left behind"
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn interrupted_swap_rolls_back_and_leaves_original_untouched() {
        let parent = fixture("interrupted");
        let target = parent.join("savegame1");
        let staged = parent.join("staged");
        make_save(&target, "old");
        make_save(&staged, "new");
        let expected = hash::hash_folder(&staged).unwrap();
        let before = snapshot(&target);
        let backups = parent.join("backups");

        FAIL_SWAP.with(|flag| flag.set(true));
        let result = replace(&target, &staged, Some(&expected), Some(&backups));

        assert!(result.is_err(), "interrupted replace must not signal success");
        assert_eq!(before, snapshot(&target), "original was not restored");
        assert!(
            leftover_siblings(&parent, "savegame1").is_empty(),
            "temp dirs left behind"
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_paths_are_inaccessible_and_leave_original_untouched() {
        let parent = fixture("missing");
        let target = parent.join("savegame1");
        let staged = parent.join("staged");
        make_save(&target, "old");
        make_save(&staged, "new");
        let before = snapshot(&target);

        // Missing staged directory.
        let gone = parent.join("no-staged");
        assert!(matches!(
            replace(&target, &gone, None, Some(&parent.join("backups"))),
            Err(Fs25Error::Inaccessible { .. })
        ));

        // Missing target directory.
        let missing_target = parent.join("no-target");
        assert!(matches!(
            replace(&missing_target, &staged, None, Some(&parent.join("backups"))),
            Err(Fs25Error::Inaccessible { .. })
        ));

        assert_eq!(before, snapshot(&target), "original was modified");
        assert!(leftover_siblings(&parent, "savegame1").is_empty());

        let _ = std::fs::remove_dir_all(&parent);
    }
}
