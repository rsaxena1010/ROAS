import { defineConfig } from "drizzle-kit";

/**
 * `turso` is the libSQL dialect. It handles both a local `file:` URL (dev) and a remote
 * `libsql://` URL (Vercel/Turso) with identical migrations.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./.data/roas.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  },
});
