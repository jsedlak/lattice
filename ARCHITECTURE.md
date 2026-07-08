# Lattice Architecture

Lattice is a single-user, local-first knowledge app built on **Tauri v2**. Two
layers with a sharp boundary:

- A **Rust core** (`src-tauri/`) that owns everything durable: the SQLite
  database (with `sqlite-vec` for vector search), the workspace filesystem
  (uploads, markdown notes), the `.lattice` workspace config, and the OS
  keychain.
- A **React webview** (`src/`) that owns everything interactive and
  model-facing: the UI, the ingest pipeline, AI provider calls, and graph
  construction logic.

```
┌────────────────────────── webview (React/TS) ──────────────────────────┐
│  screens: Dashboard · Editor · Graph · Assistant · Settings            │
│  lib/ingest  parse → chunk → graph → embed → extract → resolve         │
│  lib/ai      provider factory · chat transport · tools · citations     │
│  lib/ipc.ts  typed client — ALL data access goes through here          │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ Tauri invoke (IPC)
┌──────────────────────────────┴─────────────────────────────────────────┐
│  src-tauri/src/commands/  docs · graph · chat · settings · workspace   │
│  src-tauri/src/db.rs      schema, migrations, vec0 tables              │
│  src-tauri/src/workspace.rs  .lattice, path helpers, sanitization      │
└──────────────┬───────────────────────────┬─────────────────────────────┘
        SQLite (lattice.db)         workspace filesystem
        WAL, sqlite-vec             files/ (uploads) · notes/ (markdown)
```

The split rule: **Rust persists, TypeScript orchestrates.** The webview never
touches the filesystem or database directly; the Rust core never calls an LLM.

## IPC surface

Every command in `src-tauri/src/commands/` is the desktop analogue of a web
API route. `src/lib/ipc.ts` is the single typed client — command names are
snake_case Rust, argument keys camelCase (Tauri maps them). Errors cross the
boundary as strings (`CmdResult<T> = Result<T, String>`).

| Module | Owns |
|---|---|
| `docs.rs` | documents, folders, uploads, files-mode write-through |
| `graph.rs` | nodes, edges, entities, chunks, vector search |
| `chat.rs` | conversations, messages, ingest jobs |
| `settings.rs` | settings.json (merge-write), keychain secrets |
| `workspace.rs` | workspace info/switching, files-mode sync, storage-mode migration |

## Data model

Defined in `src-tauri/src/db.rs` (idempotent `CREATE TABLE IF NOT EXISTS`
migrations, WAL mode, foreign keys on).

- `document` — notes and uploads. `kind: note|upload`, markdown/extracted
  `content`, `folder_id`, `file_path` (workspace-relative: `files/…` for
  uploads, `notes/….md` for files-mode notes), ingest status, manual
  `sort_order`.
- `folder` — tree via `parent_id`, manual `sort_order`.
- `chunk` — per-document text chunks with token counts and embedding BLOBs
  (f32 little-endian).
- `node` / `edge` — the graph. Node types: `document`, `tag`, `entity`.
  Edge relations: `wikilink`, `tag` (origin `deterministic`) and `mentions`,
  `related` (origin `llm`). Deleting a document cascades to its chunks, nodes,
  and edges.
- `entity` — extracted concepts/people/places with an embedding used for
  dedup.
- `conversation` / `message` — assistant history, messages carry citation
  JSON.
- `ingest_job` — one per document; lets pending work resume after a relaunch.

### Vector search

Embedding BLOBs live on `chunk`/`entity` rows; KNN goes through `vec0`
virtual tables (`vec_chunks_{dim}`, `vec_entities_{dim}`), **one per embedding
dimension** because the embedding model is user-configurable. Cosine distance,
converted to similarity in SQL. Changing the embedding model invalidates all
vectors: the UI offers a full re-embed (`reset_embeddings` + reingest).

Entity resolution: a new entity's embedding is KNN-matched against
`vec_entities_{dim}`; a hit above `ENTITY_MERGE_THRESHOLD` (0.86, parity with
the web app) merges instead of creating a duplicate.

## Workspaces

A workspace is a directory:

```
<workspace>/
  .lattice        { "version": 1, "storage": "database" | "files" }
  lattice.db      SQLite (+ -wal/-shm)
  files/          uploads, files/{docId}/{filename}
  notes/          markdown tree — canonical in files mode
```

Resolution at startup (`lib.rs` setup → `workspace::resolve_workspace`):

1. Read `workspacePath` from the **global** `settings.json` in the platform
   config dir. If present and usable, that's the workspace; otherwise the
   platform app-data dir (the *default workspace*).
2. `load_or_init_config` reads `.lattice`, seeding `{storage: "database"}` if
   missing — which is also the entire back-compat story for pre-workspace
   installs. A `.lattice` from a newer version falls back to the default
   workspace rather than guessing.
3. Open `lattice.db`, stash `AppState { db, workspace_dir, config_dir,
   default_workspace_dir, storage_mode }`.

Switching workspaces writes `workspacePath` (or removes it) and restarts the
app — the DB connection lives in managed state, so a restart is the honest
lifecycle. `get_workspace_info` reports both the running workspace and the
recorded override so the UI can show a pending switch.

Global vs per-workspace config: AI endpoints, editor choice, and
`workspacePath` are global (`settings.json`, shallow **merge-written** so the
frontend's settings shape can't clobber Rust-owned keys); `.lattice` holds only
what belongs to the data itself — currently the storage mode. API keys go in
the OS keychain (Secret Service / macOS Keychain / Windows Credential
Manager), with a 0600 `secrets.json` fallback when no keychain exists.

## Note storage modes

Each workspace stores note content in one of two modes (`.lattice`,
switchable in Settings with in-place migration):

**Database** — `document.content` is canonical. Today's default; nothing
touches `notes/`.

**Files** — markdown files under `notes/` are canonical, and **path is
identity** (no frontmatter, no sidecar metadata). Invariants:

- A note's title **is** its filename stem; a folder's name **is** its
  directory name. Both are sanitized (reserved characters, length, Windows
  edge cases) and deduped case-insensitively with ` (2)` suffixes
  (`workspace.rs: sanitize_stem / unique_name / place_note`).
- The db `content` column remains as a **cache** serving lists and search;
  it is refreshed by writes and by sync, never by reads.

Canonical-on-disk is enforced at exactly three points:

1. **Writes go disk-first.** Create/edit/rename/move/delete of notes and
   folders (including tree drags, which arrive via `reorder_documents` /
   `reorder_folders`) perform the filesystem operation before the row update;
   an fs error leaves the db untouched. Folder renames/moves rewrite
   descendants' `file_path` prefixes in one UPDATE.
2. **`get_document` reads the file.** The editor and the ingest pipeline
   always see disk content. It deliberately does *not* write back to the
   cache — a stale cache is how sync detects external edits.
3. **`sync_workspace` reconciles disk → db** at launch (and around mode
   switches): directories become folder rows, new `.md` files become
   documents, changed files refresh the cache and re-ingest, missing files
   delete their rows (cascades clean the graph), vanished-and-empty folder
   rows are pruned leaf-first. Returns `{added, changed, removed}`; the
   frontend queues ingest for added + changed.

Consequences accepted by design: an external rename is a delete + new note
(re-ingest rebuilds graph and embeddings); edits made while the app is running
surface on next launch (no file watcher in v1); duplicate titles mean a
`[[wikilink]]` resolves to the first case-insensitive title match.

Mode switching (`set_storage_mode`): database→files materializes the folder
tree and writes every note (sanitize/dedupe may retitle; retitled notes are
reported for re-ingest since wikilinks resolve by title). files→database runs
a sync first, then nulls note `file_path`s — `notes/` stays on disk as a
stale export; Lattice never deletes user markdown wholesale.

## Ingest pipeline

`src/lib/ingest/pipeline.ts` — the desktop replacement for the web app's
Inngest jobs. Runs in the webview because the steps are proven TS logic;
persistence is Rust.

```
parse (uploads: pdf/docx/xlsx → text)
  → chunk (token-aware)
  → build deterministic graph (wikilinks, tags)
  → embed chunks → persist vectors (replace_chunks, atomic per document)
  → LLM extraction (entities + relationships, structured output)
  → resolve entities (embedding similarity ≥ 0.86 merges)
```

Operational behavior: per-document 5s debounce (coalesces autosaves), 3
attempts with backoff, job state persisted via `ingest_job` rows so
`resumePendingIngest()` picks up queued/processing work at launch. LLM and
embedding steps degrade gracefully when no provider is configured — content,
deterministic graph, and job state still land.

Triggers: editor autosave (700ms debounce → save → `enqueueIngest`), upload
import, boot-time workspace sync, and "re-embed everything" after an
embedding-model change.

## Assistant

`src/lib/ai/transport.ts` implements a local chat transport for the AI SDK:
`streamText` runs in-page against the configured provider, tool calls hit the
graph through `graphTools()` (`semanticSearch`, `searchNodes`, `getNeighbors`,
`traverse` — names and schemas kept verbatim from the web app so prompt
behavior matches), messages persist through `chat.rs`, and citations
(document/chunk/node references) are attached to the stored assistant message
and rendered as links back into the editor/graph.

Provider HTTP goes through `tauri-plugin-http`'s fetch (Rust reqwest under the
hood), so calls are CORS-free and work against any local or remote endpoint.

## Frontend structure

- `src/screens/` — one component per route: Dashboard, Editor, Graph,
  Assistant, Settings (tabbed General | AI).
- `src/components/editor/` — document tree (drag-reorder, context menus),
  Monaco/CodeMirror markdown editors (user-selectable), upload handling.
- `src/components/graph/` — Cytoscape (fcose layout) graph canvas.
- `src/lib/ai/settings.ts` — cached settings/keys loader; `EndpointConfig`
  per role (chat, embedding), each pointing at gateway / OpenAI / Anthropic /
  any OpenAI-compatible base URL.
- Parity-critical copies from the web app (keep semantically identical, look
  for `COPIED VERBATIM` / `PARITY` headers): `parse.ts`, `chunk.ts`,
  `ai/prompts.ts`, `ai/extraction-schema.ts`, `ai/citations.ts`, `tokens.ts`.

## Build & release

- `pnpm tauri dev` — vite + cargo, watching both layers.
- `cargo test --no-default-features` (in `src-tauri/`) — Rust unit tests,
  including the files-mode export/sync roundtrip against a scratch workspace.
- `./scripts/release.sh X.Y.Z` — bumps `tauri.conf.json`, `package.json`,
  `Cargo.toml`/lock; commits, tags `vX.Y.Z`, pushes.
- `.github/workflows/release.yml` — on tag: verifies tag == app version,
  creates a draft GitHub release with a generated changelog, then builds and
  uploads installers from a three-platform matrix (Ubuntu 22.04 for older
  glibc; universal macOS binary; Windows MSI/NSIS).
- `.github/workflows/cache-warm.yml` — keeps the Rust dependency cache warm on
  `main` so tag builds start hot (tag runs can only restore default-branch
  caches).
