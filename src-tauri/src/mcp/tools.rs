//! Tool and resource definitions exposed over MCP.
//!
//! Every tool here delegates to the same `#[tauri::command]` functions the
//! webview calls through IPC — this module owns schemas, argument coercion, and
//! response shaping, never query logic. The four graph tools keep the names and
//! descriptions from `src/lib/ai/tools.ts` so behavior matches the in-app
//! assistant; `getDocument`, `getSubgraph`, and `listDocuments` are additions
//! that an external agent needs and the in-app assistant got from the UI.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::{docs, graph, settings};
use crate::embedding;
use crate::AppState;

/// Semantic search returns short snippets; anything longer is a `getDocument`
/// away. Keeps tool results from swamping the caller's context.
const SNIPPET_CHARS: usize = 280;
const PREVIEW_CHARS: usize = 160;
/// A hub tag ("#work") can reach most of the graph in two hops. Cap what comes
/// back and say so, rather than silently returning a truncated neighborhood.
const MAX_SUBGRAPH_NODES: usize = 200;
const MAX_LISTED_DOCUMENTS: usize = 500;

/// Sent with `initialize`. Over IPC the assistant gets this vocabulary from its
/// system prompt; an MCP client has no system prompt, so without this the tools
/// read as generic search and the graph never gets traversed.
pub fn instructions<R: Runtime>(app: &AppHandle<R>) -> String {
    let workspace = app.state::<AppState>().workspace_dir.to_string_lossy().into_owned();
    format!(
        "Lattice is the user's personal knowledge base: markdown notes and uploaded \
documents, indexed into a knowledge graph with vector embeddings. This server \
serves the workspace at {workspace}.

The graph has three node types:
  - document — one per note or upload
  - tag      — an inline #tag, or a folder name (every ancestor folder in a \
note's path becomes a tag on it, so a note at work/projects/apollo.md carries \
#work and #projects)
  - entity   — a person, place, or concept extracted from note content

Edges carry a relation and an origin, and the origin is a confidence signal:
  - wikilink, tag (origin: deterministic) — parsed from the text itself. These \
are facts.
  - mentions, related (origin: llm) — inferred by a model during ingest. These \
are suggestive, not authoritative; say so if you lean on one.

How to work with it:
  - Start with semanticSearch for 'what do I know about X'. It returns chunks \
with truncated snippets — call getDocument to read a note in full before \
summarizing or quoting it.
  - Use searchNodes to turn a name into a node id, then getNeighbors or \
getSubgraph to see what surrounds it. getSubgraph at depth 2 is usually more \
useful than several getNeighbors calls.
  - Use traverse for 'how are X and Y connected' — it returns the shortest path \
between two nodes.
  - Prefer citing note titles the user will recognize over node ids.

This server is read-only: it cannot create or modify notes."
    )
}

pub fn definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "semanticSearch",
            "description": "Find the most relevant note/document chunks by meaning. Use for 'what do I know about X' style questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural-language search query" },
                    "k": { "type": "integer", "minimum": 1, "maximum": 12, "default": 6 },
                },
                "required": ["query"],
            },
        }),
        json!({
            "name": "searchNodes",
            "description": "Search graph nodes (documents, tags, entities) by label. Returns node ids usable with getNeighbors/getSubgraph/traverse.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "q": { "type": "string" },
                    "type": { "type": "string", "enum": ["document", "tag", "entity"] },
                },
                "required": ["q"],
            },
        }),
        json!({
            "name": "getNeighbors",
            "description": "Get the 1-hop neighbors of a graph node by id.",
            "inputSchema": {
                "type": "object",
                "properties": { "nodeId": { "type": "string" } },
                "required": ["nodeId"],
            },
        }),
        json!({
            "name": "getSubgraph",
            "description": "Get the neighborhood around a node out to N hops, with the edges between those nodes. Use instead of repeated getNeighbors calls when exploring a topic.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "nodeId": { "type": "string" },
                    "depth": { "type": "integer", "minimum": 1, "maximum": 4, "default": 2 },
                },
                "required": ["nodeId"],
            },
        }),
        json!({
            "name": "traverse",
            "description": "Find a path / multi-hop connection between two graph nodes. Use for 'how are X and Y connected' questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "fromNodeId": { "type": "string" },
                    "toNodeId": { "type": "string" },
                    "maxHops": { "type": "integer", "minimum": 1, "maximum": 4, "default": 3 },
                },
                "required": ["fromNodeId", "toNodeId"],
            },
        }),
        json!({
            "name": "getDocument",
            "description": "Read a note or document in full by its document id. Use after semanticSearch, whose snippets are truncated.",
            "inputSchema": {
                "type": "object",
                "properties": { "documentId": { "type": "string" } },
                "required": ["documentId"],
            },
        }),
        json!({
            "name": "listDocuments",
            "description": "List notes and uploads with titles and short previews — for orientation, or to find a document by title when search is not working.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["note", "upload"] },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 100 },
                },
            },
        }),
    ]
}

// ── Argument helpers ─────────────────────────────────────────────────────────

fn required_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .ok_or_else(|| format!("missing required argument: {key}"))
}

fn optional_u32(args: &Value, key: &str) -> Option<u32> {
    args.get(key).and_then(Value::as_u64).map(|v| v as u32)
}

fn truncate(text: &str, max: usize) -> String {
    // char_indices so a cut never lands inside a UTF-8 sequence.
    match text.char_indices().nth(max) {
        Some((byte, _)) => format!("{}…", &text[..byte]),
        None => text.to_string(),
    }
}

// ── Query embedding ──────────────────────────────────────────────────────────

/// Embeds a search query using the workspace's configured embedding endpoint,
/// returning the vector and the dimension its vec0 table is keyed by.
fn embed_query<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<(Vec<f32>, usize), String> {
    let config = settings::get_settings(app.state::<AppState>())?
        .and_then(|v| v.get("embedding").cloned())
        .ok_or_else(|| {
            "No embedding model is configured in Lattice, so semantic search is unavailable. \
             Other tools (searchNodes, getSubgraph, traverse, getDocument) still work."
                .to_string()
        })?;

    let kind = config.get("kind").and_then(Value::as_str).unwrap_or("").to_string();

    if kind == "local" {
        let state = app.state::<AppState>();
        let mut guard = state.embedder.lock();
        if guard.is_none() {
            if !embedding::model_present(&state.models_dir) {
                return Err("The built-in embedding model has not been downloaded yet — open \
                            Lattice's Settings → AI and download it to enable semantic search."
                    .into());
            }
            *guard = Some(embedding::load(&state.models_dir)?);
        }
        let vectors = guard.as_ref().expect("just initialized").embed(&[text.to_string()])?;
        let vector = vectors.into_iter().next().ok_or("local embedding returned nothing")?;
        return Ok((vector, embedding::LOCAL_EMBEDDING_DIM));
    }

    let dimensions = config
        .get("dimensions")
        .and_then(Value::as_u64)
        .ok_or("embedding settings have no dimensions")? as usize;
    let remote = embedding::RemoteConfig {
        kind,
        model: config
            .get("model")
            .and_then(Value::as_str)
            .ok_or("embedding settings have no model")?
            .to_string(),
        base_url: config.get("baseUrl").and_then(Value::as_str).map(String::from),
        api_key: settings::get_secret(app.state::<AppState>(), "embedding-api-key".into())?,
    };
    let vectors = embedding::embed_remote(&remote, &[text.to_string()])?;
    let vector = vectors.into_iter().next().ok_or("embedding endpoint returned nothing")?;
    Ok((vector, dimensions))
}

/// Exposed to the UI as a "Test" button: proves the Rust-side embedding path
/// works end to end without going through an agent.
pub fn test_embedding<R: Runtime>(app: &AppHandle<R>) -> Result<usize, String> {
    embed_query(app, "lattice").map(|(vector, _)| vector.len())
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/// Runs a tool. Blocking (SQLite, and possibly an HTTP embedding call), so the
/// transport hands it to a blocking task.
pub fn call<R: Runtime>(app: &AppHandle<R>, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "semanticSearch" => {
            let query = required_str(args, "query")?;
            let k = optional_u32(args, "k").unwrap_or(6).clamp(1, 12);
            let (vector, dimensions) = embed_query(app, &query)?;
            let hits =
                graph::cosine_search_chunks(app.state(), vector, dimensions, Some(k))?;
            Ok(json!(hits
                .into_iter()
                .map(|h| json!({
                    "chunkId": h.chunk_id,
                    "documentId": h.document_id,
                    "title": h.document_title,
                    "snippet": truncate(&h.content, SNIPPET_CHARS),
                    "score": h.score,
                }))
                .collect::<Vec<_>>()))
        }

        "searchNodes" => {
            let q = required_str(args, "q")?;
            let node_type = args.get("type").and_then(Value::as_str).map(String::from);
            let nodes = graph::search_nodes(app.state(), q, node_type)?;
            Ok(json!(nodes
                .into_iter()
                .map(|n| json!({
                    "nodeId": n.id,
                    "type": n.node_type,
                    "label": n.label,
                    "documentId": n.document_id,
                }))
                .collect::<Vec<_>>()))
        }

        "getNeighbors" => {
            let node_id = required_str(args, "nodeId")?;
            match graph::get_neighbors(app.state(), node_id)? {
                Some(hood) => serde_json::to_value(hood.neighbors).map_err(|e| e.to_string()),
                None => Err("no node with that id".into()),
            }
        }

        "getSubgraph" => {
            let node_id = required_str(args, "nodeId")?;
            let depth = optional_u32(args, "depth").unwrap_or(2).clamp(1, 4);
            let data = graph::get_subgraph(app.state(), node_id, Some(depth))?;
            if data.nodes.is_empty() {
                return Err("no node with that id".into());
            }
            let total = data.nodes.len();
            let truncated = total > MAX_SUBGRAPH_NODES;
            let kept: Vec<Value> = data
                .nodes
                .iter()
                .take(MAX_SUBGRAPH_NODES)
                .map(|n| json!({
                    "nodeId": n.id,
                    "type": n.node_type,
                    "label": n.label,
                    "documentId": n.document_id,
                }))
                .collect();
            let kept_ids: std::collections::HashSet<&str> =
                data.nodes.iter().take(MAX_SUBGRAPH_NODES).map(|n| n.id.as_str()).collect();
            let edges: Vec<Value> = data
                .edges
                .iter()
                .filter(|e| {
                    kept_ids.contains(e.source_id.as_str())
                        && kept_ids.contains(e.target_id.as_str())
                })
                .map(|e| json!({
                    "sourceId": e.source_id,
                    "targetId": e.target_id,
                    "relation": e.relation,
                    "origin": e.origin,
                    "label": e.label,
                }))
                .collect();
            let mut out = json!({ "nodes": kept, "edges": edges });
            if truncated {
                out["truncated"] = json!(true);
                out["note"] = json!(format!(
                    "This neighborhood has {total} nodes; only the first {MAX_SUBGRAPH_NODES} are \
                     shown. Try a smaller depth, or a more specific starting node."
                ));
            }
            Ok(out)
        }

        "traverse" => {
            let from = required_str(args, "fromNodeId")?;
            let to = required_str(args, "toNodeId")?;
            let max_hops = optional_u32(args, "maxHops").unwrap_or(3).clamp(1, 4);
            let result = graph::traverse(app.state(), from, to, Some(max_hops))?;
            Ok(json!({
                "found": result.found,
                "path": result.path.iter().map(|n| json!({
                    "nodeId": n.id,
                    "type": n.node_type,
                    "label": n.label,
                    "documentId": n.document_id,
                })).collect::<Vec<_>>(),
            }))
        }

        "getDocument" => {
            let id = required_str(args, "documentId")?;
            // Files mode: this reads the .md from disk, so an agent sees what the
            // editor sees rather than the database cache.
            match docs::get_document(app.state(), id)? {
                Some(doc) => Ok(json!({
                    "documentId": doc.id,
                    "title": doc.title,
                    "kind": doc.kind,
                    "content": doc.content,
                    "filePath": doc.file_path,
                    "ingestStatus": doc.ingest_status,
                    "updatedAt": doc.updated_at,
                })),
                None => Err("no document with that id".into()),
            }
        }

        "listDocuments" => {
            let kind = args.get("kind").and_then(Value::as_str).map(String::from);
            let limit = optional_u32(args, "limit").unwrap_or(100).clamp(1, 500) as usize;
            let docs = docs::list_documents(app.state(), kind)?;
            let total = docs.len();
            let listed: Vec<Value> = docs
                .into_iter()
                .take(limit.min(MAX_LISTED_DOCUMENTS))
                .map(|d| json!({
                    "documentId": d.id,
                    "title": d.title,
                    "kind": d.kind,
                    // Never the full body: listing a corpus must not dump it.
                    "preview": truncate(&d.content, PREVIEW_CHARS),
                    "ingestStatus": d.ingest_status,
                    "updatedAt": d.updated_at,
                }))
                .collect();
            Ok(json!({ "total": total, "returned": listed.len(), "documents": listed }))
        }

        other => Err(format!("unknown tool: {other}")),
    }
}

// ── Resources ────────────────────────────────────────────────────────────────

const URI_PREFIX: &str = "lattice://document/";

pub fn list_resources<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<Value>, String> {
    let docs = docs::list_documents(app.state(), None)?;
    Ok(docs
        .into_iter()
        .take(MAX_LISTED_DOCUMENTS)
        .map(|d| {
            json!({
                "uri": format!("{URI_PREFIX}{}", d.id),
                "name": d.title,
                "description": truncate(&d.content, PREVIEW_CHARS),
                "mimeType": if d.kind == "note" { "text/markdown" } else { "text/plain" },
            })
        })
        .collect())
}

pub fn read_resource<R: Runtime>(app: &AppHandle<R>, uri: &str) -> Result<Value, String> {
    let id = uri
        .strip_prefix(URI_PREFIX)
        .ok_or_else(|| format!("unsupported resource uri: {uri} (expected {URI_PREFIX}<id>)"))?;
    let doc = docs::get_document(app.state(), id.to_string())?
        .ok_or_else(|| format!("no document with id {id}"))?;
    Ok(json!({
        "uri": uri,
        "mimeType": if doc.kind == "note" { "text/markdown" } else { "text/plain" },
        "text": doc.content,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_appends_ellipsis_only_when_it_cuts() {
        assert_eq!(truncate("short", 10), "short");
        assert_eq!(truncate("abcdefghij", 10), "abcdefghij");
        assert_eq!(truncate("abcdefghijk", 10), "abcdefghij…");
    }

    /// A byte-index slice would panic here; char_indices is why it doesn't.
    #[test]
    fn truncate_respects_multibyte_boundaries() {
        assert_eq!(truncate("ααααα", 3), "ααα…");
        assert_eq!(truncate("日本語テキスト", 2), "日本…");
    }

    #[test]
    fn required_str_rejects_missing_and_blank() {
        let args = json!({ "q": "  hello  ", "blank": "   " });
        assert_eq!(required_str(&args, "q").unwrap(), "hello");
        assert!(required_str(&args, "blank").is_err());
        assert!(required_str(&args, "absent").is_err());
    }

    #[test]
    fn every_tool_definition_is_well_formed() {
        for tool in definitions() {
            assert!(tool.get("name").and_then(Value::as_str).is_some());
            assert!(tool.get("description").and_then(Value::as_str).is_some());
            let schema = tool.get("inputSchema").expect("tool has an inputSchema");
            assert_eq!(schema.get("type").and_then(Value::as_str), Some("object"));
            assert!(schema.get("properties").and_then(Value::as_object).is_some());
        }
    }
}
