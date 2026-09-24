//! Pack a save folder into a single zip archive, read-only, with progress.
//!
//! Files are added in the same stable relative-path order used by
//! [`crate::fs25::hash`], so the archive contents are deterministic for an
//! unchanged folder. The source folder is only ever read: the archive is a
//! brand-new uniquely named file under `out_dir` (or the system temp dir) and is
//! removed by [`cleanup_pack`] once the caller is done with it.
//!
//! Progress is reported through a callback so the logic stays testable; the
//! Tauri command layer turns those calls into events. `0` is reported before the
//! first file, `100` after the archive is complete, and intermediate values are
//! proportional to bytes written (monotonic non-decreasing).

use std::fs::{File, OpenOptions};
use std::io::{self, BufReader, Write};
use std::path::{Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::fs25::contract::{Fs25Error, PackResult, UnpackResult};
use crate::fs25::hash;

/// Prefix for the uniquely named temporary archives this module creates.
const TEMP_PREFIX: &str = "fs25-pack-";

/// Prefix for the uniquely named temporary extraction directories.
const UNPACK_PREFIX: &str = "fs25-unpack-";

/// Prefix for downloaded archives staged to disk before extraction.
const DOWNLOAD_PREFIX: &str = "fs25-download-";

/// Pack `save_dir` into a temporary zip, returning the archive path and stats.
///
/// `out_dir` is where the archive is written; when `None` the system temp dir is
/// used and created if missing. `on_progress` receives 0, proportional
/// intermediate values, and 100. A failure removes the partial archive and
/// returns the structured error; the source folder is never modified.
pub fn pack_save(
    save_dir: &Path,
    out_dir: Option<&Path>,
    mut on_progress: impl FnMut(u8),
) -> Result<PackResult, Fs25Error> {
    let files = hash::stable_files(save_dir)?;
    if files.is_empty() {
        return Err(Fs25Error::Internal {
            message: format!("no files to pack in {}", save_dir.display()),
        });
    }

    let mut total_bytes: u64 = 0;
    for (_, abs) in &files {
        total_bytes += std::fs::metadata(abs)
            .map_err(|err| Fs25Error::Inaccessible {
                path: abs.to_string_lossy().into_owned(),
                message: err.to_string(),
            })?
            .len();
    }

    let out = out_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    std::fs::create_dir_all(&out).map_err(|err| Fs25Error::Inaccessible {
        path: out.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    let archive = out.join(format!("{TEMP_PREFIX}{}.zip", uuid::Uuid::new_v4()));

    if let Err(err) = write_zip(&archive, &files, total_bytes, &mut on_progress) {
        let _ = std::fs::remove_file(&archive);
        return Err(err);
    }

    let size_bytes = std::fs::metadata(&archive)
        .map_err(|err| Fs25Error::Inaccessible {
            path: archive.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?
        .len();

    Ok(PackResult {
        archive_path: archive.to_string_lossy().into_owned(),
        size_bytes,
        file_count: files.len() as u32,
    })
}

/// Remove an archive produced by [`pack_save`]. A missing file is success, so
/// repeated cleanup is safe.
pub fn cleanup_pack(archive_path: &Path) -> Result<(), Fs25Error> {
    match std::fs::remove_file(archive_path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(Fs25Error::Internal {
            message: format!("failed to remove {}: {err}", archive_path.display()),
        }),
    }
}

/// A fresh, uniquely named temporary directory for extraction, under the system
/// temp dir. The caller owns it and must remove it with [`cleanup_unpack`].
pub fn new_unpack_dir() -> PathBuf {
    std::env::temp_dir().join(format!("{UNPACK_PREFIX}{}", uuid::Uuid::new_v4()))
}

/// Create a fresh, empty temp file for streamed download writes and return its
/// path. Chunks fetched from storage are appended one at a time with
/// [`append_download_chunk`], so the full archive never exists in memory; the
/// caller owns the file and must remove it with [`cleanup_pack`].
pub fn new_download_archive() -> Result<String, Fs25Error> {
    let dir = std::env::temp_dir();
    std::fs::create_dir_all(&dir).map_err(|err| Fs25Error::Inaccessible {
        path: dir.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    let archive = dir.join(format!("{DOWNLOAD_PREFIX}{}.zip", uuid::Uuid::new_v4()));
    File::create(&archive).map_err(|err| Fs25Error::Inaccessible {
        path: archive.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    Ok(archive.to_string_lossy().into_owned())
}

/// Append one fetched chunk to a staged download archive and return the total
/// bytes staged so far. The caller owns the file and must remove it with
/// [`cleanup_pack`] (or [`cleanup_pack`] on the partial file after a failure).
///
/// Only files created by [`new_download_archive`] are accepted: the frontend
/// has no filesystem plugin, and this guard keeps it that way — no other path
/// can be written through the streaming append.
pub fn append_download_chunk(archive: &Path, chunk: &[u8]) -> Result<u64, Fs25Error> {
    if !is_staged_download(archive) {
        return Err(Fs25Error::Internal {
            message: format!("not a staged download archive: {}", archive.display()),
        });
    }
    let mut file = OpenOptions::new().append(true).open(archive).map_err(|err| {
        Fs25Error::Inaccessible {
            path: archive.to_string_lossy().into_owned(),
            message: err.to_string(),
        }
    })?;
    file.write_all(chunk).map_err(|err| Fs25Error::Inaccessible {
        path: archive.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    file.metadata()
        .map(|meta| meta.len())
        .map_err(|err| Fs25Error::Inaccessible {
            path: archive.to_string_lossy().into_owned(),
            message: err.to_string(),
        })
}

/// True only for staged downloads this module created: a `{DOWNLOAD_PREFIX}`
/// file directly under the system temp dir.
fn is_staged_download(archive: &Path) -> bool {
    let Some(name) = archive.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name.starts_with(DOWNLOAD_PREFIX) && archive.parent() == Some(std::env::temp_dir().as_path())
}

/// True for the temporary archives this module owns: packed (`fs25-pack-*`) or
/// staged download (`fs25-download-*`) files. Transfers only accept these
/// (ticket 85), so no other local file can reach storage.
pub fn is_managed_archive(archive: &Path) -> bool {
    let Some(name) = archive.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name.starts_with(TEMP_PREFIX) || name.starts_with(DOWNLOAD_PREFIX)
}

/// Extract a zip archive created by [`pack_save`] into `dest_dir`.
///
/// `dest_dir` is created if missing and is expected to be a fresh staging
/// directory (see [`new_unpack_dir`]); it is only removed on failure when this
/// call created it. Entry paths are resolved with `enclosed_name`, so any entry
/// that would escape `dest_dir` (absolute or containing `..`) is rejected and
/// nothing is written outside the destination.
pub fn unpack_save(archive_path: &Path, dest_dir: &Path) -> Result<UnpackResult, Fs25Error> {
    let file = File::open(archive_path).map_err(|err| Fs25Error::Inaccessible {
        path: archive_path.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    let mut zip = ZipArchive::new(file).map_err(|err| Fs25Error::Internal {
        message: format!("invalid archive {}: {err}", archive_path.display()),
    })?;

    let created = !dest_dir.exists();
    std::fs::create_dir_all(dest_dir).map_err(|err| Fs25Error::Inaccessible {
        path: dest_dir.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;

    let mut file_count = 0u32;
    let result = extract_entries(&mut zip, dest_dir, &mut file_count);
    if result.is_err() && created {
        let _ = std::fs::remove_dir_all(dest_dir);
    }
    result?;

    Ok(UnpackResult {
        dest_path: dest_dir.to_string_lossy().into_owned(),
        file_count,
    })
}

/// Extract every safe regular file/directory entry, rejecting escapes.
fn extract_entries(
    zip: &mut ZipArchive<File>,
    dest_dir: &Path,
    file_count: &mut u32,
) -> Result<(), Fs25Error> {
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|err| Fs25Error::Internal {
            message: format!("failed to read archive entry {i}: {err}"),
        })?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(Fs25Error::Internal {
                message: format!("archive entry escapes destination: {}", entry.name()),
            });
        };
        let out = dest_dir.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|err| Fs25Error::Inaccessible {
                path: out.to_string_lossy().into_owned(),
                message: err.to_string(),
            })?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|err| Fs25Error::Inaccessible {
                path: parent.to_string_lossy().into_owned(),
                message: err.to_string(),
            })?;
        }
        let mut writer = File::create(&out).map_err(|err| Fs25Error::Inaccessible {
            path: out.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        io::copy(&mut entry, &mut writer).map_err(|err| Fs25Error::Inaccessible {
            path: out.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        *file_count += 1;
    }
    Ok(())
}

/// Remove a staging directory produced by [`unpack_save`]. A missing directory is
/// success, so repeated cleanup is safe.
pub fn cleanup_unpack(dest_dir: &Path) -> Result<(), Fs25Error> {
    match std::fs::remove_dir_all(dest_dir) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(Fs25Error::Internal {
            message: format!("failed to remove {}: {err}", dest_dir.display()),
        }),
    }
}

/// Stream every file into a fresh zip, reporting progress by bytes written.
fn write_zip(
    archive: &Path,
    files: &[(String, PathBuf)],
    total_bytes: u64,
    on_progress: &mut impl FnMut(u8),
) -> Result<(), Fs25Error> {
    let file = File::create(archive).map_err(|err| Fs25Error::Inaccessible {
        path: archive.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    on_progress(0);
    let mut processed: u64 = 0;
    for (rel, abs) in files {
        zip.start_file(rel.as_str(), options)
            .map_err(|err| Fs25Error::Internal {
                message: format!("failed to add {rel}: {err}"),
            })?;
        let src = File::open(abs).map_err(|err| Fs25Error::Inaccessible {
            path: abs.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let mut reader = BufReader::new(src);
        let written = io::copy(&mut reader, &mut zip).map_err(|err| Fs25Error::Inaccessible {
            path: abs.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        processed += written;
        on_progress(percent(processed, total_bytes));
    }
    zip.finish().map_err(|err| Fs25Error::Internal {
        message: format!("failed to finalize {}: {err}", archive.display()),
    })?;
    on_progress(100);
    Ok(())
}

/// Bytes processed as an integer percentage, capped at 100.
fn percent(processed: u64, total: u64) -> u8 {
    if total == 0 {
        return 100;
    }
    ((processed.saturating_mul(100)) / total).min(100) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use zip::ZipArchive;

    fn fixture(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fs25-pack-{name}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_save(dir: &Path) {
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
        std::fs::write(dir.join("sub").join("map.gdm"), vec![7u8; 4096]).unwrap();
    }

    fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut files = BTreeMap::new();
        for (rel, abs) in hash::stable_files(dir).unwrap() {
            files.insert(rel, std::fs::read(abs).unwrap());
        }
        files
    }

    fn extract(archive: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut zip = ZipArchive::new(File::open(archive).unwrap()).unwrap();
        let mut files = BTreeMap::new();
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).unwrap();
            if entry.is_file() && !entry.name().ends_with('/') {
                let mut bytes = Vec::new();
                io::copy(&mut entry, &mut bytes).unwrap();
                files.insert(entry.name().to_string(), bytes);
            }
        }
        files
    }

    #[test]
    fn pack_round_trips_source_without_mutating_it() {
        let parent = fixture("roundtrip");
        let save = parent.join("savegame1");
        let out = parent.join("out");
        make_save(&save);
        let before = snapshot(&save);

        let result = pack_save(&save, Some(&out), |_| {}).unwrap();
        let archive = PathBuf::from(&result.archive_path);

        assert!(archive.exists(), "archive missing");
        assert!(archive.starts_with(&out), "archive not under out_dir");
        assert_eq!(result.file_count, before.len() as u32);
        assert!(result.size_bytes > 0);
        assert_eq!(extract(&archive), before, "extract != source contents");
        assert_eq!(snapshot(&save), before, "source was modified");

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn progress_starts_at_zero_ends_at_hundred_and_is_monotonic() {
        let parent = fixture("progress");
        let save = parent.join("savegame1");
        make_save(&save);

        let mut progress: Vec<u8> = Vec::new();
        pack_save(&save, Some(&parent), |p| progress.push(p)).unwrap();

        assert_eq!(progress.first(), Some(&0), "progress must start at 0");
        assert_eq!(progress.last(), Some(&100), "progress must end at 100");
        assert!(
            progress.windows(2).all(|w| w[0] <= w[1]),
            "progress not monotonic: {progress:?}"
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn temp_archive_is_cleaned_up() {
        let parent = fixture("cleanup");
        let save = parent.join("savegame1");
        make_save(&save);

        let result = pack_save(&save, Some(&parent), |_| {}).unwrap();
        let archive = PathBuf::from(&result.archive_path);
        assert!(archive.exists(), "archive should exist before cleanup");

        cleanup_pack(&archive).unwrap();
        assert!(!archive.exists(), "archive not removed by cleanup");
        // Idempotent: cleaning up twice is fine.
        cleanup_pack(&archive).unwrap();

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn empty_folder_is_structured_error_and_leaves_no_archive() {
        let parent = fixture("empty");
        let save = parent.join("savegame1");
        std::fs::create_dir_all(&save).unwrap();
        let out = parent.join("out");

        assert!(matches!(
            pack_save(&save, Some(&out), |_| {}),
            Err(Fs25Error::Internal { .. })
        ));
        assert!(!out.exists() || std::fs::read_dir(&out).unwrap().next().is_none());

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn pack_then_unpack_round_trips_source() {
        let parent = fixture("unpack-roundtrip");
        let save = parent.join("savegame1");
        make_save(&save);
        let before = snapshot(&save);

        let result = pack_save(&save, Some(&parent), |_| {}).unwrap();
        let archive = PathBuf::from(&result.archive_path);

        let dest = parent.join("staged");
        let unpacked = unpack_save(&archive, &dest).unwrap();

        assert_eq!(unpacked.dest_path, dest.to_string_lossy());
        assert_eq!(unpacked.file_count, before.len() as u32);
        assert_eq!(snapshot(&dest), before, "unpacked content != source");
        assert_eq!(hash::hash_folder(&dest).unwrap(), hash::hash_folder(&save).unwrap());

        cleanup_unpack(&dest).unwrap();
        assert!(!dest.exists(), "staging dir not removed");
        cleanup_unpack(&dest).unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn unpack_rejects_entry_escaping_destination() {
        let parent = fixture("unpack-traversal");
        let archive = parent.join("evil.zip");
        {
            let file = File::create(&archive).unwrap();
            let mut zip = ZipWriter::new(file);
            zip.start_file("../escaped.txt", SimpleFileOptions::default())
                .unwrap();
            io::Write::write_all(&mut zip, b"pwned").unwrap();
            zip.finish().unwrap();
        }

        let dest = parent.join("staged");
        assert!(unpack_save(&archive, &dest).is_err(), "escape not rejected");
        assert!(
            !parent.join("escaped.txt").exists(),
            "entry escaped the destination"
        );

        let _ = std::fs::remove_dir_all(&parent);
    }

    // --- Streamed download staging (ticket 85) -----------------------------

    #[test]
    fn download_staging_appends_chunks_in_order_and_reports_totals() {
        let archive = PathBuf::from(new_download_archive().unwrap());
        assert!(archive.exists(), "staging file created");
        assert!(is_managed_archive(&archive));

        assert_eq!(append_download_chunk(&archive, b"abc").unwrap(), 3);
        assert_eq!(append_download_chunk(&archive, b"defgh").unwrap(), 8);
        assert_eq!(append_download_chunk(&archive, b"").unwrap(), 8);
        assert_eq!(std::fs::read(&archive).unwrap(), b"abcdefgh");

        cleanup_pack(&archive).unwrap();
        assert!(!archive.exists(), "staged archive removed");
        cleanup_pack(&archive).unwrap(); // idempotent
    }

    #[test]
    fn append_download_chunk_rejects_paths_outside_the_staging_convention() {
        // A plain file in the temp dir is not ours to write.
        let foreign = std::env::temp_dir().join(format!("not-ours-{}.txt", std::process::id()));
        std::fs::write(&foreign, b"x").unwrap();
        assert!(append_download_chunk(&foreign, b"data").is_err());
        assert_eq!(std::fs::read(&foreign).unwrap(), b"x", "foreign file untouched");
        let _ = std::fs::remove_file(&foreign);

        // A prefixed name outside the temp dir is equally out of bounds.
        let parent = fixture("staging-guard");
        let elsewhere = parent.join("fs25-download-evil.zip");
        std::fs::write(&elsewhere, b"").unwrap();
        assert!(append_download_chunk(&elsewhere, b"data").is_err());
        assert_eq!(std::fs::read(&elsewhere).unwrap(), b"", "foreign file untouched");

        // A missing staging file is a plain IO failure, not a write target.
        let missing = std::env::temp_dir().join("fs25-download-missing.zip");
        assert!(append_download_chunk(&missing, b"data").is_err());

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn managed_archive_guard_covers_packed_and_staged_names_only() {
        assert!(is_managed_archive(Path::new("/tmp/fs25-pack-1.zip")));
        assert!(is_managed_archive(Path::new("/tmp/fs25-download-1.zip")));
        assert!(!is_managed_archive(Path::new("/tmp/savegame1.zip")));
        assert!(!is_managed_archive(Path::new("/home/ada/.ssh/id_rsa")));
        assert!(!is_managed_archive(Path::new("/tmp/")));
    }
}
