//! Graph nodes/edges, chunk vectors (sqlite-vec KNN), and entity resolution.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{err, CmdResult};
use crate::db::{
    ensure_vec_table, existing_vec_tables, f32s_to_blob, new_id, now, ENTITY_MERGE_THRESHOLD,
};
use crate::AppState;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub label: String,
    pub document_id: Option<String>,
    pub entity_id: Option<String>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    pub origin: String,
    pub label: Option<String>,
    pub weight: i64,
}

#[derive(Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

const NODE_COLS: &str = "id, type, label, document_id, entity_id, meta";

fn node_from_row(r: &Row) -> rusqlite::Result<GraphNode> {
    let meta: Option<String> = r.get(5)?;
    Ok(GraphNode {
        id: r.get(0)?,
        node_type: r.get(1)?,
        label: r.get(2)?,
        document_id: r.get(3)?,
        entity_id: r.get(4)?,
        meta: meta.and_then(|m| serde_json::from_str(&m).ok()),
    })
}

fn load_node(conn: &Connection, id: &str) -> rusqlite::Result<Option<GraphNode>> {
    conn.query_row(
        &format!("SELECT {NODE_COLS} FROM node WHERE id = ?1"),
        [id],
        node_from_row,
    )
    .optional()
}

fn ensure_node(
    conn: &Connection,
    node_type: &str,
    label: &str,
    match_sql: &str,
    match_param: &str,
    document_id: Option<&str>,
    entity_id: Option<&str>,
) -> Result<GraphNode, String> {
    let existing: Option<GraphNode> = conn
        .query_row(
            &format!("SELECT {NODE_COLS} FROM node WHERE {match_sql} LIMIT 1"),
            [match_param],
            node_from_row,
        )
        .optional()
        .map_err(err)?;

    if let Some(node) = existing {
        if node.label != label {
            conn.execute("UPDATE node SET label = ?2 WHERE id = ?1", params![node.id, label])
                .map_err(err)?;
            return Ok(GraphNode { label: label.to_string(), ..node });
        }
        return Ok(node);
    }

    let id = new_id();
    conn.execute(
        "INSERT INTO node (id, type, label, document_id, entity_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, node_type, label, document_id, entity_id, now()],
    )
    .map_err(err)?;
    Ok(GraphNode {
        id,
        node_type: node_type.to_string(),
        label: label.to_string(),
        document_id: document_id.map(String::from),
        entity_id: entity_id.map(String::from),
        meta: None,
    })
}

#[tauri::command]
pub fn ensure_document_node(
    state: State<AppState>,
    document_id: String,
    title: String,
) -> CmdResult<GraphNode> {
    let conn = state.db.lock();
    ensure_node(
        &conn,
        "document",
        &title,
        "type = 'document' AND document_id = ?1",
        &document_id,
        Some(&document_id),
        None,
    )
}

#[tauri::command]
pub fn ensure_tag_node(state: State<AppState>, label: String) -> CmdResult<GraphNode> {
    let conn = state.db.lock();
    let normalized = label.to_lowercase();
    ensure_node(
        &conn,
        "tag",
        &normalized,
        "type = 'tag' AND label = ?1 COLLATE NOCASE",
        &normalized,
        None,
        None,
    )
}

#[tauri::command]
pub fn ensure_entity_node(
    state: State<AppState>,
    entity_id: String,
    label: String,
) -> CmdResult<GraphNode> {
    let conn = state.db.lock();
    ensure_node(
        &conn,
        "entity",
        &label,
        "type = 'entity' AND entity_id = ?1",
        &entity_id,
        None,
        Some(&entity_id),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    pub target_node_id: String,
    pub relation: String,
}

/// Replaces all edges of a given origin out of a node — the idempotent
/// rebuild primitive (deterministic edges on save; llm mention edges on
/// re-extract). Mirrors the web app's replaceEdgesFromNode.
#[tauri::command]
pub fn replace_edges_from_node(
    state: State<AppState>,
    source_node_id: String,
    origin: String,
    edges: Vec<EdgeInput>,
) -> CmdResult<()> {
    if origin != "deterministic" && origin != "llm" {
        return Err(format!("invalid origin: {origin}"));
    }
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;
    tx.execute(
        "DELETE FROM edge WHERE source_id = ?1 AND origin = ?2",
        params![source_node_id, origin],
    )
    .map_err(err)?;
    for e in edges {
        tx.execute(
            "INSERT INTO edge (id, source_id, target_id, relation, origin, weight, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![new_id(), source_node_id, e.target_node_id, e.relation, origin, now()],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmEdgeInput {
    pub source_node_id: String,
    pub target_node_id: String,
    pub relation: String,
    pub label: Option<String>,
}

#[tauri::command]
pub fn upsert_llm_edges(state: State<AppState>, edges: Vec<LlmEdgeInput>) -> CmdResult<()> {
    let mut conn = state.db.lock();
    let tx = conn.transaction().map_err(err)?;
    for e in edges {
        let updated = tx
            .execute(
                "UPDATE edge SET weight = weight + 1, label = COALESCE(?4, label)
                 WHERE source_id = ?1 AND target_id = ?2 AND relation = ?3 AND origin = 'llm'",
                params![e.source_node_id, e.target_node_id, e.relation, e.label],
            )
            .map_err(err)?;
        if updated == 0 {
            tx.execute(
                "INSERT INTO edge (id, source_id, target_id, relation, origin, label, weight, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'llm', ?5, 1, ?6)",
                params![new_id(), e.source_node_id, e.target_node_id, e.relation, e.label, now()],
            )
            .map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn get_graph(
    state: State<AppState>,
    types: Option<Vec<String>>,
    origin: Option<String>,
) -> CmdResult<GraphData> {
    let conn = state.db.lock();

    let mut stmt = conn
        .prepare(&format!("SELECT {NODE_COLS} FROM node"))
        .map_err(err)?;
    let all_nodes = stmt
        .query_map([], node_from_row)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let nodes: Vec<GraphNode> = match &types {
        Some(ts) => all_nodes
            .into_iter()
            .filter(|n| ts.iter().any(|t| t == &n.node_type))
            .collect(),
        None => all_nodes,
    };
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();

    let mut stmt = conn
        .prepare("SELECT id, source_id, target_id, relation, origin, label, weight FROM edge")
        .map_err(err)?;
    let edges = stmt
        .query_map([], |r| {
            Ok(GraphEdge {
                id: r.get(0)?,
                source_id: r.get(1)?,
                target_id: r.get(2)?,
                relation: r.get(3)?,
                origin: r.get(4)?,
                label: r.get(5)?,
                weight: r.get(6)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?
        .into_iter()
        .filter(|e| {
            ids.contains(e.source_id.as_str())
                && ids.contains(e.target_id.as_str())
                && origin.as_ref().is_none_or(|o| o == &e.origin)
        })
        .collect();

    Ok(GraphData { nodes, edges })
}

#[tauri::command]
pub fn search_nodes(
    state: State<AppState>,
    q: String,
    node_type: Option<String>,
) -> CmdResult<Vec<GraphNode>> {
    let conn = state.db.lock();
    let like = format!("%{q}%");
    let sql = match node_type {
        Some(_) => format!(
            "SELECT {NODE_COLS} FROM node WHERE label LIKE ?1 COLLATE NOCASE AND type = ?2 LIMIT 20"
        ),
        None => format!("SELECT {NODE_COLS} FROM node WHERE label LIKE ?1 COLLATE NOCASE LIMIT 20"),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = match node_type {
        Some(t) => stmt.query_map(params![like, t], node_from_row),
        None => stmt.query_map(params![like], node_from_row),
    }
    .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeighborEdge {
    pub node: GraphNode,
    pub relation: String,
    pub origin: String,
    pub label: Option<String>,
    pub direction: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Neighborhood {
    pub center: GraphNode,
    pub neighbors: Vec<NeighborEdge>,
}

#[tauri::command]
pub fn get_neighbors(state: State<AppState>, node_id: String) -> CmdResult<Option<Neighborhood>> {
    let conn = state.db.lock();
    let Some(center) = load_node(&conn, &node_id).map_err(err)? else {
        return Ok(None);
    };

    let mut neighbors = Vec::new();
    for (sql, direction) in [
        (
            format!(
                "SELECT {NODE_COLS}, e.relation, e.origin, e.label FROM edge e
                 JOIN node n ON n.id = e.target_id WHERE e.source_id = ?1"
            ),
            "out",
        ),
        (
            format!(
                "SELECT {NODE_COLS}, e.relation, e.origin, e.label FROM edge e
                 JOIN node n ON n.id = e.source_id WHERE e.target_id = ?1"
            ),
            "in",
        ),
    ] {
        // NODE_COLS is unqualified; qualify via the join's single-table alias.
        let sql = sql.replace(NODE_COLS, "n.id, n.type, n.label, n.document_id, n.entity_id, n.meta");
        let mut stmt = conn.prepare(&sql).map_err(err)?;
        let rows = stmt
            .query_map([&node_id], |r| {
                Ok(NeighborEdge {
                    node: node_from_row(r)?,
                    relation: r.get(6)?,
                    origin: r.get(7)?,
                    label: r.get(8)?,
                    direction: direction.to_string(),
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        neighbors.extend(rows);
    }

    Ok(Some(Neighborhood { center, neighbors }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraversalResult {
    pub found: bool,
    pub path: Vec<GraphNode>,
}

#[tauri::command]
pub fn traverse(
    state: State<AppState>,
    from_node_id: String,
    to_node_id: String,
    max_hops: Option<u32>,
) -> CmdResult<TraversalResult> {
    let max_hops = max_hops.unwrap_or(3).min(6) as usize;
    let conn = state.db.lock();

    // Single-user scale: whole edge list fits in memory comfortably.
    let mut stmt = conn.prepare("SELECT source_id, target_id FROM edge").map_err(err)?;
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
    {
        let (a, b) = row.map_err(err)?;
        adjacency.entry(a.clone()).or_default().push(b.clone());
        adjacency.entry(b).or_default().push(a);
    }

    // BFS with parent tracking (undirected).
    let mut parent: HashMap<String, String> = HashMap::new();
    let mut depth: HashMap<String, usize> = HashMap::from([(from_node_id.clone(), 0)]);
    let mut queue = VecDeque::from([from_node_id.clone()]);
    let mut found = from_node_id == to_node_id;

    while let Some(current) = queue.pop_front() {
        if found {
            break;
        }
        let d = depth[&current];
        if d >= max_hops {
            continue;
        }
        for next in adjacency.get(&current).into_iter().flatten() {
            if depth.contains_key(next) {
                continue;
            }
            depth.insert(next.clone(), d + 1);
            parent.insert(next.clone(), current.clone());
            if *next == to_node_id {
                found = true;
                break;
            }
            queue.push_back(next.clone());
        }
    }

    if !found {
        return Ok(TraversalResult { found: false, path: vec![] });
    }

    let mut ids = vec![to_node_id.clone()];
    let mut cursor = to_node_id;
    while let Some(p) = parent.get(&cursor) {
        ids.push(p.clone());
        cursor = p.clone();
    }
    ids.reverse();

    let mut path = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(n) = load_node(&conn, &id).map_err(err)? {
            path.push(n);
        }
    }
    Ok(TraversalResult { found: true, path })
}

// ── Chunks & KNN ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInput {
    pub ordinal: i64,
    pub content: String,
    pub token_count: i64,
    pub embedding: Vec<f32>,
}

#[tauri::command]
pub fn replace_chunks(
    state: State<AppState>,
    document_id: String,
    dimensions: usize,
    chunks: Vec<ChunkInput>,
) -> CmdResult<()> {
    let mut conn = state.db.lock();
    let vec_tables = existing_vec_tables(&conn, "vec_chunks").map_err(err)?;
    ensure_vec_table(&conn, "vec_chunks", dimensions).map_err(err)?;

    let tx = conn.transaction().map_err(err)?;
    for table in &vec_tables {
        tx.execute(
            &format!(
                "DELETE FROM {table} WHERE item_id IN (SELECT id FROM chunk WHERE document_id = ?1)"
            ),
            [&document_id],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM chunk WHERE document_id = ?1", [&document_id])
        .map_err(err)?;

    let ts = now();
    for c in &chunks {
        if c.embedding.len() != dimensions {
            return Err(format!(
                "embedding dim mismatch: got {}, expected {dimensions}",
                c.embedding.len()
            ));
        }
        let id = new_id();
        let blob = f32s_to_blob(&c.embedding);
        tx.execute(
            "INSERT INTO chunk (id, document_id, ordinal, content, token_count, embedding, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, document_id, c.ordinal, c.content, c.token_count, blob, ts],
        )
        .map_err(err)?;
        tx.execute(
            &format!("INSERT INTO vec_chunks_{dimensions} (item_id, embedding) VALUES (?1, ?2)"),
            params![id, blob],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkHit {
    pub chunk_id: String,
    pub document_id: String,
    pub document_title: String,
    pub content: String,
    pub score: f64,
}

#[tauri::command]
pub fn cosine_search_chunks(
    state: State<AppState>,
    embedding: Vec<f32>,
    dimensions: usize,
    k: Option<u32>,
) -> CmdResult<Vec<ChunkHit>> {
    let k = k.unwrap_or(6).clamp(1, 24);
    let conn = state.db.lock();
    ensure_vec_table(&conn, "vec_chunks", dimensions).map_err(err)?;

    let sql = format!(
        "SELECT v.item_id, v.distance, c.document_id, c.content, d.title
         FROM (SELECT item_id, distance FROM vec_chunks_{dimensions}
               WHERE embedding MATCH ?1 AND k = ?2) v
         JOIN chunk c ON c.id = v.item_id
         JOIN document d ON d.id = c.document_id
         ORDER BY v.distance ASC"
    );
    let blob = f32s_to_blob(&embedding);
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(params![blob, k], |r| {
            let distance: f64 = r.get(1)?;
            Ok(ChunkHit {
                chunk_id: r.get(0)?,
                document_id: r.get(2)?,
                content: r.get(3)?,
                document_title: r.get(4)?,
                score: 1.0 - distance,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

// ── Entities ─────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    pub id: String,
    pub name: String,
}

/// Exact-name entity lookup — the reliable primary key for resolution;
/// embedding similarity is the fallback (mirrors web resolve.ts).
#[tauri::command]
pub fn find_entity_by_name(state: State<AppState>, name: String) -> CmdResult<Option<EntityRef>> {
    let conn = state.db.lock();
    conn.query_row(
        "SELECT id, name FROM entity WHERE name = ?1 COLLATE NOCASE LIMIT 1",
        [name.trim()],
        |r| Ok(EntityRef { id: r.get(0)?, name: r.get(1)? }),
    )
    .optional()
    .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarEntity {
    pub id: String,
    pub name: String,
    pub score: f64,
}

#[tauri::command]
pub fn find_similar_entity(
    state: State<AppState>,
    embedding: Vec<f32>,
    dimensions: usize,
) -> CmdResult<Option<SimilarEntity>> {
    let conn = state.db.lock();
    ensure_vec_table(&conn, "vec_entities", dimensions).map_err(err)?;

    let sql = format!(
        "SELECT v.item_id, v.distance, e.name
         FROM (SELECT item_id, distance FROM vec_entities_{dimensions}
               WHERE embedding MATCH ?1 AND k = 1) v
         JOIN entity e ON e.id = v.item_id"
    );
    let blob = f32s_to_blob(&embedding);
    let hit = conn
        .query_row(&sql, params![blob], |r| {
            let distance: f64 = r.get(1)?;
            Ok(SimilarEntity {
                id: r.get(0)?,
                name: r.get(2)?,
                score: 1.0 - distance,
            })
        })
        .optional()
        .map_err(err)?;

    Ok(hit.filter(|h| h.score >= ENTITY_MERGE_THRESHOLD))
}

#[tauri::command]
pub fn create_entity(
    state: State<AppState>,
    name: String,
    entity_type: Option<String>,
    description: Option<String>,
    embedding: Vec<f32>,
    dimensions: usize,
) -> CmdResult<String> {
    let mut conn = state.db.lock();
    ensure_vec_table(&conn, "vec_entities", dimensions).map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let id = new_id();
    let blob = f32s_to_blob(&embedding);
    tx.execute(
        "INSERT INTO entity (id, name, entity_type, description, embedding, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, name, entity_type, description, blob, now()],
    )
    .map_err(err)?;
    tx.execute(
        &format!("INSERT INTO vec_entities_{dimensions} (item_id, embedding) VALUES (?1, ?2)"),
        params![id, blob],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(id)
}

/// Embedding model changed: drop every vector index and stored embedding.
/// The ingest pipeline re-embeds all documents afterwards.
#[tauri::command]
pub fn reset_embeddings(state: State<AppState>) -> CmdResult<()> {
    let conn = state.db.lock();
    for base in ["vec_chunks", "vec_entities"] {
        for table in existing_vec_tables(&conn, base).map_err(err)? {
            conn.execute_batch(&format!("DROP TABLE {table};")).map_err(err)?;
        }
    }
    conn.execute("UPDATE chunk SET embedding = NULL", []).map_err(err)?;
    conn.execute("UPDATE entity SET embedding = NULL", []).map_err(err)?;
    Ok(())
}
