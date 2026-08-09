# Architecture

```
src/
  app/(app)/          pages — server components, one per nav section
  app/login/          auth pages + server actions
  components/         presentational; charts/ wraps recharts
  services/           orchestration: analytics, insights, planner, recommend, promotions, ingest
  domain/             pure functions: economics, metrics, curves, optimizer  (no I/O, no DB)
  connectors/         one module per platform + sandbox generator + CSV importer
  db/                 drizzle schema, client, seed
  lib/                money, date, auth, range, page plumbing
tests/                vitest over the domain layer and the CSV parser
```

The dependency rule is one-directional: `app → services → domain`, and `domain` imports
nothing but `lib`. Everything in `domain/` is a pure function over plain numbers, which is why
it is the part that carries test coverage — it holds all the arithmetic that would be
expensive to get wrong.

## Storage

libSQL (`@libsql/client` + `drizzle-orm/libsql`) rather than better-sqlite3, so the same code
and the same schema run in three places without a dialect fork:

| | `DATABASE_URL` |
|---|---|
| local dev | `file:./.data/roas.db` — a plain SQLite file, zero setup |
| Vercel | `libsql://<db>.turso.io` + `DATABASE_AUTH_TOKEN` |
| tests | `file::memory:` |

Vercel's filesystem is read-only and ephemeral, so a local file cannot be the production
store — but the dialect is identical, so migrations and queries are unchanged.

**The libSQL driver is async.** Every drizzle call must be awaited, including `.get()`,
`.run()` and `.returning()`. This is the one footgun in the data layer: because `Day` and the
row types are structurally plain, a missing `await` yields a `Promise` that is truthy and
whose fields are `undefined`, so it fails somewhere downstream rather than at the call site.

### Postgres migration path

Every construct used in `db/schema.ts` has a 1:1 Postgres equivalent. When this outgrows
libSQL:

- `text` primary keys with `crypto.randomUUID()` → `uuid DEFAULT gen_random_uuid()`
- `integer` epoch-ms timestamps → `timestamptz` (the app already treats them as opaque)
- `text(... { mode: "json" })` → `jsonb`
- `text(... { enum: [...] })` → a check constraint or a Postgres enum
- the `grainKey` / `entryKey` unique indexes stay as-is (see below)

## Idempotent ingestion

Fact tables carry a synthetic natural key so re-syncing a period cannot duplicate rows:

- `ad_metrics_daily.grainKey` = `day|campaignId|assetId|productId`, with `-` for absent parts.
  SQLite *and* Postgres treat `NULL`s as distinct in a unique index, so a unique index over
  the nullable asset/product columns would let a re-sync insert duplicates. Collapsing them
  into one text key fixes that in both dialects.
- `brand_fund_ledger.entryKey` = `day|entryType|reference`.

`writePayload()` upserts on these keys, which is what makes both the connector sync and the
CSV import safely repeatable.

**Uploads land at campaign × SKU × day grain.** The importer sums any finer rows first,
because writing two ad-group rows without first creating those ad assets would collapse them
onto one `grainKey` and silently lose the second. Ad-metric rows whose campaign does not exist
are dropped by `writePayload`, so the importer creates missing campaigns up front and reports
that it guessed an ad type.

## Analytics: aggregate in JS, not SQL

`services/analytics.ts` loads the brand's rows for a window once and aggregates in JavaScript
rather than pushing each cut into SQL. True ROAS is not a SQL-shaped metric — it needs
per-listing fee profiles, per-product COGS, promo funding splits and pro-rated participation
fees combined at whatever grain the user picked. Expressing that as one query per view
produced six near-duplicate queries that drifted apart.

The volumes justify it: 20 SKUs × 7 platforms × 120 days is ~40k ad rows and ~16k sales rows —
tens of milliseconds to scan. At 100x that, this moves to pre-aggregated daily rollups or a
warehouse; the function signatures are built to survive that swap.

## Connectors

`Connector` is a single interface — `fetch(ctx, range) → ConnectorPayload` — behind which sit
three realities, declared honestly in `capabilities`:

- **Amazon, Flipkart** — public APIs with vendor sandboxes. Sandboxes return *structural*
  responses, not real numbers.
- **Myntra, Nykaa, BigBasket, Blinkit, Zepto** — no public self-serve ads API today. Ingestion
  is via scheduled report files (the CSV importer) or a partner API base URL once granted.
- **sandbox mode** — a deterministic synthetic generator (seeded RNG, so runs are
  reproducible) which is what the demo data is.

Secrets are read from the environment per platform at call time and are **never** written to
the database; `platform_accounts.config` holds non-secret settings only.

Where a capability is missing the product degrades explicitly rather than silently: a platform
with no new-to-brand reporting shows an estimated CAC, and Settings states the real
integration status per platform.

## Auth and tenancy

Session cookie (`roas_session`, httpOnly, SameSite=lax, 30d) → `sessions` row → user → brand.
Passwords are scrypt with a per-user salt; `authenticate()` hashes even when the user does not
exist so a missing account and a wrong password take the same time.

Everything is scoped by `brandId`. `users.brandId` is the home brand; `brand_members` grants
read access to additional brands for a portfolio or agency account. Any cross-brand view must
source its brand list from `accessibleBrands()` — never an unfiltered `brands` query. With no
membership rows a user sees exactly their own brand, so the cross-brand cut degrades to a
single row rather than breaking.

Server actions re-derive the principal and re-validate every input. `savePlanAction`
recomputes the plan server-side rather than trusting a client-supplied allocation, and every
mutation scopes its `where` clause to the caller's brand.

## Design system

Tokens live in `app/globals.css`; charts read CSS custom properties and never hard-code a hex,
so light/dark swaps in one place. Categorical series slots are assigned in fixed order and
bound to entity keys rather than array position, so hiding one series does not repaint the
others.

Two light-mode slots sit below 3:1 against the light surface. That is allowed only with
relief, so every chart ships a legend, direct labels on the series that matter, and a table
view. Status colours are reserved and always paired with an icon and a label — no judgement in
this product rests on hue alone.

One deliberate constraint: **`TrendChart` takes a single y-axis.** Plotting ROAS and spend on
two scales is the most misleading thing a dashboard can do, because the crossover point is an
artefact of the scales chosen. Series handed to one chart must share units.
