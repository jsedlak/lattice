//! Conversations, messages, and ingest-job tracking.

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;
use tauri::State;

use super::{err, CmdResult};
use crate::db::{new_id, now};
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn conversation_from_row(r: &Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get(0)?,
        title: r.get(1)?,
        model: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

#[tauri::command]
pub fn list_conversations(state: State<AppState>) -> CmdResult<Vec<Conversation>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, title, model, created_at, updated_at FROM conversation
             ORDER BY updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt.query_map([], conversation_from_row).map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn create_conversation(
    state: State<AppState>,
    title: Option<String>,
    model: Option<String>,
) -> CmdResult<Conversation> {
    let (id, ts) = (new_id(), now());
    let title = title.unwrap_or_else(|| "New conversation".to_string());
    state
        .db
        .lock()
        .execute(
            "INSERT INTO conversation (id, title, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, title, model, ts],
        )
        .map_err(err)?;
    Ok(Conversation { id, title, model, created_at: ts.clone(), updated_at: ts })
}

#[tauri::command]
pub fn rename_conversation(state: State<AppState>, id: String, title: String) -> CmdResult<()> {
    state
        .db
        .lock()
        .execute(
            "UPDATE conversation SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, title, now()],
        )
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, id: String) -> CmdResult<()> {
    state
        .db
        .lock()
        .execute("DELETE FROM conversation WHERE id = ?1", [&id])
        .map_err(err)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub citations: Option<serde_json::Value>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_messages(state: State<AppState>, conversation_id: String) -> CmdResult<Vec<MessageRow>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, citations, created_at
             FROM message WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([&conversation_id], |r| {
            let citations: Option<String> = r.get(4)?;
            Ok(MessageRow {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                citations: citations.and_then(|c| serde_json::from_str(&c).ok()),
                created_at: r.get(5)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn append_message(
    state: State<AppState>,
    conversation_id: String,
    role: String,
    content: String,
    citations: Option<serde_json::Value>,
) -> CmdResult<MessageRow> {
    let conn = state.db.lock();
    let (id, ts) = (new_id(), now());
    let citations_text = citations.as_ref().map(|c| c.to_string());
    conn.execute(
        "INSERT INTO message (id, conversation_id, role, content, citations, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, conversation_id, role, content, citations_text, ts],
    )
    .map_err(err)?;
    conn.execute(
        "UPDATE conversation SET updated_at = ?2 WHERE id = ?1",
        params![conversation_id, ts],
    )
    .map_err(err)?;
    Ok(MessageRow {
        id,
        conversation_id,
        role,
        content,
        citations,
        created_at: ts,
    })
}

// ── Ingest jobs ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestJobRow {
    pub id: String,
    pub document_id: String,
    pub status: String,
    pub step: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn job_from_row(r: &Row) -> rusqlite::Result<IngestJobRow> {
    Ok(IngestJobRow {
        id: r.get(0)?,
        document_id: r.get(1)?,
        status: r.get(2)?,
        step: r.get(3)?,
        error: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const JOB_COLS: &str = "id, document_id, status, step, error, created_at, updated_at";

/// One job row per document (UNIQUE document_id); also mirrors status onto
/// document.ingest_status/ingest_error like the web pipeline does.
#[tauri::command]
pub fn upsert_ingest_job(
    state: State<AppState>,
    document_id: String,
    status: String,
    step: Option<String>,
    error: Option<String>,
) -> CmdResult<IngestJobRow> {
    let conn = state.db.lock();
    let ts = now();
    conn.execute(
        "INSERT INTO ingest_job (id, document_id, status, step, error, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(document_id) DO UPDATE SET
           status = excluded.status, step = excluded.step, error = excluded.error,
           updated_at = excluded.updated_at",
        params![new_id(), document_id, status, step, error, ts],
    )
    .map_err(err)?;
    conn.execute(
        "UPDATE document SET ingest_status = ?2, ingest_error = ?3 WHERE id = ?1",
        params![document_id, status, error],
    )
    .map_err(err)?;
    conn.query_row(
        &format!("SELECT {JOB_COLS} FROM ingest_job WHERE document_id = ?1"),
        [&document_id],
        job_from_row,
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "job not found".into())
}

#[tauri::command]
pub fn list_ingest_jobs(state: State<AppState>) -> CmdResult<Vec<IngestJobRow>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(&format!("SELECT {JOB_COLS} FROM ingest_job ORDER BY updated_at DESC"))
        .map_err(err)?;
    let rows = stmt.query_map([], job_from_row).map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
