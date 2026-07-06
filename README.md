# Lattice

**A single-user knowledge graph second brain.** Write markdown, upload documents, and Lattice weaves both into a queryable graph an AI assistant answers from — with citations back to your own notes.

---

## What it does

- **Editor** — split-pane markdown with live preview, first-class `#tags` and `[[wiki-links]]`, debounced autosave.
- **Documents & blobs** — authored notes (in Postgres) and uploaded files (PDF/docx/xlsx → private Vercel Blob), ingested into the graph.
- **Knowledge graph** — deterministic tag/link edges + LLM-extracted entities (resolved/deduped by embedding similarity), rendered with Cytoscape.
- **Assistant** — streaming chat with hybrid retrieval (graph traversal + pgvector semantic search) and clickable source citations.

Everything is private and scoped per user.

## Stack

Turborepo · Next.js (App Router) · Neon Postgres + pgvector · Drizzle · BetterAuth · Vercel Blob · Inngest · Vercel AI SDK v7 via the **Vercel AI Gateway** (one credential for chat + embeddings; `provider/model` slugs, env-configurable) · Cytoscape · CodeMirror 6 · Tailwind.

## Monorepo layout

```
apps/web            Next.js app — UI, route handlers, Inngest endpoint
packages/
  config            shared tsconfig, Tailwind preset, design tokens
  db                Drizzle schema, client, user-scoped queries, migrations
  auth              BetterAuth server/client
  ai                provider factory, embeddings, chat tools, extraction, citations
  graph             tag/wiki-link parsing, chunking, deterministic graph builder
  ingest            Inngest client + functions (parse → chunk → embed → extract)
  ui                design-system components, theme, logo
```

## Quick start

```bash
pnpm install
cp .env.example .env          # then fill it in — see NEXT_STEPS.md
pnpm --filter @lattice/db db:migrate
pnpm dev                      # http://localhost:3000
# for ingestion locally:
pnpm inngest
```

Full setup (Neon, GitHub OAuth, AI keys, Blob, Inngest, deploy) is in **[NEXT_STEPS.md](./NEXT_STEPS.md)**.

## Project docs

- **[.plan/](./.plan/)** — the phased implementation plan (the spec).
- **[STATUS.md](./STATUS.md)** — what's built vs planned, per phase.
- **[DECISIONS.md](./DECISIONS.md)** — choices made + open questions.
- **[KNOWN_ISSUES.md](./KNOWN_ISSUES.md)** — gaps, risks, deferrals.

## Commands

```bash
pnpm dev            pnpm -r type-check     pnpm -r test
pnpm --filter @lattice/web build
pnpm --filter @lattice/db db:generate | db:migrate | db:studio
```

## Architecture notes

- **Isolation** is enforced in code: every query/route/Inngest function scopes to `userId`; blobs are private and namespaced; the authorization boundary is each handler (`requireUser`/`requireApiUser`), not middleware.
- **Providers are swappable** via the `CHAT_MODEL` / `EMBEDDING_MODEL` slugs through the AI Gateway — the model is named in exactly one place (`packages/ai/src/providers.ts`).
- **Graph = deterministic backbone + LLM enrichment.** Tags/wiki-links are the reliable skeleton; entity extraction enriches it. Deterministic edges win on conflict.
