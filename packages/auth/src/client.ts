import { createAuthClient } from "better-auth/react";

/**
 * Browser auth client. Base URL inferred from the current origin in the browser.
 * Usage: authClient.signIn.email(...), authClient.signIn.social({ provider:
 * "github" }), authClient.signUp.email(...), authClient.useSession().
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
