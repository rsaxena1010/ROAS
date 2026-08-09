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

/**
 * Are we running on a serverless host, as opposed to merely building for production?
 *
 * This is deliberately NOT `NODE_ENV === "production"`: `next build` sets that locally, and
 * building a production bundle against the local file database is entirely legitimate. Gating
 * on the host means a local `npm run build` still works while a real deployment fails fast —
 * on Vercel these variables are present during the build too, so the failure lands in the
 * build log rather than in front of a user.
 */
function serverlessHost(): string | null {
  if (process.env.VERCEL) return "Vercel";
  if (process.env.NETLIFY) return "Netlify";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "AWS Lambda";
  return null;
}

/**
 * A local file is the right default for dev and the wrong answer on a serverless host: the
 * bundle ships without `.data/` (it is gitignored), the function filesystem is read-only
 * outside `/tmp`, and anything written there dies with the instance.
 *
 * Left alone, that surfaces as `EROFS: read-only file system, mkdir '/var/task/.data'` thrown
 * from module scope on the first request — which reads like a build problem rather than a
 * missing environment variable. Fail with the actual remedy instead.
 */
function assertDeployableUrl(url: string): void {
  const host = serverlessHost();
  if (!host) return;
  if (!url.startsWith("file:") || url.startsWith("file::memory:")) return;

  throw new Error(
    `DATABASE_URL is "${url}", a local SQLite file, but this is running on ${host}. ` +
      "A serverless filesystem is read-only and ephemeral, so a file database cannot work there. " +
      "Point DATABASE_URL at a hosted libSQL database (libsql://<db>.turso.io) and set " +
      "DATABASE_AUTH_TOKEN. See docs/deploy.md.",
  );
}

function createDb() {
  const url = resolveUrl();
  assertDeployableUrl(url);

  if (url.startsWith("file:") && !url.startsWith("file::memory:")) {
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }
  // Turso rejects unauthenticated connections; catch the omission here rather than as an
  // opaque 401 from the first query.
  if (url.startsWith("libsql://") && !process.env.DATABASE_AUTH_TOKEN) {
    throw new Error(
      `DATABASE_URL is a remote libSQL URL but DATABASE_AUTH_TOKEN is not set. ` +
        "Add it to the deployment's environment variables. See docs/deploy.md.",
    );
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
