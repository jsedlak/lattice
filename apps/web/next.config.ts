import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Monorepo: a single `.env` lives at the repo root for LOCAL dev. Next only
// auto-loads env files from this app's directory, so we load the root one here
// (this runs in the Node process that serves dev/build/start, populating
// process.env for all server code). Drizzle migrations read the same root
// `.env` directly. On Vercel there is no `.env` — env vars are injected by the
// platform — so we skip this entirely in that environment.
if (!process.env.VERCEL) {
  loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env") });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TS source; transpile them.
  transpilePackages: [
    "@lattice/ui",
    "@lattice/db",
    "@lattice/auth",
    "@lattice/ai",
    "@lattice/graph",
    "@lattice/ingest",
    "@lattice/config",
  ],
  // Heavy Node-only parsers must not be bundled — kept external for the server.
  serverExternalPackages: ["unpdf", "mammoth", "xlsx", "@vercel/blob"],
  // Bundle the repo-root assistant config into the serverless functions that
  // read it (it lives outside apps/web, so it isn't traced automatically).
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../../"),
  outputFileTracingIncludes: {
    "/assistant": ["../../data/assistant.json"],
    "/assistant/[id]": ["../../data/assistant.json"],
    "/api/chat": ["../../data/assistant.json"],
  },
  eslint: {
    // Lint is run as its own CI step; don't fail production builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
