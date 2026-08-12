//! Non-secret settings (JSON file in the app config dir) and API-key secrets
//! (OS keychain via `keyring`: macOS Keychain / Linux Secret Service, with a
//! 0600 file fallback for Linux setups without a secret service).

use std::fs;

use serde_json::Value;
use tauri::State;

use super::{err, CmdResult};
use crate::AppState;

const KEYRING_SERVICE: &str = "app.lattice.desktop";

fn settings_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("settings.json")
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> CmdResult<Option<Value>> {
    let path = settings_path(&state);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(err)?;
    serde_json::from_str(&raw).map(Some).map_err(err)
}

/// Shallow-merges into the existing file rather than overwriting it: the
/// frontend only ever sends its AppSettings shape, and a plain write would
/// strip Rust-owned keys like workspacePath.
#[tauri::command]
pub fn set_settings(state: State<AppState>, settings: Value) -> CmdResult<()> {
    merge_settings(&state, settings)
}

fn merge_settings(state: &AppState, settings: Value) -> CmdResult<()> {
    let path = settings_path(state);
    let mut map = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    if let Value::Object(incoming) = settings {
        for (k, v) in incoming {
            map.insert(k, v);
        }
    } else {
        return Err("settings must be an object".into());
    }
    let pretty = serde_json::to_string_pretty(&Value::Object(map)).map_err(err)?;
    fs::write(path, pretty).map_err(err)
}

// ── Secrets ──────────────────────────────────────────────────────────────────

fn fallback_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("secrets.json")
}

fn read_fallback(state: &AppState) -> serde_json::Map<String, Value> {
    fs::read_to_string(fallback_path(state))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn write_fallback(state: &AppState, map: &serde_json::Map<String, Value>) -> CmdResult<()> {
    let path = fallback_path(state);
    fs::write(&path, serde_json::to_string_pretty(&Value::Object(map.clone())).map_err(err)?)
        .map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// macOS authorizes keychain access **per entry**, and an unsigned dev build's
/// signature changes on every rebuild, so each entry is its own password prompt.
/// Storing every secret as one JSON object under a single entry therefore costs
/// one prompt for the whole app rather than one per key.
const KEYRING_ENTRY: &str = "secrets";

/// Secrets that used to have their own keychain entry, folded into the blob the
/// first time it loads. Reading these is the only time the app touches more than
/// one entry, and it happens once ever.
const LEGACY_ENTRIES: &[&str] = &["chat-api-key", "embedding-api-key", "mcp-token"];

type SecretMap = serde_json::Map<String, Value>;

/// Runs `f` against the secret store, loading it on first use.
///
/// The lock is held across the load on purpose: two callers arriving together
/// (a double-invoked effect, several ingest jobs) would otherwise both miss the
/// cache and both hit the keychain. The second now waits and finds it loaded.
fn with_secrets<T>(state: &AppState, f: impl FnOnce(&mut SecretMap) -> T) -> T {
    let mut guard = state.secrets.lock();
    if guard.is_none() {
        *guard = Some(load_secrets(state));
    }
    f(guard.as_mut().expect("just loaded"))
}

fn load_secrets(state: &AppState) -> SecretMap {
    match keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY) {
        Ok(entry) => match entry.get_password() {
            Ok(raw) => {
                if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&raw) {
                    return map;
                }
                eprintln!("keyring: secret store was not a JSON object; ignoring it");
            }
            Err(keyring::Error::NoEntry) => {}
            Err(e) => eprintln!("keyring read failed: {e}; trying file fallback"),
        },
        Err(e) => eprintln!("keyring unavailable: {e}; using file fallback"),
    }

    // The file fallback is already a flat name → value object, i.e. the same
    // shape as the blob.
    let file = read_fallback(state);
    if !file.is_empty() {
        return file;
    }

    let mut migrated = SecretMap::new();
    for name in LEGACY_ENTRIES {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, name) {
            if let Ok(value) = entry.get_password() {
                migrated.insert((*name).to_string(), Value::String(value));
                // Consolidated now; leaving it would prompt again next launch.
                let _ = entry.delete_credential();
            }
        }
    }
    if !migrated.is_empty() {
        if let Err(e) = persist(state, &migrated) {
            eprintln!("could not persist migrated secrets: {e}");
        }
    }
    migrated
}

fn persist(state: &AppState, map: &SecretMap) -> CmdResult<()> {
    let serialized = serde_json::to_string(&Value::Object(map.clone())).map_err(err)?;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ENTRY) {
        if entry.set_password(&serialized).is_ok() {
            // Drop any stale fallback copy so there's exactly one source.
            if !read_fallback(state).is_empty() {
                write_fallback(state, &SecretMap::new())?;
            }
            return Ok(());
        }
        eprintln!("keyring write failed; using file fallback");
    }
    write_fallback(state, map)
}

/// Mirrors *which* secrets exist (never their values) into settings.json, so the
/// UI can show "stored" badges and readiness without unlocking the keychain.
/// Derived state: if the store is edited outside Lattice this can drift, which
/// only affects a badge — every real read still goes to the store.
fn record_presence(state: &AppState, map: &SecretMap) {
    let names: Vec<Value> = map
        .iter()
        .filter(|(_, v)| !v.as_str().unwrap_or("").is_empty())
        .map(|(k, _)| Value::String(k.clone()))
        .collect();
    if let Err(e) = merge_settings(state, serde_json::json!({ "secretsPresent": names })) {
        eprintln!("could not record secret presence: {e}");
    }
}

#[tauri::command]
pub fn get_secret(state: State<AppState>, name: String) -> CmdResult<Option<String>> {
    Ok(with_secrets(&state, |map| {
        map.get(&name)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    }))
}

#[tauri::command]
pub fn set_secret(state: State<AppState>, name: String, value: String) -> CmdResult<()> {
    let updated = with_secrets(&state, |map| {
        map.insert(name, Value::String(value));
        map.clone()
    });
    persist(&state, &updated)?;
    record_presence(&state, &updated);
    Ok(())
}

#[tauri::command]
pub fn delete_secret(state: State<AppState>, name: String) -> CmdResult<()> {
    let updated = with_secrets(&state, |map| {
        map.remove(&name);
        map.clone()
    });
    persist(&state, &updated)?;
    record_presence(&state, &updated);
    Ok(())
}
