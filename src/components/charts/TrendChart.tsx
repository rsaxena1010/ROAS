"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLegend, type LegendItem } from "./Legend";
import { TooltipCard } from "./Tooltip";
import { CHROME, axisProps, gridProps, seriesColorFor } from "./theme";

export interface TrendSeries {
  key: string;
  label: string;
  /** Formatter for values of this series. All series share one axis, so they share units. */
  format: (value: number) => string;
}

export interface TrendPoint {
  day: string;
  [key: string]: string | number;
}

/**
 * Multi-series time trend with a crosshair tooltip.
 *
 * ONE AXIS ONLY, deliberately. Plotting ROAS and spend together on two y-scales is the
 * single most misleading thing a dashboard can do — the crossover point is an artefact of
 * the scales chosen. Series handed to one TrendChart must share units; put a second measure
 * in a second chart.
 */
export function TrendChart({
  data,
  series,
  height = 240,
  referenceValue,
  referenceLabel,
  yTickFormat,
  emptyMessage = "No data in this period.",
}: {
  data: TrendPoint[];
  series: TrendSeries[];
  height?: number;
  referenceValue?: number;
  referenceLabel?: string;
  yTickFormat?: (value: number) => string;
  emptyMessage?: string;
}) {
  const order = useMemo(() => series.map((s) => s.key), [series]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const items: LegendItem[] = series.map((s) => ({
    key: s.key,
    label: s.label,
    color: seriesColorFor(s.key, order),
  }));

  const visible = series.filter((s) => !hidden.has(s.key));
  const format = series[0]?.format ?? String;

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: CHROME.muted }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            dataKey="day"
            {...axisProps}
            minTickGap={28}
            tickFormatter={(d: string) => d.slice(5).replace("-", "/")}
          />
          <YAxis
            {...axisProps}
            width={56}
            tickFormatter={yTickFormat ?? ((v: number) => format(v))}
          />
          {referenceValue != null && (
            <ReferenceLine
              y={referenceValue}
              stroke={CHROME.muted}
              strokeDasharray="4 4"
              label={{
                value: referenceLabel,
                position: "insideTopRight",
                fill: CHROME.muted,
                fontSize: 10,
              }}
            />
          )}
          <Tooltip
            cursor={{ stroke: CHROME.baseline, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipCard
                  title={String(label)}
                  rows={payload.map((p) => {
                    const s = series.find((x) => x.key === p.dataKey);
                    return {
                      label: s?.label ?? String(p.dataKey),
                      value: s ? s.format(Number(p.value)) : String(p.value),
                      color: String(p.stroke),
                      emphasis: true,
                    };
                  })}
                />
              );
            }}
          />
          {visible.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={seriesColorFor(s.key, order)}
              strokeWidth={2}
              dot={false}
              // Marker on hover is >= 8px so it's an easy target.
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHROME.surface }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend
        items={items}
        hidden={hidden}
        onToggle={(key) =>
          setHidden((prev) => {
            const next = new Set(prev);
            // Never let the reader hide every series — an empty plot isn't a state.
            if (next.has(key)) next.delete(key);
            else if (next.size < series.length - 1) next.add(key);
            return next;
          })
        }
      />
    </div>
  );
}
