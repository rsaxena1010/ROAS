/**
 * Planner: turn history into response curves, then into a budget recommendation.
 *
 * The chain is: daily (spend, response) points per channel -> fitted concave curve ->
 * greedy marginal-return allocation under the brand's guardrails. Nothing here decides
 * anything on its own; it produces a plan the brand approves and then applies on the
 * platforms.
 */

import { db } from "@/db";
import {
  budgetAllocations,
  budgetPlans,
  type Brand,
  type BudgetPlan,
} from "@/db/schema";
import {
  deseasonalise,
  fitResponseCurve,
  marginalResponse,
  predictResponse,
  saturationIndex,
  type ResponseCurve,
  type ResponsePoint,
} from "@/domain/curves";
import {
  optimizeBudget,
  type Allocation,
  type Channel,
  type Objective,
  type OptimizeResult,
} from "@/domain/optimizer";
import { daysBetween, type Day } from "@/lib/date";
import { safeDiv } from "@/lib/money";
import { aggregate, type BrandData, type Dimension, type GroupedMetrics } from "./analytics";

/** Dimensions a brand can actually move budget across. */
export type PlanDimension = Extract<
  Dimension,
  "platform" | "platform_ad_type" | "ad_type" | "campaign" | "asset" | "product"
>;

export interface PlanInput {
  dimension: PlanDimension;
  objective: Objective;
  /** Daily budget to distribute, paise. Defaults to current daily spend. */
  dailyBudgetPaise?: number;
  targetRoas?: number;
  /** Cap on per-channel movement, as a fraction. Defaults to 0.35. */
  maxChangeRatio?: number;
  /** Channels that must not drop below their current spend (brand defence, contracts). */
  protectedKeys?: string[];
}

export interface ChannelDiagnostics {
  key: string;
  label: string;
  sublabel?: string;
  curve: ResponseCurve;
  currentDailySpendPaise: number;
  currentDailyRevenuePaise: number;
  averageRoas: number;
  marginalRoas: number;
  saturation: number;
  breakEvenRoas: number;
  contributionRate: number;
  /** Daily spend at which the next rupee stops covering its own cost. */
  efficientFrontierSpendPaise: number;
  /**
   * True when the frontier sits outside the spend range we have evidence for, so the exact
   * figure is an extrapolation. The UI shows a direction ("below/above observed range")
   * rather than a precise rupee value in that case.
   */
  frontierExtrapolated: boolean;
  daysOfData: number;
  /** Days dropped from the fit because demand was too abnormal to correct for. */
  daysExcluded: number;
  /**
   * The deseasonalised daily points the curve was actually fitted on. Carried through so the
   * UI can plot the evidence behind the curve — a fitted line shown without its points asks
   * the reader to trust a shape that may rest on six noisy days.
   */
  observed: ResponsePoint[];
}

export interface PlanOutput {
  input: PlanInput;
  result: OptimizeResult;
  diagnostics: ChannelDiagnostics[];
  days: number;
}

/**
 * Build one optimizer channel per group, fitting a curve on that group's daily history.
 *
 * Curves are fitted on DAILY points and the optimizer therefore works in daily rupees.
 * Mixing a 30-day total with a daily curve is the easiest way to be wrong by 30x, so the
 * conversion happens once, here.
 */
export function buildChannels(
  data: BrandData,
  dimension: PlanDimension,
  objective: Objective,
  protectedKeys: string[] = [],
): { channels: Channel[]; diagnostics: ChannelDiagnostics[]; groups: GroupedMetrics[] } {
  const groups = aggregate(data, dimension);
  const days = Math.max(1, daysBetween(data.range.from, data.range.to) + 1);
  const protectedSet = new Set(protectedKeys);
  const demand = buildDemandIndex(data);

  // Daily points per group. `response` is already demand-adjusted per row, because a group
  // can span platforms whose sale events fall on different days.
  const pointsByKey = new Map<
    string,
    Map<Day, { spend: number; response: number; demandIndex: number }>
  >();
  for (const row of data.adRows) {
    const key = groupKeyForRow(data, row, dimension);
    if (key == null) continue;
    const byDay = pointsByKey.get(key) ?? new Map();
    const acc = byDay.get(row.day) ?? { spend: 0, response: 0, demandIndex: 0 };
    const raw =
      objective === "max_new_customers" ? row.newCustomerOrders : row.revenuePaise;
    const idx = demand.indexFor(row.platformId, row.day);
    acc.spend += row.spendPaise;
    acc.response += raw;
    // Spend-weighted average index for the day, so the group's index reflects where the
    // money actually went when it straddles platforms.
    acc.demandIndex += idx * row.spendPaise;
    byDay.set(row.day, acc);
    pointsByKey.set(key, byDay);
  }

  const channels: Channel[] = [];
  const diagnostics: ChannelDiagnostics[] = [];

  for (const group of groups) {
    const byDay = pointsByKey.get(group.key);
    if (!byDay || byDay.size === 0) continue;

    const raw = [...byDay.values()]
      .filter((p) => p.spend > 0)
      .map((p) => ({
        spendPaise: p.spend,
        responsePaise: p.response,
        demandIndex: p.demandIndex / p.spend,
      }));
    if (raw.length === 0) continue;

    const points = deseasonalise(raw);
    const daysExcluded = raw.length - points.length;
    if (points.length === 0) continue;

    const curve = fitResponseCurve(points);
    const currentDailySpend = Math.round(group.ad.spendPaise / days);
    const contributionRate = safeDiv(
      group.metrics.grossContributionPaise,
      group.metrics.netTotalRevenuePaise,
    );

    channels.push({
      id: group.key,
      label: group.label,
      dimension: dimension === "platform_ad_type" ? "ad_type" : dimension,
      currentSpendPaise: currentDailySpend,
      curve,
      contributionRate,
      minSpendPaise: protectedSet.has(group.key) ? currentDailySpend : 0,
      meta: {
        sublabel: group.sublabel,
        reportedRoas: group.metrics.reportedRoas,
        trueRoas: group.metrics.trueRoas,
        cacPaise: group.metrics.cacPaise,
        allocationBasis: group.allocationBasis,
      },
    });

    const frontier = efficientFrontier(curve, contributionRate);
    diagnostics.push({
      key: group.key,
      label: group.label,
      sublabel: group.sublabel,
      curve,
      currentDailySpendPaise: currentDailySpend,
      currentDailyRevenuePaise: Math.round(predictResponse(curve, currentDailySpend)),
      averageRoas: safeDiv(predictResponse(curve, currentDailySpend), currentDailySpend),
      marginalRoas: marginalResponse(curve, currentDailySpend),
      saturation: saturationIndex(curve, currentDailySpend),
      breakEvenRoas: group.metrics.breakEvenRoas,
      contributionRate,
      efficientFrontierSpendPaise: frontier,
      frontierExtrapolated:
        frontier < curve.minSpendPaise || frontier > curve.maxSpendPaise,
      daysOfData: points.length,
      daysExcluded,
      observed: points,
    });
  }

  return { channels, diagnostics, groups };
}

/**
 * STRUCTURAL demand index per platform — a smooth function of the calendar, not of the
 * day's realised sales.
 *
 * The distinction is the whole ballgame. The first version of this divided each day's
 * response by that day's own total revenue relative to the window mean. That destroys the
 * signal: organic sales on these platforms are a 1.5–3x halo on ad-driven sales, so a day
 * where ads worked is a day where the index is high, and dividing one by the other left
 * fits at r² ≈ -0.2 — literally worse than a flat line.
 *
 * Instead the index is built from grouped means over the calendar: a day-of-week factor and
 * an event-period factor, each averaged across many days so that channel-specific daily
 * noise cancels while genuine seasonality survives. Event periods come from the brand's own
 * promotion records, which is the only event calendar available across all seven platforms.
 *
 * Known bias: spend also rises during events, so the event factor absorbs some of that
 * media effect and the resulting curves read slightly flat. That is the safe direction for
 * a tool whose output is "spend more here".
 */
function buildDemandIndex(data: BrandData) {
  // Event days per platform, from promo records that look like platform events rather than
  // always-on price-offs (an always-on promo spans the whole window and tells us nothing).
  const windowDays = new Set(data.salesRows.map((r) => r.day));
  const eventDays = new Map<string, Set<Day>>();
  for (const p of data.promoRows) {
    const set = eventDays.get(p.platformId) ?? new Set<Day>();
    set.add(p.day);
    eventDays.set(p.platformId, set);
  }
  // A "promo day" that covers essentially every day is the everyday discount, not an event.
  for (const [platformId, days] of eventDays) {
    if (days.size > windowDays.size * 0.8) eventDays.set(platformId, new Set());
  }

  const revenueByPlatformDay = new Map<string, number>();
  for (const row of data.salesRows) {
    const key = `${row.platformId}|${row.day}`;
    revenueByPlatformDay.set(
      key,
      (revenueByPlatformDay.get(key) ?? 0) + row.grossRevenuePaise,
    );
  }

  // Group revenue by (platform, weekday) and (platform, isEvent) and take means.
  const dowSum = new Map<string, { sum: number; n: number }>();
  const eventSum = new Map<string, { sum: number; n: number }>();
  const platformSum = new Map<string, { sum: number; n: number }>();

  for (const [key, revenue] of revenueByPlatformDay) {
    const [platformId, day] = key.split("|");
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    const isEvent = eventDays.get(platformId)?.has(day) ?? false;

    bump(dowSum, `${platformId}|${dow}`, revenue);
    bump(eventSum, `${platformId}|${isEvent ? "1" : "0"}`, revenue);
    bump(platformSum, platformId, revenue);
  }

  const mean = (map: Map<string, { sum: number; n: number }>, key: string) => {
    const v = map.get(key);
    return v && v.n > 0 ? v.sum / v.n : null;
  };

  return {
    indexFor(platformId: string, day: Day): number {
      const overall = mean(platformSum, platformId);
      if (!overall || overall <= 0) return 1;

      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      const dowMean = mean(dowSum, `${platformId}|${dow}`);
      // Clamp: a weekday factor outside ±40% is sampling noise, not seasonality.
      const dowFactor = dowMean ? clamp(dowMean / overall, 0.6, 1.4) : 1;

      const isEvent = eventDays.get(platformId)?.has(day) ?? false;
      let eventFactor = 1;
      if (isEvent) {
        const on = mean(eventSum, `${platformId}|1`);
        const off = mean(eventSum, `${platformId}|0`);
        if (on && off && off > 0) eventFactor = clamp(on / off, 1, 5);
      }

      return dowFactor * eventFactor;
    },
  };
}

function bump(map: Map<string, { sum: number; n: number }>, key: string, value: number) {
  const acc = map.get(key) ?? { sum: 0, n: 0 };
  acc.sum += value;
  acc.n += 1;
  map.set(key, acc);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Daily spend at which marginal contribution hits zero: the point where the next rupee
 * of ads stops paying for itself. Found by bisection because the closed form differs per
 * curve family and this is called rarely.
 */
function efficientFrontier(curve: ResponseCurve, contributionRate: number): number {
  if (contributionRate <= 0) return 0;
  const target = 1 / contributionRate; // marginal ROAS needed to break even
  let lo = 1;
  let hi = Math.max(1000, curve.maxSpendPaise * 20);
  if (marginalResponse(curve, lo) < target) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (marginalResponse(curve, mid) > target) lo = mid;
    else hi = mid;
  }
  return Math.round(lo);
}

function groupKeyForRow(
  data: BrandData,
  row: BrandData["adRows"][number],
  dimension: PlanDimension,
): string | null {
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
  }
  void data;
  return null;
}

export function runPlan(data: BrandData, input: PlanInput): PlanOutput {
  const days = Math.max(1, daysBetween(data.range.from, data.range.to) + 1);
  const { channels, diagnostics } = buildChannels(
    data,
    input.dimension,
    input.objective,
    input.protectedKeys,
  );

  const currentDailyTotal = channels.reduce((s, c) => s + c.currentSpendPaise, 0);
  const budget = input.dailyBudgetPaise ?? currentDailyTotal;

  const result = optimizeBudget(channels, {
    totalBudgetPaise: budget,
    objective: input.objective,
    targetRoas: input.targetRoas ?? data.brand.targetRoas,
    maxChangeRatio: input.maxChangeRatio ?? 0.35,
    // Curves fitted on very few days shouldn't attract new money.
    minConfidence: 0,
  });

  return { input, result, diagnostics, days };
}

/* ------------------------------------------------------------- persistence */

export async function savePlan(
  brand: Brand,
  name: string,
  range: { from: Day; to: Day },
  output: PlanOutput,
): Promise<BudgetPlan> {
  const [plan] = await db
    .insert(budgetPlans)
    .values({
      brandId: brand.id,
      name,
      periodStart: range.from,
      periodEnd: range.to,
      totalBudgetPaise: output.result.totalBudgetPaise,
      objective: output.input.objective,
      targetRoas: output.input.targetRoas ?? null,
      constraints: {
        dimension: output.input.dimension,
        maxChangeRatio: output.input.maxChangeRatio ?? 0.35,
        protectedKeys: output.input.protectedKeys ?? [],
      },
      status: "draft",
    })
    .returning();

  if (output.result.allocations.length > 0) {
    await db.insert(budgetAllocations).values(
      output.result.allocations.map((a: Allocation) => ({
        planId: plan.id,
        dimension: a.channel.dimension,
        entityId: a.channel.id,
        entityLabel: a.channel.label,
        currentSpendPaise: a.currentSpendPaise,
        recommendedSpendPaise: a.recommendedSpendPaise,
        projectedRevenuePaise: a.projectedRevenuePaise,
        projectedContributionPaise: a.projectedContributionPaise,
        projectedRoas: a.projectedRoas,
        marginalRoas: a.marginalRoas,
        curve: {
          kind: a.channel.curve.kind,
          a: a.channel.curve.a,
          b: a.channel.curve.b,
          r2: a.channel.curve.r2,
          confidence: a.channel.curve.confidence,
          assumed: a.channel.curve.assumed,
        },
      })),
    );
  }

  return plan;
}
