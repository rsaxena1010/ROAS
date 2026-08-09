/**
 * Insight engine.
 *
 * Rule-based, deliberately. A brand marketer will not act on "the model says so" — every
 * item here states the number, the threshold it broke, and the rupee impact of fixing it,
 * so it can be argued with. Each rule is independent and cheap; they run over data already
 * in memory from the analytics load.
 *
 * Impact is always expressed as annualised-neutral RUPEE IMPACT OVER THE WINDOW, not a
 * projection, so numbers across insights are comparable and additive-ish.
 */

import { maxAffordableBrandDiscount } from "@/domain/economics";
import { marginalResponse } from "@/domain/curves";
import type { Recommendation } from "@/db/schema";
import { formatInrCompact, formatMultiple, formatPercent, safeDiv } from "@/lib/money";
import { daysBetween, type Day } from "@/lib/date";
import { aggregate, brandFundSummary, type BrandData } from "./analytics";
import { buildChannels } from "./planner";
import { db } from "@/db";
import { promotions, promotionMetricsDaily, listings, products, platforms, platformAccounts } from "@/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";

export type Insight = Omit<Recommendation, "id" | "createdAt">;

export async function generateInsights(
  data: BrandData,
  today: Day,
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const days = Math.max(1, daysBetween(data.range.from, data.range.to) + 1);
  const base = { brandId: data.brand.id, status: "open" as const, day: today };

  /* ------------------------------------------- 1. channels below break-even */

  const channelGroups = aggregate(data, "platform_ad_type");
  for (const g of channelGroups) {
    const m = g.metrics;
    if (m.adSpendPaise <= 0 || !Number.isFinite(m.breakEvenRoas)) continue;
    if (m.trueRoas >= m.breakEvenRoas) continue;

    // Every rupee here returns less contribution than it costs. Impact = the shortfall.
    const shortfall = Math.round(
      m.totalInvestmentPaise - m.netAttributedRevenuePaise * (1 / m.breakEvenRoas),
    );
    if (shortfall <= 0) continue;

    insights.push({
      ...base,
      kind: "below_breakeven",
      severity: m.trueRoas < m.breakEvenRoas * 0.6 ? "critical" : "warning",
      title: `${g.sublabel ?? ""} ${g.label} is below break-even`.trim(),
      body: `True ROAS is ${formatMultiple(m.trueRoas)} against a break-even of ${formatMultiple(m.breakEvenRoas)} (contribution margin ${formatPercent(safeDiv(m.grossContributionPaise, m.netTotalRevenuePaise))}). Reported ROAS of ${formatMultiple(m.reportedRoas)} hides ${formatInrCompact(m.brandFundedDiscountPaise + m.participationFeePaise)} of brand-funded discounts and event fees. Cut spend here or fix the unit economics before scaling.`,
      impactPaise: shortfall,
      dimension: "platform_ad_type",
      entityId: g.key,
      entityLabel: `${g.sublabel ?? ""} ${g.label}`.trim(),
      evidence: {
        trueRoas: m.trueRoas,
        reportedRoas: m.reportedRoas,
        breakEvenRoas: m.breakEvenRoas,
        adSpendPaise: m.adSpendPaise,
        brandFundedDiscountPaise: m.brandFundedDiscountPaise,
        allocationBasis: g.allocationBasis,
      },
    });
  }

  /* --------------------------------- 2. saturation / starvation mismatches */

  const { diagnostics } = buildChannels(data, "platform_ad_type", "max_contribution");
  const usable = diagnostics.filter((d) => !d.curve.assumed && d.currentDailySpendPaise > 0);

  if (usable.length >= 2) {
    const sorted = [...usable].sort((a, b) => b.marginalRoas - a.marginalRoas);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    // Only worth flagging if the gap is big enough to survive the noise in the fits.
    if (best.marginalRoas > worst.marginalRoas * 1.8 && worst.currentDailySpendPaise > 0) {
      const shiftable = Math.round(worst.currentDailySpendPaise * 0.25);
      const gainPerRupee = best.marginalRoas - worst.marginalRoas;
      const impact = Math.round(shiftable * gainPerRupee * days);

      insights.push({
        ...base,
        kind: "reallocate",
        severity: "warning",
        title: `Shift budget from ${worst.label} to ${best.label}`,
        body: `The next rupee into ${worst.sublabel ? worst.sublabel + " " : ""}${worst.label} returns ${formatMultiple(worst.marginalRoas)}, while ${best.sublabel ? best.sublabel + " " : ""}${best.label} returns ${formatMultiple(best.marginalRoas)} — it is ${formatPercent(worst.saturation, 0)} saturated. Moving ${formatInrCompact(shiftable)}/day is worth about ${formatInrCompact(impact)} of extra revenue over ${days} days at the same total budget.`,
        impactPaise: impact,
        dimension: "platform_ad_type",
        entityId: worst.key,
        entityLabel: worst.label,
        evidence: {
          fromMarginalRoas: worst.marginalRoas,
          toMarginalRoas: best.marginalRoas,
          fromSaturation: worst.saturation,
          shiftablePerDayPaise: shiftable,
          curveConfidence: { from: worst.curve.confidence, to: best.curve.confidence },
        },
      });
    }
  }

  /* ---------------------------------------- 3. spend past the efficient frontier */

  for (const d of usable) {
    if (d.efficientFrontierSpendPaise <= 0) continue;
    if (d.currentDailySpendPaise <= d.efficientFrontierSpendPaise * 1.15) continue;

    const excess = d.currentDailySpendPaise - d.efficientFrontierSpendPaise;
    // Contribution lost on the over-spend: it costs a rupee and returns less than one.
    const lostPerRupee = 1 - marginalResponse(d.curve, d.currentDailySpendPaise) * d.contributionRate;
    const impact = Math.round(excess * Math.max(0, lostPerRupee) * days);
    if (impact <= 0) continue;

    insights.push({
      ...base,
      kind: "past_frontier",
      severity: "warning",
      title: `${d.label} is spending past its efficient frontier`,
      body: `${formatInrCompact(d.currentDailySpendPaise)}/day is going in but the last profitable rupee is at ${formatInrCompact(d.efficientFrontierSpendPaise)}/day. The excess ${formatInrCompact(excess)}/day destroys roughly ${formatInrCompact(impact)} of contribution over ${days} days. Cap the daily budget here and redeploy.`,
      impactPaise: impact,
      dimension: "platform_ad_type",
      entityId: d.key,
      entityLabel: d.label,
      evidence: {
        currentDailySpendPaise: d.currentDailySpendPaise,
        frontierDailySpendPaise: d.efficientFrontierSpendPaise,
        marginalRoas: d.marginalRoas,
        breakEvenRoas: d.breakEvenRoas,
        curveConfidence: d.curve.confidence,
      },
    });
  }

  /* -------------------------------------------------- 4. brand fund left on the table */

  const funds = await brandFundSummary(data, today);
  for (const f of funds) {
    if (f.expiringSoonPaise > 0) {
      insights.push({
        ...base,
        kind: "brand_fund_expiring",
        severity: f.expiringSoonPaise > 50_000_00 ? "critical" : "warning",
        title: `${formatInrCompact(f.expiringSoonPaise)} of ${f.platformName} co-op fund expires within 60 days`,
        body: `${f.platformName} has accrued ${formatInrCompact(f.accruedPaise)} of co-op marketing fund and only ${formatPercent(f.utilisationRate, 0)} has been drawn. ${formatInrCompact(f.expiringSoonPaise)} lapses in the next 60 days. This is platform money — spending it does not touch the brand's cash ROAS, so it should be the first budget deployed.`,
        impactPaise: f.expiringSoonPaise,
        dimension: "platform",
        entityId: f.platformId,
        entityLabel: f.platformName,
        evidence: {
          accruedPaise: f.accruedPaise,
          utilisedPaise: f.utilisedPaise,
          balancePaise: f.balancePaise,
          utilisationRate: f.utilisationRate,
        },
      });
    } else if (f.accruedPaise > 0 && f.utilisationRate < 0.5) {
      insights.push({
        ...base,
        kind: "brand_fund_underused",
        severity: "info",
        title: `${f.platformName} co-op fund is only ${formatPercent(f.utilisationRate, 0)} used`,
        body: `${formatInrCompact(f.balancePaise)} of accrued co-op fund is unspent. Drawing it down displaces cash media spend one-for-one and lifts cash-basis ROAS without changing a single bid.`,
        impactPaise: f.balancePaise,
        dimension: "platform",
        entityId: f.platformId,
        entityLabel: f.platformName,
        evidence: { accruedPaise: f.accruedPaise, utilisationRate: f.utilisationRate },
      });
    }
  }

  /* ------------------------------------------- 5. promotions the brand can't afford */

  insights.push(...(await promotionInsights(data, base)));

  /* --------------------------------------------------- 6. loss-making SKUs */

  const bySku = aggregate(data, "product");
  for (const g of bySku) {
    const m = g.metrics;
    if (m.adSpendPaise < 100_00) continue; // ignore noise-level spend
    if (m.netContributionPaise >= 0) continue;

    insights.push({
      ...base,
      kind: "sku_loss_making",
      severity: "warning",
      title: `${g.label} loses money after marketing`,
      body: `${formatInrCompact(m.totalInvestmentPaise)} invested against ${formatInrCompact(m.netTotalRevenuePaise)} of net revenue leaves ${formatInrCompact(m.netContributionPaise)} of contribution. Return rate is ${formatPercent(safeDiv(g.sales.returnedUnits, Math.max(1, g.sales.units)))} and brand-funded discount is ${formatPercent(safeDiv(m.brandFundedDiscountPaise, Math.max(1, m.totalRevenuePaise)))} of revenue. Either reprice, cut the discount, or stop advertising this SKU.`,
      impactPaise: Math.abs(m.netContributionPaise),
      dimension: "product",
      entityId: g.key,
      entityLabel: g.label,
      evidence: {
        netContributionPaise: m.netContributionPaise,
        trueRoas: m.trueRoas,
        returnRate: safeDiv(g.sales.returnedUnits, Math.max(1, g.sales.units)),
        brandFundedDiscountPaise: m.brandFundedDiscountPaise,
      },
    });
  }

  /* ------------------------------------------------------- 7. CAC vs target */

  const byPlatform = aggregate(data, "platform");
  for (const g of byPlatform) {
    const m = g.metrics;
    if (m.newCustomers < 20) continue;
    if (m.cacPaise <= data.brand.targetCacPaise) continue;

    const excess = (m.cacPaise - data.brand.targetCacPaise) * m.newCustomers;
    insights.push({
      ...base,
      kind: "cac_above_target",
      severity: m.ltvToCac < 1 ? "critical" : "warning",
      title: `CAC on ${g.label} is ${formatInrCompact(m.cacPaise)} against a ${formatInrCompact(data.brand.targetCacPaise)} target`,
      body: `${m.newCustomers.toLocaleString("en-IN")} new customers acquired at ${formatInrCompact(m.cacPaise)} each — ${formatPercent(safeDiv(m.cacPaise - data.brand.targetCacPaise, data.brand.targetCacPaise), 0)} over target. LTV:CAC is ${formatMultiple(m.ltvToCac)}${m.ltvToCac < 1 ? ", meaning each new customer is bought for more than they will ever contribute" : ""}. Overspend against target across the window: ${formatInrCompact(excess)}.`,
      impactPaise: excess,
      dimension: "platform",
      entityId: g.key,
      entityLabel: g.label,
      evidence: {
        cacPaise: m.cacPaise,
        paidCacPaise: m.paidCacPaise,
        targetCacPaise: data.brand.targetCacPaise,
        ltvPaise: m.ltvPaise,
        ltvToCac: m.ltvToCac,
        newCustomers: m.newCustomers,
      },
    });
  }

  /* ------------------------------------- 8. hidden cost: discount vs ad spend */

  const total = aggregate(data, "platform").reduce(
    (acc, g) => ({
      ad: acc.ad + g.metrics.adSpendPaise,
      discount: acc.discount + g.metrics.brandFundedDiscountPaise,
      fees: acc.fees + g.metrics.participationFeePaise,
    }),
    { ad: 0, discount: 0, fees: 0 },
  );
  if (total.discount > total.ad) {
    insights.push({
      ...base,
      kind: "discount_exceeds_ads",
      severity: "info",
      title: "Brand-funded discounts cost more than the entire ad budget",
      body: `${formatInrCompact(total.discount)} of brand-funded discount plus ${formatInrCompact(total.fees)} of event participation fees against ${formatInrCompact(total.ad)} of ad spend. Discounting is the larger media line and it is usually managed by a different team with no ROAS target attached. Bring it into the same budget conversation.`,
      impactPaise: total.discount,
      dimension: null,
      entityId: null,
      entityLabel: null,
      evidence: total,
    });
  }

  /* ------------------------------------ 9. attribution windows aren't comparable */

  const windows = new Set(
    byPlatform.flatMap((g) => g.metrics.comparability.attributionWindowDays),
  );
  if (windows.size > 1) {
    insights.push({
      ...base,
      kind: "attribution_mismatch",
      severity: "info",
      title: "Reported ROAS is not comparable across your platforms",
      body: `Your platforms report on ${[...windows].sort((a, b) => a - b).join("-day, ")}-day attribution windows. A 1-day quick-commerce ROAS and a 14-day marketplace ROAS are different quantities; ranking channels on reported ROAS will systematically over-fund the long-window platforms. Every comparison in this product uses True ROAS on a common basis instead.`,
      impactPaise: 0,
      dimension: null,
      entityId: null,
      entityLabel: null,
      evidence: { attributionWindowDays: [...windows] },
    });
  }

  return rank(insights);
}

/** How many of each kind to surface. A 60-item list is a list nobody reads. */
const MAX_PER_KIND = 3;

function rank(insights: Insight[]): Insight[] {
  const sorted = [...insights].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      b.impactPaise - a.impactPaise,
  );

  const counts = new Map<string, number>();
  const kept: Insight[] = [];
  for (const i of sorted) {
    const n = counts.get(i.kind) ?? 0;
    if (n >= MAX_PER_KIND) continue;
    counts.set(i.kind, n + 1);
    kept.push(i);
  }
  return kept;
}

async function promotionInsights(
  data: BrandData,
  base: { brandId: string; status: "open"; day: Day },
): Promise<Insight[]> {
  const out: Insight[] = [];

  const rows = await db
    .select({
      promotionId: promotions.id,
      name: promotions.name,
      promoType: promotions.promoType,
      discountRate: promotions.discountRate,
      brandFundedShare: promotions.brandFundedShare,
      participationFeePaise: promotions.participationFeePaise,
      platformId: platformAccounts.platformId,
      platformName: platforms.name,
      startDay: promotions.startDay,
      endDay: promotions.endDay,
    })
    .from(promotions)
    .innerJoin(platformAccounts, eq(promotions.platformAccountId, platformAccounts.id))
    .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
    .where(
      and(
        eq(promotions.brandId, data.brand.id),
        lte(promotions.startDay, data.range.to),
        gte(promotions.endDay, data.range.from),
      ),
    );

  if (rows.length === 0) return out;

  const metricRows = await db
    .select({
      promotionId: promotionMetricsDaily.promotionId,
      productId: promotionMetricsDaily.productId,
      units: promotionMetricsDaily.units,
      grossRevenuePaise: promotionMetricsDaily.grossRevenuePaise,
      brandFundedDiscountPaise: promotionMetricsDaily.brandFundedDiscountPaise,
      platformFundedDiscountPaise: promotionMetricsDaily.platformFundedDiscountPaise,
      newCustomers: promotionMetricsDaily.newCustomers,
    })
    .from(promotionMetricsDaily)
    .where(
      and(
        eq(promotionMetricsDaily.brandId, data.brand.id),
        gte(promotionMetricsDaily.day, data.range.from),
        lte(promotionMetricsDaily.day, data.range.to),
      ),
    );

  const byPromo = new Map<
    string,
    { units: number; revenue: number; brandFunded: number; platformFunded: number; newCustomers: number }
  >();
  for (const m of metricRows) {
    const acc =
      byPromo.get(m.promotionId) ??
      { units: 0, revenue: 0, brandFunded: 0, platformFunded: 0, newCustomers: 0 };
    acc.units += m.units;
    acc.revenue += m.grossRevenuePaise;
    acc.brandFunded += m.brandFundedDiscountPaise;
    acc.platformFunded += m.platformFundedDiscountPaise;
    acc.newCustomers += m.newCustomers;
    byPromo.set(m.promotionId, acc);
  }

  // Representative fee profile + COGS per platform, for the affordability test.
  const listingRows = await db
    .select({
      platformAccountId: listings.platformAccountId,
      productId: listings.productId,
      sellingPricePaise: listings.sellingPricePaise,
      cogsPaise: products.cogsPaise,
    })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .where(eq(listings.brandId, data.brand.id));

  for (const promo of rows) {
    const totals = byPromo.get(promo.promotionId);
    if (!totals || totals.revenue <= 0) continue;

    // Median-ish listing on this platform: good enough for an affordability sanity check.
    const candidates = listingRows.filter((l) => l.sellingPricePaise > 0);
    if (candidates.length === 0) continue;
    const sample = candidates[Math.floor(candidates.length / 2)];
    const fee = data.fees.get(`${sample.platformAccountId}|${sample.productId}`);
    if (!fee) continue;

    const affordable = maxAffordableBrandDiscount(
      sample.sellingPricePaise,
      sample.cogsPaise,
      fee,
      data.brand.targetContributionMargin,
    );
    const effectiveBrandDiscountRate = safeDiv(totals.brandFunded, totals.revenue);
    if (effectiveBrandDiscountRate <= affordable.discountRate) continue;

    const overspend = Math.round(
      totals.brandFunded - totals.revenue * affordable.discountRate,
    );
    const totalCost = totals.brandFunded + promo.participationFeePaise;

    out.push({
      ...base,
      kind: "promo_unaffordable",
      severity: effectiveBrandDiscountRate > affordable.discountRate * 1.5 ? "critical" : "warning",
      title: `${promo.name} discounts past what the margin supports`,
      body: `The brand funded ${formatPercent(effectiveBrandDiscountRate)} of revenue as discount (${formatInrCompact(totals.brandFunded)}) plus ${formatInrCompact(promo.participationFeePaise)} in participation fees, against a maximum of ${formatPercent(affordable.discountRate)} that still clears the ${formatPercent(data.brand.targetContributionMargin, 0)} contribution target on ${promo.platformName}. The platform funded ${formatInrCompact(totals.platformFunded)} — worth pushing that split harder next event. Total brand cost: ${formatInrCompact(totalCost)} for ${totals.newCustomers.toLocaleString("en-IN")} new customers (${formatInrCompact(safeDiv(totalCost, Math.max(1, totals.newCustomers)))} each).`,
      impactPaise: overspend,
      dimension: "promotion",
      entityId: promo.promotionId,
      entityLabel: promo.name,
      evidence: {
        effectiveBrandDiscountRate,
        maxAffordableRate: affordable.discountRate,
        brandFundedPaise: totals.brandFunded,
        platformFundedPaise: totals.platformFunded,
        participationFeePaise: promo.participationFeePaise,
        newCustomers: totals.newCustomers,
        promoType: promo.promoType,
      },
    });
  }

  return out;
}

function severityRank(severity: string): number {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}
