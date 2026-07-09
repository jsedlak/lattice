//! Local embedding commands: model status/download and on-device inference.

use serde::Serialize;
use tauri::{Emitter, Manager};

use super::{err, CmdResult};
use crate::embedding;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEmbeddingInfo {
    pub ready: bool,
    pub model: String,
    pub dimensions: usize,
}

#[tauri::command]
pub fn local_embedding_status(state: tauri::State<AppState>) -> CmdResult<LocalEmbeddingInfo> {
    Ok(LocalEmbeddingInfo {
        ready: embedding::model_present(&state.models_dir),
        model: embedding::LOCAL_EMBEDDING_MODEL.into(),
        dimensions: embedding::LOCAL_EMBEDDING_DIM,
    })
}

/// Downloads the model files (idempotent), emitting `local-embedding-progress`
/// events, then loads the session and runs a smoke embedding so "Ok" really
/// means the local pipeline works end to end.
#[tauri::command]
pub async fn download_local_embedding_model(app: tauri::AppHandle) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        embedding::download_model(&state.models_dir, |p| {
            let _ = app.emit(embedding::PROGRESS_EVENT, p);
        })?;
        let mut embedder = embedding::load(&state.models_dir)?;
        let smoke = embedder
            .embed(vec!["lattice"], None)
            .map_err(|e| format!("embedding test failed: {e}"))?;
        if smoke.first().map(Vec::len) != Some(embedding::LOCAL_EMBEDDING_DIM) {
            return Err("embedding test returned unexpected dimensions".into());
        }
        *state.embedder.lock() = Some(embedder);
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Embeds texts on-device. Loads the session lazily on first call.
#[tauri::command]
pub async fn local_embed_texts(
    app: tauri::AppHandle,
    texts: Vec<String>,
) -> CmdResult<Vec<Vec<f32>>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.embedder.lock();
        if guard.is_none() {
            *guard = Some(embedding::load(&state.models_dir)?);
        }
        let embedder = guard.as_mut().expect("just initialized");
        embedder.embed(texts, Some(32)).map_err(|e| e.to_string())
    })
    .await
    .map_err(err)?
}
