//! Workspace commands: inspect/switch the workspace, sync files-mode notes,
//! switch storage modes, and restart the app.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use super::{docs, err, CmdResult};
use crate::db::{new_id, now};
use crate::workspace::{self, StorageMode, WorkspaceConfig};
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub mode: StorageMode,
    pub is_default: bool,
    /// The workspacePath currently recorded in settings.json — what the NEXT
    /// launch will open. Differs from `path` when a switch is pending restart.
    pub override_path: Option<String>,
}

#[tauri::command]
pub fn get_workspace_info(state: State<AppState>) -> CmdResult<WorkspaceInfo> {
    let override_path = fs::read_to_string(state.config_dir.join("settings.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.get("workspacePath").and_then(|p| p.as_str()).map(String::from));
    Ok(WorkspaceInfo {
        path: state.workspace_dir.display().to_string(),
        mode: *state.storage_mode.lock(),
        is_default: state.workspace_dir == state.default_workspace_dir,
        override_path,
    })
}

/// Points the app at another workspace (or back to the default with `None`).
/// Seeds `.lattice` in a fresh directory so the choice of storage mode is
/// recorded before the restart picks it up. Does not restart by itself.
#[tauri::command]
pub fn set_workspace_path(state: State<AppState>, path: Option<String>) -> CmdResult<()> {
    if let Some(ref p) = path {
        let dir = PathBuf::from(p);
        if !dir.is_absolute() {
            return Err("workspace path must be absolute".into());
        }
        // The workspace's own storage areas are not workspaces.
        for sub in ["files", "notes"] {
            if dir.starts_with(state.workspace_dir.join(sub)) {
                return Err("cannot open a directory inside the current workspace's storage".into());
            }
        }
        fs::create_dir_all(&dir).map_err(err)?;
        workspace::load_or_init_config(&dir)?;
    }

    let settings_path = state.config_dir.join("settings.json");
    let mut map = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    match path {
        Some(p) => {
            map.insert("workspacePath".into(), Value::String(p));
        }
        None => {
            map.remove("workspacePath");
        }
    }
    let pretty = serde_json::to_string_pretty(&Value::Object(map)).map_err(err)?;
    fs::write(settings_path, pretty).map_err(err)
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) -> CmdResult<()> {
    app.restart() // -> ! (never returns)
}

// ── Files-mode sync ──────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    /// Documents created from files found on disk — need ingest.
    pub added: Vec<String>,
    /// Documents whose content (or title, on migration) changed — need re-ingest.
    pub changed: Vec<String>,
    /// Documents deleted because their file is gone (graph rows cascaded).
    pub removed: Vec<String>,
}

/// Reconciles the notes/ tree with the document index. Files are canonical:
/// new files become notes, edited files refresh the cached content, missing
/// files delete their rows. Called at startup and around mode switches.
#[tauri::command]
pub fn sync_workspace(state: State<AppState>) -> CmdResult<SyncReport> {
    if !state.files_mode() {
        return Ok(SyncReport::default());
    }
    let conn = state.db.lock();
    sync_files(&conn, &state.workspace_dir)
}

fn ensure_folder(conn: &Connection, parent: Option<&str>, name: &str) -> CmdResult<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM folder WHERE parent_id IS ?1 AND name = ?2",
            params![parent, name],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let (id, ts) = (new_id(), now());
    conn.execute(
        "INSERT INTO folder (id, name, parent_id, sort_order, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folder WHERE parent_id IS ?3),
                 ?4)",
        params![id, name, parent, ts],
    )
    .map_err(err)?;
    Ok(id)
}

fn sync_files(conn: &Connection, ws: &Path) -> CmdResult<SyncReport> {
    let notes_root = ws.join("notes");
    fs::create_dir_all(&notes_root).map_err(err)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    let mut report = SyncReport::default();

    // Walk notes/: mirror directories as folder rows, collect .md files.
    // rel path → (folder_id, stem, absolute path)
    let mut disk: HashMap<String, (Option<String>, String, PathBuf)> = HashMap::new();
    let mut stack: Vec<(PathBuf, String, Option<String>)> =
        vec![(notes_root.clone(), String::new(), None)];
    while let Some((abs_dir, rel_dir, folder_id)) = stack.pop() {
        for entry in fs::read_dir(&abs_dir).map_err(err)? {
            let entry = entry.map_err(err)?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let ftype = entry.file_type().map_err(err)?;
            if ftype.is_symlink() {
                continue;
            }
            if ftype.is_dir() {
                let child_id = ensure_folder(&tx, folder_id.as_deref(), &name)?;
                let child_rel =
                    if rel_dir.is_empty() { name.clone() } else { format!("{rel_dir}/{name}") };
                stack.push((entry.path(), child_rel, Some(child_id)));
            } else if ftype.is_file() && name.to_lowercase().ends_with(".md") {
                let stem = name[..name.len() - 3].to_string();
                let file_rel =
                    if rel_dir.is_empty() { format!("notes/{name}") } else { format!("notes/{rel_dir}/{name}") };
                disk.insert(file_rel, (folder_id.clone(), stem, entry.path()));
            }
        }
    }

    // Index of notes the db already tracks on disk.
    let mut db_by_path: HashMap<String, (String, String)> = {
        let mut stmt = tx
            .prepare("SELECT file_path, id, content FROM document WHERE kind = 'note' AND file_path IS NOT NULL")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))
            .map_err(err)?;
        rows.collect::<Result<HashMap<_, _>, _>>().map_err(err)?
    };

    for (rel, (folder_id, stem, abs)) in &disk {
        let text = match fs::read_to_string(abs) {
            Ok(t) => t,
            Err(e) => {
                eprintln!("skipping {rel}: {e}"); // non-UTF-8 or unreadable
                continue;
            }
        };
        match db_by_path.remove(rel) {
            Some((id, cached)) => {
                if cached != text {
                    tx.execute(
                        "UPDATE document SET content = ?2, updated_at = ?3 WHERE id = ?1",
                        params![id, text, now()],
                    )
                    .map_err(err)?;
                    report.changed.push(id);
                }
            }
            None => {
                let (id, ts) = (new_id(), now());
                tx.execute(
                    "INSERT INTO document (id, kind, title, content, folder_id, file_path, sort_order, created_at, updated_at)
                     VALUES (?1, 'note', ?2, ?3, ?4, ?5,
                             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM document WHERE folder_id IS ?4),
                             ?6, ?6)",
                    params![id, stem, text, folder_id, rel, ts],
                )
                .map_err(err)?;
                report.added.push(id);
            }
        }
    }

    // Tracked notes whose file vanished: the note is gone (path is identity).
    for (_, (id, _)) in db_by_path {
        docs::delete_document_row(&tx, ws, &id)?;
        report.removed.push(id);
    }

    // Self-heal: files-mode notes without a file (interrupted migration) get
    // exported rather than silently living db-only.
    let orphans: Vec<(String, Option<String>, String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, folder_id, title, content FROM document WHERE kind = 'note' AND file_path IS NULL")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for (id, folder_id, title, content) in orphans {
        let (stem, rel) = workspace::place_note(&tx, ws, folder_id.as_deref(), &title, None)?;
        fs::write(ws.join(&rel), &content).map_err(err)?;
        tx.execute(
            "UPDATE document SET title = ?2, file_path = ?3 WHERE id = ?1",
            params![id, stem, rel],
        )
        .map_err(err)?;
    }

    // Prune folder rows whose directory vanished and which hold nothing —
    // leaf-first, so emptied ancestors qualify on the next pass.
    loop {
        let empties: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT f.id FROM folder f
                     WHERE NOT EXISTS (SELECT 1 FROM document d WHERE d.folder_id = f.id)
                       AND NOT EXISTS (SELECT 1 FROM folder c WHERE c.parent_id = f.id)",
                )
                .map_err(err)?;
            let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(err)?
        };
        let mut pruned = false;
        for id in empties {
            let rel = workspace::folder_rel_dir(&tx, Some(&id))?;
            if !ws.join(&rel).is_dir() {
                tx.execute("DELETE FROM folder WHERE id = ?1", [&id]).map_err(err)?;
                pruned = true;
            }
        }
        if !pruned {
            break;
        }
    }

    tx.commit().map_err(err)?;
    Ok(report)
}

// ── Storage mode switching ───────────────────────────────────────────────────

/// Switches where note content is canonical, migrating in place:
/// database→files exports every note as markdown; files→database freshens the
/// cache from disk then detaches (notes/ stays behind, no longer read).
#[tauri::command]
pub fn set_storage_mode(state: State<AppState>, mode: StorageMode) -> CmdResult<SyncReport> {
    if *state.storage_mode.lock() == mode {
        return Ok(SyncReport::default());
    }
    let conn = state.db.lock();
    let ws = &state.workspace_dir;

    let report = match mode {
        StorageMode::Files => export_notes(&conn, ws)?,
        StorageMode::Database => {
            let report = sync_files(&conn, ws)?;
            conn.execute("UPDATE document SET file_path = NULL WHERE kind = 'note'", [])
                .map_err(err)?;
            report
        }
    };

    // Flip the recorded and in-memory mode only after the migration held.
    workspace::save_config(ws, &WorkspaceConfig { storage: mode, ..Default::default() })?;
    *state.storage_mode.lock() = mode;
    Ok(report)
}

/// database→files: materialize the folder tree as directories and every note
/// as a .md file. Titles/folder names get sanitized and deduped; retitled
/// notes are reported as changed so their graph labels re-ingest.
fn export_notes(conn: &Connection, ws: &Path) -> CmdResult<SyncReport> {
    let notes_root = ws.join("notes");
    fs::create_dir_all(&notes_root).map_err(err)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    let mut report = SyncReport::default();

    // Folder names become directory names: sanitize + dedupe within siblings.
    let folders: Vec<(String, String, Option<String>)> = {
        let mut stmt = tx.prepare("SELECT id, name, parent_id FROM folder").map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    let mut siblings: HashMap<Option<String>, Vec<(String, String)>> = HashMap::new();
    for (id, name, parent) in folders {
        siblings.entry(parent).or_default().push((id, name));
    }
    for group in siblings.values() {
        let mut taken: Vec<String> = Vec::new();
        for (id, name) in group {
            let mut candidate = workspace::sanitize_stem(name);
            let mut n = 2;
            while taken.contains(&candidate.to_lowercase()) {
                candidate = format!("{} ({n})", workspace::sanitize_stem(name));
                n += 1;
            }
            taken.push(candidate.to_lowercase());
            if candidate != *name {
                tx.execute("UPDATE folder SET name = ?2 WHERE id = ?1", params![id, candidate])
                    .map_err(err)?;
            }
        }
    }
    // Directories: folder_rel_dir walks the (now settled) names.
    let ids: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM folder").map_err(err)?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for id in ids {
        let rel = workspace::folder_rel_dir(&tx, Some(&id))?;
        fs::create_dir_all(ws.join(rel)).map_err(err)?;
    }

    let notes: Vec<(String, Option<String>, String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, folder_id, title, content FROM document WHERE kind = 'note'")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    for (id, folder_id, title, content) in notes {
        let (stem, rel) = workspace::place_note(&tx, ws, folder_id.as_deref(), &title, None)?;
        fs::write(ws.join(&rel), &content).map_err(err)?;
        tx.execute(
            "UPDATE document SET title = ?2, file_path = ?3 WHERE id = ?1",
            params![id, stem, rel],
        )
        .map_err(err)?;
        if stem != title {
            // Renamed to fit the filesystem — wikilinks resolve by title, so
            // re-ingest to rebuild this note's graph labels.
            report.changed.push(id);
        }
    }

    tx.commit().map_err(err)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lattice-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn insert_note(conn: &Connection, title: &str, content: &str, folder: Option<&str>) -> String {
        let (id, ts) = (new_id(), now());
        conn.execute(
            "INSERT INTO document (id, kind, title, content, folder_id, created_at, updated_at)
             VALUES (?1, 'note', ?2, ?3, ?4, ?5, ?5)",
            params![id, title, content, folder, ts],
        )
        .unwrap();
        id
    }

    #[test]
    fn export_then_sync_roundtrip() {
        let ws = scratch("roundtrip");
        let conn = crate::db::open(&ws.join("lattice.db")).unwrap();

        let folder_id = ensure_folder(&conn, None, "Projects").unwrap();
        let roadmap = insert_note(&conn, "Roadmap", "# plan", Some(&folder_id));
        let dup = insert_note(&conn, "Roadmap", "dup", Some(&folder_id));
        let slashed = insert_note(&conn, "a/b", "slash", None);

        // database → files: tree materializes, collisions/reserved chars settle.
        let report = export_notes(&conn, &ws).unwrap();
        assert!(ws.join("notes/Projects/Roadmap.md").is_file());
        assert!(ws.join("notes/Projects/Roadmap (2).md").is_file());
        assert!(ws.join("notes/a-b.md").is_file());
        assert!(report.changed.contains(&dup) && report.changed.contains(&slashed));
        assert!(!report.changed.contains(&roadmap));

        // External edit + new note in a new dir + external delete.
        fs::write(ws.join("notes/Projects/Roadmap.md"), "# plan v2").unwrap();
        fs::create_dir(ws.join("notes/Inbox")).unwrap();
        fs::write(ws.join("notes/Inbox/Idea.md"), "spark").unwrap();
        fs::remove_file(ws.join("notes/Projects/Roadmap (2).md")).unwrap();

        let report = sync_files(&conn, &ws).unwrap();
        assert_eq!(report.changed, vec![roadmap.clone()]);
        assert_eq!(report.removed, vec![dup.clone()]);
        assert_eq!(report.added.len(), 1);
        let cached: String = conn
            .query_row("SELECT content FROM document WHERE id = ?1", [&roadmap], |r| r.get(0))
            .unwrap();
        assert_eq!(cached, "# plan v2");
        let inbox: String = conn
            .query_row("SELECT id FROM folder WHERE name = 'Inbox'", [], |r| r.get(0))
            .unwrap();
        let idea_folder: Option<String> = conn
            .query_row("SELECT folder_id FROM document WHERE id = ?1", [&report.added[0]], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(idea_folder.as_deref(), Some(inbox.as_str()));

        // Deleting a whole directory removes its notes and prunes the folder row.
        fs::remove_dir_all(ws.join("notes/Inbox")).unwrap();
        let report = sync_files(&conn, &ws).unwrap();
        assert_eq!(report.removed.len(), 1);
        let inboxes: i64 = conn
            .query_row("SELECT COUNT(*) FROM folder WHERE name = 'Inbox'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(inboxes, 0);

        fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn sync_exports_orphan_rows() {
        let ws = scratch("orphan");
        let conn = crate::db::open(&ws.join("lattice.db")).unwrap();
        let id = insert_note(&conn, "Loose", "body", None);
        sync_files(&conn, &ws).unwrap();
        assert!(ws.join("notes/Loose.md").is_file());
        let rel: Option<String> = conn
            .query_row("SELECT file_path FROM document WHERE id = ?1", [&id], |r| r.get(0))
            .unwrap();
        assert_eq!(rel.as_deref(), Some("notes/Loose.md"));
        fs::remove_dir_all(&ws).unwrap();
    }
}
