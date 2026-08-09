/**
 * Shared chart chrome. Everything reads a CSS custom property so light/dark swap happens
 * in one place (globals.css) and charts never hard-code a hex.
 */

/** Categorical slots, assigned in fixed order. Never cycle past slot 8 — fold to "Other". */
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export const MAX_SERIES = SERIES.length;

/** Sequential ramp for magnitude (one hue, light -> dark). */
export const SEQUENTIAL = [
  "var(--seq-100)",
  "var(--seq-250)",
  "var(--seq-400)",
  "var(--seq-550)",
  "var(--seq-700)",
] as const;

export const CHROME = {
  grid: "var(--grid)",
  baseline: "var(--baseline)",
  surface: "var(--surface-1)",
  muted: "var(--text-muted)",
  secondary: "var(--text-secondary)",
  primary: "var(--text-primary)",
} as const;

export const STATUS = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const;

/** Axis/tick styling shared by every chart so they read as one system. */
export const axisProps = {
  stroke: CHROME.baseline,
  tick: { fill: CHROME.muted, fontSize: 11 },
  tickLine: false,
} as const;

export const gridProps = {
  stroke: CHROME.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;

/**
 * Colour by entity identity, not by rank. A filter that removes a series must not repaint
 * the survivors, so the slot is derived from a stable key rather than array position.
 */
export function seriesColorFor(key: string, order: string[]): string {
  const index = order.indexOf(key);
  return SERIES[(index < 0 ? 0 : index) % MAX_SERIES];
}

/** Bucket a 0..1 value onto the sequential ramp. */
export function sequentialFor(value: number): string {
  const v = Math.min(1, Math.max(0, value));
  return SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.floor(v * SEQUENTIAL.length))];
}
