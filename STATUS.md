# Lattice — Implementation Status

Tracks what's built against the planned scope in `.plan/`. Updated as of the initial implementation pass.

**Gate status:** `pnpm -r type-check` ✅ 0 errors · `pnpm -r test` ✅ 30 passing · `pnpm --filter @lattice/web build` ✅ succeeds · migration generated ✅

Legend: ✅ done · 🟡 partial (see KNOWN_ISSUES.md) · ⬜ not started

---

## Phase 01 — Foundation ✅
- ✅ Turborepo + pnpm workspace (`turbo.json`, `pnpm-workspace.yaml`)
- ✅ `apps/web` Next.js (App Router, TS, Tailwind v3)
- ✅ Shared packages: `config`, `db`, `auth`, `ai`, `graph`, `ingest`, `ui`
- ✅ `.env.example`, env validation (`apps/web/src/env.ts`)
- ✅ Inngest serve endpoint (`/api/inngest`)
- 🟡 Vercel/Neon/Blob/Inngest provisioning — code-ready; accounts/keys are a NEXT_STEP
- 🟡 CI workflow — not committed (NEXT_STEP)

## Phase 02 — Database & ORM ✅
- ✅ Drizzle client over Neon serverless (`packages/db/src/client.ts`)
- ✅ Full schema: `document, chunk, node, edge, entity, conversation, message, ingest_job` + auth tables
- ✅ pgvector `vector(1536)` columns + HNSW indexes
- ✅ Query helpers (`packages/db/src/queries.ts`) — user-scoped, the isolation chokepoint
- ✅ Migration generated (`packages/db/drizzle/0000_*.sql`) incl. `CREATE EXTENSION vector`

## Phase 03 — Auth & App Shell ✅
- ✅ BetterAuth server/client (`packages/auth`), email/password + GitHub OAuth
- ✅ `/api/auth/[...all]` handler
- ✅ Session helpers (`requireUser`, `requireApiUser`), `middleware.ts` coarse redirect
- ✅ App shell: sidebar (identity, nav, docs, user menu, theme toggle, sign-out)
- ✅ Auth screens (sign-in/up) + dark-first theming (`next-themes`, token CSS vars)
- 🟡 Auth tables co-located in `@lattice/db` rather than via `@better-auth/cli generate` (see DECISIONS)

## Phase 04 — Editor & Documents ✅
- ✅ Document CRUD route handlers (`/api/documents`), user-scoped
- ✅ Dashboard (greeting, search, entry cards, doc grid, empty state)
- ✅ CodeMirror 6 editor with tag/wiki-link decorations
- ✅ Live preview (`react-markdown` + gfm + highlight + custom tag/wiki renderers)
- ✅ Debounced autosave + save indicator; word count
- ✅ Documents/Blobs tabs; ⌘S / ⌘P shortcuts; ⌘N new note (sidebar)
- ✅ `#tag`/`[[wiki-link]]` parsing shared via `@lattice/graph/parse`

## Phase 05 — Private Blob Storage ✅
- ✅ Private upload handler (`/api/upload`), `users/{userId}/{docId}/{file}` namespacing
- ✅ Authenticated blob serving (`/api/blob/[...path]`) with userId-prefix check
- ✅ Blobs tab + upload control (progress/states) + file detail/preview pane
- 🟡 `access: "private"` API surface isolated in `lib/blob.ts` — verify against installed SDK (KNOWN_ISSUES)
- 🟡 Orphan blob deletion on document delete — not yet wired (KNOWN_ISSUES)

## Phase 06 — Ingestion Pipeline ✅
- ✅ Inngest functions: `ingest-document` (parse→chunk→embed→persist) + debounce
- ✅ Parsing: PDF (unpdf), docx (mammoth), xlsx (SheetJS), txt/md; image placeholder
- ✅ Shared token-aware chunker (`@lattice/graph/chunk`)
- ✅ Embeddings via provider factory (`@lattice/ai`), pgvector persistence
- ✅ Job/status tracking surfaced in UI

## Phase 07 — Graph Extraction ✅
- ✅ Deterministic backbone (tags + wiki-links → edges) on every save, idempotent
- ✅ LLM entity extraction (`generateObject`) as `extract-graph` continuation
- ✅ Entity resolution/dedupe via cosine similarity (threshold `ENTITY_MERGE_THRESHOLD`)
- ✅ `node`/`edge` population with `origin` provenance; sidebar node badge
- 🟡 Entity↔entity `related` edges upserted (not replaced) — minor staleness (KNOWN_ISSUES)

## Phase 08 — Graph View ✅
- ✅ Cytoscape canvas (fcose) with taxonomy colors + degree sizing
- ✅ Top bar counts + legend/filter toggles; focus → neighbor highlight + detail card
- ✅ Zoom/pan/reset controls; "Open document →"; empty state
- 🟡 Deselecting all type filters shows all (edge case, KNOWN_ISSUES)

## Phase 09 — Assistant (Chat) ✅
- ✅ Streaming chat (`/api/chat`) via AI SDK v7 through the **Vercel AI Gateway**, hybrid tools (semanticSearch + graph traversal)
- ✅ Citations streamed as message metadata + persisted; clickable chips → source doc
- ✅ Conversation history (list/resume), auto-title; doc-context hand-off from editor/blob
- ✅ Empty state with grounded suggestions

## Phase 10 — Polish & Launch 🟡
- ✅ Empty states (dashboard, editor, graph, chat, blobs)
- ✅ Loading/saving/ingest states; theme tokens AA-oriented
- ✅ Core keyboard shortcuts (save, preview, new note)
- 🟡 Full a11y audit, responsive/tablet/phone layouts, reduced-motion — partial
- ⬜ Rate limiting, error tracking (Sentry), observability, backups — NEXT_STEP
- ⬜ Component/e2e tests (unit coverage is on pure logic only)

---

## Test coverage (unit)
- `@lattice/graph`: `parseLinks`/`tokenizeLinks` (8), `chunkText` (5)
- `@lattice/ai`: `toCitations` (5), extraction prompt + schema (4)
- `@lattice/ui`: `cn` (2)
- `apps/web`: `format` (3), `remark-lattice` (3)

Total: 30 tests. Coverage targets pure logic; route handlers, React components, and Inngest functions are not yet unit-tested (see KNOWN_ISSUES).
