# ROAS

True ROAS, CAC, promotions and brand-fund spend across every marketplace and quick-commerce
platform an Indian D2C brand sells on — and where to move the next rupee.

Platform dashboards report attributed revenue ÷ ad spend. That number ignores the commission,
the fulfilment fee, the brand-funded half of a "platform" discount, the event participation fee
and the returns. A brand at 6x reported ROAS can be losing money per order. This product
computes the version that nets all of it out, on one basis, so spend can actually be compared
across Amazon, Flipkart, Myntra, Nykaa, BigBasket, Blinkit and Zepto.

## Quick start

```bash
npm install
cp .env.example .env       # defaults work: sandbox connectors, local SQLite file
npm run db:push            # create the schema
npm run db:seed            # 2 demo brands, 7 platforms, 120 days of synthetic history
npm run dev                # http://127.0.0.1:3000
```

Demo logins (password `demo1234`):

| Email | Sees |
|---|---|
| `growth@vanyanaturals.in` | Vanya Naturals — 7 platforms, 14 SKUs |
| `marketing@harvestco.in` | Harvest & Co. — 4 platforms, 5 SKUs |
| `portfolio@demo.in` | Both brands — for the cross-brand cut |

Seeded figures come from a deterministic local generator, not a real platform. Nothing needs
credentials until a platform account is switched to live mode in Settings.

```bash
npm test          # vitest over the domain layer and the CSV parser
npm run typecheck
npm run verify    # end-to-end integrity check over the seeded data
npm run db:reset  # wipe, re-push, re-seed
```

## What's in it

| Page | Answers |
|---|---|
| **Overview** | Reported vs true ROAS, MER, CAC against target, net contribution, and where the marketing bill actually goes |
| **Recommendations** | What to invest in — ads, banners, video, influencer, coupons, promos, co-op fund — on which platform, for which SKUs, what it should return, and how long to run it |
| **Platforms** | Each platform as a business: total cost, net return, its own break-even |
| **SKUs** | Per-product economics, return rates, loss-making SKUs |
| **Cuts** | The same true-basis numbers sliced by category, brand, platform, ad type, campaign, creative, funding source or day |
| **Promos & funds** | Brand-funded vs platform-funded markdown, event fees, and co-op fund that is about to lapse |
| **Planner** | Fitted response curves per channel and a marginal-return budget allocation |
| **Upload data** | CSV import for the five platforms with no public ads API |
| **Settings** | Targets that drive every threshold, per-platform fees, and honest connector status |

## The three ideas it is built on

**1. Reported ROAS is not comparable across platforms.** Attribution windows run from 1 day on
quick commerce to 14 on Amazon. Ranking channels on reported ROAS systematically over-funds the
long-window platforms, so every cross-platform comparison here uses a common true basis, and
mixed windows raise a visible warning rather than being hidden.

**2. Media is usually not the biggest marketing line.** Brand-funded discount frequently costs
more than the entire ad budget, and it is normally managed by a different team with no ROAS
target attached. It is treated as marketing spend throughout — as are event participation fees
and co-op fund drawdowns.

**3. Judge the next rupee, not the average one.** Recommendations are priced on the marginal
return from a fitted response curve, and on **contribution** rather than revenue: a channel
returning 3x revenue at an 18% margin destroys money.

Consequences that show up everywhere in the code: platform-funded media is excluded from the
brand's cost entirely; co-op money is accountable spend but never cash; a discount with no
matching promotion record is assumed brand-funded rather than free; and any figure that is an
allocation rather than a measurement is labelled as one.

## Docs

- [docs/metrics.md](docs/metrics.md) — every metric definition, the two investment bases, and
  where allocation replaces measurement
- [docs/architecture.md](docs/architecture.md) — layering, the async-libSQL footgun, idempotent
  ingestion, tenancy, and the Postgres migration path

## Stack

Next.js 16 (App Router, server components, server actions) · React 19 · TypeScript ·
Tailwind 4 · drizzle-orm on libSQL/SQLite · recharts · zod · vitest.

No client-side data fetching and no API layer for the UI: pages are async server components
that call the service layer directly, and mutations are server actions.
