//! Desktop identity primitives: installation id, display name, and session
//! token storage.
//!
//! # Installation id
//!
//! A random UUID v4, generated on first need and persisted to
//! `<app-data>/identity.json` (`dirs::data_dir()` + the bundle identifier, the
//! same app data directory [`crate::fs25`] uses). Subsequent reads return the
//! same value. It is intentionally **not** derived from MAC addresses, CPU ids,
//! or any other hardware fingerprint — see the Identity & Auth spec.
//!
//! # Display name
//!
//! Captured on the first cloud action and editable in Settings; stored next to
//! the installation id in the same plaintext-free-of-secrets `identity.json`.
//! [`IdentityStore::get_or_create`] and [`IdentityStore::set_display_name`]
//! back the `get_identity` / `set_display_name` commands.
//!
//! # Session token
//!
//! Never written to `identity.json`. It lives in OS secure storage behind the
//! [`SecretStore`] trait: [`KeyringSecretStore`] is the production,
//! keyring-backed implementation, and tests use an in-memory double. The API
//! client (ticket 40) fetches the token with `get_session_token` and attaches
//! it as `Authorization: Bearer <token>` on protected calls. The server stores
//! only the token's hash; the client only ever holds the opaque token.
//!
//! # Why a trait
//!
//! CI/headless Linux has no D-Bus secret service, so the real keyring cannot be
//! exercised at test time. Commands use the keyring path in production; the
//! trait lets tests run anywhere without silently downgrading to plaintext.
//!
//! # Fallback store
//!
//! Some desktop Linux sessions (e.g. KDE without the Secret Service provider
//! enabled) have no `org.freedesktop.secrets`, which makes every keyring call
//! fail. To keep the app usable there, [`default_secret_store`] probes the OS
//! keyring once and falls back to [`FileSecretStore`] — a `0600` file next to
//! `identity.json` — when it is unavailable. This is a deliberate, documented
//! downgrade from "OS secure storage".

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Keyring service name (matches the app's bundle identifier).
pub const KEYRING_SERVICE: &str = "com.farmcrosssync.desktop";
/// Keyring account name under which the session token is stored.
pub const KEYRING_ACCOUNT: &str = "session-token";

/// Local identity as surfaced to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    /// Random UUID v4 generated on first need; never hardware-derived.
    pub installation_id: String,
    /// Player-chosen display name, once first cloud action captured it.
    pub display_name: Option<String>,
    /// Directory backups are written to, edited in Settings. Omitted from the
    /// file until the user picks one, so older identity files stay compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_location: Option<String>,
    /// Root folder containing the `savegameN` folders, edited in Settings.
    /// Omitted from the file until the user picks one, so older identity files
    /// stay compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fs25_root: Option<String>,
}

/// Structured, serializable error shared by the identity commands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdentityError {
    /// The identity file cannot be read or written.
    Inaccessible { path: String, message: String },
    /// OS secure storage failed or is unavailable.
    SecureStore { message: String },
    /// A supplied value (e.g. an empty display name) is invalid.
    Invalid { message: String },
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdentityError::Inaccessible { path, message } => {
                write!(f, "inaccessible: {path} ({message})")
            }
            IdentityError::SecureStore { message } => write!(f, "secure store: {message}"),
            IdentityError::Invalid { message } => write!(f, "invalid: {message}"),
        }
    }
}

impl std::error::Error for IdentityError {}

/// Owns the on-disk location of the local identity store.
#[derive(Debug, Clone)]
pub struct IdentityStore {
    base_dir: PathBuf,
}

impl IdentityStore {
    /// Store backed by the default app data directory.
    pub fn default_store() -> Self {
        Self::with_base_dir(default_base_dir())
    }

    /// Store backed by an explicit base directory (used by tests).
    pub fn with_base_dir(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    /// Read the stored identity, or `None` when nothing is stored yet.
    pub fn read(&self) -> Result<Option<Identity>, IdentityError> {
        let path = self.path();
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path).map_err(|err| IdentityError::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let identity: Identity =
            serde_json::from_str(&raw).map_err(|err| IdentityError::Invalid {
                message: format!("invalid identity file at {}: {err}", path.display()),
            })?;
        Ok(Some(identity))
    }

    /// Return the stored identity, generating and persisting a random UUID v4
    /// installation id on first need.
    pub fn get_or_create(&self) -> Result<Identity, IdentityError> {
        if let Some(existing) = self.read()? {
            return Ok(existing);
        }
        let identity = Identity {
            installation_id: uuid::Uuid::new_v4().to_string(),
            display_name: None,
            backup_location: None,
            fs25_root: None,
        };
        self.write(&identity)?;
        Ok(identity)
    }

    /// Persist a display name, creating the identity (and installation id) if
    /// none exists yet. Returns the stored identity.
    pub fn set_display_name(&self, name: &str) -> Result<Identity, IdentityError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(IdentityError::Invalid {
                message: "display name must not be empty".into(),
            });
        }
        if name.chars().count() > 64 {
            return Err(IdentityError::Invalid {
                message: "display name must be 64 characters or fewer".into(),
            });
        }
        let mut identity = self.get_or_create()?;
        identity.display_name = Some(name.to_string());
        self.write(&identity)?;
        Ok(identity)
    }

    /// Persist the backup directory, creating the identity if none exists yet.
    pub fn set_backup_location(&self, location: &str) -> Result<Identity, IdentityError> {
        let location = location.trim();
        if location.is_empty() {
            return Err(IdentityError::Invalid {
                message: "backup location must not be empty".into(),
            });
        }
        let mut identity = self.get_or_create()?;
        identity.backup_location = Some(location.to_string());
        self.write(&identity)?;
        Ok(identity)
    }

    /// Return the stored backup directory, or `None` when unset.
    pub fn get_backup_location(&self) -> Result<Option<String>, IdentityError> {
        Ok(self.get_or_create()?.backup_location)
    }

    /// Persist the FS25 root folder, creating the identity if none exists yet.
    pub fn set_fs25_root(&self, path: &str) -> Result<Identity, IdentityError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(IdentityError::Invalid {
                message: "FS25 root must not be empty".into(),
            });
        }
        let mut identity = self.get_or_create()?;
        identity.fs25_root = Some(path.to_string());
        self.write(&identity)?;
        Ok(identity)
    }

    /// Return the stored FS25 root folder, or `None` when unset.
    pub fn get_fs25_root(&self) -> Result<Option<String>, IdentityError> {
        Ok(self.get_or_create()?.fs25_root)
    }

    fn path(&self) -> PathBuf {
        self.base_dir.join("identity.json")
    }

    fn write(&self, identity: &Identity) -> Result<(), IdentityError> {
        std::fs::create_dir_all(&self.base_dir).map_err(|err| IdentityError::Inaccessible {
            path: self.base_dir.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        let json = serde_json::to_string_pretty(identity).map_err(|err| IdentityError::Invalid {
            message: format!("failed to serialize identity: {err}"),
        })?;
        let path = self.path();
        // ponytail: temp file + rename, same pattern as sync_state.rs, so a
        // crash mid-write can never truncate an existing identity file.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|err| IdentityError::Inaccessible {
            path: tmp.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        std::fs::rename(&tmp, &path).map_err(|err| IdentityError::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        Ok(())
    }
}

/// Default base dir: app data dir + bundle id, matching backup.rs/sync_state.rs.
fn default_base_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(KEYRING_SERVICE)
}

/// Injectable storage for the session token.
pub trait SecretStore: Send + Sync {
    /// Store (or replace) the session token.
    fn set(&self, token: &str) -> Result<(), IdentityError>;
    /// Return the stored token, or `None` when none is present.
    fn get(&self) -> Result<Option<String>, IdentityError>;
    /// Remove the stored token; a missing token is not an error.
    fn clear(&self) -> Result<(), IdentityError>;
}

/// Production [`SecretStore`] backed by the OS keyring.
pub struct KeyringSecretStore {
    service: String,
    account: String,
}

impl KeyringSecretStore {
    /// Store using an explicit keyring service/account.
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    /// Store using the app's default service and session-token account.
    pub fn desktop_default() -> Self {
        Self::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
    }

    fn entry(&self) -> Result<keyring::Entry, IdentityError> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|err| secure_store_error(&err))
    }
}

impl SecretStore for KeyringSecretStore {
    fn set(&self, token: &str) -> Result<(), IdentityError> {
        self.entry()?
            .set_password(token)
            .map_err(|err| secure_store_error(&err))
    }

    fn get(&self) -> Result<Option<String>, IdentityError> {
        match self.entry()?.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(secure_store_error(&err)),
        }
    }

    fn clear(&self) -> Result<(), IdentityError> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(secure_store_error(&err)),
        }
    }
}

fn secure_store_error(err: &keyring::Error) -> IdentityError {
    IdentityError::SecureStore {
        message: err.to_string(),
    }
}

/// Fallback [`SecretStore`] for desktops without an OS secret service: the token
/// is written to a `0600` file next to `identity.json`. Only used when the OS
/// keyring cannot be initialised; see the module docs.
pub struct FileSecretStore {
    path: PathBuf,
}

impl FileSecretStore {
    /// Store backed by the default app data directory.
    pub fn default_store() -> Self {
        Self {
            path: default_base_dir().join(KEYRING_ACCOUNT),
        }
    }

    /// Store backed by an explicit file path (used by tests).
    pub fn with_path(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }
}

impl SecretStore for FileSecretStore {
    fn set(&self, token: &str) -> Result<(), IdentityError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| IdentityError::Inaccessible {
                path: parent.to_string_lossy().into_owned(),
                message: err.to_string(),
            })?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, token).map_err(|err| IdentityError::Inaccessible {
            path: tmp.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        restrict_to_owner(&tmp)?;
        std::fs::rename(&tmp, &self.path).map_err(|err| IdentityError::Inaccessible {
            path: self.path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
        Ok(())
    }

    fn get(&self) -> Result<Option<String>, IdentityError> {
        match std::fs::read_to_string(&self.path) {
            Ok(token) => Ok(Some(token)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(IdentityError::Inaccessible {
                path: self.path.to_string_lossy().into_owned(),
                message: err.to_string(),
            }),
        }
    }

    fn clear(&self) -> Result<(), IdentityError> {
        match std::fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(IdentityError::Inaccessible {
                path: self.path.to_string_lossy().into_owned(),
                message: err.to_string(),
            }),
        }
    }
}

/// Best-effort `0600` on Unix; a no-op elsewhere (the file still lives under the
/// user's app data directory).
fn restrict_to_owner(path: &std::path::Path) -> Result<(), IdentityError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms).map_err(|err| IdentityError::Inaccessible {
            path: path.to_string_lossy().into_owned(),
            message: err.to_string(),
        })?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// The session-token store to use: the OS keyring when it can be initialised,
/// otherwise the `0600` file fallback. The probe is cached by the keyring crate,
/// so this is cheap to call per command.
pub fn default_secret_store() -> Box<dyn SecretStore> {
    if keyring::Entry::store_status().is_ok() {
        Box::new(KeyringSecretStore::desktop_default())
    } else {
        Box::new(FileSecretStore::default_store())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Return the local identity, generating a random installation id on first need.
#[tauri::command]
pub fn get_identity() -> Result<Identity, IdentityError> {
    IdentityStore::default_store().get_or_create()
}

/// Persist (or change) the player's display name.
#[tauri::command]
pub fn set_display_name(name: String) -> Result<Identity, IdentityError> {
    IdentityStore::default_store().set_display_name(&name)
}

/// Return the stored backup directory, or `None` when unset.
#[tauri::command]
pub fn get_backup_location() -> Result<Option<String>, IdentityError> {
    IdentityStore::default_store().get_backup_location()
}

/// Persist (or change) the directory backups are written to.
#[tauri::command]
pub fn set_backup_location(path: String) -> Result<Identity, IdentityError> {
    IdentityStore::default_store().set_backup_location(&path)
}

/// Return the stored FS25 root folder, or `None` when unset.
#[tauri::command]
pub fn get_fs25_root() -> Result<Option<String>, IdentityError> {
    IdentityStore::default_store().get_fs25_root()
}

/// Persist (or change) the FS25 root folder.
#[tauri::command]
pub fn set_fs25_root(path: String) -> Result<Identity, IdentityError> {
    IdentityStore::default_store().set_fs25_root(&path)
}

/// Store the session token in OS secure storage (or the documented file
/// fallback when no secret service is available).
#[tauri::command]
pub fn store_session_token(token: String) -> Result<(), IdentityError> {
    default_secret_store().set(&token)
}

/// Return the stored session token, or `None` when the user is not signed in.
#[tauri::command]
pub fn get_session_token() -> Result<Option<String>, IdentityError> {
    default_secret_store().get()
}

/// Remove the stored session token (sign out).
#[tauri::command]
pub fn clear_session_token() -> Result<(), IdentityError> {
    default_secret_store().clear()
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// In-memory [`SecretStore`] for tests; the real keyring needs a secret
    /// service that headless CI does not have.
    #[derive(Default)]
    pub struct InMemorySecretStore {
        token: Mutex<Option<String>>,
    }

    impl InMemorySecretStore {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl SecretStore for InMemorySecretStore {
        fn set(&self, token: &str) -> Result<(), IdentityError> {
            *self.token.lock().unwrap() = Some(token.to_string());
            Ok(())
        }
        fn get(&self) -> Result<Option<String>, IdentityError> {
            Ok(self.token.lock().unwrap().clone())
        }
        fn clear(&self) -> Result<(), IdentityError> {
            *self.token.lock().unwrap() = None;
            Ok(())
        }
    }

    fn fixture(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "fs25-identity-{name}-{}-{nanos}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn installation_id_is_generated_once_and_is_a_v4_uuid() {
        let dir = fixture("generate");
        let store = IdentityStore::with_base_dir(&dir);

        let first = store.get_or_create().unwrap();
        let second = store.get_or_create().unwrap();

        assert_eq!(first.installation_id, second.installation_id);
        assert_eq!(first.display_name, None);

        let parsed = uuid::Uuid::parse_str(&first.installation_id).unwrap();
        assert_eq!(parsed.get_version_num(), 4, "installation id must be UUID v4");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn installation_id_survives_a_fresh_store_instance() {
        let dir = fixture("persist");
        let generated = IdentityStore::with_base_dir(&dir).get_or_create().unwrap();

        // A brand-new store over the same base dir reads the JSON from disk
        // (simulated app restart) and reuses the same installation id.
        let reopened = IdentityStore::with_base_dir(&dir).get_or_create().unwrap();
        assert_eq!(reopened.installation_id, generated.installation_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identity_file_uses_no_hardware_identifiers() {
        let dir = fixture("no-hardware");
        IdentityStore::with_base_dir(&dir).get_or_create().unwrap();

        let raw = std::fs::read_to_string(dir.join("identity.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let object = value.as_object().unwrap();

        // Only the two documented fields may be persisted.
        let mut keys: Vec<&String> = object.keys().collect();
        keys.sort();
        assert_eq!(keys, ["displayName", "installationId"]);

        // The only identifier is a random v4 UUID; no hardware-derived names.
        let lower = raw.to_lowercase();
        for banned in ["mac", "hardware", "cpu", "serial", "machine"] {
            assert!(!lower.contains(banned), "identity.json must not contain {banned:?}");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn display_name_set_and_get_round_trips() {
        let dir = fixture("display-name");
        let store = IdentityStore::with_base_dir(&dir);

        let created = store.set_display_name("  Ada  ").unwrap();
        assert_eq!(created.display_name.as_deref(), Some("Ada"));

        let read = store.get_or_create().unwrap();
        assert_eq!(read.display_name.as_deref(), Some("Ada"));
        assert_eq!(read.installation_id, created.installation_id);

        // Changing the name keeps the installation id.
        let changed = store.set_display_name("Grace").unwrap();
        assert_eq!(changed.display_name.as_deref(), Some("Grace"));
        assert_eq!(changed.installation_id, created.installation_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_display_name_is_rejected() {
        let dir = fixture("empty-name");
        let store = IdentityStore::with_base_dir(&dir);
        assert!(matches!(
            store.set_display_name("   "),
            Err(IdentityError::Invalid { .. })
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_location_set_and_get_round_trips() {
        let dir = fixture("backup-location");
        let store = IdentityStore::with_base_dir(&dir);

        assert_eq!(store.get_backup_location().unwrap(), None);

        let created = store.set_backup_location("  /home/ada/backups  ").unwrap();
        assert_eq!(created.backup_location.as_deref(), Some("/home/ada/backups"));

        let read = store.get_backup_location().unwrap();
        assert_eq!(read.as_deref(), Some("/home/ada/backups"));
        // Changing it keeps the installation id.
        let changed = store.set_backup_location("/mnt/backups").unwrap();
        assert_eq!(changed.backup_location.as_deref(), Some("/mnt/backups"));
        assert_eq!(changed.installation_id, created.installation_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_backup_location_is_rejected() {
        let dir = fixture("empty-backup");
        let store = IdentityStore::with_base_dir(&dir);
        assert!(matches!(
            store.set_backup_location("   "),
            Err(IdentityError::Invalid { .. })
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unset_backup_location_is_omitted_from_the_identity_file() {
        let dir = fixture("omit-backup");
        IdentityStore::with_base_dir(&dir).get_or_create().unwrap();
        let raw = std::fs::read_to_string(dir.join("identity.json")).unwrap();
        assert!(!raw.contains("backupLocation"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fs25_root_set_and_get_round_trips() {
        let dir = fixture("fs25-root");
        let store = IdentityStore::with_base_dir(&dir);

        assert_eq!(store.get_fs25_root().unwrap(), None);

        let created = store.set_fs25_root("  /home/ada/fs25  ").unwrap();
        assert_eq!(created.fs25_root.as_deref(), Some("/home/ada/fs25"));

        let read = store.get_fs25_root().unwrap();
        assert_eq!(read.as_deref(), Some("/home/ada/fs25"));
        // Changing it keeps the installation id.
        let changed = store.set_fs25_root("/mnt/fs25").unwrap();
        assert_eq!(changed.fs25_root.as_deref(), Some("/mnt/fs25"));
        assert_eq!(changed.installation_id, created.installation_id);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_fs25_root_is_rejected() {
        let dir = fixture("empty-fs25-root");
        let store = IdentityStore::with_base_dir(&dir);
        assert!(matches!(
            store.set_fs25_root("   "),
            Err(IdentityError::Invalid { .. })
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn identity_file_without_fs25_root_still_loads() {
        let dir = fixture("legacy-fs25-root");
        let legacy = r#"{"installationId":"00000000-0000-4000-8000-000000000000"}"#;
        std::fs::write(dir.join("identity.json"), legacy).unwrap();

        let store = IdentityStore::with_base_dir(&dir);
        assert_eq!(store.get_fs25_root().unwrap(), None);
        assert_eq!(
            store.get_or_create().unwrap().installation_id,
            "00000000-0000-4000-8000-000000000000"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unset_fs25_root_is_omitted_from_the_identity_file() {
        let dir = fixture("omit-fs25-root");
        IdentityStore::with_base_dir(&dir).get_or_create().unwrap();
        let raw = std::fs::read_to_string(dir.join("identity.json")).unwrap();
        assert!(!raw.contains("fs25Root"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_token_round_trips_through_secret_store() {
        let store = InMemorySecretStore::new();
        assert_eq!(store.get().unwrap(), None);

        store.set("opaque-token-123").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("opaque-token-123"));

        store.clear().unwrap();
        assert_eq!(store.get().unwrap(), None);
        // Clearing a missing token is not an error.
        store.clear().unwrap();
    }

    #[test]
    fn session_token_is_not_written_to_the_identity_file() {
        let dir = fixture("token-isolation");
        let identity_store = IdentityStore::with_base_dir(&dir);
        let secret_store = InMemorySecretStore::new();

        identity_store.get_or_create().unwrap();
        secret_store.set("super-secret-token").unwrap();

        let raw = std::fs::read_to_string(dir.join("identity.json")).unwrap();
        assert!(!raw.contains("super-secret-token"));
        assert!(!raw.contains("token"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_secret_store_round_trips_and_clears() {
        let dir = fixture("file-secret");
        let store = FileSecretStore::with_path(dir.join("session-token"));
        assert_eq!(store.get().unwrap(), None);

        store.set("opaque-token-123").unwrap();
        assert_eq!(store.get().unwrap().as_deref(), Some("opaque-token-123"));

        store.clear().unwrap();
        assert_eq!(store.get().unwrap(), None);
        // Clearing a missing token is not an error.
        store.clear().unwrap();

        let _ = std::fs::remove_dir_all(&dir);
    }
}
