/**
 * The metric vocabulary of the product. Two families, deliberately kept apart:
 *
 *   REPORTED  — what the platform's own dashboard shows. Attributed revenue / ad spend.
 *               Useful only for comparing like-for-like inside one platform.
 *   TRUE      — net of returns, brand-funded discounts, participation fees and platform
 *               fees. Comparable across Amazon, Blinkit, Nykaa and everything else, and
 *               the only basis on which money should be moved between them.
 *
 * Attribution windows differ per platform (14d on some, 1d/7d on quick commerce), so any
 * cross-platform comparison of REPORTED numbers is apples-to-oranges. `comparability`
 * carries that warning to the UI instead of hiding it.
 */

import { safeDiv } from "@/lib/money";
import { breakEvenRoas, type CohortEconomics } from "./economics";

/** Raw ad facts summed over whatever grain the caller grouped by. */
export interface AdTotals {
  impressions: number;
  clicks: number;
  spendPaise: number;
  /** Ad spend funded by the platform co-op / brand fund, subset of spendPaise. */
  brandFundSpendPaise: number;
  /** Ad spend that is platform-funded and should not be charged to the brand at all. */
  platformFundedSpendPaise: number;
  orders: number;
  units: number;
  revenuePaise: number;
  newCustomerOrders: number;
  newCustomerRevenuePaise: number;
  returnedUnits: number;
}

/** Total (ad + organic) trade for the same grain, from sales_daily. */
export interface SalesTotals {
  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  brandFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  participationFeePaise: number;
  returnedUnits: number;
  newCustomers: number;
}

export interface MetricContext {
  /** Weighted gross contribution rate before marketing, from economics.ts. */
  grossContributionRate: number;
  /** Expected repeat purchases in year one, for LTV:CAC. */
  expectedRepeatPurchases?: number;
  /** Attribution windows seen in this aggregate, in days. */
  attributionWindowDays?: number[];
}

export interface Metrics {
  /* funnel */
  impressions: number;
  clicks: number;
  ctr: number;
  cpcPaise: number;
  cpmPaise: number;
  conversionRate: number;
  orders: number;
  aovPaise: number;

  /* investment */
  adSpendPaise: number;
  brandFundSpendPaise: number;
  cashAdSpendPaise: number;
  brandFundedDiscountPaise: number;
  participationFeePaise: number;
  /**
   * CHANNEL BASIS. Ad spend plus only the ads' pro-rata share of brand-funded discount and
   * event fees, prorated by the share of trade the ads actually touched. This is the
   * denominator for judging an ad channel — loading the brand's entire discount bill onto
   * the ad channels would condemn every channel regardless of how it performed.
   */
  totalInvestmentPaise: number;
  /**
   * PLATFORM BASIS. Every rupee the brand put into this platform: all ad spend, all
   * brand-funded discount, all event fees. This is the denominator for judging the
   * platform as a business, and for MER / blended ROAS.
   */
  platformInvestmentPaise: number;
  /** Share of total trade that the ads were credited with. Drives the pro-rating above. */
  attributedShare: number;

  /* revenue */
  attributedRevenuePaise: number;
  /** Attributed revenue after returns and the brand's share of the discount. */
  netAttributedRevenuePaise: number;
  totalRevenuePaise: number;
  netTotalRevenuePaise: number;

  /* efficiency */
  /** Platform-reported: attributed revenue / ad spend. */
  reportedRoas: number;
  /** Net attributed revenue / total brand investment. Cross-platform comparable. */
  trueRoas: number;
  /** Total platform revenue / total investment. a.k.a. MER. */
  blendedRoas: number;
  /** Ad spend / attributed revenue. */
  acos: number;
  /** Ad spend / total revenue. */
  tacos: number;
  /** Total investment / total revenue — TACOS including promo and fund money. */
  trueTacos: number;
  /** Contribution earned per rupee invested. Above 1.0 the channel pays for itself. */
  contributionRoas: number;
  /** Revenue multiple required to break even at this contribution rate. */
  breakEvenRoas: number;
  /** trueRoas / breakEvenRoas. >1 means profitable growth. */
  efficiencyIndex: number;

  /* acquisition */
  newCustomers: number;
  /** Total investment / new customers. */
  cacPaise: number;
  /** Ad spend only / new customers acquired by ads. Comparable to platform reporting. */
  paidCacPaise: number;
  /** Contribution per acquired customer over the expected repeat horizon. */
  ltvPaise: number;
  ltvToCac: number;
  /** Share of orders that were new-to-brand. */
  newCustomerShare: number;

  /* profit */
  grossContributionPaise: number;
  netContributionPaise: number;
  netContributionRate: number;

  comparability: Comparability;
}

export interface Comparability {
  /** True when every row in the aggregate shares one attribution window. */
  attributionAligned: boolean;
  attributionWindowDays: number[];
  notes: string[];
}

export function emptyAdTotals(): AdTotals {
  return {
    impressions: 0,
    clicks: 0,
    spendPaise: 0,
    brandFundSpendPaise: 0,
    platformFundedSpendPaise: 0,
    orders: 0,
    units: 0,
    revenuePaise: 0,
    newCustomerOrders: 0,
    newCustomerRevenuePaise: 0,
    returnedUnits: 0,
  };
}

export function emptySalesTotals(): SalesTotals {
  return {
    units: 0,
    grossRevenuePaise: 0,
    discountPaise: 0,
    brandFundedDiscountPaise: 0,
    platformFundedDiscountPaise: 0,
    participationFeePaise: 0,
    returnedUnits: 0,
    newCustomers: 0,
  };
}

export function addAdTotals(a: AdTotals, b: Partial<AdTotals>): AdTotals {
  return {
    impressions: a.impressions + (b.impressions ?? 0),
    clicks: a.clicks + (b.clicks ?? 0),
    spendPaise: a.spendPaise + (b.spendPaise ?? 0),
    brandFundSpendPaise: a.brandFundSpendPaise + (b.brandFundSpendPaise ?? 0),
    platformFundedSpendPaise:
      a.platformFundedSpendPaise + (b.platformFundedSpendPaise ?? 0),
    orders: a.orders + (b.orders ?? 0),
    units: a.units + (b.units ?? 0),
    revenuePaise: a.revenuePaise + (b.revenuePaise ?? 0),
    newCustomerOrders: a.newCustomerOrders + (b.newCustomerOrders ?? 0),
    newCustomerRevenuePaise:
      a.newCustomerRevenuePaise + (b.newCustomerRevenuePaise ?? 0),
    returnedUnits: a.returnedUnits + (b.returnedUnits ?? 0),
  };
}

export function addSalesTotals(a: SalesTotals, b: Partial<SalesTotals>): SalesTotals {
  return {
    units: a.units + (b.units ?? 0),
    grossRevenuePaise: a.grossRevenuePaise + (b.grossRevenuePaise ?? 0),
    discountPaise: a.discountPaise + (b.discountPaise ?? 0),
    brandFundedDiscountPaise:
      a.brandFundedDiscountPaise + (b.brandFundedDiscountPaise ?? 0),
    platformFundedDiscountPaise:
      a.platformFundedDiscountPaise + (b.platformFundedDiscountPaise ?? 0),
    participationFeePaise: a.participationFeePaise + (b.participationFeePaise ?? 0),
    returnedUnits: a.returnedUnits + (b.returnedUnits ?? 0),
    newCustomers: a.newCustomers + (b.newCustomers ?? 0),
  };
}

export function computeMetrics(
  ad: AdTotals,
  sales: SalesTotals,
  ctx: MetricContext,
): Metrics {
  const grossRate = ctx.grossContributionRate;

  // Ads the brand is accountable for. Platform-funded placements are excluded entirely:
  // charging them to the brand would understate every channel they appear in.
  const accountableAdSpend = Math.max(0, ad.spendPaise - ad.platformFundedSpendPaise);
  const cashAdSpend = Math.max(0, accountableAdSpend - ad.brandFundSpendPaise);

  // Share of total trade the ads were credited with. Ads are charged this share of the
  // discount and event-fee bill; the rest belongs to organic trade.
  const attributedShare = Math.min(1, safeDiv(ad.revenuePaise, sales.grossRevenuePaise));

  const attributedDiscount = Math.round(
    sales.brandFundedDiscountPaise * attributedShare,
  );
  const attributedFees = Math.round(sales.participationFeePaise * attributedShare);

  const totalInvestment = accountableAdSpend + attributedDiscount + attributedFees;
  const platformInvestment =
    accountableAdSpend + sales.brandFundedDiscountPaise + sales.participationFeePaise;

  // Attributed revenue net of returns and the ads' share of the brand-funded discount.
  const attributedReturnLoss = safeDiv(ad.returnedUnits, Math.max(1, ad.units)) * ad.revenuePaise;
  const netAttributed = Math.max(
    0,
    ad.revenuePaise - attributedReturnLoss - attributedDiscount,
  );

  const returnLossTotal =
    safeDiv(sales.returnedUnits, Math.max(1, sales.units)) * sales.grossRevenuePaise;
  const netTotalRevenue = Math.max(
    0,
    sales.grossRevenuePaise - returnLossTotal - sales.brandFundedDiscountPaise,
  );

  const grossContribution = Math.round(netTotalRevenue * grossRate);
  // Contribution is a P&L number, so it carries the full platform cost, not the ads' share.
  const netContribution = grossContribution - platformInvestment;

  // New customers: prefer the ads number when we only have ad rows, otherwise the
  // sales-side count which includes organic acquisition.
  const newCustomers = sales.newCustomers || ad.newCustomerOrders;

  const contributionPerCustomer = safeDiv(grossContribution, Math.max(1, newCustomers));
  const repeat = ctx.expectedRepeatPurchases ?? 1;
  const ltv = Math.round(contributionPerCustomer * repeat);
  // Blended CAC pairs every marketing rupee with every new customer, paid or organic. The
  // channel-basis investment would be the wrong numerator against an all-in denominator.
  const cac = safeDiv(platformInvestment, newCustomers);

  const be = breakEvenRoas(grossRate);
  const trueRoas = safeDiv(netAttributed, totalInvestment);

  return {
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: safeDiv(ad.clicks, ad.impressions),
    cpcPaise: Math.round(safeDiv(ad.spendPaise, ad.clicks)),
    cpmPaise: Math.round(safeDiv(ad.spendPaise * 1000, ad.impressions)),
    conversionRate: safeDiv(ad.orders, ad.clicks),
    orders: ad.orders,
    aovPaise: Math.round(safeDiv(ad.revenuePaise, ad.orders)),

    adSpendPaise: accountableAdSpend,
    brandFundSpendPaise: ad.brandFundSpendPaise,
    cashAdSpendPaise: cashAdSpend,
    brandFundedDiscountPaise: sales.brandFundedDiscountPaise,
    participationFeePaise: sales.participationFeePaise,
    totalInvestmentPaise: totalInvestment,
    platformInvestmentPaise: platformInvestment,
    attributedShare,

    attributedRevenuePaise: ad.revenuePaise,
    netAttributedRevenuePaise: Math.round(netAttributed),
    totalRevenuePaise: sales.grossRevenuePaise,
    netTotalRevenuePaise: Math.round(netTotalRevenue),

    reportedRoas: safeDiv(ad.revenuePaise, ad.spendPaise),
    trueRoas,
    // MER: all net revenue against every rupee the brand put into the platform.
    blendedRoas: safeDiv(netTotalRevenue, platformInvestment),
    acos: safeDiv(ad.spendPaise, ad.revenuePaise),
    tacos: safeDiv(ad.spendPaise, sales.grossRevenuePaise),
    trueTacos: safeDiv(platformInvestment, sales.grossRevenuePaise),
    contributionRoas: safeDiv(Math.round(netAttributed * grossRate), totalInvestment),
    breakEvenRoas: be,
    efficiencyIndex: Number.isFinite(be) ? safeDiv(trueRoas, be) : 0,

    newCustomers,
    cacPaise: Math.round(cac),
    paidCacPaise: Math.round(safeDiv(accountableAdSpend, ad.newCustomerOrders)),
    ltvPaise: ltv,
    ltvToCac: safeDiv(ltv, cac),
    newCustomerShare: safeDiv(ad.newCustomerOrders, ad.orders),

    grossContributionPaise: grossContribution,
    netContributionPaise: netContribution,
    netContributionRate: safeDiv(netContribution, netTotalRevenue),

    comparability: buildComparability(ctx.attributionWindowDays ?? []),
  };
}

function buildComparability(windows: number[]): Comparability {
  const distinct = [...new Set(windows)].sort((a, b) => a - b);
  const notes: string[] = [];
  if (distinct.length > 1) {
    notes.push(
      `Mixed attribution windows (${distinct.join("d, ")}d). Reported ROAS is not directly comparable across these platforms — use True ROAS.`,
    );
  }
  return {
    attributionAligned: distinct.length <= 1,
    attributionWindowDays: distinct,
    notes,
  };
}

/** Roll cohort economics up into the weighted contribution rate `computeMetrics` needs. */
export function weightedContributionRate(cohorts: CohortEconomics[]): number {
  let contribution = 0;
  let revenue = 0;
  for (const c of cohorts) {
    contribution += c.grossContributionPaise;
    revenue += c.retainedGrossPaise;
  }
  return safeDiv(contribution, revenue);
}

export type MetricKey = keyof Omit<Metrics, "comparability">;

/** Direction that counts as an improvement, for delta colouring in the UI. */
export const METRIC_DIRECTION: Record<string, "up" | "down"> = {
  reportedRoas: "up",
  trueRoas: "up",
  blendedRoas: "up",
  contributionRoas: "up",
  efficiencyIndex: "up",
  ltvToCac: "up",
  netContributionPaise: "up",
  netContributionRate: "up",
  grossContributionPaise: "up",
  attributedRevenuePaise: "up",
  netAttributedRevenuePaise: "up",
  totalRevenuePaise: "up",
  newCustomers: "up",
  newCustomerShare: "up",
  orders: "up",
  ctr: "up",
  conversionRate: "up",
  acos: "down",
  tacos: "down",
  trueTacos: "down",
  cacPaise: "down",
  paidCacPaise: "down",
  attributedShare: "up",
  cpcPaise: "down",
  cpmPaise: "down",
  breakEvenRoas: "down",
};

export function deltaVerdict(
  key: string,
  current: number,
  previous: number,
): { pct: number; good: boolean | null } {
  if (!previous || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return { pct: 0, good: null };
  }
  const pct = (current - previous) / Math.abs(previous);
  const dir = METRIC_DIRECTION[key];
  if (!dir || pct === 0) return { pct, good: null };
  return { pct, good: dir === "up" ? pct > 0 : pct < 0 };
}
