# Phase 03 — Auth & App Shell

Wire BetterAuth (email/password + GitHub), gate the app server-side, and build the persistent shell every authenticated screen lives in. After this phase a user can sign up, sign in, and land in an empty-but-real workspace.

## Deliverables

1. BetterAuth server + client in `packages/auth`; auth tables generated + migrated.
2. `/api/auth/[...all]` handler; `/api/auth/callback/github` working.
3. Auth screens (sign in / sign up) matching the dark, minimal mockup.
4. `middleware.ts` coarse redirect + per-handler session checks.
5. The **app shell**: sidebar (identity, nav, documents list, user menu, theme toggle, sign-out) + main content slot.
6. Theme system (dark default, light fully considered) with persisted preference.

## Auth config

`packages/auth/src/server.ts`
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@lattice/db";

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

Generate + migrate auth tables:
```bash
pnpm dlx @better-auth/cli generate   # emits user/session/account/verification
pnpm db:migrate
```

`apps/web/app/api/auth/[...all]/route.ts`
```ts
import { auth } from "@lattice/auth/server";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

`packages/auth/src/client.ts`
```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
// signIn.email / signIn.social({ provider: "github" }) / signUp.email / useSession
```

### GitHub OAuth app
- Callback URL: `{BETTER_AUTH_URL}/api/auth/callback/github`.
- One app per environment, or one prod app + a tunnel for local. Document chosen approach in `.env.example`.

## Session enforcement

A shared helper used by every protected route handler and server component:

`packages/auth/src/session.ts`
```ts
import { auth } from "./server";
import { headers } from "next/headers";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return session.user; // { id, email, name, image }
}
```

`apps/web/middleware.ts` — redirect unauthenticated requests for `(app)` routes to `/sign-in`. **This is convenience only.** Every handler/server component still calls `requireUser()` and returns 401 / redirects on null. Repeat this rule in every later phase.

## Screens

### Auth (`app/(auth)/sign-in`, `/sign-up`)
Minimal, welcoming, centered card on the deep `#0d0e11` background. Logo mark up top. Email + password fields, "Continue with GitHub" button (with mark). Clear inline error states. Link between sign-in/sign-up. On success → `/` (dashboard).

### App shell (`app/(app)/layout.tsx`)
Server component: calls `requireUser()`, redirects if null, then renders the sidebar + `{children}`. Reuses the exact structure from the mockup:

```
┌──────────────┬─────────────────────────────┐
│ ◧ Lattice    │                             │
│  Your Workspace                            │
│  ───────────                               │
│  ⌂ Home       │        main content         │
│  ✎ Editor     │        ({children})         │
│  ⌥ Graph   18 │                             │
│  ▢ Assistant  │                             │
│  ──────────   │                             │
│  DOCUMENTS  + │                             │
│   · Note A    │                             │
│   · Note B    │                             │
│  ──────────   │                             │
│  ◓ User  ☼ ⇲  │                             │
└──────────────┴─────────────────────────────┘
```

- **Identity:** logo + workspace name (`{user.name}'s Workspace` / "Personal · Free").
- **Nav:** Home / Editor / Graph / Assistant with active state in accent blue. Graph shows a node count badge (live later).
- **Documents list:** server-fetched `where(eq(document.userId, user.id))`, scrollable, `+` to create. Highlights the active doc.
- **Footer:** avatar + email, theme toggle (sun/moon), sign-out.
- The sidebar is a client island for interactivity; data comes from server components / route handlers.

### Theming
- CSS variables from `00-overview.md` tokens; `class="dark"` strategy via `next-themes`. Default dark; persist choice; respect `prefers-color-scheme` on first visit.
- Both palettes meet WCAG AA (verified in `10`).

## Done when

- Email/password sign-up → signed-in session → lands on dashboard shell.
- GitHub OAuth round-trips in at least the local environment.
- Hitting an `(app)` route while logged out redirects to `/sign-in`.
- A protected route handler returns 401 without a session.
- Sidebar renders the (possibly empty) per-user document list; theme toggle works and persists.

## Notes

- Keep `auth.api.getSession` server-side; never trust a client-supplied userId.
- The dashboard *content* (the "Your workspace" cards + document grid from the mockup) is built in `04` once document CRUD exists — here we just need the shell + an empty/placeholder main area.
