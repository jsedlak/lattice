# Knowledge Graph MVP — Implementation Plan

A Next.js application on Vercel for authoring markdown, building a knowledge graph from it, and querying that graph via an AI chat interface. This plan covers the foundational scaffolding: hosting, database, private per-user storage, and authentication. Graph extraction and chat are scoped as later phases.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Hosting | Vercel |
| Database | Neon Postgres (serverless driver) |
| ORM | Drizzle |
| File storage | Vercel Blob (private) |
| Auth | BetterAuth — email/password + GitHub OAuth |
| AI orchestration | Vercel AI SDK (later phase) |

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                 Next.js (Vercel)             │
│                                              │
│  /app          UI (editor, preview, chat)    │
│  /app/api/auth BetterAuth handler            │
│  /app/api/*    route handlers (blob, graph)  │
└───────┬─────────────────┬──────────────┬─────┘
        │                 │              │
   ┌────▼────┐      ┌──────▼─────┐   ┌────▼──────┐
   │  Neon   │      │ Vercel Blob│   │ AI SDK    │
   │ Postgres│      │  (private) │   │ (phase 2) │
   └─────────┘      └────────────┘   └───────────┘
```

Every blob and every database row is scoped to a `userId`. Storage isolation is enforced in application code on every read/write path, not assumed from URL obscurity.

---

## Phase 0 — Project Setup

1. `npx create-next-app@latest` — App Router, TypeScript, Tailwind.
2. Initialize Git, push to GitHub (also needed for the GitHub OAuth app).
3. Create the Vercel project, link the repo, configure the production domain.
4. Install dependencies:
   - `better-auth`
   - `drizzle-orm @neondatabase/serverless`
   - `drizzle-kit` (dev)
   - `@vercel/blob`
5. Provision Neon (via the Vercel Neon integration so `DATABASE_URL` is injected automatically across environments).
6. Enable Vercel Blob on the project; capture `BLOB_READ_WRITE_TOKEN`.

### Environment variables

```
DATABASE_URL=                 # Neon (pooled connection string)
BETTER_AUTH_SECRET=           # openssl rand -base64 32
BETTER_AUTH_URL=              # e.g. https://app.example.com
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
BLOB_READ_WRITE_TOKEN=        # provided by Vercel Blob
```

> Use Neon's **pooled** connection string for serverless. `drizzle-kit` migrations may need the **direct** (unpooled) string — keep both if so.

---

## Phase 1 — Database & ORM

Drizzle against Neon's serverless driver.

`db/index.ts`
```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);
```

### Schema

BetterAuth owns the `user`, `session`, `account`, and `verification` tables — generate these with the BetterAuth CLI rather than hand-writing them. Application tables reference `user.id`.

`db/schema.ts` (application tables)
```ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const document = pgTable("document", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),      // FK -> user.id
  title: text("title").notNull(),
  // markdown body kept in Postgres for fast edit/preview;
  // uploaded source files go to Blob (see Phase 3)
  content: text("content").notNull().default(""),
  blobPathname: text("blob_pathname"),     // set for uploaded docs
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

Migrations:
```
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Phase 2 — Authentication (BetterAuth)

### Server config

`lib/auth.ts`
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
});
```

Generate the auth tables:
```
npx @better-auth/cli generate
npx drizzle-kit migrate
```

### Route handler

`app/api/auth/[...all]/route.ts`
```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

### Client

`lib/auth-client.ts`
```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
// authClient.signIn.email(...), authClient.signIn.social({ provider: "github" }),
// authClient.signUp.email(...), authClient.useSession()
```

### GitHub OAuth app

Register at GitHub → Developer settings → OAuth Apps.
- **Authorization callback URL:** `{BETTER_AUTH_URL}/api/auth/callback/github`
- Register one app per environment (local `http://localhost:3000`, preview, production) or use a single app with the production callback and a tunnel for local dev.

### Session enforcement

Gate protected routes/handlers server-side:
```ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const session = await auth.api.getSession({ headers: await headers() });
if (!session) return new Response("Unauthorized", { status: 401 });
const userId = session.user.id;
```

Add `middleware.ts` for coarse redirect-to-login on app routes, but **always re-check the session inside each handler** — middleware is a convenience, not the authorization boundary.

---

## Phase 3 — Private Per-User Blob Storage

Markdown authored in-app lives in Postgres. **Uploaded** source documents (PDF, docx, etc.) go to Vercel Blob as private objects.

### Isolation model

- Namespace every object under the user's id: `users/{userId}/{docId}/{filename}`.
- Create blobs with `access: "private"` so they are not publicly reachable by URL.
- Serve files only through an authenticated route handler that (a) verifies the session and (b) confirms the requested pathname's `{userId}` segment matches the session user before returning a short-lived signed URL or streaming the bytes.

### Upload handler (sketch)

`app/api/upload/route.ts`
```ts
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File;
  const docId = crypto.randomUUID();
  const pathname = `users/${session.user.id}/${docId}/${file.name}`;

  const blob = await put(pathname, file, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });

  // persist document row referencing blob.pathname …
  return Response.json({ pathname: blob.pathname });
}
```

### Download handler (sketch)

```ts
// Verify session, assert pathname starts with `users/${session.user.id}/`,
// then return a signed read URL or stream the object.
// Never expose the raw blob URL to the client.
```

> If you adopt large/direct uploads later, switch to Blob **client uploads** with `handleUpload`, and run the same `userId`-prefix authorization check inside the `onBeforeGenerateToken` callback.

---

## Phase 4 — Editor & Preview (UI)

- Split-pane: editor left, rendered preview right.
- Editor: CodeMirror 6 (or Monaco) with markdown syntax highlighting.
- Preview: `react-markdown` + `remark-gfm` + `rehype-highlight` (or Shiki) for code fences.
- Autosave debounced to a `PATCH /api/documents/:id` handler (session-checked, `userId`-scoped query).
- Document list scoped to `where(eq(document.userId, session.user.id))`.

---

## Later Phases (out of scope for this plan, noted for sequencing)

- **Graph extraction:** deterministic `#tag` / `[[wiki-link]]` parsing on save; an `edges` table (`source_id`, `target_id`, `relation_type`).
- **LLM extraction + entity resolution:** `generateObject` over content; embedding-similarity dedupe (the genuinely hard part — keep deterministic links as the reliable backbone).
- **Vector search:** pgvector chunk embeddings for hybrid graph + semantic retrieval.
- **Chat:** Vercel AI SDK with graph access exposed as `tools` (`searchNodes`, `getNeighbors`, `traverse`) rather than dumped into context.

---

## Build Order Summary

1. Scaffold Next.js, link Vercel + GitHub, provision Neon + Blob.
2. Drizzle schema + first migration.
3. BetterAuth (email/password, then GitHub OAuth), generate auth tables, wire route handler + client, gate routes.
4. Private per-user Blob upload/download with `userId`-prefix authorization.
5. Editor/preview UI with per-user document CRUD.
6. (Later) graph extraction → vector search → AI SDK chat.

## Security Checklist

- [ ] Every data/storage handler re-verifies the session server-side.
- [ ] All Postgres queries filter by `session.user.id`.
- [ ] Blob objects are `private` and namespaced by `userId`.
- [ ] Blob access goes through an authenticated handler that checks the `userId` path segment — no raw blob URLs to the client.
- [ ] `BETTER_AUTH_SECRET` and `BLOB_READ_WRITE_TOKEN` are server-only env vars, never `NEXT_PUBLIC_`.
- [ ] GitHub OAuth callback URLs match per environment.
