//! Windows FS25 user-data roots (Documents / My Games).

use std::path::PathBuf;

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
