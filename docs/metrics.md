# Metric definitions

Two families of metric, deliberately kept apart.

**REPORTED** is what a platform's own dashboard shows: attributed revenue divided by ad
spend. It is useful only for comparing like-for-like *inside* one platform.

**TRUE** is net of returns, brand-funded discounts, event participation fees and platform
fees. It is comparable across Amazon, Flipkart, Nykaa, Myntra, BigBasket, Blinkit and Zepto,
and it is the only basis on which money should be moved between them.

All money is integer **paise** end to end (1 INR = 100 paise). Rupees exist only at the
edges — UI rendering, CSV import/export, API bodies. Rates and ratios are `REAL` in 0..1.

---

## Why reported ROAS is not comparable across platforms

Attribution windows differ: 14 days on Amazon, 7 on Flipkart/Myntra/Nykaa, 3 on BigBasket,
1 on Blinkit and Zepto. A 1-day quick-commerce ROAS and a 14-day marketplace ROAS are
different quantities. Ranking channels on reported ROAS therefore systematically over-funds
the long-window platforms. Every aggregate in this product carries a `comparability` record
so the UI can say so rather than hide it.

## The two investment bases

A single "spend" number cannot answer both "is this channel working?" and "is this platform
a good business?", so both are computed and named.

| | Included | Used for |
|---|---|---|
| **Channel basis** (`totalInvestmentPaise`) | Accountable ad spend + the ads' *pro-rata share* of brand-funded discount and event fees | Judging an ad channel |
| **Platform basis** (`platformInvestmentPaise`) | Accountable ad spend + *all* brand-funded discount + *all* event fees | Judging a platform, and MER |

`attributedShare = min(1, attributedRevenue / totalGrossRevenue)` is the share of trade the
ads were credited with, and is what pro-rates the discount bill onto them. Loading the
brand's entire discount bill onto the ad channels would condemn every channel regardless of
how it performed; ignoring it entirely is what platform reporting already does.

**Platform-funded media is excluded from both.** If the platform paid for the placement it is
not the brand's cost, and charging it to the brand understates every channel it appears in.

**Co-op / brand-fund media is included but flagged.** Money drawn from a platform's co-op
fund is real spend for ROAS purposes but is *not* cash out of the brand's account, so
`cashAdSpendPaise` and `brandFundSpendPaise` are tracked separately.

---

## Definitions

### Efficiency

- **`reportedRoas`** = attributed revenue ÷ ad spend (all spend, including platform-funded).
  The platform's own number, reproduced unchanged.
- **`trueRoas`** = `netAttributedRevenuePaise` ÷ `totalInvestmentPaise`.
- **`netAttributedRevenuePaise`** = attributed revenue − returns loss − the ads' share of
  brand-funded discount.
- **`blendedRoas`** (MER) = `netTotalRevenuePaise` ÷ `platformInvestmentPaise`. All trade,
  ads and organic, against every rupee put into the platform.
- **`acos`** = ad spend ÷ attributed revenue.
- **`tacos`** = ad spend ÷ total revenue.
- **`trueTacos`** = `platformInvestmentPaise` ÷ total revenue — TACOS including promo and
  fund money. This is the honest "what does marketing cost me" number.
- **`contributionRoas`** = contribution earned per rupee invested. Above 1.0 the channel pays
  for itself.
- **`breakEvenRoas`** = 1 ÷ gross contribution rate. `Infinity` when there is no margin to
  fund marketing at all. **Spend below this multiple destroys money no matter what the
  platform dashboard says.**
- **`efficiencyIndex`** = `trueRoas` ÷ `breakEvenRoas`. Above 1 is profitable growth. This is
  the one number that is comparable across platforms *and* across brands with different
  margins.

### Acquisition

- **`newCustomers`** — the sales-side count where available (includes organic), otherwise the
  ad-reported new-to-brand orders.
- **`cacPaise`** = `platformInvestmentPaise` ÷ `newCustomers`. Blended: every marketing rupee
  against every new customer, paid or organic.
- **`paidCacPaise`** = accountable ad spend ÷ ad-attributed new-to-brand orders. Comparable
  to platform reporting.
- **`ltvPaise`** = contribution per acquired customer × `expectedRepeatPurchases`.
- **`ltvToCac`** — below 1 means each new customer costs more than they will ever contribute.

### Profit

- **`grossContributionPaise`** = net revenue × gross contribution rate, where the rate comes
  from per-listing fee profiles and per-product COGS (see `domain/economics.ts`).
- **`netContributionPaise`** = gross contribution − `platformInvestmentPaise`. Contribution is
  a P&L number, so it carries the *full* platform cost, not the ads' share.

### Unit economics (per cohort, `domain/economics.ts`)

Revenue and variable fees apply only to **retained** units. Commission and payment fees are
charged on **what the customer actually paid**, not on list price. The platform keeps its own
funded discount out of the settlement, so the brand is docked only for the share it agreed to
fund. Returns cost the reverse leg plus a write-off on the goods (default 35% unrecoverable).

```
settlement        = retainedGross − retainedBrandDiscount − commission − paymentFee − fulfilment
grossContribution = settlement − COGS − returnCost
```

---

## Allocation vs measurement

Ad rows and sales/promotion rows live at different grains.

- **Platform, product, category and day exist in both**, so those cuts combine directly and
  are marked `allocationBasis: "direct"`.
- **Ad type, campaign and asset exist only on the ad side.** Brand-funded discounts and
  participation fees are *pro-rated* onto them by share of attributed revenue and marked
  `allocationBasis: "prorated"`. That is an allocation, not a measurement, and every affected
  row says so in the UI.

Event participation fees are charged per promotion, not per day, so they are spread evenly
across the promotion's days inside the window — a 9-day event does not dump its whole fee on
day one.

Where a sales row carries a discount with no matching promotion record, the discount is
treated as **fully brand-funded**. Assuming the platform paid for it would flatter every
metric downstream.

---

## Response curves and marginal return (`domain/curves.ts`)

Curves are fitted on **daily** (spend, response) points, so every optimizer figure is a daily
rupee amount. Mixing a 30-day total with a daily curve is the easiest way to be wrong by 30x.

Before fitting, response is **deseasonalised** by a structural demand index built from
grouped calendar means (day-of-week and event-period factors), not from the day's own
realised sales. Dividing a day's response by that same day's revenue destroys the signal:
organic sales are a 1.5–3x halo on ad-driven sales, so a day where ads worked is a day where
the naive index is high. Days at extreme demand are dropped rather than divided.

Below an r² of 0.1 the fit is treated as noise and a diminishing-returns prior is substituted
(`assumed: true`). A spuriously flat curve reports a marginal ROAS near zero and would cause
the optimizer to defund a healthy channel.

Curves are trusted only up to `EXTRAPOLATION_LIMIT` (3x) the highest daily spend observed.
Beyond that the recommendation is capped and the UI says the figure is an extrapolation.

**Marginal, not average.** Recommendations are priced on what the *next* rupee returns, and
on its **contribution**, not its revenue: a channel returning 3x revenue at an 18% margin
destroys money. At the optimum every unconstrained channel shares one marginal ROAS — the
brand's true cost of growth.

---

## Promotions

Promotions are priced **per run**, never extrapolated across a planning horizon like a media
channel. An event recurs on the platform's calendar rather than daily, and promoted revenue
includes demand that would have arrived at full price anyway. Scaling it to 30 days would
credit a markdown with cannibalised sales and let it outrank every media recommendation on
the strength of an accounting artefact. Reported promo contribution is an **upper bound**.

A "promotion" spanning ≥80% of the window is the everyday price, not an event: "run it again"
is not a decision anyone can take about it, so only its affordability is assessed.
