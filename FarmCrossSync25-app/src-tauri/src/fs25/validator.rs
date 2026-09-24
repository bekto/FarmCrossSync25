//! Validates that a folder is an FS25 savegame.
//!
//! # Marker rules (single source of truth)
//!
//! Derived by inspecting a real FS25 savegame (`savegame1`, map "Zielonka"),
//! which contained 46 files including `careerSavegame.xml`, `farms.xml`,
//! `players.xml`, `environment.xml`, `vehicles.xml`, `economy.xml` and
//! `placeables.xml`, alongside `.gdm`/`.grle`/`.png`/`.cache` payloads.
//! No file name here is invented; every one exists in that save.
//!
//! - Core marker: `careerSavegame.xml`. A readable folder without it is not a
//!   savegame → [`ValidationState::Invalid`].
//! - Expected markers: `farms.xml`, `players.xml`, `environment.xml`. Every
//!   FS25 save carries these; when some are absent the folder still looks like
//!   a save but is incomplete → [`ValidationState::Suspicious`], listing the
//!   missing names.
//! - All markers present → [`ValidationState::Valid`].
//!
//! # State semantics
//!
//! - `Inaccessible`: the path is missing, not a directory, or cannot be read
//!   (permission denied / IO error). This is a state, not an error, so the
//!   command still resolves `Ok`.
//! - `Invalid`: a readable directory that lacks the core marker (clearly not
//!   an FS25 save).
//! - `Suspicious`: core marker present but some expected markers are missing.
//! - `Valid`: readable directory with the core marker and every expected one.
//!
//! # Map name and last-modified
//!
//! The map name is read from `careerSavegame.xml` (`<mapTitle>`, falling back
//! to `<mapId>`). Last-modified is the folder's filesystem mtime (RFC 3339,
//! UTC), matching discovery, rather than the save's internal `saveDate`.

use std::path::Path;

use crate::fs25::contract::{ValidationResult, ValidationState};

/// File whose presence separates a savegame from an unrelated folder.
pub const CORE_MARKERS: &[&str] = &["careerSavegame.xml"];

/// Files every FS25 save carries; missing ones make a save `Suspicious`.
pub const EXPECTED_MARKERS: &[&str] = &["farms.xml", "players.xml", "environment.xml"];

/// Validate `path` as an FS25 savegame folder, read-only.
pub fn validate(path: &Path) -> ValidationResult {
    let path_str = path.to_string_lossy().into_owned();

    let meta = match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => meta,
        Ok(_) => return state(ValidationState::Inaccessible, path_str, None, None, vec![], Some("not a directory".into())),
        Err(err) => {
            return state(ValidationState::Inaccessible, path_str, None, None, vec![], Some(err.to_string()))
        }
    };

    let entries: Vec<String> = match std::fs::read_dir(path) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect(),
        Err(err) => {
            return state(ValidationState::Inaccessible, path_str, None, None, vec![], Some(err.to_string()))
        }
    };

    let last_modified = meta
        .modified()
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

    let has = |name: &str| entries.iter().any(|n| n == name);

    if !CORE_MARKERS.iter().all(|m| has(m)) {
        return state(
            ValidationState::Invalid,
            path_str,
            None,
            last_modified,
            vec![],
            Some("missing careerSavegame.xml; not an FS25 savegame".into()),
        );
    }

    let map_name = read_map_name(path);

    let missing_files: Vec<String> = EXPECTED_MARKERS
        .iter()
        .filter(|m| !has(m))
        .map(|m| m.to_string())
        .collect();

    if missing_files.is_empty() {
        state(ValidationState::Valid, path_str, map_name, last_modified, vec![], None)
    } else {
        state(
            ValidationState::Suspicious,
            path_str,
            map_name,
            last_modified,
            missing_files,
            Some("some expected FS25 save files are missing".into()),
        )
    }
}

fn state(
    state: ValidationState,
    path: String,
    map_name: Option<String>,
    last_modified: Option<String>,
    missing_files: Vec<String>,
    message: Option<String>,
) -> ValidationResult {
    ValidationResult {
        state,
        path,
        map_name,
        last_modified,
        missing_files,
        message,
    }
}

/// Best-effort map name from `careerSavegame.xml` (`<mapTitle>`, then `<mapId>`).
pub(crate) fn read_map_name(dir: &Path) -> Option<String> {
    let xml = std::fs::read_to_string(dir.join("careerSavegame.xml")).ok()?;
    xml_tag(&xml, "mapTitle").or_else(|| xml_tag(&xml, "mapId"))
}

/// Extract the text of the first `<tag>...</tag>` pair, if non-empty.
fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let value = xml[start..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fs25-validate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_save(dir: &Path, markers: &[&str]) {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?><careerSavegame revision="2" valid="true"><settings><mapId>MapEU</mapId><mapTitle>Zielonka</mapTitle></settings></careerSavegame>"#;
        std::fs::write(dir.join("careerSavegame.xml"), xml).unwrap();
        for marker in markers {
            if *marker != "careerSavegame.xml" {
                std::fs::write(dir.join(marker), b"<xml/>").unwrap();
            }
        }
    }

    #[test]
    fn valid_save_reports_map_and_last_modified() {
        let dir = fixture("valid");
        write_save(&dir, EXPECTED_MARKERS);

        let result = validate(&dir);
        assert_eq!(result.state, ValidationState::Valid);
        assert_eq!(result.map_name.as_deref(), Some("Zielonka"));
        assert!(result.last_modified.is_some());
        assert!(result.missing_files.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_expected_files_is_suspicious() {
        let dir = fixture("suspicious");
        // Core marker present, but players.xml and environment.xml absent.
        write_save(&dir, &["farms.xml"]);

        let result = validate(&dir);
        assert_eq!(result.state, ValidationState::Suspicious);
        assert!(result.missing_files.contains(&"players.xml".to_string()));
        assert!(result.missing_files.contains(&"environment.xml".to_string()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unrelated_folder_is_invalid() {
        let dir = fixture("invalid");
        std::fs::write(dir.join("notes.txt"), b"not a savegame").unwrap();

        let result = validate(&dir);
        assert_eq!(result.state, ValidationState::Invalid);
        assert!(result.map_name.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_folder_is_inaccessible() {
        let dir = fixture("missing");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(validate(&dir).state, ValidationState::Inaccessible);
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_folder_is_inaccessible() {
        use std::os::unix::fs::PermissionsExt;

        let dir = fixture("chmod");
        write_save(&dir, EXPECTED_MARKERS);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = validate(&dir);
        // Running as root, chmod 000 is not enforced; skip rather than fail.
        if std::fs::read_dir(&dir).is_ok() {
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
            let _ = std::fs::remove_dir_all(&dir);
            return;
        }
        assert_eq!(result.state, ValidationState::Inaccessible);

        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
