import Link from "next/link";
import type { GroupedMetrics } from "@/services/analytics";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { deltaVerdict } from "@/domain/metrics";

/**
 * The table view. Every chart in this app is backed by one of these — that is the relief for
 * the lighter palette slots, and it is also how a marketer exports a number into a deck.
 */
export function MetricsTable({
  rows,
  previous,
  linkFor,
  showBreakEven = true,
}: {
  rows: GroupedMetrics[];
  previous?: Map<string, GroupedMetrics>;
  linkFor?: (row: GroupedMetrics) => string;
  showBreakEven?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-3 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
        No spend or sales in this window.
      </p>
    );
  }

  const anyProrated = rows.some((r) => r.allocationBasis === "prorated");

  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th className="text-right">Invested</th>
            <th className="text-right">Ad spend</th>
            <th className="text-right">Brand discount</th>
            <th className="text-right">Reported ROAS</th>
            <th className="text-right">True ROAS</th>
            {showBreakEven && <th className="text-right">Break-even</th>}
            <th className="text-right">CAC</th>
            <th className="text-right">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const m = row.metrics;
            const prev = previous?.get(row.key)?.metrics;
            const trueDelta = prev
              ? deltaVerdict("trueRoas", m.trueRoas, prev.trueRoas)
              : null;
            const healthy = Number.isFinite(m.breakEvenRoas)
              ? m.trueRoas >= m.breakEvenRoas
              : false;

            return (
              <tr key={row.key}>
                <td>
                  <div className="flex flex-col">
                    {linkFor ? (
                      <Link href={linkFor(row)} className="font-medium hover:underline">
                        {row.label}
                      </Link>
                    ) : (
                      <span className="font-medium">{row.label}</span>
                    )}
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {row.sublabel}
                      {row.allocationBasis === "prorated" && (
                        <span title="Brand-funded discounts and event fees are allocated to this row by share of attributed revenue, not measured at this grain.">
                          {row.sublabel ? " · " : ""}allocated
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="tabular text-right">
                  {formatInrCompact(m.totalInvestmentPaise)}
                </td>
                <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatInrCompact(m.adSpendPaise)}
                </td>
                <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatInrCompact(m.brandFundedDiscountPaise)}
                </td>
                <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatMultiple(m.reportedRoas)}
                </td>
                <td className="tabular text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    <span
                      aria-hidden
                      title={healthy ? "Above break-even" : "Below break-even"}
                    >
                      {healthy ? "●" : "○"}
                    </span>
                    {formatMultiple(m.trueRoas)}
                    {trueDelta?.good != null && (
                      <span
                        className="text-[10px]"
                        style={{
                          color: trueDelta.good ? "var(--delta-good)" : "var(--delta-bad)",
                        }}
                      >
                        {trueDelta.pct > 0 ? "▲" : "▼"}
                        {Math.abs(trueDelta.pct * 100).toFixed(0)}%
                      </span>
                    )}
                  </span>
                </td>
                {showBreakEven && (
                  <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                    {Number.isFinite(m.breakEvenRoas)
                      ? formatMultiple(m.breakEvenRoas)
                      : "no margin"}
                  </td>
                )}
                <td className="tabular text-right">{formatInrCompact(m.cacPaise)}</td>
                <td
                  className="tabular text-right font-medium"
                  style={{
                    color:
                      m.netContributionPaise >= 0
                        ? "var(--delta-good)"
                        : "var(--delta-bad)",
                  }}
                >
                  {formatInrCompact(m.netContributionPaise)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="px-3 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        ● above break-even · ○ below. True ROAS charges each channel its own ad spend plus its
        pro-rata share of brand-funded discount and event fees, net of returns.
        {anyProrated &&
          " Rows marked “allocated” have sales-side costs assigned by share of attributed revenue rather than measured at that grain."}
      </p>
    </div>
  );
}

export function InvestmentMix({ row }: { row: GroupedMetrics }) {
  const m = row.metrics;
  const parts = [
    { label: "Cash ad spend", value: m.cashAdSpendPaise, color: "var(--seq-550)" },
    { label: "Co-op funded ads", value: m.brandFundSpendPaise, color: "var(--seq-400)" },
    { label: "Brand-funded discount", value: m.brandFundedDiscountPaise, color: "var(--seq-250)" },
    { label: "Event fees", value: m.participationFeePaise, color: "var(--seq-100)" },
  ].filter((p) => p.value > 0);

  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
        {parts.map((p) => (
          <div
            key={p.label}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            title={`${p.label}: ${formatInrCompact(p.value)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: p.color }}
            />
            <span style={{ color: "var(--text-secondary)" }}>{p.label}</span>
            <span className="tabular font-medium">{formatInrCompact(p.value)}</span>
            <span className="tabular" style={{ color: "var(--text-muted)" }}>
              {formatPercent(p.value / total, 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
