# Phase 01 — Foundation (Monorepo & Infra)

Stand up the Turborepo monorepo, the Next.js app, shared packages, and all external services so the app boots locally and on Vercel. No product features yet — this is the ground everything else stands on.

## Deliverables

1. **Turborepo + pnpm workspace** with the layout from `00-overview.md`.
2. **`apps/web`** — Next.js (App Router, TypeScript, Tailwind) that renders a placeholder home.
3. **Shared packages** scaffolded (empty but wired): `db`, `auth`, `ai`, `ingest`, `graph`, `ui`, `config`.
4. **Vercel project** linked to the GitHub repo; preview + production deploys green.
5. **Neon** provisioned via the Vercel Neon integration; `pgvector` available.
6. **Vercel Blob** enabled; `BLOB_READ_WRITE_TOKEN` captured.
7. **Inngest** account + keys; `/api/inngest` endpoint serving (no functions yet).

## Steps

### 1. Workspace scaffolding

```bash
pnpm dlx create-turbo@latest lattice
cd lattice
# prune to pnpm; set packageManager in package.json
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json` — pipeline for `build`, `dev`, `lint`, `type-check`, `db:generate`, `db:migrate`. Mark `^build` deps so packages build before the app.

### 2. The web app

```bash
pnpm dlx create-next-app@latest apps/web --ts --tailwind --app --eslint
```

Set the app to consume workspace packages: `"@lattice/db": "workspace:*"`, etc. Configure `transpilePackages` in `next.config.ts` for the workspace packages.

### 3. Shared package skeletons

Each `packages/*` gets a `package.json` (`"name": "@lattice/<x>"`), `tsconfig.json` extending `@lattice/config`, and an `index.ts` barrel. `packages/config` holds shared `eslint`, `tsconfig.base.json`, and a Tailwind preset that encodes the design tokens from `00-overview.md`.

`packages/ui` gets IBM Plex fonts wired (via `next/font` re-export or self-hosted), the token CSS variables, and `logo.png` copied in as the canonical asset.

### 4. External services

- **Neon:** add via Vercel → Storage → Neon. Confirm `DATABASE_URL` (pooled) injected. Grab the unpooled string for migrations → `DATABASE_URL_UNPOOLED`. Enable the extension: `CREATE EXTENSION IF NOT EXISTS vector;` (also asserted in the first migration, `02`).
- **Vercel Blob:** Storage → Blob → create store; copy `BLOB_READ_WRITE_TOKEN`.
- **Inngest:** create app, copy `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`. Add `apps/web/app/api/inngest/route.ts`:

```ts
import { serve } from "inngest/next";
import { inngest } from "@lattice/ingest/client";

export const { GET, POST, PUT } = serve({ client: inngest, functions: [] });
```

### 5. Env + secrets

Create `.env.example` (committed) mirroring the full list in `00-overview.md`. Local `.env` is git-ignored. Push the same vars into Vercel (Preview + Production). Add a tiny `env.ts` (e.g. `@t3-oss/env-nextjs` or hand-rolled zod) that validates env at boot and gives typed access — fail fast on missing vars.

### 6. CI

GitHub Action: `pnpm install`, `turbo run lint type-check build`. Turbo remote caching enabled against Vercel.

## Done when

- `pnpm dev` serves `apps/web` locally; placeholder home renders with IBM Plex fonts + dark theme.
- A push to a branch produces a green Vercel preview deploy.
- `/api/inngest` returns the Inngest introspection response.
- `env.ts` throws clearly when a required var is missing.
- All `@lattice/*` packages resolve and type-check from the web app.

## Notes / gotchas

- Use Neon's **pooled** string at runtime, **unpooled** for `drizzle-kit`.
- Keep the Inngest endpoint deployed early so later phases can register functions incrementally.
- Don't put anything user-facing behind auth yet — that lands in `03`.
