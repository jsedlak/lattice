//! HTTP transport and JSON-RPC dispatch for the MCP server.
//!
//! Streamable HTTP, stateless variant: a single `POST /mcp` endpoint that
//! answers with `application/json`. The spec only requires an SSE stream when
//! the server initiates messages, and a query server never does — so there are
//! no sessions, no event ids, and no resumability to get wrong.

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::tools;

/// The MCP revision this server implements.
const PROTOCOL_VERSION: &str = "2025-06-18";

struct Ctx<R: Runtime> {
    app: AppHandle<R>,
    token: String,
}

// Hand-written: deriving Clone would demand `R: Clone`, which Runtime
// implementations don't promise — but AppHandle<R> is Clone for every R.
impl<R: Runtime> Clone for Ctx<R> {
    fn clone(&self) -> Self {
        Self { app: self.app.clone(), token: self.token.clone() }
    }
}

pub fn router<R: Runtime>(app: AppHandle<R>, token: String) -> Router {
    Router::new()
        // GET is where an SSE stream would live. We don't offer one; the spec
        // allows saying so.
        .route("/mcp", post(handle::<R>).get(|| async { StatusCode::METHOD_NOT_ALLOWED }))
        .with_state(Ctx { app, token })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/// Length-independent equality, so a wrong token can't be recovered by timing.
fn secure_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A loopback port is reachable by every process on this machine, and — via DNS
/// rebinding — by any web page the user visits. Three gates:
///
/// 1. A bearer token, which a rebinding attacker cannot guess.
/// 2. No `Origin` header at all. MCP clients are not browsers and never send
///    one; anything that does is a web page, which has no business here. This is
///    stricter than allow-listing origins and needs no configuration.
/// 3. A loopback `Host`. Rebinding arrives with the attacker's hostname.
///
/// We also never emit CORS headers, so a browser could not read a reply anyway.
fn authorize(headers: &HeaderMap, token: &str) -> Result<(), Response> {
    if headers.contains_key(header::ORIGIN) {
        return Err(deny(StatusCode::FORBIDDEN, "cross-origin requests are not accepted"));
    }

    let host_ok = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(|h| {
            let host = h.rsplit_once(':').map_or(h, |(name, _)| name);
            host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
        })
        // A missing Host on HTTP/1.1 is malformed; treat it as untrusted.
        .unwrap_or(false);
    if !host_ok {
        return Err(deny(StatusCode::FORBIDDEN, "requests must address this server on loopback"));
    }

    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !secure_eq(presented.trim(), token) {
        return Err(deny(StatusCode::UNAUTHORIZED, "missing or invalid bearer token"));
    }
    Ok(())
}

fn deny(status: StatusCode, message: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], json!({ "error": message }).to_string())
        .into_response()
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

fn rpc_result(id: Value, result: Value) -> Response {
    json_response(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn rpc_error(id: Value, code: i32, message: impl Into<String>) -> Response {
    json_response(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() },
    }))
}

fn json_response(body: Value) -> Response {
    (StatusCode::OK, [(header::CONTENT_TYPE, "application/json")], body.to_string()).into_response()
}

async fn handle<R: Runtime>(State(ctx): State<Ctx<R>>, headers: HeaderMap, body: String) -> Response {
    if let Err(response) = authorize(&headers, &ctx.token) {
        return response;
    }

    let request: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => return rpc_error(Value::Null, -32700, format!("parse error: {e}")),
    };
    // JSON-RPC batching was removed in the 2025-06-18 revision.
    if request.is_array() {
        return rpc_error(Value::Null, -32600, "batch requests are not supported");
    }

    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return rpc_error(Value::Null, -32600, "request has no method");
    };
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    // No id means a notification: acknowledge with no body, never a result.
    let Some(id) = request.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };

    match method {
        "initialize" => rpc_result(
            id,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {}, "resources": {} },
                "serverInfo": {
                    "name": "lattice",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "instructions": tools::instructions(&ctx.app),
            }),
        ),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(id, json!({ "tools": tools::definitions() })),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str).map(String::from) else {
                return rpc_error(id, -32602, "tools/call requires a name");
            };
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let app = ctx.app.clone();
            // SQLite and the embedder are blocking; keep them off the async runtime.
            let outcome =
                tauri::async_runtime::spawn_blocking(move || tools::call(&app, &name, &args)).await;

            match outcome {
                Ok(Ok(value)) => rpc_result(
                    id,
                    json!({
                        "content": [{
                            "type": "text",
                            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
                        }],
                    }),
                ),
                // A tool that fails is a result with isError, not a protocol
                // error: the model should see the message and adapt.
                Ok(Err(message)) => rpc_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": message }],
                        "isError": true,
                    }),
                ),
                Err(e) => rpc_error(id, -32603, format!("tool task failed: {e}")),
            }
        }
        "resources/list" => {
            let app = ctx.app.clone();
            match tauri::async_runtime::spawn_blocking(move || tools::list_resources(&app)).await {
                Ok(Ok(resources)) => rpc_result(id, json!({ "resources": resources })),
                Ok(Err(e)) => rpc_error(id, -32603, e),
                Err(e) => rpc_error(id, -32603, format!("task failed: {e}")),
            }
        }
        "resources/read" => {
            let Some(uri) = params.get("uri").and_then(Value::as_str).map(String::from) else {
                return rpc_error(id, -32602, "resources/read requires a uri");
            };
            let app = ctx.app.clone();
            match tauri::async_runtime::spawn_blocking(move || tools::read_resource(&app, &uri))
                .await
            {
                Ok(Ok(contents)) => rpc_result(id, json!({ "contents": [contents] })),
                Ok(Err(e)) => rpc_error(id, -32602, e),
                Err(e) => rpc_error(id, -32603, format!("task failed: {e}")),
            }
        }
        other => rpc_error(id, -32601, format!("unknown method: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_eq_matches_only_identical_strings() {
        assert!(secure_eq("abc123", "abc123"));
        assert!(!secure_eq("abc123", "abc124"));
        assert!(!secure_eq("abc", "abc123"));
        assert!(!secure_eq("", "x"));
        assert!(secure_eq("", ""));
    }

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(
                header::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                header::HeaderValue::from_str(v).unwrap(),
            );
        }
        map
    }

    #[test]
    fn accepts_a_loopback_request_with_the_right_token() {
        let h = headers(&[("host", "127.0.0.1:4319"), ("authorization", "Bearer secret")]);
        assert!(authorize(&h, "secret").is_ok());
    }

    #[test]
    fn rejects_a_wrong_or_missing_token() {
        let h = headers(&[("host", "localhost:4319"), ("authorization", "Bearer nope")]);
        assert!(authorize(&h, "secret").is_err());
        let h = headers(&[("host", "localhost:4319")]);
        assert!(authorize(&h, "secret").is_err());
    }

    /// DNS rebinding: a page on evil.com resolves it to 127.0.0.1 and POSTs.
    /// Both the Origin and the Host give it away.
    #[test]
    fn rejects_browser_and_rebound_requests() {
        let with_origin = headers(&[
            ("host", "127.0.0.1:4319"),
            ("origin", "https://evil.com"),
            ("authorization", "Bearer secret"),
        ]);
        assert!(authorize(&with_origin, "secret").is_err());

        let rebound =
            headers(&[("host", "evil.com:4319"), ("authorization", "Bearer secret")]);
        assert!(authorize(&rebound, "secret").is_err());
    }
}
