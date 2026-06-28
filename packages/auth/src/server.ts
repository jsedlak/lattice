import { account, db, session, user, verification } from "@lattice/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * BetterAuth server instance. Email/password + GitHub OAuth. The drizzle adapter
 * is wired to the auth tables co-located in @lattice/db.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },
});

export type Auth = typeof auth;

/** Resolve the signed-in user from request headers, or null. Framework-agnostic
 *  so it works in route handlers, server components, and Inngest. The web app
 *  wraps this with next/headers in its requireUser() helper. */
export async function getUserFromHeaders(headers: Headers) {
  const result = await auth.api.getSession({ headers });
  return result?.user ?? null;
}

export type SessionUser = NonNullable<
  Awaited<ReturnType<typeof getUserFromHeaders>>
>;
