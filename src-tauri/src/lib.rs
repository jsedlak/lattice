mod commands;
mod db;
mod embedding;
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
    pub embedder: Mutex<Option<fastembed::TextEmbedding>>,
}

impl AppState {
    /// True when markdown files under notes/ are canonical for note content.
    pub fn files_mode(&self) -> bool {
        *self.storage_mode.lock() == StorageMode::Files
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            });
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
            // local embedding
            commands::embedding::local_embedding_status,
            commands::embedding::download_local_embedding_model,
            commands::embedding::local_embed_texts,
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
