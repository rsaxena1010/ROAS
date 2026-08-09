"use client";

/**
 * Formatter-bound chart wrappers.
 *
 * TrendChart and ComparisonBars take a `format` callback, and a function cannot cross the
 * server/client boundary. Rather than weaken those APIs — the formatter belongs with the
 * chart, since the y-axis, the tooltip and the data labels must agree — the bindings live
 * here as client components that server pages can render directly.
 */

import { ComparisonBars, type BarDatum } from "./ComparisonBars";
import { TrendChart, type TrendPoint } from "./TrendChart";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";

const FORMATTERS = {
  money: formatInrCompact,
  multiple: (v: number) => formatMultiple(v),
  percent: (v: number) => formatPercent(v, 0),
  count: (v: number) => Math.round(v).toLocaleString("en-IN"),
} as const;

export type Unit = keyof typeof FORMATTERS;

export function Bars({
  data,
  unit,
  height,
  referenceValue,
  referenceLabel,
  showValues = true,
}: {
  data: BarDatum[];
  unit: Unit;
  height?: number;
  referenceValue?: number;
  referenceLabel?: string;
  showValues?: boolean;
}) {
  return (
    <ComparisonBars
      data={data}
      format={FORMATTERS[unit]}
      height={height}
      referenceValue={referenceValue}
      referenceLabel={referenceLabel}
      showValues={showValues}
    />
  );
}

export function Trend({
  data,
  series,
  unit,
  height,
  referenceValue,
  referenceLabel,
  emptyMessage,
}: {
  data: TrendPoint[];
  /** All series share one y-axis, so they must share this unit. */
  series: { key: string; label: string }[];
  unit: Unit;
  height?: number;
  referenceValue?: number;
  referenceLabel?: string;
  emptyMessage?: string;
}) {
  const format = FORMATTERS[unit];
  return (
    <TrendChart
      data={data}
      series={series.map((s) => ({ ...s, format }))}
      height={height}
      referenceValue={referenceValue}
      referenceLabel={referenceLabel}
      yTickFormat={format}
      emptyMessage={emptyMessage}
    />
  );
}
