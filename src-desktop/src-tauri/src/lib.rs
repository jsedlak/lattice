mod commands;
mod db;

use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use rusqlite::Connection;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<Connection>,
    /// App data dir: lattice.db + files/{docId}/{filename} uploads.
    pub data_dir: PathBuf,
    /// App config dir: settings.json (non-secrets) + secrets fallback.
    pub config_dir: PathBuf,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;
            fs::create_dir_all(data_dir.join("files"))?;
            fs::create_dir_all(&config_dir)?;

            let conn = db::open(&data_dir.join("lattice.db"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                data_dir,
                config_dir,
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
