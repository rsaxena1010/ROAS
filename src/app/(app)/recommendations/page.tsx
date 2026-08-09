import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Banner, EmptyState, KeyValue, Section } from "@/components/Section";
import { StatTile } from "@/components/StatTile";
import { Bars } from "@/components/charts/Formatted";
import { loadBrandData } from "@/services/analytics";
import {
  ACTION_LABEL,
  VEHICLE_LABEL,
  buildInvestmentPlan,
  type Action,
  type InvestmentRecommendation,
} from "@/services/recommend";
import { formatInrCompact, formatMultiple, formatPercent, safeDiv } from "@/lib/money";
import { toDay } from "@/lib/date";
import { one, rangeQuery, readRange, requirePage, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "Recommendations — ROAS" };

const HORIZONS = [14, 30, 60, 90];

const ACTION_STYLE: Record<Action, { color: string; icon: string }> = {
  scale_up: { color: "var(--status-good)", icon: "▲" },
  deploy: { color: "var(--series-1)", icon: "★" },
  repeat: { color: "var(--status-good)", icon: "↻" },
  hold: { color: "var(--text-muted)", icon: "–" },
  scale_down: { color: "var(--status-warning)", icon: "▼" },
  renegotiate: { color: "var(--status-warning)", icon: "!" },
  stop: { color: "var(--status-critical)", icon: "✕" },
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "var(--status-good)",
  medium: "var(--status-warning)",
  low: "var(--status-serious)",
  assumed: "var(--text-muted)",
};

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);
  const q = rangeQuery(params);
  const horizonDays = HORIZONS.includes(Number(one(params.horizon)))
    ? Number(one(params.horizon))
    : 30;

  const data = await loadBrandData(brand, range);
  const plan = await buildInvestmentPlan(brand, data, toDay(Date.now()), horizonDays);

  const invest = plan.media.filter((r) => ["scale_up", "deploy"].includes(r.action));
  const pullBack = plan.media.filter((r) => ["scale_down", "stop"].includes(r.action));

  const upside = invest.reduce((s, r) => s + r.expectedContributionPaise, 0);
  const recovered = pullBack.reduce((s, r) => s + r.expectedContributionPaise, 0);
  const hasAnything = plan.media.length > 0 || plan.promotions.length > 0;

  return (
    <>
      <PageHeader
        title="Recommendations"
        description="Where the next rupee should go — on which vehicle, which platform and which SKUs — what it should return, and how long to run it before judging. Every figure is priced on contribution, not revenue."
        range={range}
        preset={preset}
        actions={
          <form method="get" className="flex items-end gap-2">
            <input type="hidden" name="from" value={range.from} />
            <input type="hidden" name="to" value={range.to} />
            <input type="hidden" name="preset" value={preset} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Plan over
              </span>
              <select name="horizon" defaultValue={horizonDays} className="!w-auto !py-1.5 !text-xs">
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {h} days
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border)" }}
            >
              Apply
            </button>
          </form>
        }
      />

      <div className="flex flex-col gap-4">
        {!hasAnything ? (
          <EmptyState
            title="Every channel is already close to its optimum"
            hint="No channel is far enough from its efficient spend level to be worth a change this cycle. Widen the window, or vary daily spend to sharpen the curves."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={`Contribution upside over ${horizonDays} days`}
                value={formatInrCompact(plan.expectedContributionPaise)}
                emphasis
                hint={`${formatInrCompact(upside)} from investing more, ${formatInrCompact(recovered)} recovered by pulling back.`}
              />
              <StatTile
                label="Net cash the plan asks for"
                value={formatInrCompact(plan.cashRequiredOverHorizonPaise)}
                hint={
                  plan.cashRequiredOverHorizonPaise <= 0
                    ? "The plan is cash-positive: cuts fund every increase."
                    : `${formatInrCompact(plan.netCashDailyPaise)}/day, after the cuts below pay for part of it.`
                }
              />
              <StatTile
                label="Co-op fund to deploy first"
                value={formatInrCompact(plan.coopDeployableOverHorizonPaise)}
                hint="Platform money, not the brand's cash. Spending it displaces cash media one-for-one."
              />
              <StatTile
                label="Expected revenue change"
                value={formatInrCompact(plan.expectedRevenuePaise)}
                hint={`Over ${horizonDays} days, from the fitted response curves at the recommended spend levels.`}
              />
            </div>

            <Banner tone="info" title="How to read the budget plan">
              Media spend today is {formatInrCompact(plan.currentDailyPaise)}/day. This plan puts{" "}
              {formatInrCompact(plan.recommendedDailyPaise)}/day to work —{" "}
              {formatInrCompact(plan.addedDailyPaise)}/day added and{" "}
              {formatInrCompact(plan.freedDailyPaise)}/day freed — of which{" "}
              {formatInrCompact(plan.coopDeployableOverHorizonPaise / Math.max(1, horizonDays))}/day
              is co-op fund rather than cash. Deploy the co-op money first, fund the increases
              from the cuts second, and only then ask for new cash.
            </Banner>

            {plan.media.length > 0 && (
              <Section
                title="Contribution impact by move"
                description="What each media move is worth over the plan horizon, ranked."
                note="Pull-backs also read positive: stopping a rupee that returned less than it cost earns that contribution back."
              >
                <Bars
                  data={plan.media.slice(0, 12).map((r) => ({
                    key: r.key,
                    label: r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label,
                    value: r.expectedContributionPaise,
                    secondary: {
                      label: ACTION_LABEL[r.action],
                      value: `${formatInrCompact(r.recommendedDailyPaise)}/day`,
                    },
                  }))}
                  unit="money"
                  referenceValue={0}
                />
              </Section>
            )}

            {plan.media.length > 0 && (
              <Section
                title="The media budget plan"
                description="Every move on one line: what changes, what it costs, what it returns, and how long to run it before judging."
                padded={false}
              >
                <PlanTable rows={plan.media} horizonDays={horizonDays} showRevenue />
                <p className="px-4 pb-4 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  “Return/₹” is the revenue the <em>next</em> rupee earns at today&apos;s spend
                  level, taken from the fitted curve — not the channel&apos;s average ROAS, which
                  is always flattering by comparison. Expected contribution already subtracts the
                  extra spend, so a positive figure is money the brand keeps.
                </p>
              </Section>
            )}

            {plan.promotions.length > 0 && (
              <Section
                title="Promotions and events"
                description="Priced per run, not per day — an event recurs on the platform's calendar, and promoted revenue includes demand that would have arrived at full price."
                padded={false}
                aside={
                  <span className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                    {formatInrCompact(plan.promotionContributionPaise)} at stake
                  </span>
                }
              >
                <PlanTable rows={plan.promotions} horizonDays={horizonDays} perRun />
                <p className="px-4 pb-4 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  These figures are deliberately excluded from the headline plan totals above:
                  they are per-run and horizon totals are per-day, and adding the two would mix
                  bases. Always-on price-offs that already cover their cost are omitted entirely —
                  “run it again” is not a decision anyone can take about the everyday price.
                </p>
              </Section>
            )}

            <h2 className="mt-2 text-sm font-semibold tracking-tight">
              Why — and for how long
            </h2>
            <div className="flex flex-col gap-4">
              {[...plan.media.slice(0, 8), ...plan.promotions.slice(0, 4)].map((r) => (
                <RecommendationCard key={r.key} r={r} horizonDays={horizonDays} q={q} />
              ))}
            </div>

            {plan.warnings.length > 0 && (
              <Banner tone="warning" title="What would make these numbers wrong">
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Banner>
            )}
          </>
        )}
      </div>
    </>
  );
}

function PlanTable({
  rows,
  horizonDays,
  showRevenue = false,
  perRun = false,
}: {
  rows: InvestmentRecommendation[];
  horizonDays: number;
  showRevenue?: boolean;
  perRun?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Invest in</th>
            <th>Vehicle</th>
            <th className="text-right">Today /day</th>
            <th className="text-right">Plan /day</th>
            <th className="text-right">{perRun ? "Brand cost /run" : `Over ${horizonDays}d`}</th>
            {showRevenue && <th className="text-right">Exp. revenue</th>}
            <th className="text-right">
              Exp. contribution{perRun ? " /run" : ""}
            </th>
            {/* Different quantities: marginal return from a curve vs a realised gross multiple. */}
            <th className="text-right">{perRun ? "Gross rev/₹" : "Return/₹"}</th>
            <th className="text-right">{perRun ? "Run length" : "Review after"}</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = ACTION_STYLE[r.action];
            return (
              <tr key={r.key}>
                <td>
                  <span
                    className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold"
                    style={{ color: s.color }}
                  >
                    <span aria-hidden>{s.icon}</span>
                    {ACTION_LABEL[r.action]}
                  </span>
                </td>
                <td>
                  <div className="flex flex-col">
                    <span className="font-medium">{r.label}</span>
                    {r.skus.length > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {r.skus
                          .slice(0, 2)
                          .map(
                            (sk) => `${sk.sku ?? sk.label} ${formatPercent(sk.revenueShare, 0)}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {VEHICLE_LABEL[r.vehicle]}
                </td>
                <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatInrCompact(r.currentDailyPaise)}
                </td>
                <td className="tabular text-right font-medium">
                  {formatInrCompact(r.recommendedDailyPaise)}
                </td>
                <td
                  className="tabular text-right"
                  style={{
                    color:
                      r.investmentOverHorizonPaise >= 0
                        ? "var(--text-primary)"
                        : "var(--delta-good)",
                  }}
                >
                  {r.investmentOverHorizonPaise === 0
                    ? "—"
                    : formatInrCompact(r.investmentOverHorizonPaise)}
                </td>
                {showRevenue && (
                  <td className="tabular text-right">
                    {r.expectedRevenuePaise === 0 ? "—" : formatInrCompact(r.expectedRevenuePaise)}
                  </td>
                )}
                <td
                  className="tabular text-right font-medium"
                  style={{
                    color:
                      r.expectedContributionPaise >= 0 ? "var(--delta-good)" : "var(--delta-bad)",
                  }}
                >
                  {formatInrCompact(r.expectedContributionPaise)}
                </td>
                <td className="tabular text-right">
                  {r.incrementalRoas > 0 ? formatMultiple(r.incrementalRoas) : "—"}
                </td>
                <td className="tabular whitespace-nowrap text-right">{r.reviewAfterDays}d</td>
                <td>
                  <span
                    className="text-xs font-medium"
                    style={{ color: CONFIDENCE_STYLE[r.confidenceLabel] }}
                  >
                    {r.confidenceLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationCard({
  r,
  horizonDays,
  q,
}: {
  r: InvestmentRecommendation;
  horizonDays: number;
  q: string;
}) {
  const s = ACTION_STYLE[r.action];
  const roiMultiple = safeDiv(
    r.expectedContributionPaise,
    Math.abs(r.investmentOverHorizonPaise),
  );

  return (
    <Section
      title={r.label}
      aside={
        <span
          className="flex items-center gap-1 text-xs font-semibold"
          style={{ color: s.color }}
        >
          <span aria-hidden>{s.icon}</span>
          {ACTION_LABEL[r.action]} · {VEHICLE_LABEL[r.vehicle]}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="max-w-4xl text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {r.why}
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KeyValue
            label="Spend today"
            value={`${formatInrCompact(r.currentDailyPaise)}/day`}
          />
          <KeyValue
            label="Recommended"
            value={`${formatInrCompact(r.recommendedDailyPaise)}/day`}
            hint={
              r.cashDeltaDailyPaise === 0 && r.vehicle === "coop_fund"
                ? "no cash required"
                : undefined
            }
          />
          <KeyValue
            label={`Committed over ${horizonDays}d`}
            value={
              r.investmentOverHorizonPaise === 0
                ? "—"
                : formatInrCompact(r.investmentOverHorizonPaise)
            }
          />
          <KeyValue
            label="Expected contribution"
            value={formatInrCompact(r.expectedContributionPaise)}
            hint={
              Number.isFinite(roiMultiple) && roiMultiple !== 0
                ? `${formatMultiple(Math.abs(roiMultiple))} on the money moved`
                : undefined
            }
          />
          <KeyValue
            label="Run for"
            value={`${r.reviewAfterDays} days`}
            hint="then refit"
          />
          <KeyValue
            label="Confidence"
            value={r.confidenceLabel}
            hint={
              r.confidenceLabel === "assumed"
                ? "no curve could be fitted"
                : `curve confidence ${formatPercent(r.confidence, 0)}`
            }
          />
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            Evidence
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
            {r.evidence.map((e) => (
              <li key={e} style={{ color: "var(--text-secondary)" }}>
                {e}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
            How long to invest
          </p>
          <p className="max-w-4xl text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {r.reviewReason}
          </p>
        </div>

        {r.skus.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              Concentrate on these SKUs
            </p>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="text-right">Share of channel revenue</th>
                    <th className="text-right">ROAS in this channel</th>
                    <th className="text-right">Contribution brand-wide</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {r.skus.map((sk) => (
                    <tr key={sk.productId}>
                      <td>
                        <span className="font-medium">{sk.label}</span>
                        <span
                          className="ml-1.5 text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {sk.sku}
                        </span>
                      </td>
                      <td className="tabular text-right">
                        {formatPercent(sk.revenueShare, 0)}
                      </td>
                      <td className="tabular text-right">{formatMultiple(sk.channelRoas)}</td>
                      <td
                        className="tabular text-right font-medium"
                        style={{
                          color:
                            sk.contributionPaise >= 0 ? "var(--delta-good)" : "var(--delta-bad)",
                        }}
                      >
                        {formatInrCompact(sk.contributionPaise)}
                      </td>
                      <td className="text-xs">
                        {sk.caution ? (
                          <span
                            className="flex items-center gap-1 font-medium"
                            style={{ color: "var(--status-critical)" }}
                          >
                            <span aria-hidden>▲</span> exclude — loses money
                          </span>
                        ) : (
                          <Link
                            href={`/skus${q}`}
                            className="hover:underline"
                            style={{ color: "var(--series-1)" }}
                          >
                            detail
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
