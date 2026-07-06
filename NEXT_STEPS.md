# Next Steps — getting Lattice running

The codebase type-checks, tests, and builds. To run it for real you need to provision a few services and set env vars. Estimated 20–30 minutes.

## 1. Prerequisites
- Node ≥ 20, `pnpm` 11 (`corepack enable`)
- Accounts: Vercel, Neon, an Anthropic API key, an OpenAI API key, a GitHub OAuth app
- `pnpm install` (already done if you're reading this in the repo)

## 2. Database (Neon + pgvector)
1. Create a Neon project. Copy the **pooled** connection string → `DATABASE_URL`, and the **direct/unpooled** one → `DATABASE_URL_UNPOOLED`.
2. Copy `.env.example` → `.env` at the repo root and fill values.
3. Apply the schema (the generated migration enables `pgvector` itself):
   ```bash
   pnpm --filter @lattice/db db:migrate
   ```
   If your Neon role can't `CREATE EXTENSION`, run `CREATE EXTENSION IF NOT EXISTS vector;` once in the Neon SQL editor first, then migrate.

## 3. Auth (BetterAuth + GitHub)
1. `BETTER_AUTH_SECRET` → `openssl rand -base64 32`
2. `BETTER_AUTH_URL` → `http://localhost:3000` for local (set the real URL per environment).
3. Create a GitHub OAuth app (Settings → Developer settings → OAuth Apps):
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
   - Set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`. (Email/password works without this; GitHub button needs it.)
4. `NEXT_PUBLIC_APP_URL` → same base URL as `BETTER_AUTH_URL`.

## 4. AI (Vercel AI Gateway)
Model access goes through the **Vercel AI Gateway** — one credential reaches every provider (no separate Anthropic/OpenAI keys), billed via Vercel.
- **Local dev / non-Vercel:** set `AI_GATEWAY_API_KEY` (create one in the Vercel dashboard → AI Gateway). That single key covers both chat and embeddings.
- **Production on Vercel:** you do **not** need the key — deployments authenticate to the Gateway automatically via OIDC. Just ensure AI Gateway is enabled for the project.
- Models are referenced by `provider/model` slug, configurable via env:
  - `CHAT_MODEL=anthropic/claude-opus-4-8`
  - `EMBEDDING_MODEL=openai/text-embedding-3-small`
  - ⚠️ Embedding dimension is pinned to **1536** in the DB schema (`EMBEDDING_DIM`). If you switch to an embedding model of a different dimension, update `packages/db/src/constants.ts` and regenerate/apply the migration.

## 5. File storage (Vercel Blob)
1. In the Vercel project: Storage → Blob → create a store.
2. Set `BLOB_READ_WRITE_TOKEN`.
3. ⚠️ Uploads use `access: "private"` (isolated in `apps/web/src/lib/blob.ts` + `packages/ingest/src/blob.ts`). Confirm your `@vercel/blob` version supports private blobs; if downloads 403/404, see KNOWN_ISSUES.md for the signed-URL fallback.

## 6. Background jobs (Inngest)
1. Create an Inngest app; set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
2. **Local dev:** run the Inngest dev server alongside the app so uploads/saves actually process:
   ```bash
   pnpm inngest
   ```
3. **Production:** point your Inngest app at `https://<your-domain>/api/inngest`.

## 7. Run it
```bash
pnpm dev                 # all packages; web on http://localhost:3000
# in another terminal, for ingestion to run locally:
pnpm inngest
```
Sign up → create a note with `#tags` and `[[wiki-links]]` → open Graph → upload a PDF → ask the Assistant.

## 8. Deploy (Vercel)
1. Import the repo into Vercel; root is the monorepo, app is `apps/web` (Turborepo is auto-detected).
2. Add **all** env vars from `.env.example` to Preview + Production (use the Vercel Neon integration to auto-inject `DATABASE_URL`).
3. Register a GitHub OAuth callback per environment.
4. Ensure `/api/inngest` is reachable and registered in the Inngest dashboard.
5. `/api/inngest`, `/api/chat`, `/api/upload` run on the Node runtime with raised `maxDuration` — already configured.

## 9. Recommended before real users (not yet implemented)
- ESLint: add `eslint` + `eslint-config-next` and an `eslint.config.mjs` (the `next lint` script was removed to avoid interactive setup).
- Rate limiting on `/api/chat`, `/api/upload`, auth endpoints (e.g. Upstash Ratelimit).
- Error tracking (Sentry) for web + Inngest; alerting on Inngest job failures.
- Neon point-in-time recovery / branching for backups.
See KNOWN_ISSUES.md and `.plan/10-polish-and-launch.md`.

## Handy commands
```bash
pnpm dev                              # run everything
pnpm -r type-check                    # typecheck all packages
pnpm -r test                          # run unit tests
pnpm --filter @lattice/web build      # production build
pnpm --filter @lattice/db db:generate # regenerate migration after schema changes
pnpm --filter @lattice/db db:studio   # browse the DB
```
