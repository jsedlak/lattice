//! SQLite layer: schema, migrations, sqlite-vec registration, small helpers.
//!
//! Schema mirrors the web app's Drizzle/Postgres schema
//! (packages/db/src/schema.ts) minus auth tables and userId columns — this is
//! a single-user local app. pgvector columns become BLOB(f32-le) plus vec0
//! virtual tables (one per embedding dimension, since the embedding model is
//! user-configurable).

use std::path::Path;

use rusqlite::{Connection, Result as SqlResult};

/// Cosine-similarity threshold above which two entities are considered the
/// same. PARITY: matches ENTITY_MERGE_THRESHOLD in packages/db/src/constants.ts.
pub const ENTITY_MERGE_THRESHOLD: f64 = 0.86;

pub fn open(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    // Register sqlite-vec on every future connection of this process.
    type SqliteInitFn = unsafe extern "C" fn(
        *mut rusqlite::ffi::sqlite3,
        *mut *mut std::os::raw::c_char,
        *const rusqlite::ffi::sqlite3_api_routines,
    ) -> std::os::raw::c_int;
    unsafe {
        let init: SqliteInitFn =
            std::mem::transmute(sqlite_vec::sqlite3_vec_init as *const ());
        rusqlite::ffi::sqlite3_auto_extension(Some(init));
    }

    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS document (
            id            TEXT PRIMARY KEY,
            kind          TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note','upload')),
            title         TEXT NOT NULL,
            content       TEXT NOT NULL DEFAULT '',
            folder_id     TEXT,
            file_path     TEXT,
            mime_type     TEXT,
            byte_size     INTEGER,
            page_count    INTEGER,
            ingest_status TEXT NOT NULL DEFAULT 'idle'
                          CHECK (ingest_status IN ('idle','queued','processing','ready','error')),
            ingest_error  TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folder (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            parent_id  TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunk (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
            ordinal     INTEGER NOT NULL,
            content     TEXT NOT NULL,
            token_count INTEGER,
            embedding   BLOB,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chunk_doc_idx ON chunk(document_id);

        CREATE TABLE IF NOT EXISTS node (
            id          TEXT PRIMARY KEY,
            type        TEXT NOT NULL CHECK (type IN ('document','tag','entity')),
            label       TEXT NOT NULL,
            document_id TEXT REFERENCES document(id) ON DELETE CASCADE,
            entity_id   TEXT,
            meta        TEXT,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS node_type_idx ON node(type);
        CREATE INDEX IF NOT EXISTS node_document_idx ON node(document_id);

        CREATE TABLE IF NOT EXISTS edge (
            id         TEXT PRIMARY KEY,
            source_id  TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
            target_id  TEXT NOT NULL REFERENCES node(id) ON DELETE CASCADE,
            relation   TEXT NOT NULL CHECK (relation IN ('wikilink','tag','mentions','related')),
            origin     TEXT NOT NULL CHECK (origin IN ('deterministic','llm')),
            label      TEXT,
            weight     INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS edge_source_idx ON edge(source_id);
        CREATE INDEX IF NOT EXISTS edge_target_idx ON edge(target_id);

        CREATE TABLE IF NOT EXISTS entity (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            entity_type TEXT,
            description TEXT,
            embedding   BLOB,
            created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation (
            id         TEXT PRIMARY KEY,
            title      TEXT NOT NULL DEFAULT 'New conversation',
            model      TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS message (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
            role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
            content         TEXT NOT NULL,
            citations       TEXT,
            created_at      TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS message_conversation_idx ON message(conversation_id);

        CREATE TABLE IF NOT EXISTS ingest_job (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL UNIQUE REFERENCES document(id) ON DELETE CASCADE,
            status      TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','processing','ready','error')),
            step        TEXT,
            error       TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        "#,
    )
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn f32s_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

/// Ensure the vec0 KNN table for a given dimension exists. One table per
/// dimension because the embedding model (and thus dim) is user-configurable.
pub fn ensure_vec_table(conn: &Connection, base: &str, dim: usize) -> SqlResult<()> {
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {base}_{dim} USING vec0(
            item_id TEXT PRIMARY KEY,
            embedding FLOAT[{dim}] distance_metric=cosine
        );"
    ))
}

/// Names of all existing vec tables with the given base prefix.
pub fn existing_vec_tables(conn: &Connection, base: &str) -> SqlResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?1 || '_%'
         AND name NOT LIKE '%\\_chunks' ESCAPE '\\'",
    )?;
    let names = stmt
        .query_map([base], |r| r.get::<_, String>(0))?
        .collect::<SqlResult<Vec<_>>>()?;
    // vec0 creates shadow tables (name_chunks, name_rowids, …); keep only the
    // virtual tables themselves: base_{digits}.
    Ok(names
        .into_iter()
        .filter(|n| {
            n.strip_prefix(&format!("{base}_"))
                .map(|suffix| !suffix.is_empty() && suffix.bytes().all(|b| b.is_ascii_digit()))
                .unwrap_or(false)
        })
        .collect())
}
