/**
 * Budget reallocation across investment channels.
 *
 * A "channel" is any slice the brand can move money between: a platform, a (platform,
 * ad type) pair, a campaign, an asset, or a SKU. Each carries a fitted concave response
 * curve, so the allocation problem is:
 *
 *     maximise  Σ Rᵢ(Sᵢ)      subject to  Σ Sᵢ ≤ B,  floorᵢ ≤ Sᵢ ≤ capᵢ
 *
 * With every Rᵢ concave, greedy water-filling — repeatedly hand the next slice of budget
 * to whichever channel has the highest marginal return — is globally optimal. That also
 * makes the result explainable: at the optimum every unconstrained channel has the same
 * marginal ROAS, and the ones sitting at a floor or cap are exactly the ones the brand
 * chose to constrain.
 *
 * Objectives differ only in what the curve predicts and what "marginal value" means:
 *   max_revenue        maximise attributed revenue
 *   max_contribution   maximise gross contribution (revenue × margin) net of the spend
 *   max_new_customers  curve fitted on new customers instead of revenue
 *   hit_target_roas    maximise revenue but refuse any rupee below the target multiple
 */

import { safeDiv } from "@/lib/money";
import {
  EXTRAPOLATION_LIMIT,
  extrapolationRatio,
  marginalResponse,
  predictResponse,
  saturationIndex,
  type ResponseCurve,
} from "./curves";

export type Objective =
  | "max_revenue"
  | "max_contribution"
  | "max_new_customers"
  | "hit_target_roas";

export interface Channel {
  id: string;
  label: string;
  dimension: "platform" | "campaign" | "ad_type" | "product" | "asset";
  /** Daily spend today, paise. The baseline every recommendation is expressed against. */
  currentSpendPaise: number;
  curve: ResponseCurve;
  /** Gross contribution rate for trade in this channel, from economics.ts. */
  contributionRate: number;
  /** Hard floor, e.g. brand-defence campaigns that must never go dark. */
  minSpendPaise?: number;
  /** Hard cap, e.g. the platform's inventory or an agreed commitment. */
  maxSpendPaise?: number;
  /** Extra context carried through to the UI. */
  meta?: Record<string, unknown>;
}

export interface OptimizeOptions {
  /** Total daily budget to distribute, paise. */
  totalBudgetPaise: number;
  objective: Objective;
  /** Required for hit_target_roas; also used as a soft reference elsewhere. */
  targetRoas?: number;
  /**
   * Cap on how far any channel may move from its current spend in one plan, as a
   * fraction. 0.4 = "nothing changes by more than ±40%". Keeps plans operable and
   * stops the optimizer betting the budget on an extrapolated curve.
   */
  maxChangeRatio?: number;
  /**
   * Don't trust a curve past this multiple of its observed max spend. Defaults to
   * curves.EXTRAPOLATION_LIMIT.
   */
  extrapolationLimit?: number;
  /** Number of greedy increments. More = finer allocation, linear cost. */
  steps?: number;
  /** Refuse to fund a channel whose curve confidence is below this. */
  minConfidence?: number;
}

export interface Allocation {
  channel: Channel;
  currentSpendPaise: number;
  recommendedSpendPaise: number;
  deltaPaise: number;
  deltaRatio: number;
  currentRevenuePaise: number;
  projectedRevenuePaise: number;
  projectedContributionPaise: number;
  currentRoas: number;
  projectedRoas: number;
  /** Marginal return at the recommended spend. Equal across unconstrained channels. */
  marginalRoas: number;
  /** 0 = headroom, 1 = saturated. */
  saturation: number;
  /** Why the channel stopped where it did. */
  binding: "none" | "floor" | "cap" | "change_limit" | "extrapolation" | "target_roas" | "confidence";
  action: "increase" | "decrease" | "hold";
}

export interface OptimizeResult {
  allocations: Allocation[];
  totalBudgetPaise: number;
  allocatedPaise: number;
  /** Budget the optimizer refused to spend because no channel paid back. */
  unallocatedPaise: number;
  currentRevenuePaise: number;
  projectedRevenuePaise: number;
  currentContributionPaise: number;
  projectedContributionPaise: number;
  /** Extra revenue at the same total budget. The headline "found money" number. */
  revenueUpliftPaise: number;
  contributionUpliftPaise: number;
  currentRoas: number;
  projectedRoas: number;
  /** The equalised marginal ROAS at the optimum — the brand's true cost of growth. */
  clearingMarginalRoas: number;
  objective: Objective;
  warnings: string[];
}

const DEFAULT_STEPS = 2000;

export function optimizeBudget(
  channels: Channel[],
  opts: OptimizeOptions,
): OptimizeResult {
  const warnings: string[] = [];
  const steps = Math.max(50, opts.steps ?? DEFAULT_STEPS);
  const extraLimit = opts.extrapolationLimit ?? EXTRAPOLATION_LIMIT;
  const minConfidence = opts.minConfidence ?? 0;
  const budget = Math.max(0, opts.totalBudgetPaise);

  if (channels.length === 0) {
    return emptyResult(budget, opts.objective, ["No channels with spend history."]);
  }

  const bounds = channels.map((c) => resolveBounds(c, opts, extraLimit, minConfidence));

  const floorTotal = bounds.reduce((s, b) => s + b.min, 0);
  if (floorTotal > budget) {
    warnings.push(
      `Minimum commitments (${Math.round(floorTotal / 100)}) exceed the budget. Floors were scaled down proportionally.`,
    );
    const scale = safeDiv(budget, floorTotal);
    for (const b of bounds) b.min = Math.floor(b.min * scale);
  }

  // Everyone starts at their floor; the remainder is auctioned off by marginal return.
  const spend = bounds.map((b) => b.min);
  let remaining = budget - spend.reduce((s, v) => s + v, 0);
  const increment = Math.max(1, Math.floor(budget / steps));

  const value = (i: number, s: number) => marginalValue(channels[i], opts, s, increment);

  let clearing = 0;
  let guard = steps * 4;
  while (remaining >= increment && guard-- > 0) {
    let bestIdx = -1;
    let bestValue = 0;
    for (let i = 0; i < channels.length; i++) {
      if (spend[i] + increment > bounds[i].max) continue;
      const v = value(i, spend[i]);
      if (v > bestValue) {
        bestValue = v;
        bestIdx = i;
      }
    }
    // Nothing left that returns more than it costs (or clears the target) — stop.
    if (bestIdx < 0) break;
    spend[bestIdx] += increment;
    remaining -= increment;
    clearing = marginalResponse(channels[bestIdx].curve, spend[bestIdx]);
  }

  const allocations: Allocation[] = channels.map((channel, i) => {
    const rec = spend[i];
    const current = channel.currentSpendPaise;
    const currentRevenue = predictResponse(channel.curve, current);
    const projRevenue = predictResponse(channel.curve, rec);
    const marginal = marginalResponse(channel.curve, rec);
    return {
      channel,
      currentSpendPaise: current,
      recommendedSpendPaise: rec,
      deltaPaise: rec - current,
      deltaRatio: safeDiv(rec - current, current),
      currentRevenuePaise: Math.round(currentRevenue),
      projectedRevenuePaise: Math.round(projRevenue),
      projectedContributionPaise: Math.round(
        projRevenue * channel.contributionRate - rec,
      ),
      currentRoas: safeDiv(currentRevenue, current),
      projectedRoas: safeDiv(projRevenue, rec),
      marginalRoas: marginal,
      saturation: saturationIndex(channel.curve, rec),
      binding: describeBinding(rec, bounds[i], clearing, marginal, opts),
      action: rec > current * 1.02 ? "increase" : rec < current * 0.98 ? "decrease" : "hold",
    };
  });

  const allocated = spend.reduce((s, v) => s + v, 0);
  const currentRevenue = allocations.reduce((s, a) => s + a.currentRevenuePaise, 0);
  const projectedRevenue = allocations.reduce((s, a) => s + a.projectedRevenuePaise, 0);
  const currentContribution = allocations.reduce(
    (s, a) =>
      s + Math.round(a.currentRevenuePaise * a.channel.contributionRate) - a.currentSpendPaise,
    0,
  );
  const projectedContribution = allocations.reduce(
    (s, a) => s + a.projectedContributionPaise,
    0,
  );
  const currentTotalSpend = allocations.reduce((s, a) => s + a.currentSpendPaise, 0);

  if (allocations.some((a) => a.channel.curve.assumed)) {
    warnings.push(
      "Some channels have too little spend variation to fit a response curve; a diminishing-returns prior was used. Vary daily spend on those channels for a week to sharpen the plan.",
    );
  }
  if (budget - allocated > increment * 2) {
    warnings.push(
      `${formatPaiseShort(budget - allocated)} of the budget was left unallocated because no channel returned above the bar.`,
    );
  }

  return {
    allocations: allocations.sort((a, b) => b.deltaPaise - a.deltaPaise),
    totalBudgetPaise: budget,
    allocatedPaise: allocated,
    unallocatedPaise: budget - allocated,
    currentRevenuePaise: currentRevenue,
    projectedRevenuePaise: projectedRevenue,
    currentContributionPaise: currentContribution,
    projectedContributionPaise: projectedContribution,
    revenueUpliftPaise: projectedRevenue - currentRevenue,
    contributionUpliftPaise: projectedContribution - currentContribution,
    currentRoas: safeDiv(currentRevenue, currentTotalSpend),
    projectedRoas: safeDiv(projectedRevenue, allocated),
    clearingMarginalRoas: clearing,
    objective: opts.objective,
    warnings,
  };
}

interface Bounds {
  min: number;
  max: number;
  /** Which rule produced `max`, for explainability. */
  maxReason: Allocation["binding"];
}

function resolveBounds(
  c: Channel,
  opts: OptimizeOptions,
  extraLimit: number,
  minConfidence: number,
): Bounds {
  let min = Math.max(0, c.minSpendPaise ?? 0);
  let max = c.maxSpendPaise ?? Number.POSITIVE_INFINITY;
  let maxReason: Allocation["binding"] = c.maxSpendPaise != null ? "cap" : "none";

  // A channel we can't model shouldn't get new money — hold it at today's spend.
  if (c.curve.confidence < minConfidence) {
    return { min: Math.min(min, c.currentSpendPaise), max: c.currentSpendPaise, maxReason: "confidence" };
  }

  if (opts.maxChangeRatio != null && c.currentSpendPaise > 0) {
    const lo = Math.floor(c.currentSpendPaise * (1 - opts.maxChangeRatio));
    const hi = Math.ceil(c.currentSpendPaise * (1 + opts.maxChangeRatio));
    min = Math.max(min, lo);
    if (hi < max) {
      max = hi;
      maxReason = "change_limit";
    }
  }

  const extraCap = c.curve.maxSpendPaise * extraLimit;
  if (extraCap > 0 && extraCap < max) {
    max = Math.floor(extraCap);
    maxReason = "extrapolation";
  }

  if (max < min) max = min;
  return { min, max, maxReason };
}

/**
 * Value of the next `increment` of spend, in "paise of objective per paise of spend".
 * Returns 0 when the increment shouldn't be bought at all.
 */
function marginalValue(
  c: Channel,
  opts: OptimizeOptions,
  currentSpend: number,
  increment: number,
): number {
  // Average marginal return over the increment rather than the point derivative: with
  // coarse steps the point value overshoots near S≈0 on power curves.
  const gain =
    predictResponse(c.curve, currentSpend + increment) -
    predictResponse(c.curve, currentSpend);
  const mr = gain / increment;
  if (!Number.isFinite(mr) || mr <= 0) return 0;

  switch (opts.objective) {
    case "max_revenue":
    case "max_new_customers":
      return mr;
    case "hit_target_roas": {
      const target = opts.targetRoas ?? 1;
      return mr >= target ? mr : 0;
    }
    case "max_contribution": {
      // Only buy the increment if the contribution it generates exceeds its own cost.
      const net = mr * c.contributionRate - 1;
      return net > 0 ? net : 0;
    }
  }
}

function describeBinding(
  rec: number,
  bounds: Bounds,
  clearing: number,
  marginal: number,
  opts: OptimizeOptions,
): Allocation["binding"] {
  if (rec <= bounds.min && bounds.min > 0) return "floor";
  if (rec >= bounds.max && Number.isFinite(bounds.max)) return bounds.maxReason;
  if (
    opts.objective === "hit_target_roas" &&
    opts.targetRoas != null &&
    marginal < opts.targetRoas * 1.05
  ) {
    return "target_roas";
  }
  // Sitting at the clearing price is the healthy state, not a constraint.
  if (clearing > 0 && Math.abs(marginal - clearing) / clearing < 0.1) return "none";
  return "none";
}

function emptyResult(
  budget: number,
  objective: Objective,
  warnings: string[],
): OptimizeResult {
  return {
    allocations: [],
    totalBudgetPaise: budget,
    allocatedPaise: 0,
    unallocatedPaise: budget,
    currentRevenuePaise: 0,
    projectedRevenuePaise: 0,
    currentContributionPaise: 0,
    projectedContributionPaise: 0,
    revenueUpliftPaise: 0,
    contributionUpliftPaise: 0,
    currentRoas: 0,
    projectedRoas: 0,
    clearingMarginalRoas: 0,
    objective,
    warnings,
  };
}

function formatPaiseShort(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 1e7) return `₹${(rupees / 1e7).toFixed(1)}Cr`;
  if (rupees >= 1e5) return `₹${(rupees / 1e5).toFixed(1)}L`;
  if (rupees >= 1e3) return `₹${(rupees / 1e3).toFixed(1)}K`;
  return `₹${rupees.toFixed(0)}`;
}
