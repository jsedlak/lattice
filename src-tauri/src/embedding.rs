//! Built-in local embedding: all-MiniLM-L6-v2, quantized ONNX, 384 dims.
//!
//! The model is downloaded once (~24 MB from Hugging Face) into the app-local
//! models dir with progress events for the UI, then runs fully on-device via
//! fastembed/onnxruntime. No API key, nothing leaves the machine.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use serde::Serialize;

pub const LOCAL_EMBEDDING_MODEL: &str = "all-MiniLM-L6-v2";
pub const LOCAL_EMBEDDING_DIM: usize = 384;
pub const PROGRESS_EVENT: &str = "local-embedding-progress";

const HF_BASE: &str = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";
/// (remote path, local filename)
const FILES: &[(&str, &str)] = &[
    ("onnx/model_quantized.onnx", "model_quantized.onnx"),
    ("tokenizer.json", "tokenizer.json"),
    ("config.json", "config.json"),
    ("special_tokens_map.json", "special_tokens_map.json"),
    ("tokenizer_config.json", "tokenizer_config.json"),
];

fn model_dir(models_dir: &Path) -> PathBuf {
    models_dir.join("all-minilm-l6-v2")
}

pub fn model_present(models_dir: &Path) -> bool {
    let dir = model_dir(models_dir);
    FILES.iter().all(|(_, local)| dir.join(local).is_file())
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    /// 0 when the server didn't report sizes (indeterminate).
    pub total: u64,
}

/// Downloads any missing model files, reporting progress via the callback.
/// Idempotent: present files are skipped; partial files never land (tmp+rename).
pub fn download_model(
    models_dir: &Path,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<(), String> {
    let dir = model_dir(models_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let net = |e: ureq::Error| format!("download failed: {e}");

    let missing: Vec<&(&str, &str)> =
        FILES.iter().filter(|(_, local)| !dir.join(local).is_file()).collect();

    // The total grows as each GET starts (HEAD sizes are unreliable through
    // HF's redirect chain). The dominant onnx file is first in FILES, so the
    // denominator is ~final from the first progress event.
    let mut total: u64 = 0;
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();
    for (remote, local) in &missing {
        let tmp = dir.join(format!("{local}.part"));
        let mut resp = ureq::get(format!("{HF_BASE}/{remote}")).call().map_err(net)?;
        total += resp
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let mut reader = resp.body_mut().as_reader();
        let mut out = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            downloaded += n as u64;
            if last_emit.elapsed() > Duration::from_millis(150) {
                last_emit = Instant::now();
                on_progress(DownloadProgress { downloaded, total });
            }
        }
        out.flush().map_err(|e| e.to_string())?;
        drop(out);
        fs::rename(&tmp, dir.join(local)).map_err(|e| e.to_string())?;
    }
    on_progress(DownloadProgress { downloaded: total.max(downloaded), total });
    Ok(())
}

/// Loads the on-disk model into an inference session (a few hundred ms).
pub fn load(models_dir: &Path) -> Result<TextEmbedding, String> {
    let dir = model_dir(models_dir);
    let read = |name: &str| fs::read(dir.join(name)).map_err(|e| format!("read {name}: {e}"));
    let tokenizer_files = TokenizerFiles {
        tokenizer_file: read("tokenizer.json")?,
        config_file: read("config.json")?,
        special_tokens_map_file: read("special_tokens_map.json")?,
        tokenizer_config_file: read("tokenizer_config.json")?,
    };
    // Same pooling/quantization fastembed uses for its AllMiniLML6V2Q preset.
    let model = UserDefinedEmbeddingModel::new(read("model_quantized.onnx")?, tokenizer_files)
        .with_pooling(Pooling::Mean)
        .with_quantization(QuantizationMode::Dynamic);
    TextEmbedding::try_new_from_user_defined(model, InitOptionsUserDefined::default())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real download (~24 MB) + inference — network-dependent, so ignored by
    /// default. Run with: cargo test embedding -- --ignored
    #[test]
    #[ignore]
    fn download_load_embed_roundtrip() {
        let dir = std::env::temp_dir().join("lattice-test-embedding");
        let _ = fs::remove_dir_all(&dir);
        let mut last = DownloadProgress { downloaded: 0, total: 0 };
        download_model(&dir, |p| {
            assert!(p.downloaded >= last.downloaded, "progress went backwards");
            last = p;
        })
        .unwrap();
        assert!(model_present(&dir));
        // The onnx model alone is >20 MB; a tiny final count means we streamed
        // a redirect page instead of the real files.
        assert!(last.downloaded > 20_000_000, "downloaded only {} bytes", last.downloaded);

        let mut embedder = load(&dir).unwrap();
        let out = embedder
            .embed(vec!["knowledge graph", "second brain"], None)
            .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].len(), LOCAL_EMBEDDING_DIM);
        // Mean-pooled + normalized: unit-ish length.
        let norm: f32 = out[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.05, "norm was {norm}");
        // Distinct inputs should not be identical vectors.
        assert_ne!(out[0], out[1]);
    }
}
