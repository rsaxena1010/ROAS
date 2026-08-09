# Deploying to Vercel

## The two things that will bite you

**1. Vercel builds your production branch.** By default that is `main`. If the app lives on a
feature branch, the production deployment has nothing to build and Vercel serves its own
platform-level `404: NOT_FOUND` (a styled page with a `Code:` and `ID:`, not the app's own 404).
Either merge to `main` or set **Settings → Git → Production Branch** to the branch you want.

**2. A `file:` database cannot work on Vercel.** `.data/roas.db` is gitignored, so it is not in
the bundle; the function filesystem is read-only outside `/tmp`; and anything written there dies
with the instance. `src/db/index.ts` now throws a named error rather than an opaque
`EROFS: read-only file system, mkdir '/var/task/.data'` from module scope.

You need a hosted libSQL database. The dialect is identical to local SQLite, so no schema or
query changes are required.

---

## Steps

### 1. Create the database

```bash
turso db create roas --location bom          # match the Vercel function region
turso db show roas --url                     # -> libsql://roas-<org>.turso.io
turso db tokens create roas                  # -> the auth token
```

**Co-locate the database with the function.** Every page runs several queries per request, so a
cross-region round trip is paid many times over. If Vercel is serving from `bom1` (Mumbai), put
the database in `bom`/`aws-ap-south-1` too — the deployment error ID is prefixed with the
region, e.g. `bom1::…`.

### 2. Set the environment variables

Set these in **Vercel → Settings → Environment Variables**, or with `vercel env add`. Do not
paste the token into a chat, an issue, or a commit.

| Variable | Value | Scope |
|---|---|---|
| `DATABASE_URL` | `libsql://roas-<org>.turso.io` | Production, Preview |
| `DATABASE_AUTH_TOKEN` | the token from step 1 | Production, Preview |
| `CONNECTOR_MODE` | `sandbox` | Production, Preview |

`NODE_ENV` is set by Vercel — don't override it. It matters here: it flips the session cookie to
`Secure` and enables the file-database guard.

`SESSION_SECRET` is listed in `.env.example` but is **not read by the app**; session ids are
random UUIDs stored in the `sessions` table. Setting it adds nothing today.

Leave the per-platform credentials unset unless you are switching an account to live mode. In
`sandbox` mode the connectors generate deterministic synthetic data and need nothing.

### 3. Create the schema on the remote database

`drizzle.config.ts` already reads both variables, so this works against Turso unchanged:

```bash
DATABASE_URL='libsql://roas-<org>.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
npm run db:push
```

### 4. Seed it

```bash
DATABASE_URL='libsql://roas-<org>.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
npm run db:seed
```

This writes ~26k ad rows and ~14k sales rows across 120 days. Over the network that is slow —
expect several minutes, and note that `services/ingest.ts` batches 400 statements at a time
specifically to stay inside libSQL's per-batch cap.

Faster alternative: seed locally, then upload the file.

```bash
npm run db:reset                    # builds .data/roas.db locally
turso db shell roas < dump.sql      # or: turso db import .data/roas.db
```

### 5. Deploy

With the GitHub integration, pushing the production branch is enough. Otherwise:

```bash
npx vercel --prod
```

### 6. Restrict access before sharing the URL

A Vercel deployment is reachable by anyone with the link by default. Turn on
**Settings → Deployment Protection → Vercel Authentication** so only your team can open it.

This app ships two demo accounts with the published password `demo1234`, and the seeded figures
are synthetic — but the login page prints those credentials on screen, so an unprotected
deployment is an open door to whatever data the database actually holds.

---

## Verifying a deployment

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<deployment>/login   # expect 200
```

- **Platform `404: NOT_FOUND` with a `Code:`/`ID:`** — Vercel has no build output. Wrong
  production branch (see above) or a wrong **Root Directory** setting.
- **500 on every route, `DATABASE_URL is "file:..."` in the function logs** — step 2 was
  skipped.
- **500 mentioning `DATABASE_AUTH_TOKEN is not set`** — the URL is remote but the token is
  missing from that environment. Note that Preview and Production have separate values.
- **`/login` renders but sign-in fails** — the schema exists but is empty; run step 4.
- **Sign-in succeeds then every page shows zeros** — seeded to a different database than the one
  the deployment points at, or the seeded window has aged out of the default 30-day range.

Check `vercel logs <deployment>` for the thrown message; both database misconfigurations now
name the missing variable and point back here.

---

## What runs where

All ten app routes are dynamic (`ƒ`) because they read the session cookie — there is nothing to
prerender and no ISR to invalidate. `next.config.ts` sets
`serverExternalPackages: ["@libsql/client"]` so the native client is not bundled.

The heaviest request is `/recommendations`, which loads the window, fits a response curve per
channel and prices every recommendation. On the demo brand that is ~40k rows scanned in
JavaScript. It is comfortably inside the default function limits, but if you widen the window to
a year or add SKUs, that is the route to watch — see the scaling note in
[architecture.md](architecture.md#analytics-aggregate-in-js-not-sql).
