import type { Insight } from "@/services/insights";
import { formatInrCompact } from "@/lib/money";
import { EmptyState } from "./Section";

const SEVERITY = {
  critical: { label: "Critical", color: "var(--status-critical)", icon: "▲" },
  warning: { label: "Warning", color: "var(--status-warning)", icon: "▲" },
  info: { label: "Note", color: "var(--series-1)", icon: "●" },
} as const;

/**
 * The insight feed. Each item states the number, the threshold it broke and the rupee
 * impact — a marketer has to be able to argue with it, which means no bare verdicts.
 *
 * Severity carries an icon and a written label as well as a colour, because this is the one
 * list in the product where the reader's eye goes straight to the worst row.
 */
export function InsightList({
  insights,
  limit,
}: {
  insights: Insight[];
  limit?: number;
}) {
  if (insights.length === 0) {
    return (
      <EmptyState
        title="Nothing flagged in this window"
        hint="Every channel is above break-even, CAC is inside target and no co-op fund is lapsing. Widen the date range to look further back."
      />
    );
  }

  const shown = limit ? insights.slice(0, limit) : insights;

  return (
    <ul className="flex flex-col">
      {shown.map((insight, i) => {
        const s = SEVERITY[insight.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
        return (
          <li
            key={`${insight.kind}-${insight.entityId ?? i}`}
            className="flex flex-col gap-1.5 border-b py-3 last:border-b-0 first:pt-0"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: s.color }}
              >
                <span aria-hidden>{s.icon}</span>
                {s.label}
              </span>
              <h3 className="text-sm font-medium">{insight.title}</h3>
              {insight.impactPaise > 0 && (
                <span
                  className="tabular ml-auto text-sm font-semibold"
                  title="Rupee impact over the selected window"
                >
                  {formatInrCompact(insight.impactPaise)}
                </span>
              )}
            </div>
            <p
              className="max-w-4xl text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              {insight.body}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Count-by-severity strip, for the Overview header. */
export function InsightSummary({ insights }: { insights: Insight[] }) {
  const counts = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
  let impact = 0;
  for (const i of insights) {
    counts[i.severity] = (counts[i.severity] ?? 0) + 1;
    impact += i.impactPaise;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {(["critical", "warning", "info"] as const).map((key) =>
        counts[key] ? (
          <span key={key} className="flex items-center gap-1.5">
            <span aria-hidden style={{ color: SEVERITY[key].color }}>
              {SEVERITY[key].icon}
            </span>
            <span className="tabular font-medium">{counts[key]}</span>
            <span style={{ color: "var(--text-secondary)" }}>
              {SEVERITY[key].label.toLowerCase()}
            </span>
          </span>
        ) : null,
      )}
      {impact > 0 && (
        <span style={{ color: "var(--text-muted)" }}>
          {formatInrCompact(impact)} at stake
        </span>
      )}
    </div>
  );
}
