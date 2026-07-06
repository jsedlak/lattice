//! Documents, folders, and upload file storage.

use std::fs;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use tauri::State;

use super::{err, CmdResult};
use crate::db::{existing_vec_tables, new_id, now};
use crate::AppState;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub content: String,
    pub folder_id: Option<String>,
    pub file_path: Option<String>,
    pub mime_type: Option<String>,
    pub byte_size: Option<i64>,
    pub page_count: Option<i64>,
    pub ingest_status: String,
    pub ingest_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const DOC_COLS: &str = "id, kind, title, content, folder_id, file_path, mime_type, byte_size, \
                        page_count, ingest_status, ingest_error, created_at, updated_at";

fn doc_from_row(r: &Row) -> rusqlite::Result<Doc> {
    Ok(Doc {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        content: r.get(3)?,
        folder_id: r.get(4)?,
        file_path: r.get(5)?,
        mime_type: r.get(6)?,
        byte_size: r.get(7)?,
        page_count: r.get(8)?,
        ingest_status: r.get(9)?,
        ingest_error: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

fn get_doc(conn: &Connection, id: &str) -> rusqlite::Result<Option<Doc>> {
    conn.query_row(
        &format!("SELECT {DOC_COLS} FROM document WHERE id = ?1"),
        [id],
        doc_from_row,
    )
    .optional()
}

#[tauri::command]
pub fn list_documents(state: State<AppState>, kind: Option<String>) -> CmdResult<Vec<Doc>> {
    let conn = state.db.lock();
    let sql = match kind {
        Some(_) => format!("SELECT {DOC_COLS} FROM document WHERE kind = ?1 ORDER BY updated_at DESC"),
        None => format!("SELECT {DOC_COLS} FROM document ORDER BY updated_at DESC"),
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = match kind {
        Some(k) => stmt.query_map([k], doc_from_row),
        None => stmt.query_map([], doc_from_row),
    }
    .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn get_document(state: State<AppState>, id: String) -> CmdResult<Option<Doc>> {
    get_doc(&state.db.lock(), &id).map_err(err)
}

#[tauri::command]
pub fn find_document_by_title(state: State<AppState>, title: String) -> CmdResult<Option<Doc>> {
    let conn = state.db.lock();
    conn.query_row(
        &format!("SELECT {DOC_COLS} FROM document WHERE title = ?1 COLLATE NOCASE LIMIT 1"),
        [title],
        doc_from_row,
    )
    .optional()
    .map_err(err)
}

#[tauri::command]
pub fn create_note(
    state: State<AppState>,
    title: String,
    content: String,
    folder_id: Option<String>,
) -> CmdResult<Doc> {
    let conn = state.db.lock();
    let (id, ts) = (new_id(), now());
    conn.execute(
        "INSERT INTO document (id, kind, title, content, folder_id, created_at, updated_at)
         VALUES (?1, 'note', ?2, ?3, ?4, ?5, ?5)",
        params![id, title, content, folder_id, ts],
    )
    .map_err(err)?;
    get_doc(&conn, &id).map_err(err)?.ok_or_else(|| "not found".into())
}

#[tauri::command]
pub fn update_document(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    folder_id: Option<String>,
    clear_folder: Option<bool>,
) -> CmdResult<Doc> {
    let conn = state.db.lock();
    let existing = get_doc(&conn, &id).map_err(err)?.ok_or("document not found")?;
    let new_folder = if clear_folder.unwrap_or(false) {
        None
    } else {
        folder_id.or(existing.folder_id)
    };
    conn.execute(
        "UPDATE document SET title = ?2, content = ?3, folder_id = ?4, updated_at = ?5 WHERE id = ?1",
        params![
            id,
            title.unwrap_or(existing.title),
            content.unwrap_or(existing.content),
            new_folder,
            now()
        ],
    )
    .map_err(err)?;
    get_doc(&conn, &id).map_err(err)?.ok_or_else(|| "not found".into())
}

#[tauri::command]
pub fn set_document_ingest(
    state: State<AppState>,
    id: String,
    status: String,
    error: Option<String>,
) -> CmdResult<()> {
    state
        .db
        .lock()
        .execute(
            "UPDATE document SET ingest_status = ?2, ingest_error = ?3 WHERE id = ?1",
            params![id, status, error],
        )
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_document(state: State<AppState>, id: String) -> CmdResult<()> {
    let conn = state.db.lock();
    let doc = get_doc(&conn, &id).map_err(err)?.ok_or("document not found")?;

    // vec0 tables have no FK to chunk — clean them up explicitly first.
    for table in existing_vec_tables(&conn, "vec_chunks").map_err(err)? {
        conn.execute(
            &format!(
                "DELETE FROM {table} WHERE item_id IN (SELECT id FROM chunk WHERE document_id = ?1)"
            ),
            [&id],
        )
        .map_err(err)?;
    }
    // Cascades: chunk, node (and edges via node FK), ingest_job.
    conn.execute("DELETE FROM document WHERE id = ?1", [&id]).map_err(err)?;

    if doc.file_path.is_some() {
        let dir = state.data_dir.join("files").join(&id);
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> CmdResult<Vec<Folder>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, created_at FROM folder ORDER BY name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    name: String,
    parent_id: Option<String>,
) -> CmdResult<Folder> {
    let (id, ts) = (new_id(), now());
    state
        .db
        .lock()
        .execute(
            "INSERT INTO folder (id, name, parent_id, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, parent_id, ts],
        )
        .map_err(err)?;
    Ok(Folder { id, name, parent_id, created_at: ts })
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    state
        .db
        .lock()
        .execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![id, name])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> CmdResult<()> {
    let conn = state.db.lock();
    // Documents fall back to root; child folders are re-rooted (app-managed tree).
    conn.execute("UPDATE document SET folder_id = NULL WHERE folder_id = ?1", [&id])
        .map_err(err)?;
    conn.execute("UPDATE folder SET parent_id = NULL WHERE parent_id = ?1", [&id])
        .map_err(err)?;
    conn.execute("DELETE FROM folder WHERE id = ?1", [&id]).map_err(err)?;
    Ok(())
}

// ── Uploads ──────────────────────────────────────────────────────────────────

fn mime_for(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdf" => Some("application/pdf"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xls" => Some("application/vnd.ms-excel"),
        "csv" => Some("text/csv"),
        "md" | "markdown" => Some("text/markdown"),
        "txt" => Some("text/plain"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

#[tauri::command]
pub fn import_upload(state: State<AppState>, src_path: String) -> CmdResult<Doc> {
    let src = Path::new(&src_path);
    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid file path")?
        .to_string();
    let title = src
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(&file_name)
        .to_string();
    let mime = mime_for(src).ok_or("unsupported file type")?;

    let id = new_id();
    let dest_dir = state.data_dir.join("files").join(&id);
    fs::create_dir_all(&dest_dir).map_err(err)?;
    let dest = dest_dir.join(&file_name);
    fs::copy(src, &dest).map_err(err)?;
    let byte_size = fs::metadata(&dest).map_err(err)?.len() as i64;
    // Stored relative to the data dir so the whole dir is relocatable.
    let rel_path = format!("files/{id}/{file_name}");

    let conn = state.db.lock();
    let ts = now();
    conn.execute(
        "INSERT INTO document (id, kind, title, content, file_path, mime_type, byte_size,
                               ingest_status, created_at, updated_at)
         VALUES (?1, 'upload', ?2, '', ?3, ?4, ?5, 'queued', ?6, ?6)",
        params![id, title, rel_path, mime, byte_size, ts],
    )
    .map_err(err)?;
    get_doc(&conn, &id).map_err(err)?.ok_or_else(|| "not found".into())
}

#[tauri::command]
pub fn read_upload_bytes(
    state: State<AppState>,
    document_id: String,
) -> CmdResult<tauri::ipc::Response> {
    let rel: Option<String> = {
        let conn = state.db.lock();
        conn.query_row(
            "SELECT file_path FROM document WHERE id = ?1",
            [&document_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten()
    };
    let rel = rel.ok_or("document has no stored file")?;
    let bytes = fs::read(state.data_dir.join(rel)).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}
