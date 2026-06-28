# Known Issues & Gaps

Honest list of what's incomplete, risky, or deferred. Grouped by severity. None block `type-check`, `test`, or `build`; most are runtime/UX/ops gaps that surface only against live services.

## Needs verification against live services

- **Vercel Blob private access.** Uploads use `access: "private"`; reads go through the authenticated `/api/blob` handler. The exact private-read surface of `@vercel/blob` can vary by version (`apps/web/src/lib/blob.ts`, `packages/ingest/src/blob.ts`). If downloads 403/404, switch to a signed-URL strategy (`getDownloadUrl`/signed `head`) — both reads are isolated in those two files for a one-place fix.
- **BetterAuth schema drift.** Auth tables are hand-maintained in `packages/db/src/auth-schema.ts` to match BetterAuth v1. If you upgrade BetterAuth and its expected columns change, auth queries can fail — run `@better-auth/cli generate` and reconcile.
- **AI Gateway credential.** Chat + embeddings route through the Vercel AI Gateway (AI SDK v7). Locally this needs `AI_GATEWAY_API_KEY`; in production on Vercel it uses OIDC (no key). If calls 401, confirm AI Gateway is enabled for the project and the key/OIDC is in place. Model slugs (`anthropic/…`, `openai/…`) must be ones the Gateway exposes.
- **AI SDK message metadata.** Citations are streamed as message metadata (`toUIMessageStreamResponse({ messageMetadata })`) and read from `message.metadata` in the chat UI, plus persisted to the DB. If an AI-SDK upgrade changes the metadata/parts shape, live citations may not render — persisted citations (DB) still show on resume.

## Correctness / data

- **Backlink resolution is one-directional at save time.** A `[[wiki-link]]` resolves to the target doc when the *linking* note is saved. If you create the target note later, the backlink edge isn't created until the linking note is re-saved. A periodic/lazy re-resolve pass would fix this.
- **Entity↔entity `related` edges aren't garbage-collected.** They're upserted, not replaced per-document (relations span docs). A relation removed from the text lingers until a cleanup sweep.
- **Orphan entity cleanup not wired.** Deleting an upload now removes its blob bytes (best-effort `del()` in the DELETE handler) and cascades its chunks/nodes/edges — but entities left with no remaining edges aren't swept. Add a periodic orphan-entity cleanup.
- **Multi-step writes aren't transactional.** neon-http transactions are non-interactive, so resolution/edge writes are sequential awaits. Re-runs are idempotent, but a mid-operation crash can leave a partial state until the next ingest.
- **"ready" status precedes entity extraction.** A document shows `ready` once embedded; entity nodes appear a moment later. No distinct "extracting" status.
- **Extraction is capped at 24 chunks/document** (`getChunkContents` limit) to bound LLM cost — very long documents won't have entities extracted from their tail. Not surfaced in the UI.

## UX / polish

- **Graph: deselecting all type filters shows all nodes** (the API treats an empty type list as "no filter"). Minor; an explicit empty-selection guard would fix it.
- **Graph layout is non-deterministic** (`fcose` `randomize: true`) — it re-lays-out on each load/theme change. Acceptable; could persist positions.
- **Responsive layouts are desktop-first.** Tablet/phone stacking for the split editor and the multi-column shells is not fully implemented (the brief wants phone = read/chat-first).
- **Accessibility is partial.** Tokens target AA contrast and focus states exist, but a full keyboard/ARIA pass on the editor, graph canvas, and chat stream (per `.plan/10`) is outstanding. No `prefers-reduced-motion` gating yet.
- **No `?` shortcut cheat-sheet**; only save/preview/new-note shortcuts are implemented.

## Ops / security (deferred to launch hardening)

- **No rate limiting** on `/api/chat`, `/api/upload`, or auth endpoints — add before exposing publicly (cost/abuse).
- **No error tracking / observability** (Sentry, structured logs, Inngest failure alerts).
- **No backups/runbook** documented beyond NEXT_STEPS; enable Neon PITR/branching.
- **Env validation is non-fatal** (`apps/web/src/env.ts` warns rather than throws) so env-less builds/CI succeed. Production should fail fast — flip to throwing once envs are guaranteed.
- **ESLint not configured** (the `next lint` script was removed to avoid interactive setup).

## Testing

- **Unit tests cover pure logic only** (parsing, chunking, citations, formatting, remark transform, `cn`). Not covered: route handlers, React components, Inngest functions, entity resolution end-to-end, DB queries. Add component tests (Testing Library + jsdom) and an e2e smoke (Playwright) before relying on regressions being caught.
- **No integration test of the ingestion pipeline** against a real/mock Neon + provider.
