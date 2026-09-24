//! Extracts lightweight save metadata (slot, map, last modified, path, size).
//!
//! Reads only the small `careerSavegame.xml` for the map name and uses
//! filesystem metadata for size and mtime; the bulk `.gdm`/`.grle`/`.png`/
//! `.cache` payloads are never opened. Missing or unparseable map metadata
//! yields a partial result (`map_name: None`) rather than an error.

use std::path::Path;

use crate::fs25::contract::{Fs25Error, SaveMetadata};
use crate::fs25::discovery::slot_of;
use crate::fs25::validator::read_map_name;

/// Extract lightweight metadata from a save folder, read-only.
///
/// The path itself must be an accessible directory; a missing/unreadable path
/// is a genuine [`Fs25Error::Inaccessible`] error. Missing optional metadata
/// inside the folder is not an error.
pub fn extract(path: &Path) -> Result<SaveMetadata, Fs25Error> {
    let folder = std::fs::metadata(path).map_err(|err| Fs25Error::Inaccessible {
        path: path.to_string_lossy().into_owned(),
        message: err.to_string(),
    })?;
    if !folder.is_dir() {
        return Err(Fs25Error::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: "not a directory".into(),
        });
    }

    let last_modified = folder
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

    Ok(SaveMetadata {
        slot: slot_of(path),
        map_name: read_map_name(path),
        path: path.to_string_lossy().into_owned(),
        last_modified,
        size_bytes: dir_size(path),
        // ponytail: hashing is its own ticket; empty until compute_hash lands.
        content_hash: String::new(),
    })
}

/// Total byte size of `dir`, walking file metadata only (never file contents).
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total += dir_size(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fs25-metadata-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn extracts_slot_map_size_and_mtime() {
        let parent = fixture("full");
        let save = parent.join("savegame1");
        std::fs::create_dir_all(&save).unwrap();
        let xml = r#"<?xml version="1.0" encoding="utf-8"?><careerSavegame><settings><mapId>MapEU</mapId><mapTitle>Zielonka</mapTitle></settings></careerSavegame>"#;
        std::fs::write(save.join("careerSavegame.xml"), xml).unwrap();
        // Invalid UTF-8 payload: reading it would fail, so success proves the
        // bulk file is only stat'd, never opened.
        std::fs::write(save.join("densityMap_fruits.gdm"), vec![0xFFu8; 4096]).unwrap();

        let meta = extract(&save).unwrap();
        assert_eq!(meta.slot, Some(1));
        assert_eq!(meta.map_name.as_deref(), Some("Zielonka"));
        assert!(meta.size_bytes >= 4096);
        assert!(meta.last_modified.is_some());
        assert_eq!(meta.path, save.to_string_lossy());

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_map_metadata_returns_partial_without_error() {
        let parent = fixture("partial");
        let save = parent.join("savegame7");
        std::fs::create_dir_all(&save).unwrap();
        std::fs::write(save.join("careerSavegame.xml"), b"<careerSavegame><settings/></careerSavegame>").unwrap();

        let meta = extract(&save).unwrap();
        assert_eq!(meta.slot, Some(7));
        assert!(meta.map_name.is_none());
        assert!(meta.last_modified.is_some());

        // Missing careerSavegame.xml entirely is also partial, not an error.
        let save2 = parent.join("savegame8");
        std::fs::create_dir_all(&save2).unwrap();
        std::fs::write(save2.join("notes.txt"), b"x").unwrap();
        assert!(extract(&save2).unwrap().map_name.is_none());

        let _ = std::fs::remove_dir_all(&parent);
    }

    #[test]
    fn missing_folder_is_inaccessible_error() {
        let parent = fixture("gone");
        let missing = parent.join("savegame9");
        assert!(matches!(extract(&missing), Err(Fs25Error::Inaccessible { .. })));
        let _ = std::fs::remove_dir_all(&parent);
    }
}
