# Lattice Desktop

Local-first desktop version of Lattice for Linux and macOS. **Maintained
separately** from the web monorepo above this directory: own lockfile, no
`@lattice/*` dependencies — shared styles and parity-critical logic are
*copied in* (look for `COPIED VERBATIM` / `PARITY` headers).

Tauri v2: a Rust core owns SQLite (+ `sqlite-vec` KNN), upload file storage,
and the OS keychain; the webview runs the React UI plus the proven TS pipeline
logic (parsers, chunker, AI SDK). Design: `.plan/12-desktop-app.md` in the
repo root.

## Prerequisites

- Node ≥ 20, pnpm
- Rust (stable, via rustup)
- Linux build deps (Debian/Ubuntu):

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

macOS needs only Xcode command-line tools.

## Develop / build

```bash
pnpm install          # .npmrc pins ignore-workspace (standalone from the monorepo)
pnpm tauri dev        # run the app (vite + cargo)
pnpm tauri build      # bundle: .deb/.rpm/AppImage on Linux, .dmg on macOS
pnpm type-check       # frontend only
```

## Where things live

- **Data**: `~/.local/share/app.lattice.desktop/` (Linux) /
  `~/Library/Application Support/app.lattice.desktop/` (macOS) —
  `lattice.db` (SQLite, WAL) and `files/{docId}/` for uploads.
- **Settings**: `settings.json` in the app config dir. API keys: OS keychain
  (Secret Service / macOS Keychain), with a 0600 `secrets.json` fallback when
  no keychain is available.
- **Models**: configured in-app (Settings screen) — Vercel AI Gateway, OpenAI,
  Anthropic, or any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp,
  vLLM) for both chat and embeddings. Changing the embedding model triggers a
  full re-embed (vector dimensions change).

## Architecture crib sheet

- `src-tauri/src/db.rs` — schema (mirrors web Drizzle schema, single-user),
  vec0 virtual tables per embedding dimension.
- `src-tauri/src/commands/` — the IPC surface (`docs`, `graph`, `chat`,
  `settings`); the desktop analogue of the web app's API routes.
- `src/lib/ipc.ts` — typed client for those commands. All data access goes
  through it.
- `src/lib/ai/` — provider factory (Tauri http fetch = no CORS), local chat
  transport (streamText in-page, persists messages, attaches citations),
  graph tools, settings/keychain access.
- `src/lib/ingest/pipeline.ts` — parse → chunk → deterministic graph → embed →
  extract → resolve, with debounce/retry/resume; replaces Inngest.
- Parity-critical copies (keep semantically identical to the web app):
  `src/lib/parse.ts`, `src/lib/chunk.ts`, `src/lib/ai/prompts.ts`,
  `src/lib/ai/extraction-schema.ts`, `src/lib/ai/citations.ts`,
  `src/lib/tokens.ts`.
