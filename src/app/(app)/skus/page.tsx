import { PageHeader } from "@/components/PageHeader";
import { Banner, Section } from "@/components/Section";
import { StatTile } from "@/components/StatTile";
import { MetricsTable } from "@/components/MetricsTable";
import { Bars } from "@/components/charts/Formatted";
import { aggregate, aggregateWithComparison } from "@/services/analytics";
import { formatInrCompact, formatMultiple, formatPercent, safeDiv } from "@/lib/money";
import { requirePage, readRange, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "SKUs — ROAS" };

export default async function SkusPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);

  const { current, previous, data } = await aggregateWithComparison(
    brand,
    range,
    "product",
  );
  const byCategory = aggregate(data, "category");

  const lossMaking = current.filter((g) => g.metrics.netContributionPaise < 0);
  const lossTotal = lossMaking.reduce((s, g) => s + g.metrics.netContributionPaise, 0);
  const profitable = current.filter((g) => g.metrics.netContributionPaise > 0);

  // Return rate is a SKU-level pathology: it silently converts a good ROAS into a loss.
  const worstReturns = [...current]
    .filter((g) => g.sales.units > 0)
    .sort(
      (a, b) =>
        safeDiv(b.sales.returnedUnits, b.sales.units) -
        safeDiv(a.sales.returnedUnits, a.sales.units),
    )
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="SKUs"
        description="Per-product economics on a true basis. Product and platform are the two grains where the discount bill is measured rather than allocated, so these numbers are directly comparable."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="SKUs with trade"
            value={String(current.length)}
            hint={`${profitable.length} contribute positively, ${lossMaking.length} do not.`}
          />
          <StatTile
            label="Contribution lost to loss-making SKUs"
            value={formatInrCompact(Math.abs(lossTotal))}
            hint="What the brand would keep if these SKUs merely broke even."
          />
          <StatTile
            label="Categories"
            value={String(byCategory.length)}
            hint="Take rates and fulfilment fees vary by category, so break-even does too."
          />
          <StatTile
            label="Blended return rate"
            value={formatPercent(
              safeDiv(
                current.reduce((s, g) => s + g.sales.returnedUnits, 0),
                Math.max(
                  1,
                  current.reduce((s, g) => s + g.sales.units, 0),
                ),
              ),
            )}
            hint="Returned units against units sold. Returns are charged against revenue in every true metric."
          />
        </div>

        {lossMaking.length > 0 && (
          <Banner tone="warning" title={`${lossMaking.length} SKUs lose money after marketing`}>
            {lossMaking
              .slice(0, 4)
              .map((g) => `${g.label} (${formatInrCompact(g.metrics.netContributionPaise)})`)
              .join(", ")}
            {lossMaking.length > 4 ? ` and ${lossMaking.length - 4} more` : ""}. Reprice, cut the
            discount, or stop advertising them — scaling spend on a negative-contribution SKU
            buys revenue at a loss.
          </Banner>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Net contribution by SKU"
            description="After COGS, platform fees, returns, discount and media."
          >
            <Bars
              data={current.slice(0, 12).map((g) => ({
                key: g.key,
                label: g.label,
                value: Math.round(g.metrics.netContributionPaise),
              }))}
              unit="money"
              referenceValue={0}
            />
          </Section>

          <Section
            title="Highest return rates"
            description="Returned units as a share of units sold."
            note="A 4x reported ROAS on a SKU with a 30% return rate is a 2.8x in reality, before any discount is counted."
          >
            <Bars
              data={worstReturns.map((g) => ({
                key: g.key,
                label: g.label,
                value: Number(
                  safeDiv(g.sales.returnedUnits, g.sales.units).toFixed(4),
                ),
              }))}
              unit="percent"
            />
          </Section>
        </div>

        <Section
          title="By category"
          description="Rolled up from the SKUs below. Measured, not allocated."
          padded={false}
        >
          <MetricsTable rows={byCategory} />
        </Section>

        <Section
          title="Every SKU"
          description="Ranked by total investment."
          padded={false}
        >
          <MetricsTable rows={current} previous={previous} />
        </Section>

        <Section
          title="Unit economics detail"
          description="The per-SKU figures that drive break-even."
          padded={false}
        >
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="text-right">Units</th>
                  <th className="text-right">Returned</th>
                  <th className="text-right">Gross revenue</th>
                  <th className="text-right">Discount</th>
                  <th className="text-right">Brand-funded</th>
                  <th className="text-right">Platform-funded</th>
                  <th className="text-right">New customers</th>
                  <th className="text-right">True ROAS</th>
                </tr>
              </thead>
              <tbody>
                {current.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <div className="flex flex-col">
                        <span className="font-medium">{g.label}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {g.sublabel}
                        </span>
                      </div>
                    </td>
                    <td className="tabular text-right">
                      {g.sales.units.toLocaleString("en-IN")}
                    </td>
                    <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                      {formatPercent(safeDiv(g.sales.returnedUnits, Math.max(1, g.sales.units)))}
                    </td>
                    <td className="tabular text-right">
                      {formatInrCompact(g.sales.grossRevenuePaise)}
                    </td>
                    <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                      {formatInrCompact(g.sales.discountPaise)}
                    </td>
                    <td className="tabular text-right">
                      {formatInrCompact(g.sales.brandFundedDiscountPaise)}
                    </td>
                    <td className="tabular text-right" style={{ color: "var(--status-good)" }}>
                      {formatInrCompact(g.sales.platformFundedDiscountPaise)}
                    </td>
                    <td className="tabular text-right">
                      {g.sales.newCustomers.toLocaleString("en-IN")}
                    </td>
                    <td className="tabular text-right font-medium">
                      {formatMultiple(g.metrics.trueRoas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Platform-funded discount is the share of the markdown the platform paid for. It
              lifts units without costing the brand, so it is excluded from every true metric.
              Brand targets: {formatMultiple(brand.targetRoas)} ROAS,{" "}
              {formatInrCompact(brand.targetCacPaise)} CAC,{" "}
              {formatPercent(brand.targetContributionMargin, 0)} contribution margin.
            </p>
          </div>
        </Section>
      </div>
    </>
  );
}
