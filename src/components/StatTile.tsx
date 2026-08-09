"use client";

import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { CHROME, SERIES } from "./charts/theme";

export interface StatTileProps {
  label: string;
  value: string;
  /** Period-over-period change as a fraction. */
  deltaPct?: number;
  /** Whether that change is an improvement. null = no verdict (direction is ambiguous). */
  deltaGood?: boolean | null;
  hint?: string;
  /** Sparkline values, oldest first. */
  spark?: number[];
  /** Rendered under the value: a target comparison, a break-even bar, etc. */
  footer?: ReactNode;
  emphasis?: boolean;
}

/**
 * A single headline number. Deliberately not a one-bar bar chart.
 *
 * The delta arrow gets an explicit good/bad verdict from the metric's own direction — CAC
 * going down is good, ROAS going down is not — and carries a text sign as well as colour so
 * the judgement never rests on hue alone.
 */
export function StatTile({
  label,
  value,
  deltaPct,
  deltaGood,
  hint,
  spark,
  footer,
  emphasis,
}: StatTileProps) {
  const hasDelta = deltaPct != null && Number.isFinite(deltaPct) && deltaPct !== 0;
  const up = (deltaPct ?? 0) > 0;
  const deltaColor =
    deltaGood == null
      ? CHROME.secondary
      : deltaGood
        ? "var(--delta-good)"
        : "var(--delta-bad)";

  return (
    <div className="card flex flex-col gap-1.5 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs" style={{ color: CHROME.muted }}>
          {label}
        </span>
        {hasDelta && (
          <span
            className="tabular flex items-center gap-0.5 text-xs font-medium"
            style={{ color: deltaColor }}
          >
            <span aria-hidden>{up ? "▲" : "▼"}</span>
            <span className="sr-only">{up ? "up" : "down"}</span>
            {Math.abs(deltaPct! * 100).toFixed(1)}%
          </span>
        )}
      </div>

      <div
        className={emphasis ? "text-3xl font-semibold" : "text-2xl font-semibold"}
        style={{ color: CHROME.primary, letterSpacing: "-0.01em" }}
      >
        {value}
      </div>

      {spark && spark.length > 1 && (
        <div className="-mx-1 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.map((v, i) => ({ i, v }))}>
              <Area
                type="monotone"
                dataKey="v"
                stroke={SERIES[0]}
                strokeWidth={1.5}
                fill={SERIES[0]}
                fillOpacity={0.12}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {footer}

      {hint && (
        <p className="text-[11px] leading-snug" style={{ color: CHROME.muted }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A single ratio against a limit — e.g. true ROAS against the break-even multiple. Same-hue
 * track, so it reads as "how far along" rather than as two competing categories.
 */
export function Meter({
  value,
  limit,
  goodAbove = true,
  caption,
}: {
  value: number;
  limit: number;
  goodAbove?: boolean;
  caption?: string;
}) {
  const ratio = limit > 0 && Number.isFinite(limit) ? value / limit : 0;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const ok = goodAbove ? ratio >= 1 : ratio <= 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)" }}
        role="meter"
        aria-valuenow={Number(ratio.toFixed(2))}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-label={caption}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${pct}%`,
            background: ok ? "var(--status-good)" : "var(--status-critical)",
          }}
        />
        {/* The limit itself, so "am I above the line" is readable without arithmetic. */}
        <div
          className="absolute inset-y-0 w-0.5"
          style={{ left: `${Math.min(100, 100 / Math.max(1, ratio || 1))}%`, background: CHROME.baseline }}
          aria-hidden
        />
      </div>
      {caption && (
        <span className="text-[11px]" style={{ color: CHROME.muted }}>
          {caption}
        </span>
      )}
    </div>
  );
}
