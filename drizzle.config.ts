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
    // Also accept the names Vercel's Turso integration provisions, so `db:push` works against
    // a pulled production environment without renaming anything.
    url:
      process.env.DATABASE_URL?.trim() ||
      process.env.TURSO_DATABASE_URL?.trim() ||
      "file:./.data/roas.db",
    authToken:
      process.env.DATABASE_AUTH_TOKEN?.trim() || process.env.TURSO_AUTH_TOKEN?.trim(),
  },
});
