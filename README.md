<p align="center">
  <img src="https://github.com/jsedlak/lattice/blob/main/public/logo-mark.png?raw=true" alt="Lattice" width="96" />
</p>

<h1 align="center">Lattice</h1>

<p align="center">
  <strong>A local-first knowledge graph second brain.</strong><br />
  Write markdown, upload documents, and Lattice weaves everything into a queryable
  graph an AI assistant answers from — with citations back to your own notes.
</p>

<p align="center">
  <a href="https://github.com/jsedlak/lattice/releases">Download</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="ARCHITECTURE.md">Architecture</a>
</p>

---

<p align="center">
  <img src="https://github.com/jsedlak/lattice/blob/main/public/screenshots/editor.png?raw=true" alt="The Lattice editor: markdown with live preview, wikilinks, and tags" width="900" />
</p>

## Why Lattice

- **Your data stays yours.** Everything lives on your machine — notes, documents, the graph, embeddings, chat history. The only network traffic is the AI API calls you configure.
- **Notes as plain markdown, if you want.** Each workspace chooses its storage: a single SQLite database, or markdown files on disk that you can edit with any tool, sync, and version. Lattice picks up external edits on launch.
- **A graph, not a pile.** Wikilinks (`[[Note]]`) and `#tags` build a deterministic graph as you type; an LLM pass extracts entities and relationships on top of it.
- **Ask your notes questions.** The assistant retrieves by semantic search and graph traversal, and every answer cites the notes and passages it came from.
- **Bring your own models.** Vercel AI Gateway, OpenAI, Anthropic, or any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM) — for chat and embeddings independently. Run fully local if you like.

<table>
  <tr>
    <td width="50%">
      <img src="https://github.com/jsedlak/lattice/blob/main/public/screenshots/graph.png?raw=true" alt="The knowledge graph view" />
      <p align="center"><sub>The graph your notes build — documents, tags, and extracted entities.</sub></p>
    </td>
    <td width="50%">
      <img src="https://github.com/jsedlak/lattice/blob/main/public/screenshots/chat.png?raw=true" alt="The assistant answering from the knowledge graph" />
      <p align="center"><sub>The assistant answers from your graph and cites its sources.</sub></p>
    </td>
  </tr>
</table>

## Getting started

Grab an installer from the [releases page](https://github.com/jsedlak/lattice/releases):

| Platform | File |
|---|---|
| Ubuntu / Debian | `.deb` |
| Other Linux | `.AppImage` (portable), `.rpm` |
| macOS (Apple Silicon + Intel) | `.dmg` |
| Windows | `.msi` or `.exe` |

Then:

1. **Add a model** — open *Settings → AI*, pick a provider, paste an API key (stored in your OS keychain), and hit *Test connection*. Do the same for an embedding model.
2. **Write** — create notes in the editor. Link them with `[[wikilinks]]` and `#tags`; the graph builds itself as you save.
3. **Upload** — drop in PDFs, Word docs, or spreadsheets; they're parsed and ingested into the same graph.
4. **Explore & ask** — browse the graph view, or ask the assistant and follow its citations back to the source.

<p align="center">
  <img src="https://github.com/jsedlak/lattice/blob/main/public/screenshots/settings-ai.png?raw=true" alt="AI provider settings: chat and embedding endpoints" width="900" />
</p>

### Workspaces

A workspace is just a folder: your database, uploads, and notes together in one
relocatable place. Lattice starts in a default workspace in your platform's
app-data directory; *Settings → General* lets you open a different folder.

Each workspace also chooses **where note content is canonical**:

- **Database** (default) — everything in one SQLite file.
- **Markdown files** — notes are `.md` files under `notes/`, mirroring your
  folder tree. Edit them in any editor; Lattice reconciles changes at launch.
  Switching modes migrates your notes in place, either direction.

> **Tip:** keep workspaces out of cloud-synced folders (Dropbox, OneDrive) —
> SQLite and file-sync conflict resolution don't mix.

<p align="center">
  <img src="https://github.com/jsedlak/lattice/blob/main/public/screenshots/settings.png?raw=true" alt="Workspace and note-storage settings" width="900" />
</p>

## Build from source

Prerequisites: Node ≥ 20 with pnpm, and stable Rust via rustup.
On Debian/Ubuntu you'll also need the webview build deps:

```bash
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

macOS needs only the Xcode command-line tools; Windows needs the MSVC build tools.

```bash
pnpm install
pnpm tauri dev     # run the app (vite + cargo)
pnpm tauri build   # produce installers for your platform
```

Useful extras:

```bash
pnpm type-check                                # frontend
cargo test --no-default-features               # Rust core (run in src-tauri/)
./scripts/release.sh 0.3.0                     # bump + tag + push → CI builds a draft release
```

## How it's built

Tauri v2. A Rust core owns SQLite (with `sqlite-vec` for vector search), the
filesystem, and the OS keychain; the webview runs the React UI and the
TypeScript ingest/AI pipeline. The full design — data model, workspaces, files
mode, ingest stages, graph semantics — is specced in
[ARCHITECTURE.md](ARCHITECTURE.md).
