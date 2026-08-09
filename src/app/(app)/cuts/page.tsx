import { PageHeader } from "@/components/PageHeader";
import { Banner, EmptyState, Section } from "@/components/Section";
import { StatTile } from "@/components/StatTile";
import { InvestmentMix, MetricsTable } from "@/components/MetricsTable";
import { Bars } from "@/components/charts/Formatted";
import { accessibleBrands } from "@/lib/auth";
import {
  aggregate,
  aggregateTotal,
  aggregateWithComparison,
  loadBrandData,
  type Dimension,
  type GroupedMetrics,
} from "@/services/analytics";
import type { Metrics } from "@/domain/metrics";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { one, readRange, requirePage, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "Cuts — ROAS" };

/** `brand` is assembled outside `aggregate()`, so it is not part of the analytics Dimension. */
type CutDimension = Dimension | "brand";

const CUTS: { key: CutDimension; label: string; hint: string; direct: boolean }[] = [
  {
    key: "brand",
    label: "Brand",
    hint: "Every brand you have access to, side by side. Each brand's window is loaded and totalled independently.",
    direct: true,
  },
  {
    key: "category",
    label: "Category",
    hint: "Take rates, fulfilment fees and return rates vary by category, so break-even does too — this is the cut that shows which categories can actually carry media.",
    direct: true,
  },
  {
    key: "platform",
    label: "Platform",
    hint: "Measured directly: the discount bill and event fees are reported per platform.",
    direct: true,
  },
  {
    key: "product",
    label: "SKU",
    hint: "Measured directly. The finest grain where sales-side costs are real rather than allocated.",
    direct: true,
  },
  {
    key: "ad_type",
    label: "Ad type",
    hint: "Across platforms. Sales-side costs are allocated by share of attributed revenue.",
    direct: false,
  },
  {
    key: "platform_ad_type",
    label: "Platform × ad type",
    hint: "The working grain for moving budget. Sales-side costs are allocated.",
    direct: false,
  },
  {
    key: "campaign",
    label: "Campaign",
    hint: "Operationally exact on the ad side; sales-side costs are allocated.",
    direct: false,
  },
  {
    key: "asset",
    label: "Creative / asset",
    hint: "The creative axis — a 15s video against a static banner. Sales-side costs are allocated.",
    direct: false,
  },
  {
    key: "funding_source",
    label: "Funding source",
    hint: "Brand cash against co-op fund against platform-funded placements.",
    direct: false,
  },
  { key: "day", label: "Day", hint: "The same totals by business day.", direct: true },
];

const MEASURES: {
  key: string;
  label: string;
  unit: "money" | "multiple" | "percent" | "count";
  get: (m: Metrics) => number;
  zeroReference?: boolean;
}[] = [
  { key: "trueRoas", label: "True ROAS", unit: "multiple", get: (m) => Number(m.trueRoas.toFixed(2)) },
  {
    key: "netContributionPaise",
    label: "Net contribution",
    unit: "money",
    get: (m) => Math.round(m.netContributionPaise),
    zeroReference: true,
  },
  {
    key: "platformInvestmentPaise",
    label: "Total invested",
    unit: "money",
    get: (m) => Math.round(m.platformInvestmentPaise),
  },
  {
    key: "netTotalRevenuePaise",
    label: "Net revenue",
    unit: "money",
    get: (m) => Math.round(m.netTotalRevenuePaise),
  },
  { key: "cacPaise", label: "CAC", unit: "money", get: (m) => Math.round(m.cacPaise) },
  {
    key: "newCustomers",
    label: "New customers",
    unit: "count",
    get: (m) => m.newCustomers,
  },
  { key: "trueTacos", label: "True TACOS", unit: "percent", get: (m) => m.trueTacos },
  {
    key: "efficiencyIndex",
    label: "Efficiency index",
    unit: "multiple",
    get: (m) => Number(m.efficiencyIndex.toFixed(2)),
  },
];

export default async function CutsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const principal = await requirePage();
  const { brand } = principal;
  const params = await searchParams;
  const { range, preset } = readRange(params);

  const cut = CUTS.find((c) => c.key === one(params.cut)) ?? CUTS[1];
  const measure = MEASURES.find((m) => m.key === one(params.measure)) ?? MEASURES[0];

  const brandsInScope = await accessibleBrands(principal);

  let rows: GroupedMetrics[] = [];
  let previous: Map<string, GroupedMetrics> | undefined;
  let total: GroupedMetrics | null = null;

  if (cut.key === "brand") {
    // Each brand is a separate tenant with its own fee profiles and margins, so there is no
    // shared load to reuse — every brand's window is fetched and totalled on its own.
    rows = await Promise.all(
      brandsInScope.map(async (b) => {
        const data = await loadBrandData(b, range);
        const t = aggregateTotal(data);
        return {
          ...t,
          key: b.id,
          label: b.name,
          sublabel: `target ${formatMultiple(b.targetRoas)} · CAC ${formatInrCompact(b.targetCacPaise)}`,
        };
      }),
    );
  } else {
    const result = await aggregateWithComparison(brand, range, cut.key);
    rows = result.current;
    previous = result.previous;
    total = result.total;
  }

  const chartRows = cut.key === "day" ? rows.slice(-30) : rows.slice(0, 14);
  const positive = rows.filter((r) => r.metrics.netContributionPaise > 0);
  const aboveBreakEven = rows.filter(
    (r) => Number.isFinite(r.metrics.breakEvenRoas) && r.metrics.trueRoas >= r.metrics.breakEvenRoas,
  );

  return (
    <>
      <PageHeader
        title="Cuts"
        description="Slice the same true-basis numbers by whichever dimension the question needs — category, brand, platform, ad type, creative, funding source or SKU."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        <Section title="Choose the cut">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="from" value={range.from} />
            <input type="hidden" name="to" value={range.to} />
            <input type="hidden" name="preset" value={preset} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Cut by
              </span>
              <select name="cut" defaultValue={cut.key} className="!w-auto !py-1.5 !text-xs">
                {CUTS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Chart measure
              </span>
              <select
                name="measure"
                defaultValue={measure.key}
                className="!w-auto !py-1.5 !text-xs"
              >
                {MEASURES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: "var(--series-1)" }}
            >
              Apply
            </button>
          </form>
          <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
            {cut.hint}
          </p>
        </Section>

        {rows.length === 0 ? (
          <EmptyState
            title={`No ${cut.label.toLowerCase()} rows in this window`}
            hint="Widen the date range, or pick a cut the connected platforms actually report at — creative-level rows in particular need a platform that attributes to an ad group."
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label={`${cut.label} rows`}
                value={String(rows.length)}
                hint={`${positive.length} contribute positively, ${rows.length - positive.length} do not.`}
              />
              <StatTile
                label="Above break-even"
                value={`${aboveBreakEven.length} of ${rows.length}`}
                hint="Counted on each row's own break-even multiple, not a single blended one."
              />
              <StatTile
                label="Invested across the cut"
                value={formatInrCompact(
                  rows.reduce((s, r) => s + r.metrics.platformInvestmentPaise, 0),
                )}
                hint={
                  cut.direct
                    ? "Measured at this grain."
                    : "Ad spend is measured; discount and event fees are allocated by share of attributed revenue."
                }
              />
              <StatTile
                label="Net contribution across the cut"
                value={formatInrCompact(
                  rows.reduce((s, r) => s + r.metrics.netContributionPaise, 0),
                )}
                hint="After COGS, platform fees, returns, discount and all media."
              />
            </div>

            {cut.key === "brand" && (
              <Banner
                tone="info"
                title={
                  brandsInScope.length > 1
                    ? `Showing ${brandsInScope.length} brands you have access to`
                    : "You have access to one brand"
                }
              >
                {brandsInScope.length > 1 ? (
                  <>
                    {brandsInScope.map((b) => b.name).join(", ")}. Each brand carries its own
                    targets and margin, so True ROAS and break-even differ by row — compare the
                    efficiency index rather than the raw multiple. Every other page on this site
                    stays scoped to {brand.name}.
                  </>
                ) : (
                  <>
                    This cut lists the brands your account can read, which is currently just{" "}
                    {brand.name}. A portfolio or agency account with access to several brands
                    sees them side by side here.
                  </>
                )}
              </Banner>
            )}

            {!cut.direct && (
              <Banner tone="info" title={`${cut.label} rows carry allocated sales-side costs`}>
                Brand-funded discounts and event participation fees are reported per platform and
                per SKU — never per {cut.label.toLowerCase()}. Those costs are assigned to each
                row by its share of attributed revenue, which is an allocation rather than a
                measurement. Ad spend, impressions, clicks and attributed revenue are measured
                exactly.
              </Banner>
            )}

            <Section
              title={`${measure.label} by ${cut.label.toLowerCase()}`}
              description={
                cut.key === "day"
                  ? "Most recent 30 days."
                  : rows.length > 14
                    ? `Top 14 of ${rows.length} rows by investment. The table below has them all.`
                    : undefined
              }
            >
              <Bars
                data={chartRows.map((r) => ({
                  key: r.key,
                  label: r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label,
                  value: measure.get(r.metrics),
                  secondary: {
                    label: "Invested",
                    value: formatInrCompact(r.metrics.platformInvestmentPaise),
                  },
                }))}
                unit={measure.unit}
                referenceValue={
                  measure.zeroReference
                    ? 0
                    : measure.key === "trueRoas" && total && Number.isFinite(total.metrics.breakEvenRoas)
                      ? Number(total.metrics.breakEvenRoas.toFixed(2))
                      : undefined
                }
                referenceLabel={measure.key === "trueRoas" ? "blended break-even" : undefined}
              />
            </Section>

            <Section
              title={`All ${cut.label.toLowerCase()} rows`}
              description="Ranked by total investment."
              padded={false}
            >
              <MetricsTable rows={rows} previous={previous} />
            </Section>

            {cut.key !== "day" && (
              <Section
                title="Investment mix"
                description="Where the money went inside each row — media, co-op-funded media, brand-funded discount and event fees."
              >
                <div className="flex flex-col gap-4">
                  {rows.slice(0, 8).map((r) => (
                    <div key={r.key} className="flex flex-col gap-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-xs font-medium">{r.label}</span>
                        <span className="tabular text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {formatMultiple(r.metrics.trueRoas)} true ·{" "}
                          {formatPercent(r.metrics.trueTacos)} true TACOS
                        </span>
                      </div>
                      <InvestmentMix row={r} />
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}
