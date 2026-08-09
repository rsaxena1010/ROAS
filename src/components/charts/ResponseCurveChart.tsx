"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ComposedChart,
} from "recharts";
import { TooltipCard } from "./Tooltip";
import { ChartLegend } from "./Legend";
import { CHROME, SERIES, axisProps, gridProps } from "./theme";
import { formatInrCompact, formatMultiple } from "@/lib/money";

export interface CurvePoint {
  spend: number;
  revenue: number;
}

/**
 * Spend-response curve for one channel: the fitted curve, the observed days behind it, and
 * the two decision markers (today's spend, and the point where the next rupee stops paying
 * for itself).
 *
 * Showing the observed scatter is not decoration — it is the honesty channel. A curve drawn
 * without its points invites the reader to trust a shape that may rest on six noisy days.
 */
export function ResponseCurveChart({
  curve,
  observed,
  currentSpend,
  frontierSpend,
  frontierExtrapolated,
  height = 260,
}: {
  curve: CurvePoint[];
  observed: CurvePoint[];
  currentSpend: number;
  frontierSpend?: number;
  frontierExtrapolated?: boolean;
  height?: number;
}) {
  const currentPoint = nearest(curve, currentSpend);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid {...gridProps} />
          <XAxis
            type="number"
            dataKey="spend"
            {...axisProps}
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => formatInrCompact(v)}
            label={{
              value: "Daily spend",
              position: "insideBottom",
              offset: -2,
              fill: CHROME.muted,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            dataKey="revenue"
            {...axisProps}
            width={60}
            tickFormatter={(v: number) => formatInrCompact(v)}
          />
          <ZAxis range={[36, 36]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as CurvePoint;
              const roas = p.spend > 0 ? p.revenue / p.spend : 0;
              return (
                <TooltipCard
                  title={`${formatInrCompact(p.spend)}/day`}
                  rows={[
                    {
                      label: "Revenue",
                      value: formatInrCompact(p.revenue),
                      color: SERIES[0],
                      emphasis: true,
                    },
                    { label: "Average ROAS", value: formatMultiple(roas) },
                  ]}
                />
              );
            }}
          />
          <Scatter
            data={observed}
            fill={CHROME.muted}
            fillOpacity={0.45}
            shape="circle"
            isAnimationActive={false}
          />
          <Line
            data={curve}
            type="monotone"
            dataKey="revenue"
            stroke={SERIES[0]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine
            x={currentSpend}
            stroke={CHROME.secondary}
            strokeDasharray="4 4"
            label={{
              value: "today",
              position: "top",
              fill: CHROME.secondary,
              fontSize: 10,
            }}
          />
          {currentPoint && (
            <ReferenceDot
              x={currentPoint.spend}
              y={currentPoint.revenue}
              r={4}
              fill={SERIES[0]}
              stroke={CHROME.surface}
              strokeWidth={2}
            />
          )}
          {frontierSpend != null && frontierSpend > 0 && !frontierExtrapolated && (
            <ReferenceLine
              x={frontierSpend}
              stroke="var(--status-warning)"
              strokeDasharray="2 3"
              label={{
                value: "break-even",
                position: "top",
                fill: CHROME.muted,
                fontSize: 10,
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <ChartLegend
        items={[
          { key: "fit", label: "Fitted response curve", color: SERIES[0] },
          { key: "obs", label: "Observed days", color: CHROME.muted },
        ]}
      />
    </div>
  );
}

function nearest(points: CurvePoint[], spend: number): CurvePoint | null {
  if (points.length === 0) return null;
  return points.reduce((best, p) =>
    Math.abs(p.spend - spend) < Math.abs(best.spend - spend) ? p : best,
  );
}

/** Kept for the curve gallery: a bare scatter of spend vs revenue with no fit drawn. */
export function SpendScatter({
  points,
  height = 180,
}: {
  points: CurvePoint[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid {...gridProps} />
        <XAxis
          type="number"
          dataKey="spend"
          {...axisProps}
          tickFormatter={(v: number) => formatInrCompact(v)}
        />
        <YAxis
          type="number"
          dataKey="revenue"
          {...axisProps}
          width={56}
          tickFormatter={(v: number) => formatInrCompact(v)}
        />
        <ZAxis range={[36, 36]} />
        <Scatter data={points} fill={SERIES[0]} fillOpacity={0.6} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
