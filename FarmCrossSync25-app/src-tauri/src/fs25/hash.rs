//! Content hash over a save folder's contents in stable path order.
//!
//! SHA-256 over every regular file's relative path and bytes, never over a zip
//! envelope. Entries are visited in ascending byte order of their normalized
//! (forward-slash) relative path, so the same unchanged folder always hashes to
//! the same digest regardless of filesystem enumeration order.
//!
//! Framing per file, fed into one streaming SHA-256 (all integers little-endian):
//!
//! ```text
//! u64 path_len | path bytes (UTF-8, '/' separated) | u64 file_len | file bytes
//! ```
//!
//! The lengths make the boundaries unambiguous: `a` + `bc` cannot collide with
//! `ab` + `c`. Including the path binds each file's bytes to its name/location.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::fs25::contract::{Fs25Error, HashResult};

/// Compute the [`HashResult`] for a save folder, read-only.
///
/// A missing, unreadable, or non-directory path is [`Fs25Error::Inaccessible`].
/// A readable folder containing no regular files (including one with only empty
/// subdirectories) is [`Fs25Error::Internal`]: there is no content to hash, and
/// silently hashing an empty stream would collide across distinct empty saves.
pub fn compute(path: &Path) -> Result<HashResult, Fs25Error> {
    let hash = hash_folder(path)?;
    Ok(HashResult {
        path: path.to_string_lossy().into_owned(),
        hash,
    })
}

/// Hash a folder's contents, returning the lowercase hex SHA-256 digest.
pub fn hash_folder(path: &Path) -> Result<String, Fs25Error> {
    let files = stable_files(path)?;
    if files.is_empty() {
        return Err(Fs25Error::Internal {
            message: format!("no files to hash in {}", path.display()),
        });
    }

    let mut hasher = Sha256::new();
    for (rel, abs) in &files {
        let file = File::open(abs).map_err(|err| Fs25Error::Inaccessible {
            path: abs.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let len = file
            .metadata()
            .map_err(|err| Fs25Error::Inaccessible {
                path: abs.to_string_lossy().into_owned(),
                message: err.to_string(),
            })?
            .len();

        hasher.update((rel.len() as u64).to_le_bytes());
        hasher.update(rel.as_bytes());
        hasher.update(len.to_le_bytes());
        let mut reader = io::BufReader::new(file);
        io::copy(&mut reader, &mut hasher).map_err(|err| Fs25Error::Inaccessible {
            path: abs.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
    }

    Ok(hex(&hasher.finalize()))
}

/// Read-only walk of `path` returning every regular file as
/// `(forward-slash relative path, absolute path)`, sorted by relative path in
/// ascending byte order. This is the shared stable ordering used by hashing and
/// packing, so enumeration order never matters. Symlinks are skipped.
pub(crate) fn stable_files(path: &Path) -> Result<Vec<(String, PathBuf)>, Fs25Error> {
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

    let mut files: Vec<(String, PathBuf)> = Vec::new();
    collect_files(path, path, &mut files)?;
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    Ok(files)
}

/// Recursively collect `(normalized relative path, absolute path)` for regular
/// files under `dir`. Symlinks are skipped so a self-referential link cannot
/// loop forever.
fn collect_files(
    base: &Path,
    dir: &Path,
    out: &mut Vec<(String, PathBuf)>,
) -> Result<(), Fs25Error> {
    let entries = std::fs::read_dir(dir).map_err(|err| Fs25Error::Inaccessible {
        path: dir.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    for entry in entries {
        let entry = entry.map_err(|err| Fs25Error::Inaccessible {
            path: dir.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let file_type = entry.file_type().map_err(|err| Fs25Error::Inaccessible {
            path: entry.path().to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let path = entry.path();
        if file_type.is_dir() {
            collect_files(base, &path, out)?;
        } else if file_type.is_file() {
            let rel = path.strip_prefix(base).unwrap_or(&path);
            out.push((normalize(rel), path));
        }
    }
    Ok(())
}

/// Normalize a relative path to forward-slash separators.
fn normalize(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Lowercase hex encoding of a digest.
fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fs25-hash-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn same_content_twice_is_equal() {
        let parent = fixture("stable");
        let a = parent.join("a");
        let b = parent.join("b");
        for dir in [&a, &b] {
            std::fs::create_dir_all(dir.join("sub")).unwrap();
            std::fs::write(dir.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
            std::fs::write(dir.join("sub").join("map.gdm"), vec![7u8; 1024]).unwrap();
        }
        assert_eq!(hash_folder(&a).unwrap(), hash_folder(&b).unwrap());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn same_folder_hashed_twice_is_stable() {
        let dir = fixture("rerun");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("careerSavegame.xml"), b"<careerSavegame/>").unwrap();
        std::fs::write(dir.join("sub").join("map.gdm"), vec![3u8; 128]).unwrap();

        let first = hash_folder(&dir).unwrap();
        let second = hash_folder(&dir).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_file_changed_changes_hash() {
        let parent = fixture("changed");
        std::fs::write(parent.join("a.txt"), b"hello").unwrap();
        let before = hash_folder(&parent).unwrap();
        std::fs::write(parent.join("a.txt"), b"hello!").unwrap();
        assert_ne!(before, hash_folder(&parent).unwrap());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn path_binds_to_content() {
        // Same bytes, different name: the path is part of the digest.
        let parent = fixture("pathbind");
        std::fs::write(parent.join("a.txt"), b"same").unwrap();
        let first = hash_folder(&parent).unwrap();
        std::fs::rename(parent.join("a.txt"), parent.join("b.txt")).unwrap();
        assert_ne!(first, hash_folder(&parent).unwrap());
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn empty_folder_is_structured_error() {
        let parent = fixture("empty");
        assert!(matches!(
            hash_folder(&parent),
            Err(Fs25Error::Internal { .. })
        ));
        // A folder with only empty subdirectories is also empty.
        std::fs::create_dir_all(parent.join("sub")).unwrap();
        assert!(matches!(
            hash_folder(&parent),
            Err(Fs25Error::Internal { .. })
        ));
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_folder_is_inaccessible_error() {
        let parent = fixture("missing");
        let gone = parent.join("nope");
        assert!(matches!(
            hash_folder(&gone),
            Err(Fs25Error::Inaccessible { .. })
        ));
        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn known_digest_pins_framing() {
        // Framing for a single file "a.txt" = "hello":
        //   05 00 00 00 00 00 00 00 | "a.txt" | 05 00 00 00 00 00 00 00 | "hello"
        let parent = fixture("known");
        std::fs::write(parent.join("a.txt"), b"hello").unwrap();
        assert_eq!(
            hash_folder(&parent).unwrap(),
            "7e879ad70cf914d609d68f4e68a2e3d4e363da41afdbb8f39f955da148481529"
        );
        let _ = std::fs::remove_dir_all(&parent);
    }
}
