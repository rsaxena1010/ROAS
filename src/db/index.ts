import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

/**
 * libSQL is used rather than better-sqlite3 so the same code and the same schema run in
 * three places without a dialect fork:
 *
 *   local dev   DATABASE_URL=file:./.data/roas.db   (a plain SQLite file, zero setup)
 *   Vercel      DATABASE_URL=libsql://<db>.turso.io + DATABASE_AUTH_TOKEN
 *   tests       DATABASE_URL=file::memory:
 *
 * Vercel's filesystem is read-only and ephemeral, so a local file cannot be the production
 * store — but the dialect is identical, so migrations and queries are unchanged.
 * Postgres remains the migration path if this outgrows libSQL; see docs/architecture.md.
 */

function resolveUrl(): string {
  return process.env.DATABASE_URL ?? "file:./.data/roas.db";
}

const globalForDb = globalThis as unknown as {
  __roasDb?: ReturnType<typeof createDb>;
};

function createDb() {
  const url = resolveUrl();
  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

// Next dev recompiles modules per request; without the cache we'd open a new connection
// on every hot reload.
export const db = globalForDb.__roasDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__roasDb = db;

export { schema };
export type Db = typeof db;
