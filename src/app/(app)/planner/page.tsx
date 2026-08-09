import { count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { budgetAllocations, budgetPlans } from "@/db/schema";
import { PageHeader } from "@/components/PageHeader";
import { Banner, EmptyState, KeyValue, Section } from "@/components/Section";
import { StatTile } from "@/components/StatTile";
import { ResponseCurveChart } from "@/components/charts/ResponseCurveChart";
import { loadBrandData } from "@/services/analytics";
import { runPlan, type PlanDimension } from "@/services/planner";
import { predictResponse } from "@/domain/curves";
import type { Objective } from "@/domain/optimizer";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { requirePage, one, readRange, type RawSearchParams } from "@/lib/page";
import { deletePlanAction, savePlanAction } from "./actions";
import { MAX_CHANGE_OPTIONS, PLAN_DIMENSIONS, PLAN_OBJECTIVES } from "./options";

export const metadata = { title: "Planner — ROAS" };

const BINDING_LABEL: Record<string, string> = {
  none: "free",
  floor: "at floor",
  cap: "at cap",
  change_limit: "move limit",
  extrapolation: "beyond data",
  target_roas: "below target",
  confidence: "weak curve",
};

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);

  const dimension = (PLAN_DIMENSIONS.find((d) => d.key === one(params.dimension))?.key ??
    "platform_ad_type") as PlanDimension;
  const objective = (PLAN_OBJECTIVES.find((o) => o.key === one(params.objective))?.key ??
    "max_contribution") as Objective;
  const maxChange = Number(one(params.maxChange)) || 0.35;
  const budgetRupees = Number(one(params.budget));

  const data = await loadBrandData(brand, range);
  const plan = runPlan(data, {
    dimension,
    objective,
    dailyBudgetPaise:
      Number.isFinite(budgetRupees) && budgetRupees > 0
        ? Math.round(budgetRupees * 100)
        : undefined,
    maxChangeRatio: maxChange,
  });

  const r = plan.result;
  const allocations = [...r.allocations].sort(
    (a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise),
  );
  const diagnosticsByKey = new Map(plan.diagnostics.map((d) => [d.key, d]));

  const saved = await db
    .select()
    .from(budgetPlans)
    .where(eq(budgetPlans.brandId, brand.id))
    .orderBy(desc(budgetPlans.createdAt))
    .limit(5);
  const savedIds = saved.map((p) => p.id);
  const savedAllocationCounts = new Map<string, number>();
  if (savedIds.length > 0) {
    const rows = await db
      .select({ planId: budgetAllocations.planId, n: count() })
      .from(budgetAllocations)
      .where(inArray(budgetAllocations.planId, savedIds))
      .groupBy(budgetAllocations.planId);
    for (const row of rows) savedAllocationCounts.set(row.planId, Number(row.n));
  }

  // Curves worth showing: the biggest moves, which are the ones the reader will challenge.
  const featured = allocations
    .filter((a) => diagnosticsByKey.get(a.channel.id))
    .slice(0, 4);

  const hiddenRange = (
    <>
      <input type="hidden" name="from" value={range.from} />
      <input type="hidden" name="to" value={range.to} />
      <input type="hidden" name="preset" value={preset} />
    </>
  );

  return (
    <>
      <PageHeader
        title="Planner"
        description="Fit a diminishing-returns curve to each channel's own history, then hand the next rupee to whichever channel returns the most. At the optimum every unconstrained channel has the same marginal ROAS — that number is the brand's true cost of growth."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        <Section
          title="Plan parameters"
          description="Curves are fitted on daily points, so the budget below is a daily figure."
        >
          <form method="get" className="flex flex-wrap items-end gap-3">
            {hiddenRange}
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Move budget across
              </span>
              <select name="dimension" defaultValue={dimension} className="!w-auto !py-1.5 !text-xs">
                {PLAN_DIMENSIONS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Objective
              </span>
              <select name="objective" defaultValue={objective} className="!w-auto !py-1.5 !text-xs">
                {PLAN_OBJECTIVES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Daily budget (₹)
              </span>
              <input
                type="number"
                name="budget"
                min={0}
                step={1}
                placeholder={String(Math.round(r.totalBudgetPaise / 100))}
                defaultValue={
                  Number.isFinite(budgetRupees) && budgetRupees > 0 ? budgetRupees : ""
                }
                className="!w-36 !py-1.5 !text-xs"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Movement cap
              </span>
              <select name="maxChange" defaultValue={maxChange} className="!w-auto !py-1.5 !text-xs">
                {MAX_CHANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: "var(--series-1)" }}
            >
              Recalculate
            </button>
          </form>

          <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
            {PLAN_OBJECTIVES.find((o) => o.key === objective)?.hint}{" "}
            {PLAN_DIMENSIONS.find((d) => d.key === dimension)?.hint}
          </p>
        </Section>

        {r.warnings.length > 0 && (
          <Banner tone="warning" title="Read these before acting on the plan">
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Daily budget"
            value={formatInrCompact(r.totalBudgetPaise)}
            emphasis
            hint={
              r.unallocatedPaise > 0
                ? `${formatInrCompact(r.unallocatedPaise)} left unallocated — no channel returned above the bar.`
                : "Fully allocated."
            }
          />
          <StatTile
            label="Projected revenue"
            value={formatInrCompact(r.projectedRevenuePaise)}
            deltaPct={
              r.currentRevenuePaise > 0
                ? (r.projectedRevenuePaise - r.currentRevenuePaise) / r.currentRevenuePaise
                : undefined
            }
            deltaGood={r.revenueUpliftPaise >= 0}
            hint={`Today ${formatInrCompact(r.currentRevenuePaise)} per day at the same total budget.`}
          />
          <StatTile
            label="Projected contribution"
            value={formatInrCompact(r.projectedContributionPaise)}
            deltaPct={
              r.currentContributionPaise !== 0
                ? (r.projectedContributionPaise - r.currentContributionPaise) /
                  Math.abs(r.currentContributionPaise)
                : undefined
            }
            deltaGood={r.contributionUpliftPaise >= 0}
            hint={`Today ${formatInrCompact(r.currentContributionPaise)} per day. This is the number the default objective maximises.`}
          />
          <StatTile
            label="Clearing marginal ROAS"
            value={formatMultiple(r.clearingMarginalRoas)}
            hint="What the next rupee returns once the budget is optimally placed — the brand's true cost of growth."
          />
        </div>

        {r.revenueUpliftPaise < 0 && r.contributionUpliftPaise > 0 && (
          <Banner tone="info" title="This plan trades revenue for profit, deliberately">
            Projected revenue falls by {formatInrCompact(Math.abs(r.revenueUpliftPaise))}/day while
            contribution rises by {formatInrCompact(r.contributionUpliftPaise)}/day. The
            objective is contribution, so the optimizer withdrew money from channels that were
            buying revenue below their own break-even. Switch to “maximise revenue” to see the
            other trade.
          </Banner>
        )}

        <Section
          title="Recommended moves"
          description="Ranked by size of change. Every unconstrained row lands on the same marginal ROAS; the constrained ones name what stopped them."
          padded={false}
        >
          {allocations.length === 0 ? (
            <EmptyState
              title="Not enough history to fit any curve"
              hint="The planner needs several days of varying daily spend per channel. Widen the window or pick a coarser grain."
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th className="text-right">Today /day</th>
                    <th className="text-right">Recommended /day</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">Marginal ROAS</th>
                    <th className="text-right">Projected ROAS</th>
                    <th>Saturation</th>
                    <th>Limited by</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((a) => {
                    const d = diagnosticsByKey.get(a.channel.id);
                    const up = a.action === "increase";
                    const flat = a.action === "hold";
                    return (
                      <tr key={a.channel.id}>
                        <td>
                          <div className="flex flex-col">
                            <span className="font-medium">{a.channel.label}</span>
                            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                              {String(a.channel.meta?.sublabel ?? "")}
                              {d?.curve.assumed && (
                                <span title="Too little spend variation to fit a curve; a diminishing-returns prior was used.">
                                  {a.channel.meta?.sublabel ? " · " : ""}assumed curve
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                          {formatInrCompact(a.currentSpendPaise)}
                        </td>
                        <td className="tabular text-right font-medium">
                          {formatInrCompact(a.recommendedSpendPaise)}
                        </td>
                        <td
                          className="tabular text-right font-medium"
                          style={{
                            color: flat
                              ? "var(--text-muted)"
                              : up
                                ? "var(--delta-good)"
                                : "var(--delta-bad)",
                          }}
                        >
                          <span aria-hidden>{flat ? "–" : up ? "▲" : "▼"}</span>{" "}
                          {flat ? "hold" : formatInrCompact(Math.abs(a.deltaPaise))}
                          {!flat && (
                            <span className="block text-[10px]">
                              {formatPercent(Math.abs(a.deltaRatio), 0)}
                            </span>
                          )}
                        </td>
                        <td className="tabular text-right">{formatMultiple(a.marginalRoas)}</td>
                        <td className="tabular text-right">{formatMultiple(a.projectedRoas)}</td>
                        <td style={{ minWidth: 120 }}>
                          <div
                            className="h-1.5 w-full overflow-hidden rounded-full"
                            style={{ background: "var(--surface-2)" }}
                            role="meter"
                            aria-valuenow={Number(a.saturation.toFixed(2))}
                            aria-valuemin={0}
                            aria-valuemax={1}
                            aria-label={`Saturation ${formatPercent(a.saturation, 0)}`}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, a.saturation * 100)}%`,
                                background:
                                  a.saturation > 0.85 ? "var(--status-warning)" : "var(--seq-400)",
                              }}
                            />
                          </div>
                          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {formatPercent(a.saturation, 0)}
                          </span>
                        </td>
                        <td className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {BINDING_LABEL[a.binding] ?? a.binding}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-3 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Saturation is how far up its own curve a channel already sits — at 100% another
                rupee buys almost nothing. “Limited by” explains why a channel stopped short of
                the marginal-ROAS equilibrium: a floor you set, the movement cap, or a curve the
                optimizer refused to extrapolate past.
              </p>
            </div>
          )}
        </Section>

        {featured.length > 0 && (
          <>
            <h2 className="mt-2 text-sm font-semibold tracking-tight">
              The evidence behind the biggest moves
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {featured.map((a) => {
                const d = diagnosticsByKey.get(a.channel.id)!;
                const observed = d.observed.map((p) => ({
                  spend: Math.round(p.spendPaise),
                  revenue: Math.round(p.responsePaise),
                }));
                const maxSpend = Math.max(
                  d.curve.maxSpendPaise,
                  a.recommendedSpendPaise,
                  a.currentSpendPaise,
                  1,
                ) * 1.15;
                const curvePoints = Array.from({ length: 40 }, (_, i) => {
                  const spend = (maxSpend * (i + 1)) / 40;
                  return {
                    spend: Math.round(spend),
                    revenue: Math.round(predictResponse(d.curve, spend)),
                  };
                });

                return (
                  <Section
                    key={a.channel.id}
                    title={`${a.channel.label}${a.channel.meta?.sublabel ? ` · ${a.channel.meta.sublabel}` : ""}`}
                    description={`${d.curve.kind} fit on ${d.daysOfData} days · r² ${d.curve.r2.toFixed(2)} · confidence ${formatPercent(d.curve.confidence, 0)}${d.daysExcluded > 0 ? ` · ${d.daysExcluded} abnormal-demand days excluded` : ""}`}
                    note={
                      d.curve.assumed
                        ? "This channel's daily spend barely varied, so no curve could be fitted and a diminishing-returns prior was substituted. Vary spend for a week to replace the assumption with evidence."
                        : d.frontierExtrapolated
                          ? "The break-even point sits outside the spend range we have data for, so it is an extrapolation and is not drawn."
                          : undefined
                    }
                  >
                    <ResponseCurveChart
                      curve={curvePoints}
                      observed={observed}
                      currentSpend={a.currentSpendPaise}
                      frontierSpend={d.efficientFrontierSpendPaise}
                      frontierExtrapolated={d.frontierExtrapolated}
                    />
                    <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
                      <KeyValue
                        label="Today"
                        value={`${formatInrCompact(a.currentSpendPaise)}/day`}
                      />
                      <KeyValue
                        label="Recommended"
                        value={`${formatInrCompact(a.recommendedSpendPaise)}/day`}
                      />
                      <KeyValue label="Marginal ROAS" value={formatMultiple(a.marginalRoas)} />
                      <KeyValue
                        label="Break-even needs"
                        value={formatMultiple(d.breakEvenRoas)}
                        hint={`margin ${formatPercent(d.contributionRate)}`}
                      />
                    </div>
                  </Section>
                );
              })}
            </div>
          </>
        )}

        <Section
          title="Save this plan"
          description="Saved plans keep the parameters and the fitted curves, so a decision can be re-read months later. Saving recomputes server-side rather than trusting the table above."
        >
          <form action={savePlanAction} className="flex flex-wrap items-end gap-3">
            {hiddenRange}
            <input type="hidden" name="dimension" value={dimension} />
            <input type="hidden" name="objective" value={objective} />
            <input type="hidden" name="maxChange" value={maxChange} />
            {Number.isFinite(budgetRupees) && budgetRupees > 0 && (
              <input type="hidden" name="budget" value={budgetRupees} />
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Plan name
              </span>
              <input
                type="text"
                name="name"
                placeholder={`${PLAN_OBJECTIVES.find((o) => o.key === objective)?.label} · ${range.from} to ${range.to}`}
                className="!w-80 !py-1.5 !text-xs"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: "var(--series-1)" }}
            >
              Save plan
            </button>
          </form>
        </Section>

        {saved.length > 0 && (
          <Section title="Saved plans" padded={false}>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Period</th>
                    <th>Objective</th>
                    <th className="text-right">Daily budget</th>
                    <th className="text-right">Channels</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {saved.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                        {p.periodStart} → {p.periodEnd}
                      </td>
                      <td className="text-xs">
                        {PLAN_OBJECTIVES.find((o) => o.key === p.objective)?.label ?? p.objective}
                      </td>
                      <td className="tabular text-right">
                        {formatInrCompact(p.totalBudgetPaise)}
                      </td>
                      <td className="tabular text-right">
                        {savedAllocationCounts.get(p.id) ?? 0}
                      </td>
                      <td className="text-xs">{p.status}</td>
                      <td className="text-right">
                        <form action={deletePlanAction}>
                          <input type="hidden" name="planId" value={p.id} />
                          <button
                            type="submit"
                            className="text-xs hover:underline"
                            style={{ color: "var(--delta-bad)" }}
                          >
                            Delete
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
