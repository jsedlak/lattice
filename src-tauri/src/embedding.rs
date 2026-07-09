//! Built-in local embedding: all-MiniLM-L6-v2 via candle, 384 dims.
//!
//! Pure Rust on purpose: prebuilt onnxruntime binaries broke the release
//! matrix (glibc 2.38+ on Linux, no x86_64-apple-darwin build), so inference
//! runs on candle's BERT, compiled from source for every target. The model
//! (~90 MB safetensors from Hugging Face) is downloaded once into the
//! app-local models dir with progress callbacks for the UI, then everything
//! runs on-device. No API key, nothing leaves the machine.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use serde::Serialize;
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

pub const LOCAL_EMBEDDING_MODEL: &str = "all-MiniLM-L6-v2";
pub const LOCAL_EMBEDDING_DIM: usize = 384;
pub const PROGRESS_EVENT: &str = "local-embedding-progress";

const BATCH_SIZE: usize = 16;
const MAX_TOKENS: usize = 512;

const HF_BASE: &str = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main";
/// (remote path, local filename)
const FILES: &[(&str, &str)] = &[
    ("model.safetensors", "model.safetensors"),
    ("tokenizer.json", "tokenizer.json"),
    ("config.json", "config.json"),
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
    // HF's redirect chain). The dominant safetensors file is first in FILES,
    // so the denominator is ~final from the first progress event.
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

/// A loaded MiniLM session: BERT forward pass + masked mean pooling +
/// L2 normalization (the sentence-transformers recipe for this model).
pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

/// Loads the on-disk model into an inference session (mmap, sub-second).
pub fn load(models_dir: &Path) -> Result<Embedder, String> {
    let dir = model_dir(models_dir);
    let config: Config = serde_json::from_str(
        &fs::read_to_string(dir.join("config.json")).map_err(|e| format!("read config: {e}"))?,
    )
    .map_err(|e| format!("parse config: {e}"))?;

    let device = Device::Cpu;
    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&[dir.join("model.safetensors")], DTYPE, &device)
    }
    .map_err(|e| format!("load weights: {e}"))?;
    let model = BertModel::load(vb, &config).map_err(|e| format!("build model: {e}"))?;

    let mut tokenizer =
        Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|e| e.to_string())?;
    tokenizer.with_padding(Some(PaddingParams::default())); // pad to longest in batch
    tokenizer
        .with_truncation(Some(TruncationParams { max_length: MAX_TOKENS, ..Default::default() }))
        .map_err(|e| e.to_string())?;

    Ok(Embedder { model, tokenizer, device })
}

impl Embedder {
    pub fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let mut out = Vec::with_capacity(texts.len());
        for batch in texts.chunks(BATCH_SIZE) {
            out.extend(self.embed_batch(batch)?);
        }
        Ok(out)
    }

    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let e = |e: candle_core::Error| e.to_string();
        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| e.to_string())?;

        let ids: Vec<Vec<u32>> = encodings.iter().map(|x| x.get_ids().to_vec()).collect();
        let mask: Vec<Vec<u32>> =
            encodings.iter().map(|x| x.get_attention_mask().to_vec()).collect();
        let input_ids = Tensor::new(ids, &self.device).map_err(e)?;
        let attention_mask = Tensor::new(mask, &self.device).map_err(e)?;
        let token_type_ids = input_ids.zeros_like().map_err(e)?;

        // (batch, seq, hidden)
        let hidden = self
            .model
            .forward(&input_ids, &token_type_ids, Some(&attention_mask))
            .map_err(e)?;

        // Mean over real tokens only, then L2-normalize.
        let mask_f = attention_mask.to_dtype(DType::F32).map_err(e)?.unsqueeze(2).map_err(e)?;
        let summed = hidden.broadcast_mul(&mask_f).map_err(e)?.sum(1).map_err(e)?;
        let counts = mask_f.sum(1).map_err(e)?;
        let mean = summed.broadcast_div(&counts).map_err(e)?;
        let norm = mean.sqr().map_err(e)?.sum_keepdim(1).map_err(e)?.sqrt().map_err(e)?;
        let normalized = mean.broadcast_div(&norm).map_err(e)?;
        normalized.to_vec2::<f32>().map_err(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real download (~91 MB) + inference — network-dependent, so ignored by
    /// default. Run with: cargo test --lib embedding -- --ignored
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
        // The safetensors file alone is ~90 MB; a tiny final count means we
        // streamed a redirect page instead of the real files.
        assert!(last.downloaded > 80_000_000, "downloaded only {} bytes", last.downloaded);

        let embedder = load(&dir).unwrap();
        let out = embedder
            .embed(&["knowledge graph".to_string(), "second brain".to_string()])
            .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].len(), LOCAL_EMBEDDING_DIM);
        // Mean-pooled + normalized: unit-ish length.
        let norm: f32 = out[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.05, "norm was {norm}");
        // Paraphrases must land close; an unrelated sentence must not.
        let probe = embedder
            .embed(&[
                "The cat sits on the mat".to_string(),
                "A cat is sitting on a mat".to_string(),
                "Quarterly revenue exceeded projections in Europe".to_string(),
            ])
            .unwrap();
        let cos = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>();
        let near = cos(&probe[0], &probe[1]);
        let far = cos(&probe[0], &probe[2]);
        assert!(near > 0.7, "paraphrase cosine only {near}");
        assert!(far < near - 0.3, "unrelated cosine {far} too close to paraphrase {near}");
    }
}
