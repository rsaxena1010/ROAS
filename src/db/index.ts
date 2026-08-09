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

/**
 * Accept the Turso integration's variable names as well as our own.
 *
 * Vercel's Turso marketplace integration provisions `TURSO_DATABASE_URL` and
 * `TURSO_AUTH_TOKEN`. Reading only `DATABASE_URL`/`DATABASE_AUTH_TOKEN` meant a correctly
 * connected database looked entirely absent: the app fell back to the local file default and
 * failed the serverless guard, which points at a missing variable that was in fact already
 * there under another name. Prefer the explicit names, fall back to the integration's.
 */
function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    // An env var set to an empty string is a misconfiguration, not a choice.
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function resolveUrl(): string {
  return firstEnv("DATABASE_URL", "TURSO_DATABASE_URL") || "file:./.data/roas.db";
}

export function resolveAuthToken(): string | undefined {
  return firstEnv("DATABASE_AUTH_TOKEN", "TURSO_AUTH_TOKEN");
}

const globalForDb = globalThis as unknown as {
  __roasDb?: DrizzleDb;
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
    `No database URL is configured, so this fell back to "${url}", a local SQLite file — ` +
      `but it is running on ${host}, whose filesystem is read-only and ephemeral. ` +
      "Set DATABASE_URL (or TURSO_DATABASE_URL, which Vercel's Turso integration provisions) " +
      "to a hosted libSQL database, plus the matching auth token. See docs/deploy.md.",
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
  if (url.startsWith("libsql://") && !resolveAuthToken()) {
    throw new Error(
      "DATABASE_URL is a remote libSQL URL but no auth token is set. Set DATABASE_AUTH_TOKEN " +
        "(or TURSO_AUTH_TOKEN, which Vercel's Turso integration provisions) in the " +
        "deployment's environment variables. See docs/deploy.md.",
    );
  }
  const client = createClient({
    url,
    authToken: resolveAuthToken(),
  });
  return drizzle(client, { schema });
}

type DrizzleDb = ReturnType<typeof createDb>;

// Next dev recompiles modules per request; without the cache we'd open a new connection
// on every hot reload.
function connection(): DrizzleDb {
  const cached = globalForDb.__roasDb;
  if (cached) return cached;
  const created = createDb();
  globalForDb.__roasDb = created;
  return created;
}

/**
 * Lazy on purpose.
 *
 * `next build` imports every page module to collect its configuration, so anything constructed
 * at module scope runs during the build. When this was `const db = createDb()`, that made a
 * *build* depend on runtime database credentials: on Vercel the deploy failed at "Collecting
 * page data" with a connection-string error, which is the wrong place to learn about a missing
 * environment variable. Nothing queries during the build — every route here is dynamic — so the
 * client should not exist until something actually uses it.
 *
 * The proxy defers `createDb()` (and therefore both config checks) to first property access,
 * which is the first real query. Methods are bound to the underlying instance rather than to
 * the proxy so drizzle's internals see the object they expect.
 */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, property) {
    const real = connection() as unknown as Record<string | symbol, unknown>;
    const value = real[property];
    return typeof value === "function" ? value.bind(real) : value;
  },
  has(_target, property) {
    return property in (connection() as unknown as object);
  },
});

export { schema };
export type Db = DrizzleDb;
