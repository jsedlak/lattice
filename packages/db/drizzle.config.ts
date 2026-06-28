import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Migrations use the DIRECT (unpooled) connection string.
config({ path: "../../.env" });

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  // pgvector extension is enabled by the 0000 pre-migration (see drizzle/0000_*).
  verbose: true,
  strict: true,
});
