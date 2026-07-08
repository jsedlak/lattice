//! Documents, folders, and upload file storage.

use std::fs;
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use tauri::State;

use super::{err, CmdResult};
use crate::db::{existing_vec_tables, new_id, now};
use crate::workspace;
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
    pub sort_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

const DOC_COLS: &str = "id, kind, title, content, folder_id, file_path, mime_type, byte_size, \
                        page_count, ingest_status, ingest_error, sort_order, created_at, \
                        updated_at";

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
        sort_order: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

pub(crate) fn get_doc(conn: &Connection, id: &str) -> rusqlite::Result<Option<Doc>> {
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
    // Manual order first (tree drag-reorder), most recently touched otherwise.
    const ORDER: &str = "ORDER BY sort_order IS NULL, sort_order, updated_at DESC";
    let sql = match kind {
        Some(_) => format!("SELECT {DOC_COLS} FROM document WHERE kind = ?1 {ORDER}"),
        None => format!("SELECT {DOC_COLS} FROM document {ORDER}"),
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
    let mut doc = get_doc(&state.db.lock(), &id).map_err(err)?;
    // Files mode: the .md file is canonical — serve it, but do NOT refresh the
    // db cache; a stale cache is how sync_workspace detects external edits.
    if state.files_mode() {
        if let Some(d) = doc.as_mut() {
            if d.kind == "note" {
                if let Some(rel) = &d.file_path {
                    if let Ok(text) = fs::read_to_string(state.workspace_dir.join(rel)) {
                        d.content = text;
                    }
                }
            }
        }
    }
    Ok(doc)
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
    // Files mode: disk first — the file is canonical, the row is the index.
    let (title, file_path) = if state.files_mode() {
        let (stem, rel) =
            workspace::place_note(&conn, &state.workspace_dir, folder_id.as_deref(), &title, None)?;
        fs::write(state.workspace_dir.join(&rel), &content).map_err(err)?;
        (stem, Some(rel))
    } else {
        (title, None)
    };
    conn.execute(
        "INSERT INTO document (id, kind, title, content, folder_id, file_path, sort_order, created_at, updated_at)
         VALUES (?1, 'note', ?2, ?3, ?4, ?5,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM document WHERE folder_id IS ?4),
                 ?6, ?6)",
        params![id, title, content, folder_id, file_path, ts],
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
        folder_id.or(existing.folder_id.clone())
    };
    // Moving between folders appends to the destination's manual order.
    if new_folder != existing.folder_id {
        conn.execute(
            "UPDATE document SET sort_order =
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM document WHERE folder_id IS ?2)
             WHERE id = ?1",
            params![id, new_folder],
        )
        .map_err(err)?;
    }

    let content_changed = content.is_some();
    let mut new_title = title.unwrap_or_else(|| existing.title.clone());
    let new_content = content.unwrap_or_else(|| existing.content.clone());
    let mut new_file_path = existing.file_path.clone();

    // Files mode: the .md file is canonical — apply the change on disk first;
    // any fs error aborts before the row is touched. Sanitizing/deduping may
    // adjust the requested title; the returned Doc carries what stuck.
    if state.files_mode() && existing.kind == "note" {
        let ws = &state.workspace_dir;
        match existing.file_path.as_deref() {
            None => {
                // Self-heal a row that never got a file.
                let (stem, rel) =
                    workspace::place_note(&conn, ws, new_folder.as_deref(), &new_title, None)?;
                fs::write(ws.join(&rel), &new_content).map_err(err)?;
                new_title = stem;
                new_file_path = Some(rel);
            }
            Some(cur_rel) => {
                let cur_abs = ws.join(cur_rel);
                if new_folder != existing.folder_id || new_title != existing.title {
                    let (stem, rel) = workspace::place_note(
                        &conn,
                        ws,
                        new_folder.as_deref(),
                        &new_title,
                        Some(&cur_abs),
                    )?;
                    fs::rename(&cur_abs, ws.join(&rel)).map_err(err)?;
                    new_title = stem;
                    new_file_path = Some(rel);
                }
                if content_changed {
                    let rel = new_file_path.as_deref().unwrap_or(cur_rel);
                    fs::write(ws.join(rel), &new_content).map_err(err)?;
                }
            }
        }
    }

    conn.execute(
        "UPDATE document SET title = ?2, content = ?3, folder_id = ?4, file_path = ?5, updated_at = ?6
         WHERE id = ?1",
        params![id, new_title, new_content, new_folder, new_file_path, now()],
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

/// Removes a document row plus its vec-table vectors and upload files.
/// Shared with workspace sync (externally deleted notes). Does NOT remove
/// note .md files — the command below owns that.
pub(crate) fn delete_document_row(
    conn: &Connection,
    workspace_dir: &Path,
    id: &str,
) -> CmdResult<()> {
    let doc = get_doc(conn, id).map_err(err)?.ok_or("document not found")?;

    // vec0 tables have no FK to chunk — clean them up explicitly first.
    for table in existing_vec_tables(conn, "vec_chunks").map_err(err)? {
        conn.execute(
            &format!(
                "DELETE FROM {table} WHERE item_id IN (SELECT id FROM chunk WHERE document_id = ?1)"
            ),
            [id],
        )
        .map_err(err)?;
    }
    // Cascades: chunk, node (and edges via node FK), ingest_job.
    conn.execute("DELETE FROM document WHERE id = ?1", [id]).map_err(err)?;

    if doc.kind == "upload" {
        let dir = workspace_dir.join("files").join(id);
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_document(state: State<AppState>, id: String) -> CmdResult<()> {
    let conn = state.db.lock();
    let doc = get_doc(&conn, &id).map_err(err)?.ok_or("document not found")?;
    if state.files_mode() && doc.kind == "note" {
        if let Some(rel) = &doc.file_path {
            match fs::remove_file(state.workspace_dir.join(rel)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
                _ => {}
            }
        }
    }
    delete_document_row(&conn, &state.workspace_dir, &id)
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: Option<i64>,
    pub created_at: String,
}

#[tauri::command]
pub fn list_folders(state: State<AppState>) -> CmdResult<Vec<Folder>> {
    let conn = state.db.lock();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, parent_id, sort_order, created_at FROM folder
             ORDER BY sort_order IS NULL, sort_order, name",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                name: r.get(1)?,
                parent_id: r.get(2)?,
                sort_order: r.get(3)?,
                created_at: r.get(4)?,
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
    let conn = state.db.lock();
    let (id, ts) = (new_id(), now());
    // Files mode: the directory is the folder — create it first, letting
    // sanitize/dedupe settle the name that actually sticks.
    let name = if state.files_mode() {
        let parent_rel = workspace::folder_rel_dir(&conn, parent_id.as_deref())?;
        let abs_parent = state.workspace_dir.join(&parent_rel);
        fs::create_dir_all(&abs_parent).map_err(err)?;
        let unique = workspace::unique_name(&abs_parent, &workspace::sanitize_stem(&name), false, None);
        fs::create_dir(abs_parent.join(&unique)).map_err(err)?;
        unique
    } else {
        name
    };
    conn.execute(
        "INSERT INTO folder (id, name, parent_id, sort_order, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folder WHERE parent_id IS ?3),
                 ?4)",
        params![id, name, parent_id, ts],
    )
    .map_err(err)?;
    let sort_order = conn
        .query_row("SELECT sort_order FROM folder WHERE id = ?1", [&id], |r| r.get(0))
        .map_err(err)?;
    Ok(Folder { id, name, parent_id, sort_order, created_at: ts })
}

/// Rewrites the manual order (and containment) of notes in one folder: each id
/// gets sort_order = its index and folder_id = `folder_id`. The client sends
/// the full sibling list after a drag.
#[tauri::command]
pub fn reorder_documents(
    state: State<AppState>,
    folder_id: Option<String>,
    ids: Vec<String>,
) -> CmdResult<()> {
    let conn = state.db.lock();
    let tx = conn.unchecked_transaction().map_err(err)?;
    for (i, id) in ids.iter().enumerate() {
        // A drag between folders arrives here (not update_document) — in
        // files mode the note's .md file moves with it.
        if state.files_mode() {
            let row: Option<(String, Option<String>, Option<String>)> = tx
                .query_row(
                    "SELECT kind, folder_id, file_path FROM document WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()
                .map_err(err)?;
            if let Some((kind, cur_folder, Some(cur_rel))) = row {
                if kind == "note" && cur_folder.as_deref() != folder_id.as_deref() {
                    let ws = &state.workspace_dir;
                    let cur_abs = ws.join(&cur_rel);
                    let title: String = tx
                        .query_row("SELECT title FROM document WHERE id = ?1", [id], |r| r.get(0))
                        .map_err(err)?;
                    let (stem, rel) =
                        workspace::place_note(&tx, ws, folder_id.as_deref(), &title, Some(&cur_abs))?;
                    fs::rename(&cur_abs, ws.join(&rel)).map_err(err)?;
                    tx.execute(
                        "UPDATE document SET title = ?2, file_path = ?3 WHERE id = ?1",
                        params![id, stem, rel],
                    )
                    .map_err(err)?;
                }
            }
        }
        tx.execute(
            "UPDATE document SET folder_id = ?2, sort_order = ?3 WHERE id = ?1",
            params![id, folder_id, i as i64],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

/// Same as reorder_documents, for folders within one parent.
#[tauri::command]
pub fn reorder_folders(
    state: State<AppState>,
    parent_id: Option<String>,
    ids: Vec<String>,
) -> CmdResult<()> {
    let conn = state.db.lock();
    let tx = conn.unchecked_transaction().map_err(err)?;
    for (i, id) in ids.iter().enumerate() {
        // Re-parenting a folder moves its directory (and every descendant's
        // file_path) in files mode.
        if state.files_mode() {
            let row: Option<(String, Option<String>)> = tx
                .query_row("SELECT name, parent_id FROM folder WHERE id = ?1", [id], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .optional()
                .map_err(err)?;
            if let Some((name, cur_parent)) = row {
                if cur_parent.as_deref() != parent_id.as_deref() {
                    let ws = &state.workspace_dir;
                    let old_rel = workspace::folder_rel_dir(&tx, Some(id))?;
                    let parent_rel = workspace::folder_rel_dir(&tx, parent_id.as_deref())?;
                    let abs_parent = ws.join(&parent_rel);
                    fs::create_dir_all(&abs_parent).map_err(err)?;
                    let unique =
                        workspace::unique_name(&abs_parent, &workspace::sanitize_stem(&name), false, None);
                    let new_rel = parent_rel.join(&unique);
                    fs::rename(ws.join(&old_rel), ws.join(&new_rel)).map_err(err)?;
                    workspace::rewrite_path_prefix(
                        &tx,
                        &workspace::rel_to_string(&old_rel),
                        &workspace::rel_to_string(&new_rel),
                    )?;
                    if unique != name {
                        tx.execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![id, unique])
                            .map_err(err)?;
                    }
                }
            }
        }
        tx.execute(
            "UPDATE folder SET parent_id = ?2, sort_order = ?3 WHERE id = ?1",
            params![id, parent_id, i as i64],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn rename_folder(state: State<AppState>, id: String, name: String) -> CmdResult<()> {
    let conn = state.db.lock();
    if state.files_mode() {
        let ws = &state.workspace_dir;
        let parent_id: Option<String> = conn
            .query_row("SELECT parent_id FROM folder WHERE id = ?1", [&id], |r| r.get(0))
            .map_err(err)?;
        let old_rel = workspace::folder_rel_dir(&conn, Some(&id))?;
        let parent_rel = workspace::folder_rel_dir(&conn, parent_id.as_deref())?;
        let old_abs = ws.join(&old_rel);
        let unique = workspace::unique_name(
            &ws.join(&parent_rel),
            &workspace::sanitize_stem(&name),
            false,
            Some(&old_abs),
        );
        let new_rel = parent_rel.join(&unique);
        if new_rel != old_rel {
            fs::rename(&old_abs, ws.join(&new_rel)).map_err(err)?;
            workspace::rewrite_path_prefix(
                &conn,
                &workspace::rel_to_string(&old_rel),
                &workspace::rel_to_string(&new_rel),
            )?;
        }
        conn.execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![id, unique])
            .map_err(err)?;
        return Ok(());
    }
    conn.execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![id, name])
        .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn delete_folder(state: State<AppState>, id: String) -> CmdResult<()> {
    let conn = state.db.lock();
    // Files mode: mirror the fallback-to-root semantics on disk before the
    // rows change (folder_rel_dir walks the current parent chain).
    if state.files_mode() {
        let ws = &state.workspace_dir;
        let folder_rel = workspace::folder_rel_dir(&conn, Some(&id))?;
        let notes_root = ws.join("notes");
        fs::create_dir_all(&notes_root).map_err(err)?;

        let docs: Vec<(String, String, Option<String>)> = {
            let mut stmt = conn
                .prepare("SELECT id, title, file_path FROM document WHERE folder_id = ?1 AND kind = 'note'")
                .map_err(err)?;
            let rows = stmt
                .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        for (doc_id, title, rel) in docs {
            let Some(rel) = rel else { continue };
            let cur_abs = ws.join(&rel);
            let (stem, new_rel) = workspace::place_note(&conn, ws, None, &title, Some(&cur_abs))?;
            fs::rename(&cur_abs, ws.join(&new_rel)).map_err(err)?;
            conn.execute(
                "UPDATE document SET title = ?2, file_path = ?3 WHERE id = ?1",
                params![doc_id, stem, new_rel],
            )
            .map_err(err)?;
        }

        let children: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, name FROM folder WHERE parent_id = ?1")
                .map_err(err)?;
            let rows = stmt
                .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        for (child_id, name) in children {
            let old_rel = workspace::folder_rel_dir(&conn, Some(&child_id))?;
            let unique =
                workspace::unique_name(&notes_root, &workspace::sanitize_stem(&name), false, None);
            let new_rel = Path::new("notes").join(&unique);
            fs::rename(ws.join(&old_rel), ws.join(&new_rel)).map_err(err)?;
            workspace::rewrite_path_prefix(
                &conn,
                &workspace::rel_to_string(&old_rel),
                &workspace::rel_to_string(&new_rel),
            )?;
            if unique != name {
                conn.execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![child_id, unique])
                    .map_err(err)?;
            }
        }

        // Only removes an empty dir — stray user files keep it (and stay) put.
        let _ = fs::remove_dir(ws.join(&folder_rel));
    }
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
    let dest_dir = state.workspace_dir.join("files").join(&id);
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
    let bytes = fs::read(state.workspace_dir.join(rel)).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}
