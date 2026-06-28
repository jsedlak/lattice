import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Drizzle client over Neon's serverless HTTP driver. Suitable for serverless
 * route handlers and Inngest functions. Note: neon-http transactions are
 * batched (non-interactive) — fine for our "delete-then-insert" edge replaces.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Defer hard failure to first use so importing the package (e.g. in tests
  // that mock the db) doesn't crash on a missing env var.
  console.warn("[@lattice/db] DATABASE_URL is not set — queries will fail.");
}

// A well-formed placeholder so importing this module never throws when
// DATABASE_URL is unset (tests, `next build` without env). neon-http is lazy —
// it only connects on the first query, which will then fail clearly.
const sql = neon(connectionString ?? "postgresql://user:password@db.invalid.neon.tech/lattice?sslmode=require");
export const db = drizzle(sql, { schema });

export type Database = typeof db;
