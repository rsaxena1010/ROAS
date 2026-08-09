/**
 * Investment recommendations: where the next rupee should go, on what, for which SKUs, and
 * for how long.
 *
 * This is the planner's arithmetic turned into instructions a brand team can act on. The
 * planner answers "how do I split a fixed budget"; this answers the prior question — "should
 * the budget be bigger or smaller, and on which vehicle" — which is what a marketer actually
 * asks in a monthly review.
 *
 * Three rules keep it honest:
 *
 *  1. Every recommendation is priced on the CONTRIBUTION of the incremental rupee, not its
 *     revenue. A channel returning 3x revenue at an 18% margin destroys money; recommending
 *     it because 3x "looks good" is the failure mode this whole product exists to prevent.
 *  2. Nothing is recommended past the spend range the curve has evidence for. Where the
 *     maths wants to extrapolate, the recommendation is capped and says so.
 *  3. Co-op fund money is separated from cash. It is real spend for ROAS purposes but it is
 *     not the brand's cash, so it is always the first budget deployed and is never counted
 *     in the cash requirement.
 */

import { db } from "@/db";
import { platformAccounts, platforms, type AdType, type Brand } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  EXTRAPOLATION_LIMIT,
  predictResponse,
  type ResponseCurve,
} from "@/domain/curves";
import { safeDiv } from "@/lib/money";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { daysBetween, type Day } from "@/lib/date";
import { aggregate, brandFundSummary, prettyAdType, type BrandData } from "./analytics";
import { buildChannels } from "./planner";
import { promotionSummaries, prettyPromoType } from "./promotions";

export type Vehicle =
  | "sponsored_ads"
  | "display"
  | "banner"
  | "video"
  | "influencer"
  | "coupon"
  | "promotion"
  | "coop_fund";

export const VEHICLE_LABEL: Record<Vehicle, string> = {
  sponsored_ads: "Sponsored ads",
  display: "Display ads",
  banner: "Banner placement",
  video: "Video",
  influencer: "Influencer",
  coupon: "Coupon boost",
  promotion: "Promotion / event",
  coop_fund: "Co-op fund",
};

export type Action =
  | "scale_up"
  | "hold"
  | "scale_down"
  | "stop"
  | "deploy"
  | "repeat"
  | "renegotiate";

export const ACTION_LABEL: Record<Action, string> = {
  scale_up: "Invest more",
  hold: "Hold",
  scale_down: "Pull back",
  stop: "Stop",
  deploy: "Deploy now",
  repeat: "Run again",
  renegotiate: "Renegotiate",
};

export interface SkuFocus {
  productId: string;
  label: string;
  sku?: string;
  /** Share of this channel's attributed revenue. */
  revenueShare: number;
  /** Revenue per rupee of ad spend inside this channel. */
  channelRoas: number;
  /** The SKU's own net contribution brand-wide — a negative one should not be scaled. */
  contributionPaise: number;
  /** True when scaling this SKU would scale a loss. */
  caution: boolean;
}

export interface InvestmentRecommendation {
  key: string;
  vehicle: Vehicle;
  action: Action;
  platformId: string;
  platformName: string;
  adType?: AdType;
  /** "Sponsored Product on Amazon India" */
  label: string;

  currentDailyPaise: number;
  recommendedDailyPaise: number;
  deltaDailyPaise: number;

  /** Cash the brand must find per day. Zero for co-op deployments and for cuts. */
  cashDeltaDailyPaise: number;

  /** Money moved over the plan horizon. Negative = freed. */
  investmentOverHorizonPaise: number;
  expectedRevenuePaise: number;
  expectedContributionPaise: number;

  /** Revenue per incremental rupee, from the fitted curve. */
  incrementalRoas: number;
  breakEvenRoas: number;
  saturation: number;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low" | "assumed";

  /** How long to run it before the effect is readable and the curve should be refitted. */
  reviewAfterDays: number;
  reviewReason: string;

  why: string;
  evidence: string[];
  skus: SkuFocus[];
}

export interface InvestmentPlan {
  horizonDays: number;
  /** Media and co-op recommendations: curve-priced and comparable over the plan horizon. */
  media: InvestmentRecommendation[];
  /** Promotions: priced per run, so deliberately kept out of the horizon totals. */
  promotions: InvestmentRecommendation[];
  /** Contribution at stake across the promotion decisions, per run. */
  promotionContributionPaise: number;

  currentDailyPaise: number;
  recommendedDailyPaise: number;
  addedDailyPaise: number;
  freedDailyPaise: number;

  /** Net cash per day the plan asks for, after cuts and co-op money. */
  netCashDailyPaise: number;
  cashRequiredOverHorizonPaise: number;
  coopDeployableOverHorizonPaise: number;

  expectedRevenuePaise: number;
  expectedContributionPaise: number;

  warnings: string[];
}

/** Below this the move is inside the noise of the fit and not worth an instruction. */
const MIN_DAILY_MOVE_PAISE = 20_000; // ₹200/day
const MIN_MOVE_RATIO = 0.05;

export async function buildInvestmentPlan(
  brand: Brand,
  data: BrandData,
  today: Day,
  horizonDays = 30,
): Promise<InvestmentPlan> {
  const windowDays = Math.max(1, daysBetween(data.range.from, data.range.to) + 1);
  const { diagnostics } = buildChannels(data, "platform_ad_type", "max_contribution");
  const byProduct = new Map(
    aggregate(data, "product").map((g) => [g.key, g]),
  );
  const platformGroups = new Map(aggregate(data, "platform").map((g) => [g.key, g]));

  const recommendations: InvestmentRecommendation[] = [];
  const warnings: string[] = [];

  /* ------------------------------------------------ media channels from curves */

  // Best marginal return per platform, used to price co-op fund deployment.
  const bestMarginalByPlatform = new Map<string, number>();

  for (const d of diagnostics) {
    const [platformId, adType] = d.key.split("::") as [string, AdType];
    const platformName = data.platformMeta.get(platformId)?.name ?? platformId;
    const attributionWindow = data.platformMeta.get(platformId)?.attributionWindowDays ?? 7;
    const contributionRate = d.contributionRate;

    if (!bestMarginalByPlatform.has(platformId) || d.marginalRoas > bestMarginalByPlatform.get(platformId)!) {
      bestMarginalByPlatform.set(platformId, d.marginalRoas);
    }

    // Contribution earned by the next rupee. Above 1.0 the rupee pays for itself.
    const marginalContribution = d.marginalRoas * contributionRate;
    const current = d.currentDailySpendPaise;
    if (current <= 0) continue;

    // Never recommend beyond the range the curve is supported by.
    const trustCeiling = Math.max(
      current,
      d.curve.maxSpendPaise * EXTRAPOLATION_LIMIT,
    );
    const cap = 0.35; // one plan should not move a channel more than this

    let target = current;
    let action: Action = "hold";

    if (marginalContribution > 1.05) {
      target = Math.min(
        d.efficientFrontierSpendPaise > 0 ? d.efficientFrontierSpendPaise : current * (1 + cap),
        current * (1 + cap),
        trustCeiling,
      );
      action = "scale_up";
    } else if (marginalContribution < 0.95) {
      target = Math.max(
        d.efficientFrontierSpendPaise,
        current * (1 - cap),
        0,
      );
      // A channel whose very first rupee doesn't pay back has no profitable spend level.
      action = d.efficientFrontierSpendPaise <= 0 ? "stop" : "scale_down";
      if (action === "stop") target = 0;
    }

    const delta = Math.round(target - current);
    const material =
      Math.abs(delta) >= MIN_DAILY_MOVE_PAISE &&
      Math.abs(delta) >= current * MIN_MOVE_RATIO;
    if (!material) {
      action = "hold";
      target = current;
    }

    const dailyRevenueDelta =
      predictResponse(d.curve, target) - predictResponse(d.curve, current);
    const dailyContributionDelta = dailyRevenueDelta * contributionRate - (target - current);

    // Two full attribution cycles, so the effect is actually observable before judging it.
    const reviewAfterDays = d.curve.assumed
      ? 14
      : Math.min(45, Math.max(14, attributionWindow * 2));
    const reviewReason = d.curve.assumed
      ? `This channel's daily spend barely varied, so no curve could be fitted and a diminishing-returns prior was used. Run 14 days with deliberately varied daily spend to replace the assumption with evidence.`
      : `${platformName} attributes over ${attributionWindow} days, so a shorter test would read the tail of the old spend level as the result of the new one. Refit the curve after ${Math.min(45, Math.max(14, attributionWindow * 2))} days.`;

    const confidenceLabel = labelConfidence(d.curve);
    const skus = skuFocusFor(data, platformId, adType, byProduct);

    const evidence: string[] = [
      `Next rupee returns ${formatMultiple(d.marginalRoas)} of revenue — ${formatMultiple(marginalContribution)} of contribution at this channel's ${formatPercent(contributionRate)} margin.`,
      `Break-even needs ${Number.isFinite(d.breakEvenRoas) ? formatMultiple(d.breakEvenRoas) : "an unattainable multiple"}; the channel is ${formatPercent(d.saturation, 0)} saturated.`,
      `${d.curve.kind} curve fitted on ${d.daysOfData} days, r² ${d.curve.r2.toFixed(2)}${d.daysExcluded > 0 ? `, ${d.daysExcluded} abnormal-demand days excluded` : ""}.`,
    ];
    if (d.frontierExtrapolated) {
      evidence.push(
        `The profitable ceiling sits outside the ${formatInrCompact(d.curve.minSpendPaise)}–${formatInrCompact(d.curve.maxSpendPaise)}/day range we have data for, so the target is capped at ${formatMultiple(EXTRAPOLATION_LIMIT)} the observed maximum rather than taken literally.`,
      );
    }
    if (skus.some((s) => s.caution)) {
      evidence.push(
        `${skus.filter((s) => s.caution).map((s) => s.label).join(", ")} carries negative contribution brand-wide — exclude ${skus.filter((s) => s.caution).length > 1 ? "them" : "it"} from the scale-up or the extra spend buys a bigger loss.`,
      );
    }

    recommendations.push({
      key: d.key,
      vehicle: vehicleFor(adType),
      action,
      platformId,
      platformName,
      adType,
      label: `${prettyAdType(adType)} on ${platformName}`,
      currentDailyPaise: current,
      recommendedDailyPaise: Math.round(target),
      deltaDailyPaise: delta,
      cashDeltaDailyPaise: Math.round(target - current),
      investmentOverHorizonPaise: Math.round((target - current) * horizonDays),
      expectedRevenuePaise: Math.round(dailyRevenueDelta * horizonDays),
      expectedContributionPaise: Math.round(dailyContributionDelta * horizonDays),
      incrementalRoas: d.marginalRoas,
      breakEvenRoas: d.breakEvenRoas,
      saturation: d.saturation,
      confidence: d.curve.confidence,
      confidenceLabel,
      reviewAfterDays,
      reviewReason,
      why: whyForChannel(action, d.marginalRoas, marginalContribution, d.saturation, platformName, adType),
      evidence,
      skus,
    });
  }

  /* -------------------------------------------------------- co-op fund money */

  const funds = await brandFundSummary(data, today);
  const accountRows = await db
    .select({ platformId: platformAccounts.platformId, name: platforms.name })
    .from(platformAccounts)
    .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
    .where(eq(platformAccounts.brandId, brand.id));
  const platformNames = new Map(accountRows.map((a) => [a.platformId, a.name]));

  for (const f of funds) {
    if (f.balancePaise <= 0) continue;

    // Expiring money sets the deadline; otherwise spread over the plan horizon.
    const urgent = f.expiringSoonPaise > 0;
    const days = urgent ? 60 : horizonDays;
    const deployable = urgent ? f.expiringSoonPaise : f.balancePaise;
    const daily = Math.round(deployable / days);

    const marginal = bestMarginalByPlatform.get(f.platformId) ?? 0;
    const platformGroup = platformGroups.get(f.platformId);
    const contributionRate = platformGroup
      ? safeDiv(
          platformGroup.metrics.grossContributionPaise,
          platformGroup.metrics.netTotalRevenuePaise,
        )
      : 0;

    const overHorizon = Math.min(deployable, daily * horizonDays);
    const expectedRevenue = Math.round(overHorizon * marginal);
    // No cash leaves the brand, so the whole gross contribution is upside.
    const expectedContribution = Math.round(expectedRevenue * contributionRate);

    recommendations.push({
      key: `coop::${f.platformId}`,
      vehicle: "coop_fund",
      action: "deploy",
      platformId: f.platformId,
      platformName: f.platformName || platformNames.get(f.platformId) || f.platformId,
      label: `Draw down ${f.platformName} co-op fund`,
      currentDailyPaise: 0,
      recommendedDailyPaise: daily,
      deltaDailyPaise: daily,
      // The defining property of this money: it is not the brand's cash.
      cashDeltaDailyPaise: 0,
      investmentOverHorizonPaise: overHorizon,
      expectedRevenuePaise: expectedRevenue,
      expectedContributionPaise: expectedContribution,
      incrementalRoas: marginal,
      breakEvenRoas: 0,
      saturation: 0,
      confidence: 0.9,
      confidenceLabel: "high",
      reviewAfterDays: urgent ? 30 : horizonDays,
      reviewReason: urgent
        ? `${formatInrCompact(f.expiringSoonPaise)} lapses within 60 days. Check the drawdown against the accrual statement monthly — unspent accruals are simply lost.`
        : `Review with the platform's quarterly accrual statement; the balance grows as sales grow.`,
      why: urgent
        ? `${formatInrCompact(f.expiringSoonPaise)} of ${f.platformName}'s co-op fund expires within 60 days and only ${formatPercent(f.utilisationRate, 0)} of the accrual has been drawn. This is the platform's money — deploying it displaces cash media one-for-one, so it raises cash-basis ROAS without changing a single bid. Spend it before anything else in this plan.`
        : `${formatInrCompact(f.balancePaise)} of accrued co-op fund on ${f.platformName} is unspent (${formatPercent(f.utilisationRate, 0)} utilisation). Drawing it down substitutes for cash media at no cost to the brand.`,
      evidence: [
        `Accrued ${formatInrCompact(f.accruedPaise)}, drawn ${formatInrCompact(f.utilisedPaise)}, balance ${formatInrCompact(f.balancePaise)}.`,
        `Priced at ${formatMultiple(marginal)} — the best marginal return currently available on ${f.platformName}. Because no cash leaves the brand, the entire ${formatPercent(contributionRate)} contribution on that revenue is upside.`,
        urgent
          ? `${formatInrCompact(f.expiringSoonPaise)} carries an expiry inside 60 days.`
          : `No near-term expiry on the current balance.`,
        `Co-op money buys the same inventory as cash, so it consumes the same saturation headroom — deploy it into the scale-up channels below rather than on top of them.`,
      ],
      skus: [],
    });
  }

  /* ------------------------------------------------------------- promotions */

  const promos = await promotionSummaries(brand.id, data.range);
  for (const p of promos) {
    if (p.grossRevenuePaise <= 0 || p.brandCostPaise <= 0) continue;

    const platformGroup = platformGroups.get(p.platformId);
    const contributionRate = platformGroup
      ? safeDiv(
          platformGroup.metrics.grossContributionPaise,
          platformGroup.metrics.netTotalRevenuePaise,
        )
      : 0;

    // Does the promoted trade cover the discount and the entry fee?
    const contribution = Math.round(p.grossRevenuePaise * contributionRate - p.brandCostPaise);
    const promoDays = Math.max(1, daysBetween(p.startDay, p.endDay) + 1);
    const dailyBrandCost = Math.round(p.brandCostPaise / promoDays);

    // A "promotion" covering nearly the whole window is the everyday price, not an event.
    // "Run it again" is not a decision anyone can take about it; affordability is.
    const alwaysOn = promoDays >= windowDays * 0.8;
    if (alwaysOn && contribution >= 0) continue;

    const action: Action = contribution >= 0 ? "repeat" : "renegotiate";

    // Rate at which the promo would break even on the brand's own funding.
    const affordableBrandRate = contributionRate;
    const affordableDailyCost = Math.round(
      dailyBrandCost * Math.min(1, safeDiv(affordableBrandRate, p.effectiveBrandDiscountRate)),
    );

    /**
     * Promotions are priced PER RUN, never extrapolated across the plan horizon like a media
     * channel. Two reasons: an event recurs on the platform's calendar rather than daily, and
     * promoted revenue is mostly demand that would have arrived at full price anyway. Scaling
     * it to 30 days would credit a markdown with cannibalised sales and let it outrank every
     * media recommendation on the strength of an accounting artefact.
     */
    recommendations.push({
      key: `promo::${p.promotionId}`,
      vehicle: "promotion",
      action,
      platformId: p.platformId,
      platformName: p.platformName,
      label: `${p.name} (${prettyPromoType(p.promoType)})`,
      currentDailyPaise: dailyBrandCost,
      recommendedDailyPaise: action === "repeat" ? dailyBrandCost : affordableDailyCost,
      deltaDailyPaise: action === "repeat" ? 0 : affordableDailyCost - dailyBrandCost,
      cashDeltaDailyPaise: 0,
      investmentOverHorizonPaise: action === "repeat" ? p.brandCostPaise : 0,
      // Gross promoted revenue is reported for context but is not treated as incremental.
      expectedRevenuePaise: 0,
      expectedContributionPaise: action === "repeat" ? contribution : Math.abs(contribution),
      incrementalRoas: p.promoRoas,
      breakEvenRoas: Number.isFinite(safeDiv(1, contributionRate)) ? safeDiv(1, contributionRate) : 0,
      saturation: 0,
      confidence: 0.6,
      confidenceLabel: "medium",
      reviewAfterDays: promoDays,
      reviewReason:
        action === "repeat"
          ? `Judge a promotion over its full ${promoDays}-day run rather than day by day: the opening days pull demand forward and the closing days show what was genuinely incremental. Book the next occurrence on the platform's event calendar and hold the funding split.`
          : `Renegotiate before the next occurrence — the funding split is agreed when you sign up for the event, not while it runs. Over a ${promoDays}-day run there is no in-flight fix beyond withdrawing SKUs.`,
      why:
        action === "repeat"
          ? `${p.name} returned ${formatMultiple(p.promoRoas)} of gross revenue on ${formatInrCompact(p.brandCostPaise)} of brand cost and cleared that cost by ${formatInrCompact(contribution)} of contribution over its ${promoDays}-day run. The platform absorbed ${formatPercent(p.platformFundedShare, 0)} of the markdown. Hold that split and book it again — but treat the figure as an upper bound, because some of the promoted units would have sold at full price.`
          : `${p.name} cost the brand ${formatInrCompact(p.brandCostPaise)} — ${formatPercent(p.effectiveBrandDiscountRate)} of revenue as own-funded discount plus ${formatInrCompact(p.participationFeePaise)} in participation fees — against ${formatInrCompact(Math.round(p.grossRevenuePaise * contributionRate))} of contribution earned, a ${formatInrCompact(Math.abs(contribution))} shortfall. At a ${formatPercent(contributionRate)} margin the brand can only fund about ${formatPercent(affordableBrandRate)} of revenue as discount, which is ${formatInrCompact(affordableDailyCost)}/day rather than ${formatInrCompact(dailyBrandCost)}/day. Push the split toward the platform or skip the event.`,
      evidence: [
        `Revenue ${formatInrCompact(p.grossRevenuePaise)} over ${promoDays} days on ${p.units.toLocaleString("en-IN")} units.`,
        `Brand funded ${formatInrCompact(p.brandFundedDiscountPaise)}, platform funded ${formatInrCompact(p.platformFundedDiscountPaise)} (${formatPercent(p.platformFundedShare, 0)} of the markdown).`,
        `${p.newCustomers.toLocaleString("en-IN")} new customers at ${formatInrCompact(p.costPerNewCustomerPaise)} each against a ${formatInrCompact(brand.targetCacPaise)} target.`,
        `Priced per run, not per day: promoted revenue includes demand that would have arrived at full price, so this is an upper bound on the incremental effect.`,
      ],
      skus: [],
    });
  }

  /* ------------------------------------------------------------- assemble */

  const actionable = recommendations.filter((r) => r.action !== "hold");
  const byContribution = (a: InvestmentRecommendation, b: InvestmentRecommendation) =>
    b.expectedContributionPaise - a.expectedContributionPaise;

  const media = actionable.filter((r) => r.vehicle !== "promotion").sort(byContribution);
  const promotionRecs = actionable.filter((r) => r.vehicle === "promotion").sort(byContribution);

  const mediaRecs = recommendations.filter((r) => r.vehicle !== "promotion");
  const currentDaily = mediaRecs.reduce((s, r) => s + r.currentDailyPaise, 0);
  const recommendedDaily = mediaRecs.reduce((s, r) => s + r.recommendedDailyPaise, 0);
  const addedDaily = mediaRecs
    .filter((r) => r.deltaDailyPaise > 0)
    .reduce((s, r) => s + r.deltaDailyPaise, 0);
  const freedDaily = mediaRecs
    .filter((r) => r.deltaDailyPaise < 0)
    .reduce((s, r) => s + Math.abs(r.deltaDailyPaise), 0);
  const netCashDaily = mediaRecs.reduce((s, r) => s + r.cashDeltaDailyPaise, 0);
  const coopDaily = mediaRecs
    .filter((r) => r.vehicle === "coop_fund")
    .reduce((s, r) => s + r.recommendedDailyPaise, 0);

  const assumedCount = diagnostics.filter((d) => d.curve.assumed).length;
  if (assumedCount > 0) {
    warnings.push(
      `${assumedCount} channel(s) had too little spend variation to fit a response curve, so a diminishing-returns prior was used. Their targets are directional, not precise — vary daily spend on them for a week to sharpen the plan.`,
    );
  }
  const extrapolated = diagnostics.filter((d) => d.frontierExtrapolated).length;
  if (extrapolated > 0) {
    warnings.push(
      `${extrapolated} channel(s) have a profitable ceiling outside their observed spend range. Recommendations there are capped at ${EXTRAPOLATION_LIMIT}x the highest daily spend actually seen rather than taken from the curve.`,
    );
  }
  warnings.push(
    `Curves are fitted on ${windowDays} days of history for this window. Expected returns assume demand stays broadly as it was — a festival or a stock-out will dominate any of these effects.`,
  );

  return {
    horizonDays,
    media,
    promotions: promotionRecs,
    promotionContributionPaise: promotionRecs.reduce(
      (s, r) => s + r.expectedContributionPaise,
      0,
    ),
    currentDailyPaise: currentDaily,
    recommendedDailyPaise: recommendedDaily,
    addedDailyPaise: addedDaily,
    freedDailyPaise: freedDaily,
    netCashDailyPaise: netCashDaily,
    cashRequiredOverHorizonPaise: Math.round(netCashDaily * horizonDays),
    coopDeployableOverHorizonPaise: Math.round(coopDaily * horizonDays),
    // Media only. Promotions are per-run figures and adding them here would mix two bases.
    expectedRevenuePaise: media.reduce((s, r) => s + r.expectedRevenuePaise, 0),
    expectedContributionPaise: media.reduce((s, r) => s + r.expectedContributionPaise, 0),
    warnings,
  };
}

/* ------------------------------------------------------------------ helpers */

function vehicleFor(adType: AdType): Vehicle {
  switch (adType) {
    case "sponsored_product":
    case "sponsored_brand":
      return "sponsored_ads";
    case "sponsored_display":
      return "display";
    case "search_banner":
    case "homepage_banner":
    case "category_listing":
      return "banner";
    case "video":
      return "video";
    case "influencer":
      return "influencer";
    case "coupon_boost":
      return "coupon";
    default:
      return "sponsored_ads";
  }
}

function labelConfidence(curve: ResponseCurve): "high" | "medium" | "low" | "assumed" {
  if (curve.assumed) return "assumed";
  if (curve.confidence >= 0.7 && curve.r2 >= 0.4) return "high";
  if (curve.confidence >= 0.4) return "medium";
  return "low";
}

function whyForChannel(
  action: Action,
  marginalRoas: number,
  marginalContribution: number,
  saturation: number,
  platformName: string,
  adType: AdType,
): string {
  const what = `${prettyAdType(adType)} on ${platformName}`;
  switch (action) {
    case "scale_up":
      return `The next rupee into ${what} returns ${formatMultiple(marginalRoas)} of revenue, which is ${formatMultiple(marginalContribution)} of contribution after COGS and platform fees — it more than pays for itself. The channel is only ${formatPercent(saturation, 0)} saturated, so there is real headroom before diminishing returns bite.`;
    case "scale_down":
      return `${what} is ${formatPercent(saturation, 0)} saturated and the next rupee returns only ${formatMultiple(marginalContribution)} of contribution — it costs a rupee to earn less than one. Pull spend back to the point where the last rupee still pays for itself and redeploy it to the channels above.`;
    case "stop":
      return `No level of spend on ${what} is profitable at the current margin: even the first rupee returns less contribution than it costs. Pause it and fix the unit economics — price, take rate or return rate — before restarting.`;
    default:
      return `${what} is close to its optimum; the next rupee returns ${formatMultiple(marginalContribution)} of contribution. Leave it alone this cycle.`;
  }
}

/**
 * Which SKUs a channel's money actually lands on.
 *
 * Both spend and revenue exist on the ad row, so this is measured at the SKU grain rather
 * than allocated — the one place in the product where a per-SKU channel ROAS is honest.
 */
function skuFocusFor(
  data: BrandData,
  platformId: string,
  adType: AdType,
  byProduct: Map<string, ReturnType<typeof aggregate>[number]>,
): SkuFocus[] {
  const totals = new Map<string, { revenue: number; spend: number }>();
  let channelRevenue = 0;

  for (const row of data.adRows) {
    if (row.platformId !== platformId || row.adType !== adType) continue;
    channelRevenue += row.revenuePaise;
    if (!row.productId) continue;
    const acc = totals.get(row.productId) ?? { revenue: 0, spend: 0 };
    acc.revenue += row.revenuePaise;
    acc.spend += row.spendPaise;
    totals.set(row.productId, acc);
  }

  return [...totals.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 4)
    .map(([productId, t]) => {
      const meta = data.productMeta.get(productId);
      const group = byProduct.get(productId);
      const contribution = group?.metrics.netContributionPaise ?? 0;
      return {
        productId,
        label: meta?.name ?? productId,
        sku: meta?.sku,
        revenueShare: safeDiv(t.revenue, channelRevenue),
        channelRoas: safeDiv(t.revenue, t.spend),
        contributionPaise: contribution,
        caution: contribution < 0,
      };
    });
}
