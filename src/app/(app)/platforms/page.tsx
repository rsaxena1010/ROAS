import { PageHeader } from "@/components/PageHeader";
import { Banner, KeyValue, Section } from "@/components/Section";
import { InvestmentMix, MetricsTable } from "@/components/MetricsTable";
import { Meter } from "@/components/StatTile";
import { Bars } from "@/components/charts/Formatted";
import { aggregate, aggregateWithComparison } from "@/services/analytics";
import { formatInrCompact, formatMultiple, formatPercent, safeDiv } from "@/lib/money";
import { requirePage, readRange, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "Platforms — ROAS" };

export default async function PlatformsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);

  const { current, previous, total, data } = await aggregateWithComparison(
    brand,
    range,
    "platform",
  );
  const byAdType = aggregate(data, "platform_ad_type");
  const brandBreakEven = total.metrics.breakEvenRoas;

  return (
    <>
      <PageHeader
        title="Platforms"
        description="Each marketplace and quick-commerce platform as a business: what it cost in total, what it returned net, and whether it clears its own break-even."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="True ROAS by platform"
            description="Dashed line is the brand's blended break-even multiple."
            note="Each platform has its own break-even because take rates, fulfilment fees and category mix differ — see the table for the per-platform figure."
          >
            <Bars
              data={current.map((g) => ({
                key: g.key,
                label: g.label,
                value: Number(g.metrics.trueRoas.toFixed(2)),
                secondary: {
                  label: "Break-even",
                  value: Number.isFinite(g.metrics.breakEvenRoas)
                    ? formatMultiple(g.metrics.breakEvenRoas)
                    : "no margin",
                },
                intensity: Number.isFinite(g.metrics.breakEvenRoas)
                  ? Math.min(1, g.metrics.trueRoas / g.metrics.breakEvenRoas / 1.5)
                  : 0,
              }))}
              unit="multiple"
              referenceValue={
                Number.isFinite(brandBreakEven) ? Number(brandBreakEven.toFixed(2)) : undefined
              }
              referenceLabel="blended break-even"
            />
          </Section>

          <Section
            title="Net contribution by platform"
            description="Net revenue at this platform's margin, minus every rupee invested in it."
            note="A platform can carry a healthy reported ROAS and still land here in the negative once its discount bill and event fees are counted."
          >
            <Bars
              data={current.map((g) => ({
                key: g.key,
                label: g.label,
                value: Math.round(g.metrics.netContributionPaise),
              }))}
              unit="money"
              referenceValue={0}
            />
          </Section>
        </div>

        <Section
          title="All platforms"
          description="Ranked by total investment."
          padded={false}
        >
          <MetricsTable rows={current} previous={previous} />
        </Section>

        <Section
          title="Ad type within platform"
          description="The channel cut the optimizer moves money across."
          padded={false}
        >
          <MetricsTable rows={byAdType} showBreakEven={false} />
        </Section>

        <h2 className="mt-2 text-sm font-semibold tracking-tight">Platform detail</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {current.map((g) => {
            const m = g.metrics;
            const meta = data.platformMeta.get(g.key);
            const returnRate = safeDiv(g.sales.returnedUnits, Math.max(1, g.sales.units));

            return (
              <Section
                key={g.key}
                title={g.label}
                description={`${meta?.kind === "quick_commerce" ? "Quick commerce" : "Marketplace"} · ${meta?.attributionWindowDays ?? "?"}-day attribution window`}
                aside={
                  <span
                    className="flex items-center gap-1 text-xs font-medium"
                    style={{
                      color:
                        m.trueRoas >= m.breakEvenRoas
                          ? "var(--status-good)"
                          : "var(--status-critical)",
                    }}
                  >
                    <span aria-hidden>{m.trueRoas >= m.breakEvenRoas ? "●" : "○"}</span>
                    {m.trueRoas >= m.breakEvenRoas ? "Above break-even" : "Below break-even"}
                  </span>
                }
              >
                <div className="flex flex-col gap-4">
                  <Meter
                    value={m.trueRoas}
                    limit={m.breakEvenRoas}
                    caption={`True ${formatMultiple(m.trueRoas)} against break-even ${
                      Number.isFinite(m.breakEvenRoas)
                        ? formatMultiple(m.breakEvenRoas)
                        : "n/a"
                    }`}
                  />

                  <InvestmentMix row={g} />

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KeyValue label="Invested" value={formatInrCompact(m.platformInvestmentPaise)} />
                    <KeyValue label="Net revenue" value={formatInrCompact(m.netTotalRevenuePaise)} />
                    <KeyValue
                      label="Contribution"
                      value={formatInrCompact(m.netContributionPaise)}
                      hint={formatPercent(m.netContributionRate)}
                    />
                    <KeyValue label="True TACOS" value={formatPercent(m.trueTacos)} />
                    <KeyValue
                      label="CAC"
                      value={formatInrCompact(m.cacPaise)}
                      hint={`paid only ${formatInrCompact(m.paidCacPaise)}`}
                    />
                    <KeyValue
                      label="LTV:CAC"
                      value={formatMultiple(m.ltvToCac)}
                      hint={`LTV ${formatInrCompact(m.ltvPaise)}`}
                    />
                    <KeyValue
                      label="New customers"
                      value={m.newCustomers.toLocaleString("en-IN")}
                      hint={`${formatPercent(m.newCustomerShare, 0)} of ad orders`}
                    />
                    <KeyValue label="Return rate" value={formatPercent(returnRate)} />
                    <KeyValue
                      label="Impressions"
                      value={m.impressions.toLocaleString("en-IN")}
                    />
                    <KeyValue
                      label="CTR"
                      value={formatPercent(m.ctr, 2)}
                      hint={`CPC ${formatInrCompact(m.cpcPaise)}`}
                    />
                    <KeyValue label="Conversion" value={formatPercent(m.conversionRate, 2)} />
                    <KeyValue label="AOV" value={formatInrCompact(m.aovPaise)} />
                  </div>

                  <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                    Ads were credited with {formatPercent(m.attributedShare, 0)} of this
                    platform&apos;s trade, so they carry that share of the{" "}
                    {formatInrCompact(m.brandFundedDiscountPaise)} brand-funded discount bill in
                    True ROAS. Contribution below charges the platform the full amount.
                  </p>
                </div>
              </Section>
            );
          })}
        </div>

        {byAdType.some((g) => g.allocationBasis === "prorated") && (
          <Banner tone="info" title="Ad-type rows are an allocation, not a measurement">
            Brand-funded discounts and event fees are reported per platform and per SKU, never
            per ad type. Those costs are assigned to each ad type by its share of attributed
            revenue. The platform rows above are measured directly.
          </Banner>
        )}
      </div>
    </>
  );
}
