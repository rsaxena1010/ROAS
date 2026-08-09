import { addDays, isValidDay, lastNDays, toDay, type Day } from "./date";

export interface Range {
  from: Day;
  to: Day;
}

export const PRESETS = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "14d", label: "Last 14 days", days: 14 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
] as const;

export type PresetKey = (typeof PRESETS)[number]["key"] | "mtd" | "custom";

/**
 * Resolve a range from URL search params. Everything is anchored on the IST business day so
 * the window matches what the platforms report.
 */
export function resolveRange(params: {
  from?: string;
  to?: string;
  preset?: string;
}): { range: Range; preset: PresetKey } {
  const today = toDay(Date.now());

  if (isValidDay(params.from) && isValidDay(params.to) && params.from <= params.to) {
    return { range: { from: params.from, to: params.to }, preset: "custom" };
  }

  if (params.preset === "mtd") {
    return { range: { from: `${today.slice(0, 7)}-01`, to: today }, preset: "mtd" };
  }

  const preset = PRESETS.find((p) => p.key === params.preset) ?? PRESETS[2];
  return { range: lastNDays(preset.days, today), preset: preset.key };
}

export function rangeLabel(range: Range): string {
  return `${range.from} to ${range.to}`;
}

/** Same length, immediately before — the comparison window. */
export function comparisonLabel(range: Range): string {
  const span = Math.round(
    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) /
      86400000,
  );
  return `vs previous ${span + 1} days`;
}

export function shiftRange(range: Range, deltaDays: number): Range {
  return { from: addDays(range.from, deltaDays), to: addDays(range.to, deltaDays) };
}
