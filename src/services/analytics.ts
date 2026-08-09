/**
 * Analytics service: raw daily rows -> the metrics the product actually shows.
 *
 * Design choice: load the brand's rows for the window once and aggregate in JavaScript
 * rather than pushing every cut into SQL. The reason is that true ROAS is not a SQL-shaped
 * metric — it needs per-listing fee profiles, per-product COGS, promo funding splits and
 * pro-rated participation fees combined at whatever grain the user picked. Expressing that
 * as one query per view produced six near-duplicate queries that drifted apart.
 *
 * The volumes justify it: a brand with 20 SKUs on 7 platforms over 120 days is ~40k ad rows
 * and ~16k sales rows — tens of milliseconds to scan. At 100x that (enterprise catalogues,
 * multi-year windows) this moves to pre-aggregated daily rollups or a warehouse; the
 * function signatures here are built to survive that swap.
 *
 * ATTRIBUTION HONESTY
 * -------------------
 * Ad rows and sales/promotion rows live at different grains. Platform, product and day
 * exist in both, so those cuts combine directly. Ad type, campaign and asset exist only on
 * the ad side, so brand-funded discounts and participation fees are PRO-RATED onto them by
 * share of attributed revenue. That's an allocation, not a measurement, and every row
 * carries `allocationBasis` so the UI can say so.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  adAssets,
  adMetricsDaily,
  brandFundLedger,
  campaigns,
  listings,
  platformAccounts,
  platforms,
  products,
  promotionMetricsDaily,
  promotions,
  salesDaily,
  type AdType,
  type Brand,
} from "@/db/schema";
import {
  computeCohortEconomics,
  resolveFeeProfile,
  type FeeProfile,
} from "@/domain/economics";
import {
  addAdTotals,
  addSalesTotals,
  computeMetrics,
  emptyAdTotals,
  emptySalesTotals,
  type AdTotals,
  type Metrics,
  type SalesTotals,
} from "@/domain/metrics";
import { daysBetween, previousPeriod, type Day } from "@/lib/date";
import { safeDiv } from "@/lib/money";
import type { DateRange } from "@/connectors/types";

export type Dimension =
  | "platform"
  | "ad_type"
  | "platform_ad_type"
  | "campaign"
  | "asset"
  | "product"
  | "category"
  | "funding_source"
  | "day";

/** Dimensions that exist on the sales/promotion side too, so no pro-rating is needed. */
const DIRECT_DIMENSIONS = new Set<Dimension>(["platform", "product", "category", "day"]);

export interface BrandData {
  brand: Brand;
  range: DateRange;
  adRows: AdRow[];
  salesRows: SalesRow[];
  promoRows: PromoRow[];
  fundRows: FundRow[];
  promoFeeByPlatformDay: Map<string, number>;
  fees: Map<string, FeeProfile>;
  cogs: Map<string, number>;
  productMeta: Map<string, { sku: string; name: string; category: string; repeat: number }>;
  platformMeta: Map<string, { name: string; attributionWindowDays: number; kind: string }>;
  campaignMeta: Map<string, { name: string; platformId: string; adType: AdType }>;
  assetMeta: Map<string, { name: string; assetType: string; campaignId: string }>;
}

interface AdRow {
  day: Day;
  platformId: string;
  platformAccountId: string;
  campaignId: string;
  adAssetId: string | null;
  productId: string | null;
  adType: AdType;
  fundingSource: string;
  impressions: number;
  clicks: number;
  spendPaise: number;
  orders: number;
  units: number;
  revenuePaise: number;
  newCustomerOrders: number;
  newCustomerRevenuePaise: number;
  returnedUnits: number;
}

interface SalesRow {
  day: Day;
  platformId: string;
  platformAccountId: string;
  productId: string;
  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  returnedUnits: number;
  newCustomers: number;
}

interface PromoRow {
  day: Day;
  platformId: string;
  productId: string;
  promotionId: string;
  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  brandFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  newCustomers: number;
}

interface FundRow {
  day: Day;
  platformAccountId: string;
  entryType: string;
  amountPaise: number;
  expiresOn: string | null;
}

/* ------------------------------------------------------------------ loading */

export async function loadBrandData(
  brand: Brand,
  range: DateRange,
): Promise<BrandData> {
  const inRange = <T extends { day: typeof salesDaily.$inferSelect.day }>(
    col: typeof salesDaily.day | typeof adMetricsDaily.day | typeof promotionMetricsDaily.day | typeof brandFundLedger.day,
  ) => and(gte(col, range.from), lte(col, range.to)) as unknown as T;

  const [adRows, salesRows, promoRows, fundRows, listingRows, productRows, platformRows, campaignRows, assetRows, promoDefs] =
    await Promise.all([
      db
        .select({
          day: adMetricsDaily.day,
          platformId: adMetricsDaily.platformId,
          platformAccountId: adMetricsDaily.platformAccountId,
          campaignId: adMetricsDaily.campaignId,
          adAssetId: adMetricsDaily.adAssetId,
          productId: adMetricsDaily.productId,
          adType: adMetricsDaily.adType,
          fundingSource: adMetricsDaily.fundingSource,
          impressions: adMetricsDaily.impressions,
          clicks: adMetricsDaily.clicks,
          spendPaise: adMetricsDaily.spendPaise,
          orders: adMetricsDaily.orders,
          units: adMetricsDaily.units,
          revenuePaise: adMetricsDaily.revenuePaise,
          newCustomerOrders: adMetricsDaily.newCustomerOrders,
          newCustomerRevenuePaise: adMetricsDaily.newCustomerRevenuePaise,
          returnedUnits: adMetricsDaily.returnedUnits,
        })
        .from(adMetricsDaily)
        .where(
          and(
            eq(adMetricsDaily.brandId, brand.id),
            gte(adMetricsDaily.day, range.from),
            lte(adMetricsDaily.day, range.to),
          ),
        ),
      db
        .select({
          day: salesDaily.day,
          platformId: salesDaily.platformId,
          platformAccountId: salesDaily.platformAccountId,
          productId: salesDaily.productId,
          units: salesDaily.units,
          grossRevenuePaise: salesDaily.grossRevenuePaise,
          discountPaise: salesDaily.discountPaise,
          returnedUnits: salesDaily.returnedUnits,
          newCustomers: salesDaily.newCustomers,
        })
        .from(salesDaily)
        .where(
          and(
            eq(salesDaily.brandId, brand.id),
            gte(salesDaily.day, range.from),
            lte(salesDaily.day, range.to),
          ),
        ),
      db
        .select({
          day: promotionMetricsDaily.day,
          platformId: promotionMetricsDaily.platformId,
          productId: promotionMetricsDaily.productId,
          promotionId: promotionMetricsDaily.promotionId,
          units: promotionMetricsDaily.units,
          grossRevenuePaise: promotionMetricsDaily.grossRevenuePaise,
          discountPaise: promotionMetricsDaily.discountPaise,
          brandFundedDiscountPaise: promotionMetricsDaily.brandFundedDiscountPaise,
          platformFundedDiscountPaise: promotionMetricsDaily.platformFundedDiscountPaise,
          newCustomers: promotionMetricsDaily.newCustomers,
        })
        .from(promotionMetricsDaily)
        .where(
          and(
            eq(promotionMetricsDaily.brandId, brand.id),
            gte(promotionMetricsDaily.day, range.from),
            lte(promotionMetricsDaily.day, range.to),
          ),
        ),
      db
        .select({
          day: brandFundLedger.day,
          platformAccountId: brandFundLedger.platformAccountId,
          entryType: brandFundLedger.entryType,
          amountPaise: brandFundLedger.amountPaise,
          expiresOn: brandFundLedger.expiresOn,
        })
        .from(brandFundLedger)
        .where(eq(brandFundLedger.brandId, brand.id)),
      db
        .select({
          productId: listings.productId,
          platformAccountId: listings.platformAccountId,
          takeRate: listings.takeRate,
          fulfilmentFeePaise: listings.fulfilmentFeePaise,
          paymentFeeRate: listings.paymentFeeRate,
        })
        .from(listings)
        .where(eq(listings.brandId, brand.id)),
      db
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          category: products.category,
          cogsPaise: products.cogsPaise,
          repeat: products.expectedRepeatPurchases,
        })
        .from(products)
        .where(eq(products.brandId, brand.id)),
      db.select().from(platforms),
      db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          adType: campaigns.adType,
          platformAccountId: campaigns.platformAccountId,
        })
        .from(campaigns)
        .where(eq(campaigns.brandId, brand.id)),
      db
        .select({
          id: adAssets.id,
          name: adAssets.name,
          assetType: adAssets.assetType,
          campaignId: adAssets.campaignId,
        })
        .from(adAssets)
        .where(eq(adAssets.brandId, brand.id)),
      db
        .select({
          id: promotions.id,
          platformAccountId: promotions.platformAccountId,
          startDay: promotions.startDay,
          endDay: promotions.endDay,
          participationFeePaise: promotions.participationFeePaise,
        })
        .from(promotions)
        .where(eq(promotions.brandId, brand.id)),
    ]);

  void inRange;

  const accountRows = await db
    .select({ id: platformAccounts.id, platformId: platformAccounts.platformId })
    .from(platformAccounts)
    .where(eq(platformAccounts.brandId, brand.id));
  const accountToPlatform = new Map(accountRows.map((a) => [a.id, a.platformId]));

  const platformById = new Map(platformRows.map((p) => [p.id, p]));

  // Fee profile per (platformAccount, product) with platform-level fallback.
  const fees = new Map<string, FeeProfile>();
  for (const l of listingRows) {
    const platformId = accountToPlatform.get(l.platformAccountId);
    const platform = platformId ? platformById.get(platformId) : undefined;
    if (!platform) continue;
    fees.set(
      `${l.platformAccountId}|${l.productId}`,
      resolveFeeProfile(l, platform),
    );
  }

  const cogs = new Map(productRows.map((p) => [p.id, p.cogsPaise]));
  const productMeta = new Map(
    productRows.map((p) => [
      p.id,
      { sku: p.sku, name: p.name, category: p.category, repeat: p.repeat },
    ]),
  );
  const platformMeta = new Map(
    platformRows.map((p) => [
      p.id,
      {
        name: p.name,
        attributionWindowDays: p.attributionWindowDays,
        kind: p.kind,
      },
    ]),
  );
  const campaignMeta = new Map(
    campaignRows.map((c) => [
      c.id,
      {
        name: c.name,
        adType: c.adType,
        platformId: accountToPlatform.get(c.platformAccountId) ?? "unknown",
      },
    ]),
  );
  const assetMeta = new Map(
    assetRows.map((a) => [
      a.id,
      { name: a.name, assetType: a.assetType, campaignId: a.campaignId },
    ]),
  );

  // Participation fees are charged per promotion, not per day. Spread them evenly across
  // the promo's days inside the window so a 9-day event doesn't dump its whole fee on day 1.
  const promoFeeByPlatformDay = new Map<string, number>();
  for (const p of promoDefs) {
    if (!p.participationFeePaise) continue;
    const platformId = accountToPlatform.get(p.platformAccountId);
    if (!platformId) continue;
    const totalDays = Math.max(1, daysBetween(p.startDay, p.endDay) + 1);
    const perDay = p.participationFeePaise / totalDays;
    const from = p.startDay > range.from ? p.startDay : range.from;
    const to = p.endDay < range.to ? p.endDay : range.to;
    if (from > to) continue;
    for (let d = from; d <= to; d = nextDay(d)) {
      const key = `${platformId}|${d}`;
      promoFeeByPlatformDay.set(key, (promoFeeByPlatformDay.get(key) ?? 0) + perDay);
    }
  }

  return {
    brand,
    range,
    adRows: adRows as AdRow[],
    salesRows: salesRows as SalesRow[],
    promoRows: promoRows as PromoRow[],
    fundRows: fundRows as FundRow[],
    promoFeeByPlatformDay,
    fees,
    cogs,
    productMeta,
    platformMeta,
    campaignMeta,
    assetMeta,
  };
}

function nextDay(day: Day): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------- aggregation */

export interface GroupedMetrics {
  key: string;
  label: string;
  sublabel?: string;
  dimension: Dimension;
  ad: AdTotals;
  sales: SalesTotals;
  metrics: Metrics;
  /** 'direct' when sales-side costs were measured at this grain, 'prorated' when allocated. */
  allocationBasis: "direct" | "prorated";
}

export function aggregate(data: BrandData, dimension: Dimension): GroupedMetrics[] {
  const direct = DIRECT_DIMENSIONS.has(dimension);

  const adByKey = new Map<string, AdTotals>();
  const windowsByKey = new Map<string, Set<number>>();
  const revenueByKey = new Map<string, number>();

  for (const row of data.adRows) {
    const key = adKeyFor(data, row, dimension);
    if (key == null) continue;
    const current = adByKey.get(key) ?? emptyAdTotals();
    adByKey.set(
      key,
      addAdTotals(current, {
        ...row,
        // Co-op-funded and platform-funded media are tracked separately so the
        // cash-vs-accountable distinction survives aggregation.
        brandFundSpendPaise: row.fundingSource === "brand_fund" ? row.spendPaise : 0,
        platformFundedSpendPaise:
          row.fundingSource === "platform_coop" ? row.spendPaise : 0,
      }),
    );
    revenueByKey.set(key, (revenueByKey.get(key) ?? 0) + row.revenuePaise);

    const window = data.platformMeta.get(row.platformId)?.attributionWindowDays;
    if (window != null) {
      const set = windowsByKey.get(key) ?? new Set<number>();
      set.add(window);
      windowsByKey.set(key, set);
    }
  }

  const salesByKey = new Map<string, SalesTotals>();
  const contributionByKey = new Map<string, { contribution: number; revenue: number }>();

  for (const row of data.salesRows) {
    const key = direct ? salesKeyFor(data, row, dimension) : "__all__";
    if (key == null) continue;

    const promo = promoForSalesRow(data, row);
    const fee = data.fees.get(`${row.platformAccountId}|${row.productId}`);
    const cogsPerUnit = data.cogs.get(row.productId) ?? 0;

    const totals = salesByKey.get(key) ?? emptySalesTotals();
    salesByKey.set(
      key,
      addSalesTotals(totals, {
        units: row.units,
        grossRevenuePaise: row.grossRevenuePaise,
        discountPaise: row.discountPaise,
        brandFundedDiscountPaise: promo.brandFunded,
        platformFundedDiscountPaise: promo.platformFunded,
        returnedUnits: row.returnedUnits,
        newCustomers: row.newCustomers,
      }),
    );

    if (fee) {
      const econ = computeCohortEconomics(
        {
          units: row.units,
          returnedUnits: row.returnedUnits,
          grossRevenuePaise: row.grossRevenuePaise,
          discountPaise: row.discountPaise,
          brandFundedDiscountPaise: promo.brandFunded,
          cogsPerUnitPaise: cogsPerUnit,
        },
        fee,
      );
      const acc = contributionByKey.get(key) ?? { contribution: 0, revenue: 0 };
      acc.contribution += econ.grossContributionPaise;
      acc.revenue += econ.retainedGrossPaise;
      contributionByKey.set(key, acc);
    }
  }

  // Participation fees, keyed the same way.
  const feeByKey = new Map<string, number>();
  for (const [key, amount] of data.promoFeeByPlatformDay) {
    const [platformId, day] = key.split("|");
    const groupKey = direct
      ? dimension === "platform"
        ? platformId
        : dimension === "day"
          ? day
          : null
      : "__all__";
    if (groupKey == null) continue;
    feeByKey.set(groupKey, (feeByKey.get(groupKey) ?? 0) + amount);
  }

  const totalAttributedRevenue = [...revenueByKey.values()].reduce((s, v) => s + v, 0);
  const allSales = salesByKey.get("__all__") ?? emptySalesTotals();
  const allContribution = contributionByKey.get("__all__") ?? { contribution: 0, revenue: 0 };
  const allFees = feeByKey.get("__all__") ?? 0;

  const out: GroupedMetrics[] = [];
  const keys = direct
    ? new Set([...adByKey.keys(), ...salesByKey.keys()])
    : new Set(adByKey.keys());

  for (const key of keys) {
    if (key === "__all__") continue;
    const ad = adByKey.get(key) ?? emptyAdTotals();

    let sales: SalesTotals;
    let contributionRate: number;
    let participationFee: number;

    if (direct) {
      sales = salesByKey.get(key) ?? emptySalesTotals();
      const c = contributionByKey.get(key) ?? { contribution: 0, revenue: 0 };
      contributionRate = safeDiv(c.contribution, c.revenue);
      participationFee = feeByKey.get(key) ?? 0;
    } else {
      // Pro-rate the brand's sales-side costs by this group's share of attributed revenue.
      const share = safeDiv(revenueByKey.get(key) ?? 0, totalAttributedRevenue);
      sales = scaleSalesTotals(allSales, share);
      contributionRate = safeDiv(allContribution.contribution, allContribution.revenue);
      participationFee = allFees * share;
    }
    sales.participationFeePaise = Math.round(participationFee);

    const repeat = averageRepeat(data);
    const metrics = computeMetrics(ad, sales, {
      grossContributionRate: contributionRate,
      expectedRepeatPurchases: repeat,
      attributionWindowDays: [...(windowsByKey.get(key) ?? [])],
    });

    const meta = labelFor(data, dimension, key);
    out.push({
      key,
      label: meta.label,
      sublabel: meta.sublabel,
      dimension,
      ad,
      sales,
      metrics,
      allocationBasis: direct ? "direct" : "prorated",
    });
  }

  return out.sort((a, b) =>
    dimension === "day"
      ? a.key.localeCompare(b.key)
      : b.metrics.totalInvestmentPaise - a.metrics.totalInvestmentPaise,
  );
}

/** Brand-level totals, using the direct (measured) path for everything. */
export function aggregateTotal(data: BrandData): GroupedMetrics {
  const byPlatform = aggregate(data, "platform");
  let ad = emptyAdTotals();
  let sales = emptySalesTotals();
  let contribution = 0;
  let revenue = 0;
  const windows = new Set<number>();

  for (const g of byPlatform) {
    ad = addAdTotals(ad, g.ad);
    sales = addSalesTotals(sales, g.sales);
    contribution += g.metrics.grossContributionPaise;
    revenue += g.metrics.netTotalRevenuePaise;
    for (const w of g.metrics.comparability.attributionWindowDays) windows.add(w);
  }

  const metrics = computeMetrics(ad, sales, {
    grossContributionRate: safeDiv(contribution, revenue),
    expectedRepeatPurchases: averageRepeat(data),
    attributionWindowDays: [...windows],
  });

  return {
    key: "__brand__",
    label: data.brand.name,
    dimension: "platform",
    ad,
    sales,
    metrics,
    allocationBasis: "direct",
  };
}

/** Same window and the one immediately before it, for period-over-period deltas. */
export async function aggregateWithComparison(
  brand: Brand,
  range: DateRange,
  dimension: Dimension,
): Promise<{
  current: GroupedMetrics[];
  previous: Map<string, GroupedMetrics>;
  total: GroupedMetrics;
  previousTotal: GroupedMetrics;
  data: BrandData;
}> {
  const prevRange = previousPeriod(range.from, range.to);
  const [data, prevData] = await Promise.all([
    loadBrandData(brand, range),
    loadBrandData(brand, prevRange),
  ]);

  const current = aggregate(data, dimension);
  const previous = new Map(aggregate(prevData, dimension).map((g) => [g.key, g]));

  return {
    current,
    previous,
    total: aggregateTotal(data),
    previousTotal: aggregateTotal(prevData),
    data,
  };
}

/* --------------------------------------------------------------- key/labels */

function adKeyFor(data: BrandData, row: AdRow, dimension: Dimension): string | null {
  switch (dimension) {
    case "platform":
      return row.platformId;
    case "ad_type":
      return row.adType;
    case "platform_ad_type":
      return `${row.platformId}::${row.adType}`;
    case "campaign":
      return row.campaignId;
    case "asset":
      return row.adAssetId;
    case "product":
      return row.productId;
    case "category":
      return row.productId ? (data.productMeta.get(row.productId)?.category ?? null) : null;
    case "funding_source":
      return row.fundingSource;
    case "day":
      return row.day;
  }
}

function salesKeyFor(
  data: BrandData,
  row: SalesRow,
  dimension: Dimension,
): string | null {
  switch (dimension) {
    case "platform":
      return row.platformId;
    case "product":
      return row.productId;
    case "category":
      return data.productMeta.get(row.productId)?.category ?? null;
    case "day":
      return row.day;
    default:
      return null;
  }
}

function labelFor(
  data: BrandData,
  dimension: Dimension,
  key: string,
): { label: string; sublabel?: string } {
  switch (dimension) {
    case "platform":
      return { label: data.platformMeta.get(key)?.name ?? key };
    case "ad_type":
      return { label: prettyAdType(key) };
    case "platform_ad_type": {
      const [platformId, adType] = key.split("::");
      return {
        label: prettyAdType(adType),
        sublabel: data.platformMeta.get(platformId)?.name ?? platformId,
      };
    }
    case "campaign": {
      const c = data.campaignMeta.get(key);
      return { label: c?.name ?? key, sublabel: c ? prettyAdType(c.adType) : undefined };
    }
    case "asset": {
      const a = data.assetMeta.get(key);
      return {
        label: a?.name ?? key,
        sublabel: a ? prettyAssetType(a.assetType) : undefined,
      };
    }
    case "product": {
      const p = data.productMeta.get(key);
      return { label: p?.name ?? key, sublabel: p?.sku };
    }
    case "funding_source":
      return { label: prettyFunding(key) };
    default:
      return { label: key };
  }
}

export function prettyAdType(adType: string): string {
  return adType
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function prettyAssetType(assetType: string): string {
  return prettyAdType(assetType);
}

export function prettyFunding(source: string): string {
  switch (source) {
    case "brand_cash":
      return "Brand cash";
    case "brand_fund":
      return "Co-op / brand fund";
    case "platform_coop":
      return "Platform funded";
    default:
      return source;
  }
}

/* ------------------------------------------------------------------ helpers */

function promoForSalesRow(
  data: BrandData,
  row: SalesRow,
): { brandFunded: number; platformFunded: number } {
  // Promo metrics are keyed on (day, platform, product) once resolved, same as sales.
  const key = `${row.day}|${row.platformId}|${row.productId}`;
  const cache = promoCache(data);
  const hit = cache.get(key);
  if (hit) return hit;
  // No promo row: the discount on the sales row is unexplained, so treat it as fully
  // brand funded. Assuming the platform paid for it would flatter every metric.
  return { brandFunded: row.discountPaise, platformFunded: 0 };
}

const PROMO_CACHE = new WeakMap<
  BrandData,
  Map<string, { brandFunded: number; platformFunded: number }>
>();

function promoCache(data: BrandData) {
  let cache = PROMO_CACHE.get(data);
  if (cache) return cache;
  cache = new Map();
  for (const p of data.promoRows) {
    const key = `${p.day}|${p.platformId}|${p.productId}`;
    const acc = cache.get(key) ?? { brandFunded: 0, platformFunded: 0 };
    acc.brandFunded += p.brandFundedDiscountPaise;
    acc.platformFunded += p.platformFundedDiscountPaise;
    cache.set(key, acc);
  }
  PROMO_CACHE.set(data, cache);
  return cache;
}

function scaleSalesTotals(totals: SalesTotals, share: number): SalesTotals {
  return {
    units: Math.round(totals.units * share),
    grossRevenuePaise: Math.round(totals.grossRevenuePaise * share),
    discountPaise: Math.round(totals.discountPaise * share),
    brandFundedDiscountPaise: Math.round(totals.brandFundedDiscountPaise * share),
    platformFundedDiscountPaise: Math.round(totals.platformFundedDiscountPaise * share),
    participationFeePaise: Math.round(totals.participationFeePaise * share),
    returnedUnits: Math.round(totals.returnedUnits * share),
    newCustomers: Math.round(totals.newCustomers * share),
  };
}

function averageRepeat(data: BrandData): number {
  const values = [...data.productMeta.values()].map((p) => p.repeat);
  if (values.length === 0) return 1;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/* -------------------------------------------------------------- brand fund */

export interface BrandFundSummary {
  platformId: string;
  platformName: string;
  accruedPaise: number;
  utilisedPaise: number;
  expiredPaise: number;
  balancePaise: number;
  /** Accrued but unused money that expires within 60 days. */
  expiringSoonPaise: number;
  utilisationRate: number;
}

export async function brandFundSummary(
  data: BrandData,
  today: Day,
): Promise<BrandFundSummary[]> {
  const accountRows = await db
    .select({ id: platformAccounts.id, platformId: platformAccounts.platformId })
    .from(platformAccounts)
    .where(eq(platformAccounts.brandId, data.brand.id));
  const accountToPlatform = new Map(accountRows.map((a) => [a.id, a.platformId]));

  const byPlatform = new Map<string, BrandFundSummary>();
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000)
    .toISOString()
    .slice(0, 10);

  for (const row of data.fundRows) {
    const platformId = accountToPlatform.get(row.platformAccountId);
    if (!platformId) continue;
    const entry =
      byPlatform.get(platformId) ??
      ({
        platformId,
        platformName: data.platformMeta.get(platformId)?.name ?? platformId,
        accruedPaise: 0,
        utilisedPaise: 0,
        expiredPaise: 0,
        balancePaise: 0,
        expiringSoonPaise: 0,
        utilisationRate: 0,
      } satisfies BrandFundSummary);

    if (row.entryType === "accrual") {
      entry.accruedPaise += row.amountPaise;
      if (row.expiresOn && row.expiresOn <= horizon && row.expiresOn >= today) {
        entry.expiringSoonPaise += row.amountPaise;
      }
    } else if (row.entryType === "utilization") {
      entry.utilisedPaise += Math.abs(row.amountPaise);
    } else if (row.entryType === "expiry") {
      entry.expiredPaise += Math.abs(row.amountPaise);
    }
    entry.balancePaise = entry.accruedPaise - entry.utilisedPaise - entry.expiredPaise;
    entry.utilisationRate = safeDiv(entry.utilisedPaise, entry.accruedPaise);
    byPlatform.set(platformId, entry);
  }

  // Expiring money can't exceed what's actually left unspent.
  for (const entry of byPlatform.values()) {
    entry.expiringSoonPaise = Math.min(
      entry.expiringSoonPaise,
      Math.max(0, entry.balancePaise),
    );
  }

  return [...byPlatform.values()].sort((a, b) => b.balancePaise - a.balancePaise);
}
