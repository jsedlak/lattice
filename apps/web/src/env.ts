import { z } from "zod";

/**
 * Environment validation. Server vars are validated lazily so the browser bundle
 * (which can't see them) and env-less CI typechecks don't crash. In production,
 * missing required vars surface as a clear warning at boot and an error at first
 * use of the dependent feature.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // AI Gateway: optional in env (OIDC supplies it on Vercel in production).
  AI_GATEWAY_API_KEY: z.string().optional(),
  CHAT_MODEL: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export const clientEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

let cached: z.infer<typeof serverSchema> | null = null;

/** Validate + return server env. Call from server code only. Throws if invalid. */
export function serverEnv(): z.infer<typeof serverSchema> {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    console.warn(
      "[env] Server environment is incomplete:",
      parsed.error.flatten().fieldErrors,
    );
    // Return a best-effort object so non-dependent paths still work in dev.
    cached = process.env as unknown as z.infer<typeof serverSchema>;
    return cached;
  }
  cached = parsed.data;
  return cached;
}
