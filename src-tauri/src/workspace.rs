//! Workspace resolution and per-workspace config (.lattice).
//!
//! A workspace is a directory holding `.lattice` (JSON config), `lattice.db`,
//! `files/` (uploads), and `notes/` (markdown tree in files mode). The
//! platform app-data dir is the default workspace; a `workspacePath` key in
//! the global settings.json overrides it.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const LATTICE_FILE: &str = ".lattice";
const LATTICE_VERSION: u32 = 1;

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageMode {
    /// Note content is canonical in the SQLite content column.
    Database,
    /// Markdown files under notes/ are canonical; the db caches content.
    Files,
}

#[derive(Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub version: u32,
    pub storage: StorageMode,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self { version: LATTICE_VERSION, storage: StorageMode::Database }
    }
}

/// The workspace directory to open: the `workspacePath` override from the
/// global settings.json when present and usable, the default dir otherwise.
pub fn resolve_workspace(config_dir: &Path, default_dir: &Path) -> PathBuf {
    let overridden = fs::read_to_string(config_dir.join("settings.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("workspacePath").and_then(|p| p.as_str()).map(PathBuf::from));
    match overridden {
        Some(dir) => {
            if fs::create_dir_all(&dir).is_ok() {
                dir
            } else {
                eprintln!("workspacePath {} unusable; falling back to default", dir.display());
                default_dir.to_path_buf()
            }
        }
        None => default_dir.to_path_buf(),
    }
}

/// Reads `{root}/.lattice`, creating it (database mode) if missing.
/// Errors on unreadable/unparseable config or a version from the future —
/// the caller falls back to the default workspace rather than guessing.
pub fn load_or_init_config(root: &Path) -> Result<WorkspaceConfig, String> {
    let path = root.join(LATTICE_FILE);
    if !path.exists() {
        let cfg = WorkspaceConfig::default();
        save_config(root, &cfg)?;
        return Ok(cfg);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: WorkspaceConfig = serde_json::from_str(&raw)
        .map_err(|e| format!("invalid {}: {e}", path.display()))?;
    if cfg.version > LATTICE_VERSION {
        return Err(format!(
            "workspace at {} requires a newer Lattice (version {})",
            root.display(),
            cfg.version
        ));
    }
    Ok(cfg)
}

pub fn save_config(root: &Path, cfg: &WorkspaceConfig) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(root.join(LATTICE_FILE), pretty).map_err(|e| e.to_string())
}

// ── Files-mode path helpers ──────────────────────────────────────────────────
//
// In files mode a note's title IS its filename stem and a folder's name IS its
// directory name, so both get sanitized to what every OS accepts and deduped
// (case-insensitively — macOS/Windows filesystems) within their directory.

/// A title reduced to a usable filename stem.
pub fn sanitize_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned: String = cleaned.chars().take(120).collect();
    // Leading dots hide files; trailing dots/spaces are invalid on Windows.
    let cleaned = cleaned.trim_start_matches('.').trim_end_matches(['.', ' ']);
    if cleaned.is_empty() {
        "Untitled".into()
    } else {
        cleaned.to_string()
    }
}

/// `want`, or `want (2)`, `want (3)`, … — whichever doesn't collide with an
/// existing entry in `dir`. `md_files` selects what counts as taken: `.md`
/// stems (notes) or subdirectory names (folders). `ignore` exempts the
/// caller's own current path so renames (including case-only ones) don't
/// collide with themselves.
pub fn unique_name(dir: &Path, want: &str, md_files: bool, ignore: Option<&Path>) -> String {
    let ignore_lower = ignore.map(|p| p.to_string_lossy().to_lowercase());
    let taken: HashSet<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| {
                let path = e.ok()?.path();
                if let Some(ref ig) = ignore_lower {
                    if path.to_string_lossy().to_lowercase() == *ig {
                        return None;
                    }
                }
                let stem = if md_files {
                    if !path.extension()?.to_str()?.eq_ignore_ascii_case("md") {
                        return None;
                    }
                    path.file_stem()?.to_str()?.to_lowercase()
                } else {
                    if !path.is_dir() {
                        return None;
                    }
                    path.file_name()?.to_str()?.to_lowercase()
                };
                Some(stem)
            })
            .collect()
        })
        .unwrap_or_default();

    if !taken.contains(&want.to_lowercase()) {
        return want.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{want} ({n})");
        if !taken.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        n += 1;
    }
}

/// Workspace-relative directory of a folder: `notes/<ancestors…>/<folder>`
/// (`notes` itself for the root). Guards against parent cycles.
pub fn folder_rel_dir(conn: &Connection, folder_id: Option<&str>) -> Result<PathBuf, String> {
    let mut parts: Vec<String> = Vec::new();
    let mut cursor = folder_id.map(str::to_string);
    let mut seen = HashSet::new();
    while let Some(id) = cursor {
        if !seen.insert(id.clone()) {
            return Err("folder hierarchy contains a cycle".into());
        }
        let (name, parent): (String, Option<String>) = conn
            .query_row("SELECT name, parent_id FROM folder WHERE id = ?1", [&id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(|e| e.to_string())?;
        parts.push(sanitize_stem(&name));
        cursor = parent;
    }
    let mut dir = PathBuf::from("notes");
    dir.extend(parts.iter().rev());
    Ok(dir)
}

/// Where a note titled `title` in `folder_id` lives: creates the directory,
/// dedupes the stem, and returns `(stem, workspace-relative path)`. The rel
/// path always uses forward slashes (portable, matches uploads' files/…).
pub fn place_note(
    conn: &Connection,
    workspace_dir: &Path,
    folder_id: Option<&str>,
    title: &str,
    ignore: Option<&Path>,
) -> Result<(String, String), String> {
    let rel_dir = folder_rel_dir(conn, folder_id)?;
    let abs_dir = workspace_dir.join(&rel_dir);
    fs::create_dir_all(&abs_dir).map_err(|e| e.to_string())?;
    let stem = unique_name(&abs_dir, &sanitize_stem(title), true, ignore);
    let rel = rel_dir.join(format!("{stem}.md"));
    Ok((stem, rel_to_string(&rel)))
}

/// Path → workspace-relative string with forward slashes.
pub fn rel_to_string(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}

/// Rewrites descendants' file_path prefixes after a folder rename/move.
pub fn rewrite_path_prefix(conn: &Connection, old_rel: &str, new_rel: &str) -> Result<(), String> {
    let like = format!(
        "{}/%",
        old_rel.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    );
    conn.execute(
        "UPDATE document SET file_path = ?2 || substr(file_path, length(?1) + 1)
         WHERE file_path LIKE ?3 ESCAPE '\\'",
        rusqlite::params![old_rel, new_rel, like],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_reserved_and_trims() {
        assert_eq!(sanitize_stem("a/b: c?"), "a-b- c-");
        assert_eq!(sanitize_stem("  spaced   out  "), "spaced out");
        assert_eq!(sanitize_stem("...hidden"), "hidden");
        assert_eq!(sanitize_stem("trailing dots..."), "trailing dots");
        assert_eq!(sanitize_stem(""), "Untitled");
        assert_eq!(sanitize_stem("///"), "---");
        assert_eq!(sanitize_stem(" . "), "Untitled");
        assert_eq!(sanitize_stem(&"x".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn unique_name_dedupes_case_insensitively_and_honors_ignore() {
        let dir = std::env::temp_dir().join(format!("lattice-test-unique-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Foo.md"), "x").unwrap();
        fs::write(dir.join("foo (2).md"), "x").unwrap();
        fs::create_dir(dir.join("Sub")).unwrap();

        assert_eq!(unique_name(&dir, "Bar", true, None), "Bar");
        assert_eq!(unique_name(&dir, "foo", true, None), "foo (3)");
        // A note renaming only its own case isn't a collision with itself.
        assert_eq!(unique_name(&dir, "FOO", true, Some(&dir.join("Foo.md"))), "FOO");
        // Directory dedupe ignores the .md files and vice versa.
        assert_eq!(unique_name(&dir, "sub", false, None), "sub (2)");
        assert_eq!(unique_name(&dir, "Sub", true, None), "Sub");

        fs::remove_dir_all(&dir).unwrap();
    }
}
