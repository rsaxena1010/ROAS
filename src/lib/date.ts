/**
 * All business days are IST (UTC+5:30) days rendered as 'YYYY-MM-DD'. Platforms report in
 * local marketplace time, so anchoring on IST keeps our days aligned with theirs and stops
 * spend and revenue landing on different dates.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Day = string;

export function toDay(date: Date | number): Day {
  const ms = typeof date === "number" ? date : date.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function dayToUtcMs(day: Day): number {
  return Date.parse(`${day}T00:00:00.000Z`) - IST_OFFSET_MS;
}

export function addDays(day: Day, delta: number): Day {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS,
  );
}

/** Inclusive on both ends. */
export function dayRange(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidDay(value: unknown): value is Day {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  );
}

export function dayOfWeek(day: Day): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

export function isWeekend(day: Day): boolean {
  const d = dayOfWeek(day);
  return d === 0 || d === 6;
}

/**
 * The window immediately before [from, to] of the same length — the honest
 * period-over-period comparison.
 */
export function previousPeriod(from: Day, to: Day): { from: Day; to: Day } {
  const span = daysBetween(from, to) + 1;
  return { from: addDays(from, -span), to: addDays(to, -1) };
}

export function lastNDays(n: number, today = toDay(Date.now())): { from: Day; to: Day } {
  return { from: addDays(today, -(n - 1)), to: today };
}
