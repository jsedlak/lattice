//! An MCP server exposing the knowledge graph to external agents (Claude Code,
//! Claude Desktop) over HTTP on the loopback interface.
//!
//! It runs **inside the app** rather than as a stdio sidecar, and the reason is
//! code reuse: holding an `AppHandle` means `app.state::<AppState>()` yields the
//! same `State<AppState>` the IPC layer passes, so the tools call the existing
//! `#[tauri::command]` functions unchanged. There is no second query
//! implementation, no second workspace resolution, and no second database
//! handle — this module is a protocol adapter over the surface the webview
//! already uses. A sidecar would have had to reimplement all of that.
//!
//! Consequences: the server only serves the workspace that is currently open
//! (switching workspaces restarts the app, which restarts the server), and the
//! app must be running for agents to connect.

mod server;
mod tools;

pub use tools::test_embedding;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

use crate::commands::settings;
use crate::AppState;

/// Keychain entry holding the bearer token (same store as the API keys).
pub const TOKEN_SECRET: &str = "mcp-token";

/// Default loopback port. Configurable — the user has to paste it into their
/// agent's config either way, so a surprise port is worse than a bind error.
pub const DEFAULT_PORT: u16 = 4319;

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct McpConfig {
    pub enabled: bool,
    pub port: u16,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self { enabled: false, port: DEFAULT_PORT }
    }
}

/// A live server: the port actually bound, plus its shutdown trigger.
pub struct McpHandle {
    pub port: u16,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    /// The configured port — what a future start will try to bind.
    pub port: u16,
    pub running: bool,
    /// The port currently bound; None when not running.
    pub bound_port: Option<u16>,
    /// Deliberately absent: the token lives in the keychain, and unlocking it
    /// can cost an OS password prompt. Reporting status must be free, so the
    /// token is fetched only when the user asks for it (`mcp_token`).
    /// Why the last start attempt failed (port in use, permissions…).
    pub error: Option<String>,
    /// The workspace being served, so the UI can say what agents will see.
    pub workspace_path: String,
}

// ── Config persistence ───────────────────────────────────────────────────────
//
// Stored under the `mcp` key of the global settings.json. Written through
// set_settings, whose shallow merge is what keeps the frontend's AppSettings
// shape from clobbering it (same arrangement as workspacePath).

pub fn load_config<R: Runtime>(app: &AppHandle<R>) -> McpConfig {
    settings::get_settings(app.state::<AppState>())
        .ok()
        .flatten()
        .and_then(|v| v.get("mcp").cloned())
        .and_then(|v| serde_json::from_value::<McpConfig>(v).ok())
        .unwrap_or_default()
}

pub fn save_config<R: Runtime>(app: &AppHandle<R>, config: McpConfig) -> Result<(), String> {
    settings::set_settings(
        app.state::<AppState>(),
        serde_json::json!({ "mcp": config }),
    )
}

// ── Token ────────────────────────────────────────────────────────────────────

/// Reads the token without creating one. Unlocks the secret store, so only
/// call it from paths the user explicitly asked for.
fn read_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    settings::get_secret(app.state::<AppState>(), TOKEN_SECRET.to_string())
        .ok()
        .flatten()
        .filter(|t| !t.is_empty())
}

/// Returns the bearer token, minting one on first use. 256 bits of v4 UUID —
/// `uuid` is already a dependency, so this avoids pulling in an RNG crate.
/// Only the paths that actually need a live token call this: starting the
/// server, and regenerating on request.
pub fn ensure_token<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    if let Some(existing) = read_token(app) {
        return Ok(existing);
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    settings::set_secret(app.state::<AppState>(), TOKEN_SECRET.to_string(), token.clone())?;
    Ok(token)
}

pub fn regenerate_token<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    settings::set_secret(app.state::<AppState>(), TOKEN_SECRET.to_string(), token.clone())?;
    // The running server captured the old token; restart it so the new one takes
    // effect immediately rather than at next launch.
    if is_running(app) {
        let port = load_config(app).port;
        stop(app);
        start(app, port)?;
    }
    Ok(token)
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

pub fn is_running<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<AppState>().mcp.lock().is_some()
}

/// Binds and serves. Returns the bound port.
///
/// The bind is done synchronously on a std listener before handing it to tokio,
/// so "port already in use" surfaces here as an error the UI can show instead of
/// disappearing into a background task.
pub fn start<R: Runtime>(app: &AppHandle<R>, port: u16) -> Result<u16, String> {
    if is_running(app) {
        stop(app);
    }
    let token = ensure_token(app)?;
    let handle = serve(app, token, port)?;
    let bound_port = handle.port;
    *app.state::<AppState>().mcp.lock() = Some(handle);
    Ok(bound_port)
}

/// Binds and spawns the listener. Split out from `start` so tests can drive a
/// real server with a fixed token instead of minting one into the OS keychain.
fn serve<R: Runtime>(app: &AppHandle<R>, token: String, port: u16) -> Result<McpHandle, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port)).map_err(|e| {
        format!("could not bind 127.0.0.1:{port} — {e}")
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let bound_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let router = server::router(app.clone(), token);

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("mcp: could not adopt listener: {e}");
                return;
            }
        };
        let served = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = served {
            eprintln!("mcp: server stopped: {e}");
        }
    });

    Ok(McpHandle { port: bound_port, shutdown: tx })
}

pub fn stop<R: Runtime>(app: &AppHandle<R>) {
    if let Some(handle) = app.state::<AppState>().mcp.lock().take() {
        // Receiver dropped already means the task is gone — either way we're stopped.
        let _ = handle.shutdown.send(());
    }
}

pub fn status<R: Runtime>(app: &AppHandle<R>, error: Option<String>) -> McpStatus {
    let config = load_config(app);
    let state = app.state::<AppState>();
    let bound_port = state.mcp.lock().as_ref().map(|h| h.port);
    McpStatus {
        enabled: config.enabled,
        port: config.port,
        running: bound_port.is_some(),
        bound_port,
        error,
        workspace_path: state.workspace_dir.to_string_lossy().into_owned(),
    }
}

/// Called during setup: starts the server when the user left it enabled.
/// A failure here is reported and swallowed — a busy port must not stop the app
/// from launching; Settings shows the error.
pub fn start_if_enabled<R: Runtime>(app: &AppHandle<R>) {
    let config = load_config(app);
    if !config.enabled {
        return;
    }
    match start(app, config.port) {
        Ok(port) => eprintln!("mcp: listening on http://127.0.0.1:{port}/mcp"),
        Err(e) => eprintln!("mcp: not started — {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read as _;
    use std::path::{Path, PathBuf};

    use parking_lot::Mutex;
    use rusqlite::params;
    use serde_json::{json, Value};
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::App;

    use crate::db::{new_id, now};

    const TOKEN: &str = "test-token-not-from-the-keychain";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lattice-mcp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A mock Tauri app with a scratch workspace holding one note wired into the
    /// graph: (document "Apollo") —wikilink→ (tag "space").
    fn seeded_app(dir: &Path) -> (App<MockRuntime>, String, String) {
        let conn = crate::db::open(&dir.join("lattice.db")).unwrap();
        let (doc_id, ts) = (new_id(), now());
        conn.execute(
            "INSERT INTO document (id, kind, title, content, ingest_status, created_at, updated_at)
             VALUES (?1, 'note', 'Apollo', ?2, 'ready', ?3, ?3)",
            params![doc_id, "Apollo is a #space program note.", ts],
        )
        .unwrap();

        let (doc_node, tag_node) = (new_id(), new_id());
        conn.execute(
            "INSERT INTO node (id, type, label, document_id, created_at) VALUES (?1,'document',?2,?3,?4)",
            params![doc_node, "Apollo", doc_id, ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO node (id, type, label, created_at) VALUES (?1,'tag',?2,?3)",
            params![tag_node, "space", ts],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO edge (id, source_id, target_id, relation, origin, weight, created_at)
             VALUES (?1, ?2, ?3, 'tag', 'deterministic', 1, ?4)",
            params![new_id(), doc_node, tag_node, ts],
        )
        .unwrap();

        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(AppState {
            db: Mutex::new(conn),
            workspace_dir: dir.to_path_buf(),
            config_dir: dir.to_path_buf(),
            default_workspace_dir: dir.to_path_buf(),
            storage_mode: Mutex::new(crate::workspace::StorageMode::Database),
            models_dir: dir.join("models"),
            embedder: Mutex::new(None),
            mcp: Mutex::new(None),
            secrets: Mutex::new(None),
        });
        (app, doc_id, doc_node)
    }

    /// One JSON-RPC round trip over real HTTP. Returns (status, parsed body).
    fn post(port: u16, token: &str, body: &Value) -> (u16, Value) {
        let payload = serde_json::to_string(body).unwrap();
        let result = ureq::post(&format!("http://127.0.0.1:{port}/mcp"))
            .header("content-type", "application/json")
            .header("authorization", &format!("Bearer {token}"))
            .send(payload.as_str());
        match result {
            Ok(mut resp) => {
                let status = resp.status().as_u16();
                let mut raw = String::new();
                resp.body_mut().as_reader().read_to_string(&mut raw).unwrap();
                (status, serde_json::from_str(&raw).unwrap_or(Value::Null))
            }
            Err(ureq::Error::StatusCode(code)) => (code, Value::Null),
            Err(e) => panic!("request failed: {e}"),
        }
    }

    fn rpc(port: u16, method: &str, params: Value) -> Value {
        let (status, body) =
            post(port, TOKEN, &json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }));
        assert_eq!(status, 200, "{method} returned {status}");
        assert_eq!(body["jsonrpc"], "2.0");
        assert!(body.get("error").is_none(), "{method} errored: {body}");
        body["result"].clone()
    }

    /// Tool results arrive as JSON encoded into a text content block.
    fn call_tool(port: u16, name: &str, args: Value) -> Value {
        let result = rpc(port, "tools/call", json!({ "name": name, "arguments": args }));
        assert!(
            result.get("isError").is_none(),
            "{name} reported a tool error: {}",
            result["content"][0]["text"]
        );
        serde_json::from_str(result["content"][0]["text"].as_str().expect("text content"))
            .expect("tool payload is JSON")
    }

    /// The whole path an agent takes: bind → handshake → discover → query, with
    /// real sockets, real JSON-RPC framing, and a real SQLite workspace.
    #[test]
    fn serves_the_graph_over_http() {
        let dir = scratch("e2e");
        let (app, doc_id, doc_node) = seeded_app(&dir);
        // Port 0: let the OS pick, so the test can't collide with a real server.
        let handle = serve(app.handle(), TOKEN.to_string(), 0).unwrap();
        let port = handle.port;

        // initialize — the vocabulary the client needs must actually be there.
        let init = rpc(port, "initialize", json!({ "protocolVersion": "2025-06-18" }));
        assert_eq!(init["protocolVersion"], "2025-06-18");
        assert_eq!(init["serverInfo"]["name"], "lattice");
        let instructions = init["instructions"].as_str().unwrap();
        assert!(instructions.contains("deterministic"), "instructions omit edge origins");
        assert!(instructions.contains("getSubgraph"), "instructions omit graph traversal");

        // tools/list — every advertised tool is callable by name.
        let tools = rpc(port, "tools/list", Value::Null);
        let names: Vec<&str> =
            tools["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names.len(), 7, "unexpected tool set: {names:?}");
        assert!(names.contains(&"semanticSearch") && names.contains(&"getSubgraph"));

        // listDocuments — previews only, never the full body.
        let listed = call_tool(port, "listDocuments", json!({}));
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["documents"][0]["title"], "Apollo");
        assert!(listed["documents"][0].get("content").is_none());

        // getDocument — the full text, keyed by the id listDocuments returned.
        let doc = call_tool(port, "getDocument", json!({ "documentId": doc_id }));
        assert_eq!(doc["content"], "Apollo is a #space program note.");

        // searchNodes → getSubgraph: label to node id to neighborhood.
        let found = call_tool(port, "searchNodes", json!({ "q": "apoll" }));
        assert_eq!(found[0]["nodeId"], doc_node);
        let sub = call_tool(port, "getSubgraph", json!({ "nodeId": doc_node, "depth": 1 }));
        assert_eq!(sub["nodes"].as_array().unwrap().len(), 2, "expected the note and its tag");
        assert_eq!(sub["edges"][0]["relation"], "tag");
        assert_eq!(sub["edges"][0]["origin"], "deterministic");

        // A tool failure is a result with isError, not a JSON-RPC error, so the
        // model sees the message and can recover.
        let missing = rpc(
            port,
            "tools/call",
            json!({ "name": "getDocument", "arguments": { "documentId": "nope" } }),
        );
        assert_eq!(missing["isError"], true);

        // Notifications get an ack with no body — replying would break clients.
        let (status, body) =
            post(port, TOKEN, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        assert_eq!(status, 202);
        assert_eq!(body, Value::Null);

        drop(handle);
    }

    #[test]
    fn rejects_requests_without_the_token() {
        let dir = scratch("auth");
        let (app, _, _) = seeded_app(&dir);
        let handle = serve(app.handle(), TOKEN.to_string(), 0).unwrap();

        let (status, _) =
            post(handle.port, "wrong-token", &json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }));
        assert_eq!(status, 401);

        // …and the right one still works on the same listener.
        let (status, _) =
            post(handle.port, TOKEN, &json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" }));
        assert_eq!(status, 200);

        drop(handle);
    }

    /// Opening Settings → MCP must cost nothing. `status` used to report the
    /// token, which meant reading (and minting) it — on macOS an OS password
    /// prompt for what is a read-only glance at some state.
    ///
    /// `AppState.secrets` stays `None` until something unlocks the store, so an
    /// untouched `None` afterwards is proof no keychain access happened. It also
    /// keeps this test off the real keychain.
    #[test]
    fn status_does_not_unlock_the_secret_store() {
        let dir = scratch("statustoken");
        let (app, _, _) = seeded_app(&dir);
        assert!(app.state::<AppState>().secrets.lock().is_none(), "precondition");

        let reported = status(app.handle(), None);
        assert!(!reported.enabled && !reported.running);

        assert!(
            app.state::<AppState>().secrets.lock().is_none(),
            "status touched the secret store — that is a password prompt on macOS",
        );
    }

    /// Semantic search is the one tool that needs a model. With none configured
    /// it must fail with an explanation, not a panic, and must not take the
    /// other tools down with it.
    #[test]
    fn semantic_search_degrades_without_an_embedding_model() {
        let dir = scratch("noembed");
        let (app, _, _) = seeded_app(&dir);
        let handle = serve(app.handle(), TOKEN.to_string(), 0).unwrap();

        let result = rpc(
            handle.port,
            "tools/call",
            json!({ "name": "semanticSearch", "arguments": { "query": "apollo" } }),
        );
        assert_eq!(result["isError"], true);
        let message = result["content"][0]["text"].as_str().unwrap();
        assert!(message.contains("embedding"), "unhelpful message: {message}");

        // Unrelated tools are unaffected.
        let listed = call_tool(handle.port, "listDocuments", json!({}));
        assert_eq!(listed["total"], 1);

        drop(handle);
    }
}
