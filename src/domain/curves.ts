/**
 * Spend-response curves.
 *
 * Reallocating budget on average ROAS is the classic mistake: the channel with the best
 * average is often already saturated, so the next rupee into it returns less than the next
 * rupee into a "worse" channel. What matters is MARGINAL return, which means we need a
 * concave response curve per channel rather than a single ratio.
 *
 * Two concave families are fitted and the better one wins:
 *
 *   power    R(S) = a·S^b,  0 < b < 1        — no ceiling, gentle decay. Fits search-type
 *                                              demand capture well.
 *   hill     R(S) = V·S/(k+S)                — hard ceiling V (total addressable demand).
 *                                              Fits display/quick-commerce placements.
 *
 * Both are fitted by a 1-D grid search over the shape parameter with the scale parameter
 * solved in closed form by weighted least squares. Same objective for both, so comparing
 * their R² is legitimate. Errors are measured in revenue space (not log space) because
 * that is the thing we are actually trying to predict.
 *
 * Curves are fitted on DAILY spend/revenue points, so `spend` in every function here is
 * daily spend in paise unless the caller scales consistently.
 */

export interface ResponsePoint {
  spendPaise: number;
  /** Revenue, contribution, or new customers — whatever the objective maximises. */
  responsePaise: number;
  /** Optional weight; defaults to spend, so heavy days matter more than trivial ones. */
  weight?: number;
}

/**
 * Remove the common demand shock before fitting.
 *
 * This matters more than the choice of curve family. Sale events lift both spend and
 * demand at the same time, so a naive fit attributes a festival to the media buy and
 * reports a rising response curve where there is none — the fits came out at r² ≈ 0.03 on
 * quick-commerce channels until this was added. `demandIndex` is the day's total category
 * demand relative to the window average (1.0 = a normal day); dividing the response by it
 * restates every day as an average-demand day, which is the right basis for planning a
 * budget that will be spent on ordinary days.
 *
 * Days with an extreme index are dropped rather than divided: at 4x demand the linear
 * correction is not credible and the point does more harm than good.
 */
export function deseasonalise(
  points: (ResponsePoint & { demandIndex?: number })[],
  maxIndex = 2.5,
): ResponsePoint[] {
  return points
    .filter((p) => {
      const idx = p.demandIndex ?? 1;
      return idx > 0.2 && idx <= maxIndex;
    })
    .map((p) => ({
      spendPaise: p.spendPaise,
      responsePaise: p.responsePaise / (p.demandIndex ?? 1),
      weight: p.weight,
    }));
}

export type CurveKind = "power" | "hill" | "linear";

export interface ResponseCurve {
  kind: CurveKind;
  /** power: R = a·S^b. hill: R = a·S/(b+S) — `a` is Vmax, `b` is the half-saturation spend. */
  a: number;
  b: number;
  /** Weighted R² against the fitted points. */
  r2: number;
  /** 0..1 heuristic: do we have enough spread in the data to trust this? */
  confidence: number;
  nPoints: number;
  /** Spend range the fit is supported by. Extrapolation beyond this is flagged. */
  minSpendPaise: number;
  maxSpendPaise: number;
  /** True when the curve is a prior, not a fit — data was too thin. */
  assumed: boolean;
}

const DEFAULT_ELASTICITY = 0.72;
/** Trust the curve up to this multiple of the max observed spend; clamp beyond it. */
export const EXTRAPOLATION_LIMIT = 3;
/**
 * Below this weighted R², spend explains so little of the response that the fit is noise.
 * A bad fit is worse than no fit: a spuriously flat curve reports marginal ROAS near zero
 * and the optimizer would defund a perfectly healthy channel. Fall back to the prior.
 */
const MIN_ACCEPTABLE_R2 = 0.1;

export function fitResponseCurve(points: ResponsePoint[]): ResponseCurve {
  const clean = points.filter(
    (p) =>
      Number.isFinite(p.spendPaise) &&
      Number.isFinite(p.responsePaise) &&
      p.spendPaise > 0 &&
      p.responsePaise >= 0,
  );

  if (clean.length === 0) {
    return {
      kind: "power",
      a: 0,
      b: DEFAULT_ELASTICITY,
      r2: 0,
      confidence: 0,
      nPoints: 0,
      minSpendPaise: 0,
      maxSpendPaise: 0,
      assumed: true,
    };
  }

  const spends = clean.map((p) => p.spendPaise);
  const minSpend = Math.min(...spends);
  const maxSpend = Math.max(...spends);
  const distinct = new Set(spends.map((s) => Math.round(s / 1000))).size;
  const spread = maxSpend > 0 ? (maxSpend - minSpend) / maxSpend : 0;

  // With fewer than 5 distinct spend levels or almost no variation in spend, any fit is
  // fantasy. Anchor a prior curve on the observed average instead and say so.
  if (clean.length < 5 || distinct < 4 || spread < 0.15) {
    return assumedCurve(clean, minSpend, maxSpend);
  }

  const power = fitPower(clean);
  const hill = fitHill(clean);
  const best = hill.r2 > power.r2 + 0.01 ? hill : power;

  if (best.r2 < MIN_ACCEPTABLE_R2) {
    return { ...assumedCurve(clean, minSpend, maxSpend), r2: best.r2 };
  }

  // Goodness of fit dominates. Thirty days of data at a wide spread still tells you
  // nothing if the response doesn't track spend — an early version weighted volume of
  // data heavily and happily reported 0.8 confidence on an r²=0.03 fit.
  const dataQuality =
    0.4 * clamp01(clean.length / 30) +
    0.3 * clamp01(distinct / 15) +
    0.3 * clamp01(spread / 0.6);
  const confidence = clamp01(clamp01(best.r2) * 0.75 + dataQuality * 0.25 * clamp01(best.r2 * 3));

  return {
    ...best,
    confidence,
    nPoints: clean.length,
    minSpendPaise: minSpend,
    maxSpendPaise: maxSpend,
    assumed: false,
  };
}

function assumedCurve(
  points: ResponsePoint[],
  minSpend: number,
  maxSpend: number,
): ResponseCurve {
  const totalSpend = points.reduce((s, p) => s + p.spendPaise, 0);
  const totalResponse = points.reduce((s, p) => s + p.responsePaise, 0);
  const meanSpend = totalSpend / points.length;
  const meanResponse = totalResponse / points.length;
  // Pin R(meanSpend) = meanResponse with the prior elasticity: a = R̄ / S̄^b.
  const a = meanSpend > 0 ? meanResponse / Math.pow(meanSpend, DEFAULT_ELASTICITY) : 0;
  return {
    kind: "power",
    a,
    b: DEFAULT_ELASTICITY,
    r2: 0,
    confidence: points.length >= 3 ? 0.15 : 0.05,
    nPoints: points.length,
    minSpendPaise: minSpend,
    maxSpendPaise: maxSpend,
    assumed: true,
  };
}

interface RawFit {
  kind: CurveKind;
  a: number;
  b: number;
  r2: number;
}

/** R = a·S^b. Grid over b, `a` solved by weighted least squares. */
function fitPower(points: ResponsePoint[]): RawFit {
  let best: RawFit = { kind: "power", a: 0, b: DEFAULT_ELASTICITY, r2: -Infinity };
  for (let b = 0.1; b <= 0.98; b += 0.01) {
    const basis = points.map((p) => Math.pow(p.spendPaise, b));
    const a = solveScale(points, basis);
    const r2 = weightedR2(points, basis.map((z) => a * z));
    if (r2 > best.r2) best = { kind: "power", a, b, r2 };
  }
  return best;
}

/** R = V·S/(k+S). Grid over k (log-spaced across the observed range), V solved by WLS. */
function fitHill(points: ResponsePoint[]): RawFit {
  const maxSpend = Math.max(...points.map((p) => p.spendPaise));
  let best: RawFit = { kind: "hill", a: 0, b: maxSpend, r2: -Infinity };
  // Half-saturation anywhere from 5% to 50x the biggest day we've seen.
  const lo = Math.log(Math.max(1, maxSpend * 0.05));
  const hi = Math.log(Math.max(2, maxSpend * 50));
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const k = Math.exp(lo + ((hi - lo) * i) / steps);
    const basis = points.map((p) => p.spendPaise / (k + p.spendPaise));
    const v = solveScale(points, basis);
    const r2 = weightedR2(points, basis.map((z) => v * z));
    if (r2 > best.r2) best = { kind: "hill", a: v, b: k, r2 };
  }
  return best;
}

/** argmin_c Σ w·(R - c·z)² = Σ w·z·R / Σ w·z². */
function solveScale(points: ResponsePoint[], basis: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < points.length; i++) {
    const w = points[i].weight ?? points[i].spendPaise;
    num += w * basis[i] * points[i].responsePaise;
    den += w * basis[i] * basis[i];
  }
  return den > 0 ? num / den : 0;
}

function weightedR2(points: ResponsePoint[], predicted: number[]): number {
  let wSum = 0;
  let mean = 0;
  for (const p of points) {
    const w = p.weight ?? p.spendPaise;
    wSum += w;
    mean += w * p.responsePaise;
  }
  if (wSum === 0) return 0;
  mean /= wSum;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < points.length; i++) {
    const w = points[i].weight ?? points[i].spendPaise;
    ssRes += w * (points[i].responsePaise - predicted[i]) ** 2;
    ssTot += w * (points[i].responsePaise - mean) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

/* ------------------------------------------------------------- evaluation */

export function predictResponse(curve: ResponseCurve, spendPaise: number): number {
  const s = Math.max(0, spendPaise);
  if (s === 0) return 0;
  if (curve.kind === "hill") return (curve.a * s) / (curve.b + s);
  return curve.a * Math.pow(s, curve.b);
}

/** dR/dS — revenue from the next rupee. The number the optimizer equalises. */
export function marginalResponse(curve: ResponseCurve, spendPaise: number): number {
  const s = Math.max(1, spendPaise);
  if (curve.kind === "hill") return (curve.a * curve.b) / (curve.b + s) ** 2;
  return curve.a * curve.b * Math.pow(s, curve.b - 1);
}

export function averageRoas(curve: ResponseCurve, spendPaise: number): number {
  if (spendPaise <= 0) return 0;
  return predictResponse(curve, spendPaise) / spendPaise;
}

/**
 * Spend at which marginal return falls to `target`. Closed form per family; used to price
 * "how much can this channel absorb before it stops paying back?".
 */
export function spendForMarginalRoas(
  curve: ResponseCurve,
  target: number,
): number {
  if (target <= 0 || curve.a <= 0) return Number.POSITIVE_INFINITY;
  if (curve.kind === "hill") {
    // V·k/(k+S)² = t  =>  S = sqrt(V·k/t) - k
    const s = Math.sqrt((curve.a * curve.b) / target) - curve.b;
    return Math.max(0, s);
  }
  // a·b·S^(b-1) = t  =>  S = (t/(a·b))^(1/(b-1))
  const s = Math.pow(target / (curve.a * curve.b), 1 / (curve.b - 1));
  return Number.isFinite(s) ? Math.max(0, s) : Number.POSITIVE_INFINITY;
}

/**
 * How far past the supported spend range a proposal reaches. The UI downgrades a
 * recommendation that relies on heavy extrapolation.
 */
export function extrapolationRatio(curve: ResponseCurve, spendPaise: number): number {
  if (curve.maxSpendPaise <= 0) return Number.POSITIVE_INFINITY;
  return spendPaise / curve.maxSpendPaise;
}

/** Saturation: 0 = plenty of headroom, 1 = every extra rupee is wasted. */
export function saturationIndex(curve: ResponseCurve, spendPaise: number): number {
  const avg = averageRoas(curve, spendPaise);
  if (avg <= 0) return 1;
  return clamp01(1 - marginalResponse(curve, spendPaise) / avg);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}
