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

// ── Remote embedding ─────────────────────────────────────────────────────────
//
// The architectural rule is "Rust persists, TypeScript orchestrates", with the
// corollary that Rust never calls a model. Embedding is the deliberate
// exception, narrowed to: **Rust owns text→vector, TypeScript owns text→text.**
// Rust already owned that responsibility for the on-device model above; the MCP
// server needs to embed a search query with no webview in the loop, and routing
// it back through the frontend would fail whenever no window is open.

/// An embedding endpoint as configured in settings.json (`embedding` key).
pub struct RemoteConfig {
    pub kind: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

impl RemoteConfig {
    fn resolved_base(&self) -> Result<&str, String> {
        match self.kind.as_str() {
            "openai" => Ok("https://api.openai.com/v1"),
            "anthropic" => Ok("https://api.anthropic.com/v1"),
            // The Gateway's OpenAI-compatible surface. The TS path uses
            // @ai-sdk/gateway's own protocol instead, so this URL is the one
            // piece here not already exercised by the app — Settings → MCP has
            // a Test button that round-trips it.
            "gateway" => Ok("https://ai-gateway.vercel.sh/v1"),
            "openai-compatible" => self
                .base_url
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "openai-compatible embedding endpoint has no base URL".to_string()),
            other => Err(format!("unsupported embedding endpoint kind: {other}")),
        }
    }
}

/// Embeds texts through an OpenAI-compatible `/embeddings` endpoint.
/// Blocking (ureq) — call it from a blocking context.
pub fn embed_remote(config: &RemoteConfig, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let url = format!("{}/embeddings", config.resolved_base()?.trim_end_matches('/'));
    let body = serde_json::json!({ "model": config.model, "input": texts });

    // Serialized by hand rather than via send_json: ureq's json support is
    // behind a feature this crate doesn't enable, and the body is trivial.
    let payload = serde_json::to_string(&body).map_err(|e| e.to_string())?;
    let mut req = ureq::post(&url).header("content-type", "application/json");
    if let Some(key) = config.api_key.as_deref().filter(|k| !k.is_empty()) {
        req = req.header("authorization", &format!("Bearer {key}"));
    }

    let mut resp = req.send(payload.as_str()).map_err(|e| match e {
        ureq::Error::StatusCode(code) => format!(
            "embedding endpoint returned HTTP {code} ({url}) — check the model name and API key"
        ),
        other => format!("embedding request failed: {other}"),
    })?;
    let mut raw = String::new();
    resp.body_mut()
        .as_reader()
        .read_to_string(&mut raw)
        .map_err(|e| format!("could not read embedding response: {e}"))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("embedding response was not JSON: {e}"))?;

    let data = parsed
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| match parsed.get("error") {
            Some(e) => format!("embedding endpoint error: {e}"),
            None => "embedding response had no data array".to_string(),
        })?;

    // Sort by the reported index: the spec allows out-of-order data.
    let mut rows: Vec<(usize, Vec<f32>)> = data
        .iter()
        .enumerate()
        .map(|(fallback, item)| {
            let index = item.get("index").and_then(|i| i.as_u64()).map_or(fallback, |i| i as usize);
            let vector = item
                .get("embedding")
                .and_then(|e| e.as_array())
                .ok_or_else(|| "embedding item had no vector".to_string())?
                .iter()
                .map(|v| v.as_f64().map(|f| f as f32).ok_or_else(|| "non-numeric embedding value".to_string()))
                .collect::<Result<Vec<f32>, String>>()?;
            Ok((index, vector))
        })
        .collect::<Result<Vec<_>, String>>()?;
    rows.sort_by_key(|(i, _)| *i);

    if rows.len() != texts.len() {
        return Err(format!("expected {} embeddings, got {}", texts.len(), rows.len()));
    }
    Ok(rows.into_iter().map(|(_, v)| v).collect())
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
