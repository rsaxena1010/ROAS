"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TooltipCard } from "./Tooltip";
import { CHROME, axisProps, gridProps, sequentialFor } from "./theme";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Optional secondary figure shown in the tooltip only. */
  secondary?: { label: string; value: string };
  /** 0..1 magnitude used to pick the sequential step. Defaults to value/max. */
  intensity?: number;
}

/**
 * Horizontal magnitude comparison, sequential single-hue.
 *
 * Sequential rather than categorical because the job is "compare magnitude", not "tell these
 * entities apart" — and because a bar chart already encodes identity in the axis label, so
 * spending eight categorical hues here would be colour with no job to do.
 */
export function ComparisonBars({
  data,
  format,
  height,
  referenceValue,
  referenceLabel,
  showValues = true,
}: {
  data: BarDatum[];
  format: (value: number) => string;
  height?: number;
  referenceValue?: number;
  referenceLabel?: string;
  showValues?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="py-6 text-center text-sm" style={{ color: CHROME.muted }}>
        Nothing to compare yet.
      </div>
    );
  }

  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const chartHeight = height ?? Math.max(120, data.length * 34 + 28);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: showValues ? 64 : 12, bottom: 4, left: 4 }}
        barCategoryGap={6}
      >
        <CartesianGrid {...gridProps} vertical horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={format} />
        <YAxis
          type="category"
          dataKey="label"
          {...axisProps}
          width={150}
          tick={{ fill: CHROME.secondary, fontSize: 11 }}
        />
        {referenceValue != null && (
          <ReferenceLine
            x={referenceValue}
            stroke={CHROME.secondary}
            strokeDasharray="4 4"
            label={{
              value: referenceLabel,
              position: "top",
              fill: CHROME.muted,
              fontSize: 10,
            }}
          />
        )}
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload as BarDatum;
            return (
              <TooltipCard
                title={d.label}
                rows={[
                  { label: "Value", value: format(d.value), emphasis: true },
                  ...(d.secondary
                    ? [{ label: d.secondary.label, value: d.secondary.value }]
                    : []),
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="value"
          // 4px rounded data-end, square against the baseline.
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell
              key={d.key}
              fill={sequentialFor(d.intensity ?? Math.abs(d.value) / max)}
            />
          ))}
          {showValues && (
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => format(Number(v))}
              style={{ fill: CHROME.secondary, fontSize: 11 }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
