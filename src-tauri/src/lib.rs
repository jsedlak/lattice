mod commands;
mod db;
mod embedding;
mod mcp;
mod workspace;

use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use rusqlite::Connection;
use tauri::Manager;

use workspace::StorageMode;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// Workspace root: .lattice + lattice.db + files/ uploads + notes/ markdown.
    pub workspace_dir: PathBuf,
    /// App config dir: settings.json (non-secrets) + secrets fallback.
    pub config_dir: PathBuf,
    /// Platform app-data dir — the workspace used when no override is set.
    pub default_workspace_dir: PathBuf,
    /// Mutable: switching Database <-> Files happens in place, no restart.
    pub storage_mode: Mutex<StorageMode>,
    /// Machine-global (not per-workspace) dir for downloaded ML models.
    pub models_dir: PathBuf,
    /// Lazily-loaded local embedding session.
    pub embedder: Mutex<Option<embedding::Embedder>>,
    /// The MCP server, when it is listening. Holds its shutdown trigger.
    pub mcp: Mutex<Option<mcp::McpHandle>>,
    /// Keychain reads, memoized for the process lifetime (including misses).
    /// Each real read can be an OS password prompt; see commands/settings.rs.
    pub secrets: Mutex<std::collections::HashMap<String, Option<String>>>,
}

impl AppState {
    /// True when markdown files under notes/ are canonical for note content.
    pub fn files_mode(&self) -> bool {
        *self.storage_mode.lock() == StorageMode::Files
    }
}

/// macOS owns Cmd+W through the app menu: `NSMenu` matches key equivalents
/// before the event ever reaches the webview, so the editor's "close the
/// active tab" binding is unreachable while the default menu's *Close Window*
/// item exists. Tauri only installs a default menu on macOS, so this replaces
/// it with the same standard set minus that one item — the rest has to be
/// rebuilt by hand, because dropping the default would also drop the Edit menu
/// that Cmd+C/Cmd+V depend on. The window still closes via the red button,
/// Cmd+Q, or the Window menu.
#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Lattice")
        .about(Some(AboutMetadata::default()))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// Other platforms get no default menu from Tauri, so Cmd/Ctrl+W already
/// reaches the webview untouched.
#[cfg(not(target_os = "macos"))]
fn build_menu(_app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            build_menu(app.handle())?;

            let default_workspace_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            fs::create_dir_all(&config_dir)?;

            let mut workspace_dir = workspace::resolve_workspace(&config_dir, &default_workspace_dir);
            let cfg = workspace::load_or_init_config(&workspace_dir).or_else(|e| {
                eprintln!("{e}; falling back to default workspace");
                workspace_dir = default_workspace_dir.clone();
                workspace::load_or_init_config(&workspace_dir)
            })?;
            fs::create_dir_all(workspace_dir.join("files"))?;
            if cfg.storage == StorageMode::Files {
                fs::create_dir_all(workspace_dir.join("notes"))?;
            }

            let models_dir = app.path().app_local_data_dir()?.join("models");
            let conn = db::open(&workspace_dir.join("lattice.db"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                workspace_dir,
                config_dir,
                default_workspace_dir,
                storage_mode: Mutex::new(cfg.storage),
                models_dir,
                embedder: Mutex::new(None),
                mcp: Mutex::new(None),
                secrets: Mutex::new(std::collections::HashMap::new()),
            });
            // After manage(): the server resolves its config through AppState.
            mcp::start_if_enabled(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // documents & folders & files
            commands::docs::list_documents,
            commands::docs::get_document,
            commands::docs::create_note,
            commands::docs::update_document,
            commands::docs::delete_document,
            commands::docs::set_document_ingest,
            commands::docs::find_document_by_title,
            commands::docs::list_folders,
            commands::docs::create_folder,
            commands::docs::rename_folder,
            commands::docs::delete_folder,
            commands::docs::reorder_documents,
            commands::docs::reorder_folders,
            commands::docs::import_upload,
            commands::docs::read_upload_bytes,
            // graph, chunks, entities
            commands::graph::get_graph,
            commands::graph::ensure_document_node,
            commands::graph::ensure_tag_node,
            commands::graph::ensure_entity_node,
            commands::graph::replace_edges_from_node,
            commands::graph::upsert_llm_edges,
            commands::graph::find_entity_by_name,
            commands::graph::search_nodes,
            commands::graph::get_neighbors,
            commands::graph::get_subgraph,
            commands::graph::traverse,
            commands::graph::replace_chunks,
            commands::graph::cosine_search_chunks,
            commands::graph::find_similar_entity,
            commands::graph::create_entity,
            commands::graph::reset_embeddings,
            // conversations, messages, jobs
            commands::chat::list_conversations,
            commands::chat::create_conversation,
            commands::chat::rename_conversation,
            commands::chat::delete_conversation,
            commands::chat::list_messages,
            commands::chat::append_message,
            commands::chat::upsert_ingest_job,
            commands::chat::list_ingest_jobs,
            // workspace
            commands::workspace::get_workspace_info,
            commands::workspace::set_workspace_path,
            commands::workspace::restart_app,
            commands::workspace::sync_workspace,
            commands::workspace::set_storage_mode,
            commands::workspace::list_workspace_files,
            // local embedding
            commands::embedding::local_embedding_status,
            commands::embedding::download_local_embedding_model,
            commands::embedding::local_embed_texts,
            // MCP server
            commands::mcp::mcp_status,
            commands::mcp::set_mcp_config,
            commands::mcp::regenerate_mcp_token,
            commands::mcp::test_mcp_embedding,
            // settings & secrets
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::get_secret,
            commands::settings::set_secret,
            commands::settings::delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lattice");
}
