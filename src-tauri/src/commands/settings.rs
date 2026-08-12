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
    let path = settings_path(&state);
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

/// Every keychain touch can be a password prompt — on macOS a dev build's
/// signature changes each rebuild, so previously-granted access is re-asked.
/// This process-lifetime cache means one prompt per secret per run no matter how
/// many callers ask, which is the backstop for frontend callers that race.
/// A cached `None` counts: repeated misses would otherwise re-prompt too.
fn cached_secret(state: &AppState, name: &str) -> Option<Option<String>> {
    state.secrets.lock().get(name).cloned()
}

fn cache_secret(state: &AppState, name: &str, value: Option<String>) {
    state.secrets.lock().insert(name.to_string(), value);
}

#[tauri::command]
pub fn get_secret(state: State<AppState>, name: String) -> CmdResult<Option<String>> {
    if let Some(hit) = cached_secret(&state, &name) {
        return Ok(hit);
    }
    match keyring::Entry::new(KEYRING_SERVICE, &name) {
        Ok(entry) => match entry.get_password() {
            Ok(v) => {
                cache_secret(&state, &name, Some(v.clone()));
                return Ok(Some(v));
            }
            Err(keyring::Error::NoEntry) => {}
            Err(e) => eprintln!("keyring read failed ({name}): {e}; trying file fallback"),
        },
        Err(e) => eprintln!("keyring unavailable: {e}; using file fallback"),
    }
    let found = read_fallback(&state)
        .get(&name)
        .and_then(|v| v.as_str())
        .map(String::from);
    cache_secret(&state, &name, found.clone());
    Ok(found)
}

#[tauri::command]
pub fn set_secret(state: State<AppState>, name: String, value: String) -> CmdResult<()> {
    // Cache before returning on either path, so a write is never followed by a
    // read that goes back to the keychain for a value we already have.
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &name) {
        if entry.set_password(&value).is_ok() {
            // Drop any stale fallback copy so there's exactly one source.
            let mut map = read_fallback(&state);
            if map.remove(&name).is_some() {
                write_fallback(&state, &map)?;
            }
            cache_secret(&state, &name, Some(value));
            return Ok(());
        }
        eprintln!("keyring write failed ({name}); using file fallback");
    }
    let mut map = read_fallback(&state);
    map.insert(name.clone(), Value::String(value.clone()));
    write_fallback(&state, &map)?;
    cache_secret(&state, &name, Some(value));
    Ok(())
}

#[tauri::command]
pub fn delete_secret(state: State<AppState>, name: String) -> CmdResult<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &name) {
        let _ = entry.delete_credential();
    }
    let mut map = read_fallback(&state);
    if map.remove(&name).is_some() {
        write_fallback(&state, &map)?;
    }
    cache_secret(&state, &name, None);
    Ok(())
}
