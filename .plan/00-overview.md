# Lattice — Implementation Plan (Overview)

**Lattice** is a single-user "second brain": author markdown, upload source documents, and Lattice weaves both into a queryable knowledge graph that an AI assistant answers from — with citations back to your own notes.

This is the anchor document. Each numbered file in `.plan/` is a phase with concrete deliverables, schema, and code sketches. Phases are ordered so each one ships something runnable.

> Scope decisions locked for the MVP (from planning):
> - **Full graph extraction** — deterministic `#tag` / `[[wiki-link]]` parsing *and* LLM entity extraction with embedding-based resolution/dedupe.
> - **Hybrid retrieval** — the assistant uses graph-traversal tools *and* pgvector semantic search.
> - **Single-user private workspaces** — one workspace per account, hard `userId` isolation everywhere. No teams/sharing in MVP.
> - **Background-job ingestion** — uploads enqueue a durable multi-step job (parse → chunk → embed → extract).

---

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | **Turborepo + pnpm** | `apps/*` + `packages/*`, remote caching on Vercel |
| Framework | **Next.js (App Router)** | React Server Components, route handlers |
| Hosting | **Vercel** | Web app + Inngest functions on the same project |
| Database | **Neon Postgres** | serverless driver; `pgvector` extension enabled |
| ORM | **Drizzle** | schema + migrations in `packages/db` |
| File storage | **Vercel Blob (private)** | per-user namespaced objects, no public URLs |
| Auth | **BetterAuth** | email/password + GitHub OAuth |
| Background jobs | **Inngest** | durable steps, retries, concurrency; QStash / Vercel Queues are fallbacks |
| AI orchestration | **Vercel AI SDK** | `@ai-sdk/anthropic` chat, `@ai-sdk/openai` embeddings — provider-configurable via env |
| Chat model | **Anthropic Claude** (`claude-opus-4-8` default) | streaming + tool calling |
| Embeddings | **OpenAI** (`text-embedding-3-small`) | 1536-dim; provider swappable |
| Graph render | **Cytoscape.js** | color-coded node taxonomy, focus/neighbor, filtering |
| Editor | **CodeMirror 6** | markdown highlighting, tag/wiki-link decorations |
| Preview | **react-markdown** + `remark-gfm` + `rehype-highlight` | |
| UI | **Tailwind + shadcn/ui** | IBM Plex Sans / IBM Plex Mono, dark-first |

### Why these are configurable
The Vercel AI SDK abstracts providers. Chat and embedding providers are each chosen by env (`CHAT_PROVIDER`, `EMBEDDING_PROVIDER`) so Anthropic↔OpenAI (or others) can be swapped without touching call sites. See `06`/`09`.

---

## Monorepo layout

```
lattice/
├─ apps/
│  └─ web/                      # Next.js app (UI + route handlers + Inngest endpoint)
│     ├─ app/
│     │  ├─ (auth)/             # sign-in / sign-up
│     │  ├─ (app)/              # authenticated shell: dashboard, editor, graph, assistant
│     │  ├─ api/auth/[...all]/  # BetterAuth handler
│     │  ├─ api/inngest/        # Inngest serve endpoint
│     │  └─ api/*               # documents, upload, chat, graph route handlers
│     └─ ...
├─ packages/
│  ├─ db/                       # Drizzle schema, client, migrations
│  ├─ auth/                     # BetterAuth server + client config
│  ├─ ai/                       # provider factory, embeddings, extraction, chat tools
│  ├─ ingest/                   # Inngest client + functions (parse/chunk/embed/extract)
│  ├─ graph/                    # graph build + query helpers (shared by web + ingest)
│  ├─ ui/                       # shadcn components, design tokens, logo asset
│  └─ config/                   # eslint, tsconfig, tailwind preset shared configs
├─ turbo.json
├─ pnpm-workspace.yaml
└─ package.json
```

Rationale: ingestion and graph logic live in packages so both the web route handlers and the Inngest functions import the *same* code. No duplicated extraction logic.

---

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │            Next.js (Vercel)           │
   Browser ──────────────▶  (app) shell: editor / graph / chat   │
                         │  route handlers: documents, upload,   │
                         │  chat (streaming), graph queries      │
                         └───┬───────────┬───────────┬───────────┘
                             │           │           │
                   ┌─────────▼──┐  ┌─────▼──────┐  ┌─▼───────────┐
                   │   Neon PG  │  │ Vercel Blob│  │  AI SDK      │
                   │ + pgvector │  │  (private) │  │ Anthropic /  │
                   └─────▲──────┘  └─────┬──────┘  │ OpenAI       │
                         │               │         └─▲────────────┘
                         │        upload enqueues    │
                   ┌─────┴───────────────▼───────────┴────┐
                   │            Inngest functions          │
                   │  parse → chunk → embed → extract →     │
                   │  resolve entities → write nodes/edges │
                   └───────────────────────────────────────┘
```

Every blob and every row is scoped to a `userId`. Isolation is enforced in application code on every read/write path — never assumed from URL obscurity. See the security checklist below and `03`.

---

## Data model (high level)

Owned by BetterAuth: `user`, `session`, `account`, `verification`.

Application tables (detailed in `02`):

- **`document`** — authored notes (markdown in PG) and uploaded files (pointer to Blob). `kind: 'note' | 'upload'`, `ingestStatus`.
- **`chunk`** — text chunks of a document for retrieval. `embedding vector(1536)` (pgvector).
- **`node`** — graph nodes: a document, a tag, or an extracted entity. `type: 'document' | 'tag' | 'entity'`.
- **`edge`** — typed relationships between nodes. `relation: 'wikilink' | 'tag' | 'mentions' | 'related'`, with `source` provenance.
- **`entity`** — canonical extracted entities (after resolution/dedupe), with `embedding` for similarity matching.
- **`conversation`** / **`message`** — chat history with `citations` (node/chunk references) per assistant message.
- **`ingestJob`** — tracks background processing state surfaced in the UI.

Node color taxonomy (consistent everywhere — editor, graph, chat): Documents = blue, Tags = green, Entities = orange, Wiki-links = purple.

---

## Design system (from the mockup)

Pull these into `packages/ui` as the single source of truth. Both themes are first-class; **dark is default**.

```
Type:    IBM Plex Sans (UI)   ·   IBM Plex Mono (editor, code, tags, links)

Accent:  #3a6df0 primary  ·  #5b8cff active/hover
Graph:   doc   #3a6df0 / #5b8cff      tag    #1f9d68 / #46c08a
         entity #b9701f / #e0a35a     link   #8b54c4 / #bb8ce0
         (citation/alert accent: #d23f6b / #e87b9b)

Dark:    bg #0d0e11  surface #101216 / #15171b  raised #1a1c20 / #1b1e23
         border #22262d / #262a31 / #363c45
         text #e7e8ea  muted #a4aab3 / #8a909a  faint #6e747e

Light:   bg #fbfbfa  surface #f5f5f3 / #f0f0ee  border #e4e4e0 / #d3d3cd
```

Branding: `logo.png` → app mark in the sidebar header, favicon set, and the auth screen. Keep the rounded-square blue mark treatment from the mockup.

App shell (all authenticated screens share it):
- **Left sidebar** — workspace identity (logo + "Your Workspace"), nav (Home / Editor / Graph / Assistant), Documents list with add, user menu + theme toggle + sign-out at the bottom.
- **Main area** — the active surface.
- The Editor's right region and the Assistant can co-exist (ask-about-what-you're-writing flow) — see `04`/`09`.

---

## Phase map

| # | Phase | Ships |
|---|---|---|
| 01 | Foundation | Turborepo + Vercel + Neon + Blob wired; app boots |
| 02 | Database & ORM | Drizzle schema, pgvector, migrations |
| 03 | Auth & App Shell | BetterAuth, session gating, sidebar shell, theming |
| 04 | Editor & Documents | Split-pane editor, preview, autosave, doc CRUD, tags/links |
| 05 | Blob Storage | Private per-user uploads, Blobs tab, file preview |
| 06 | Ingestion Pipeline | Inngest parse → chunk → embed; pgvector populated |
| 07 | Graph Extraction | Deterministic edges + LLM entities + resolution/dedupe |
| 08 | Graph View | Cytoscape canvas, taxonomy colors, focus, filtering |
| 09 | Assistant (Chat) | AI SDK streaming, graph+vector tools, citations, history |
| 10 | Polish & Launch | Empty states, a11y, shortcuts, responsive, hardening |

Each phase doc lists its own **Done when** acceptance criteria.

---

## Cross-cutting environment variables

```
# Database (Neon)
DATABASE_URL=                 # pooled connection string (serverless)
DATABASE_URL_UNPOOLED=        # direct string for drizzle-kit migrations

# Auth (BetterAuth)
BETTER_AUTH_SECRET=           # openssl rand -base64 32
BETTER_AUTH_URL=              # https://app.lattice... (per environment)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Storage
BLOB_READ_WRITE_TOKEN=        # Vercel Blob, server-only

# AI (provider-configurable)
CHAT_PROVIDER=anthropic       # anthropic | openai | ...
CHAT_MODEL=claude-opus-4-8
ANTHROPIC_API_KEY=
EMBEDDING_PROVIDER=openai     # openai | ...
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=

# Background jobs (Inngest)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

Secrets are server-only — never `NEXT_PUBLIC_`. Use the Vercel Neon integration so `DATABASE_URL` is injected across environments.

---

## Global security checklist (applies to every phase)

- [ ] Every data/storage/route handler re-verifies the session server-side.
- [ ] All Postgres queries filter by `session.user.id` (no implicit trust of client IDs).
- [ ] Blob objects are `private`, namespaced `users/{userId}/...`, served only via an authenticated handler that checks the `userId` path segment — no raw blob URLs to the client.
- [ ] Inngest functions re-scope all work to the `userId` carried in the event payload.
- [ ] `BETTER_AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, AI keys, Inngest keys are server-only.
- [ ] GitHub OAuth callback URLs match per environment.
- [ ] Middleware does coarse redirect-to-login only; the authorization boundary is in each handler.

---

## Build order summary

1. Stand up the monorepo and infra (`01`).
2. Schema + first migration with pgvector (`02`).
3. Auth + the shared app shell so every later screen has a home (`03`).
4. Editor + document CRUD — the screen users live in (`04`).
5. Private uploads (`05`) feed the ingestion pipeline (`06`).
6. Graph extraction (`07`) turns content into nodes/edges, rendered by the graph view (`08`).
7. The assistant (`09`) ties it together with grounded, cited answers.
8. Polish and launch hardening (`10`).
