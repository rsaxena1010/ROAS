export const PLATFORM_COLOR_VAR: Record<string, string> = {
  amazon: "--series-1",
  flipkart: "--series-2",
  nykaa: "--series-3",
  myntra: "--series-4",
  instamart: "--series-5",
  jiomart: "--series-6",
  bigbasket: "--series-7",
  blinkit: "--series-8",
  zepto: "--series-9",
};

export function platformColorVar(platformKey: string): string {
  return `var(${PLATFORM_COLOR_VAR[platformKey] ?? "--series-9"})`;
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatRoas(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}x`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
