/**
 * Money helpers. Everything internal is integer paise; rupees only exist at the edges
 * (UI rendering, CSV import/export, API request bodies).
 */

export const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/** Split `paise` by `share` without losing a paisa: the remainder goes to the first part. */
export function splitPaise(paise: number, share: number): [number, number] {
  const first = Math.round(paise * share);
  return [first, paise - first];
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInr(paise: number, opts?: { precise?: boolean }): string {
  const rupees = paiseToRupees(paise);
  return opts?.precise ? inrPrecise.format(rupees) : inr.format(rupees);
}

/**
 * Indian-convention compact money: ₹1.2L, ₹3.4Cr. Brands read spend in lakhs/crores,
 * not millions, so Intl's `notation: "compact"` is wrong here.
 */
export function formatInrCompact(paise: number): string {
  const rupees = paiseToRupees(paise);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(abs / 1e7 >= 100 ? 0 : 2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(abs / 1e5 >= 100 ? 0 : 2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(abs / 1e3 >= 100 ? 0 : 1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function formatMultiple(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}x`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Ratio that returns 0 instead of NaN/Infinity when the denominator is 0. */
export function safeDiv(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  const v = numerator / denominator;
  return Number.isFinite(v) ? v : 0;
}
