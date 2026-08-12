//! Control surface for the MCP server (Settings → MCP).

use tauri::{AppHandle, Runtime};

use super::CmdResult;
use crate::mcp;

#[tauri::command]
pub fn mcp_status<R: Runtime>(app: AppHandle<R>) -> CmdResult<mcp::McpStatus> {
    Ok(mcp::status(&app, None))
}

/// Persists the enabled/port setting and applies it immediately.
///
/// A failed bind is reported in the returned status rather than as a command
/// error: the setting was saved, so the UI needs to show both the new config and
/// why it isn't listening.
#[tauri::command]
pub fn set_mcp_config<R: Runtime>(app: AppHandle<R>, enabled: bool, port: u16) -> CmdResult<mcp::McpStatus> {
    if port < 1024 {
        return Err("Choose a port above 1023 — lower ports are reserved.".into());
    }
    mcp::save_config(&app, mcp::McpConfig { enabled, port })?;

    let mut error = None;
    if enabled {
        if let Err(e) = mcp::start(&app, port) {
            error = Some(e);
        }
    } else {
        mcp::stop(&app);
    }
    Ok(mcp::status(&app, error))
}

/// Returns the bearer token, creating one if none exists.
///
/// Separate from `mcp_status` on purpose: this unlocks the secret store, which
/// on macOS can be a password prompt. Opening Settings → MCP must cost nothing,
/// so only an explicit "show connection details" click lands here.
#[tauri::command]
pub fn mcp_token<R: Runtime>(app: AppHandle<R>) -> CmdResult<String> {
    mcp::ensure_token(&app)
}

/// Issues a new bearer token, invalidating the old one. Restarts the listener so
/// the change takes effect without relaunching the app.
#[tauri::command]
pub fn regenerate_mcp_token<R: Runtime>(app: AppHandle<R>) -> CmdResult<String> {
    mcp::regenerate_token(&app)
}

/// Round-trips the Rust-side query embedding — the same path semanticSearch
/// uses over MCP, which is not the path the in-app assistant exercises.
#[tauri::command]
pub async fn test_mcp_embedding<R: Runtime>(app: AppHandle<R>) -> CmdResult<usize> {
    tauri::async_runtime::spawn_blocking(move || mcp::test_embedding(&app))
        .await
        .map_err(|e| e.to_string())?
}
