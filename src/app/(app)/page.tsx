import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Section } from "@/components/Section";
import { StatTile, Meter } from "@/components/StatTile";
import { InvestmentMix, MetricsTable } from "@/components/MetricsTable";
import { InsightList, InsightSummary } from "@/components/InsightList";
import { Trend } from "@/components/charts/Formatted";
import { aggregate, aggregateWithComparison } from "@/services/analytics";
import { generateInsights } from "@/services/insights";
import { deltaVerdict } from "@/domain/metrics";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { toDay } from "@/lib/date";
import { requirePage, rangeQuery, readRange, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "Overview — ROAS" };

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);
  const q = rangeQuery(params);

  const { current, previous, total, previousTotal, data } =
    await aggregateWithComparison(brand, range, "platform");
  const daily = aggregate(data, "day");
  const insights = await generateInsights(data, toDay(Date.now()));

  const m = total.metrics;
  const prev = previousTotal.metrics;
  const delta = (key: keyof typeof m) =>
    deltaVerdict(key as string, m[key] as number, prev[key] as number);

  const roasTrend = daily.map((d) => ({
    day: d.key,
    trueRoas: Number(d.metrics.trueRoas.toFixed(3)),
    reportedRoas: Number(d.metrics.reportedRoas.toFixed(3)),
  }));
  const moneyTrend = daily.map((d) => ({
    day: d.key,
    invested: d.metrics.platformInvestmentPaise,
    netRevenue: d.metrics.netTotalRevenuePaise,
  }));
  const contributionSpark = daily.map((d) => d.metrics.netContributionPaise);

  const windows = m.comparability.attributionWindowDays;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every rupee this brand put into every platform — media, brand-funded discount and event fees — against what came back, net of returns and platform costs."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        {!m.comparability.attributionAligned && (
          <Banner tone="info" title="Reported ROAS is not comparable across these platforms">
            Your platforms attribute on {windows.join("-day, ")}-day windows. A 1-day
            quick-commerce ROAS and a 14-day marketplace ROAS are different quantities, so
            ranking channels on reported ROAS over-funds the long-window platforms. True ROAS
            below puts them on one basis.
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="True ROAS"
            value={formatMultiple(m.trueRoas)}
            deltaPct={delta("trueRoas").pct}
            deltaGood={delta("trueRoas").good}
            emphasis
            footer={
              <Meter
                value={m.trueRoas}
                limit={m.breakEvenRoas}
                caption={
                  Number.isFinite(m.breakEvenRoas)
                    ? `break-even ${formatMultiple(m.breakEvenRoas)} · index ${m.efficiencyIndex.toFixed(2)}`
                    : "no margin to cover"
                }
              />
            }
            hint="Net attributed revenue ÷ all accountable investment."
          />
          <StatTile
            label="Reported ROAS"
            value={formatMultiple(m.reportedRoas)}
            deltaPct={delta("reportedRoas").pct}
            deltaGood={delta("reportedRoas").good}
            hint={`What the platform dashboards show. It excludes ${formatInrCompact(
              m.brandFundedDiscountPaise + m.participationFeePaise,
            )} of brand-funded discount and event fees.`}
          />
          <StatTile
            label="Blended ROAS (MER)"
            value={formatMultiple(m.blendedRoas)}
            deltaPct={delta("blendedRoas").pct}
            deltaGood={delta("blendedRoas").good}
            hint="All net platform revenue ÷ all platform investment, ads and organic together."
          />
          <StatTile
            label="Net contribution"
            value={formatInrCompact(m.netContributionPaise)}
            deltaPct={delta("netContributionPaise").pct}
            deltaGood={delta("netContributionPaise").good}
            spark={contributionSpark}
            hint={`${formatPercent(m.netContributionRate)} of net revenue after every platform cost and all marketing.`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total invested"
            value={formatInrCompact(m.platformInvestmentPaise)}
            deltaPct={delta("platformInvestmentPaise").pct}
            deltaGood={null}
            hint={`${formatInrCompact(m.adSpendPaise)} ads · ${formatInrCompact(m.brandFundedDiscountPaise)} discount · ${formatInrCompact(m.participationFeePaise)} fees`}
          />
          <StatTile
            label="Net revenue"
            value={formatInrCompact(m.netTotalRevenuePaise)}
            deltaPct={delta("netTotalRevenuePaise").pct}
            deltaGood={delta("netTotalRevenuePaise").good}
            hint={`${formatInrCompact(m.totalRevenuePaise)} gross, after returns and brand-funded discount.`}
          />
          <StatTile
            label="CAC"
            value={formatInrCompact(m.cacPaise)}
            deltaPct={delta("cacPaise").pct}
            deltaGood={delta("cacPaise").good}
            footer={
              <Meter
                value={m.cacPaise}
                limit={brand.targetCacPaise}
                goodAbove={false}
                caption={`target ${formatInrCompact(brand.targetCacPaise)} · LTV:CAC ${formatMultiple(m.ltvToCac)}`}
              />
            }
            hint={`${m.newCustomers.toLocaleString("en-IN")} new customers, paid and organic.`}
          />
          <StatTile
            label="True TACOS"
            value={formatPercent(m.trueTacos)}
            deltaPct={delta("trueTacos").pct}
            deltaGood={delta("trueTacos").good}
            hint={`Every marketing rupee as a share of revenue. Ad-only TACOS is ${formatPercent(m.tacos)}.`}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Efficiency over time"
            description="Reported against true, on one axis and one basis."
            note="The gap between the two lines is the brand-funded discount and event-fee cost that platform reporting leaves out."
          >
            <Trend
              data={roasTrend}
              series={[
                { key: "trueRoas", label: "True ROAS" },
                { key: "reportedRoas", label: "Reported ROAS" },
              ]}
              unit="multiple"
              referenceValue={
                Number.isFinite(m.breakEvenRoas) ? Number(m.breakEvenRoas.toFixed(2)) : undefined
              }
              referenceLabel="break-even"
            />
          </Section>

          <Section
            title="Investment and return"
            description="Daily money in against net money out."
          >
            <Trend
              data={moneyTrend}
              series={[
                { key: "netRevenue", label: "Net revenue" },
                { key: "invested", label: "Invested" },
              ]}
              unit="money"
            />
          </Section>
        </div>

        <Section
          title="Where the money actually goes"
          description="Media is rarely the biggest line. This is the whole marketing bill on one basis."
        >
          <InvestmentMix row={total} />
        </Section>

        <Section
          title="Platforms"
          description="Ranked by total investment. True ROAS is the only column comparable across rows."
          aside={
            <Link href={`/platforms${q}`} className="text-xs hover:underline" style={{ color: "var(--series-1)" }}>
              Platform detail →
            </Link>
          }
          padded={false}
        >
          <MetricsTable
            rows={current}
            previous={previous}
            linkFor={() => `/platforms${q}`}
          />
        </Section>

        <Section
          title="What to fix first"
          description="Ranked by severity then rupee impact over this window."
          aside={<InsightSummary insights={insights} />}
        >
          <InsightList insights={insights} limit={6} />
          {insights.length > 6 && (
            <Link
              href={`/promotions${q}`}
              className="text-xs hover:underline"
              style={{ color: "var(--series-1)" }}
            >
              {insights.length - 6} more across promotions and co-op funds →
            </Link>
          )}
        </Section>
      </div>
    </>
  );
}
