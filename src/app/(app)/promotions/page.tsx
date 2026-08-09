import { PageHeader } from "@/components/PageHeader";
import { Banner, EmptyState, Section } from "@/components/Section";
import { Meter, StatTile } from "@/components/StatTile";
import { InsightList } from "@/components/InsightList";
import { Bars } from "@/components/charts/Formatted";
import { brandFundSummary, loadBrandData } from "@/services/analytics";
import { generateInsights } from "@/services/insights";
import { prettyPromoType, promotionSummaries } from "@/services/promotions";
import { formatInrCompact, formatMultiple, formatPercent, safeDiv } from "@/lib/money";
import { toDay } from "@/lib/date";
import { requirePage, readRange, type RawSearchParams } from "@/lib/page";

export const metadata = { title: "Promos & funds — ROAS" };

export default async function PromotionsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const { brand } = await requirePage();
  const params = await searchParams;
  const { range, preset } = readRange(params);
  const today = toDay(Date.now());

  const data = await loadBrandData(brand, range);
  const [promos, funds, insights] = await Promise.all([
    promotionSummaries(brand.id, range),
    brandFundSummary(data, today),
    generateInsights(data, today),
  ]);

  const promoInsights = insights.filter(
    (i) => i.kind === "promo_unaffordable" || i.kind.startsWith("brand_fund"),
  );

  const brandCost = promos.reduce((s, p) => s + p.brandCostPaise, 0);
  const platformFunded = promos.reduce((s, p) => s + p.platformFundedDiscountPaise, 0);
  const promoRevenue = promos.reduce((s, p) => s + p.grossRevenuePaise, 0);
  const promoNewCustomers = promos.reduce((s, p) => s + p.newCustomers, 0);
  const feeTotal = promos.reduce((s, p) => s + p.participationFeePaise, 0);

  const accrued = funds.reduce((s, f) => s + f.accruedPaise, 0);
  const utilised = funds.reduce((s, f) => s + f.utilisedPaise, 0);
  const balance = funds.reduce((s, f) => s + f.balancePaise, 0);
  const expiring = funds.reduce((s, f) => s + f.expiringSoonPaise, 0);

  return (
    <>
      <PageHeader
        title="Promos & funds"
        description="The two marketing lines that never appear in a ROAS dashboard: the discount the brand funds out of its own margin, and the co-op fund the platform accrues on its behalf."
        range={range}
        preset={preset}
      />

      <div className="flex flex-col gap-4">
        {expiring > 0 && (
          <Banner
            tone="critical"
            title={`${formatInrCompact(expiring)} of co-op fund lapses within 60 days`}
          >
            This is platform money. Spending it displaces cash media one-for-one and does not
            touch the brand&apos;s cash ROAS, so it should be the first budget deployed —
            unspent accruals simply expire.
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Brand cost of promotions"
            value={formatInrCompact(brandCost)}
            emphasis
            hint={`${formatInrCompact(brandCost - feeTotal)} of discount out of margin plus ${formatInrCompact(feeTotal)} of participation fees.`}
          />
          <StatTile
            label="Platform funded"
            value={formatInrCompact(platformFunded)}
            hint={`${formatPercent(
              safeDiv(platformFunded, platformFunded + (brandCost - feeTotal)),
              0,
            )} of the total markdown was absorbed by the platforms.`}
          />
          <StatTile
            label="Promo revenue"
            value={formatInrCompact(promoRevenue)}
            footer={
              <Meter
                value={safeDiv(promoRevenue, brandCost)}
                limit={Number.isFinite(brand.targetRoas) ? brand.targetRoas : 4}
                caption={`${formatMultiple(safeDiv(promoRevenue, brandCost))} against the ${formatMultiple(brand.targetRoas)} target`}
              />
            }
            hint="Gross revenue on promoted units, per rupee of brand cost."
          />
          <StatTile
            label="Cost per new customer"
            value={formatInrCompact(Math.round(safeDiv(brandCost, promoNewCustomers)))}
            hint={`${promoNewCustomers.toLocaleString("en-IN")} new customers from promotions, against a ${formatInrCompact(brand.targetCacPaise)} CAC target.`}
          />
        </div>

        <Section
          title="Co-op / brand fund by platform"
          description="Platforms accrue a share of your sales into a marketing fund, then you draw it down. Money drawn is real spend for ROAS but is not cash out of the brand's pocket."
          padded={false}
        >
          {funds.length === 0 ? (
            <EmptyState
              title="No co-op fund accruals"
              hint="None of your connected platforms accrue a brand fund, or the ledger has not been synced yet."
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Platform</th>
                    <th className="text-right">Accrued</th>
                    <th className="text-right">Utilised</th>
                    <th className="text-right">Expired</th>
                    <th className="text-right">Balance</th>
                    <th className="text-right">Expiring in 60d</th>
                    <th>Utilisation</th>
                  </tr>
                </thead>
                <tbody>
                  {funds.map((f) => (
                    <tr key={f.platformId}>
                      <td className="font-medium">{f.platformName}</td>
                      <td className="tabular text-right">{formatInrCompact(f.accruedPaise)}</td>
                      <td className="tabular text-right">{formatInrCompact(f.utilisedPaise)}</td>
                      <td
                        className="tabular text-right"
                        style={{
                          color: f.expiredPaise > 0 ? "var(--delta-bad)" : "var(--text-secondary)",
                        }}
                      >
                        {formatInrCompact(f.expiredPaise)}
                      </td>
                      <td className="tabular text-right font-medium">
                        {formatInrCompact(f.balancePaise)}
                      </td>
                      <td
                        className="tabular text-right font-medium"
                        style={{
                          color:
                            f.expiringSoonPaise > 0 ? "var(--status-critical)" : "var(--text-muted)",
                        }}
                      >
                        {f.expiringSoonPaise > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden>▲</span>
                            {formatInrCompact(f.expiringSoonPaise)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ minWidth: 160 }}>
                        <Meter
                          value={f.utilisationRate}
                          limit={1}
                          caption={formatPercent(f.utilisationRate, 0)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold">Total</td>
                    <td className="tabular text-right font-semibold">
                      {formatInrCompact(accrued)}
                    </td>
                    <td className="tabular text-right font-semibold">
                      {formatInrCompact(utilised)}
                    </td>
                    <td />
                    <td className="tabular text-right font-semibold">
                      {formatInrCompact(balance)}
                    </td>
                    <td className="tabular text-right font-semibold">
                      {formatInrCompact(expiring)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <p className="px-3 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                The ledger is read in full regardless of the selected window, because a balance is
                a running total — a 30-day slice of accruals and drawdowns is not a balance.
              </p>
            </div>
          )}
        </Section>

        {funds.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title="Unspent co-op balance"
              description="Money already earned that has not been deployed."
            >
              <Bars
                data={funds.map((f) => ({
                  key: f.platformId,
                  label: f.platformName,
                  value: f.balancePaise,
                }))}
                unit="money"
              />
            </Section>
            <Section
              title="Brand cost by promotion"
              description="Own-margin discount plus participation fee."
            >
              <Bars
                data={promos.slice(0, 10).map((p) => ({
                  key: p.promotionId,
                  label: p.name,
                  value: p.brandCostPaise,
                  secondary: {
                    label: "Revenue",
                    value: formatInrCompact(p.grossRevenuePaise),
                  },
                }))}
                unit="money"
              />
            </Section>
          </div>
        )}

        <Section
          title="Promotions in this window"
          description="Ranked by what they cost the brand. Funding split is the number to negotiate — the same event at a 50/50 split costs half as much."
          padded={false}
        >
          {promos.length === 0 ? (
            <EmptyState
              title="No promotions overlap this window"
              hint="Widen the date range, or check that the platform accounts have synced their promotion records."
            />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Promotion</th>
                    <th>Platform</th>
                    <th>Dates</th>
                    <th className="text-right">Revenue</th>
                    <th className="text-right">Brand cost</th>
                    <th className="text-right">Platform funded</th>
                    <th className="text-right">Split</th>
                    <th className="text-right">Promo ROAS</th>
                    <th className="text-right">CAC</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p) => (
                    <tr key={p.promotionId}>
                      <td>
                        <div className="flex flex-col">
                          <span className="font-medium">{p.name}</span>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {prettyPromoType(p.promoType)} ·{" "}
                            {formatPercent(p.discountRate, 0)} off · {p.status}
                          </span>
                        </div>
                      </td>
                      <td>{p.platformName}</td>
                      <td className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                        {p.startDay.slice(5)} → {p.endDay.slice(5)}
                      </td>
                      <td className="tabular text-right">
                        {formatInrCompact(p.grossRevenuePaise)}
                      </td>
                      <td className="tabular text-right font-medium">
                        {formatInrCompact(p.brandCostPaise)}
                        {p.participationFeePaise > 0 && (
                          <span
                            className="block text-[10px]"
                            style={{ color: "var(--text-muted)" }}
                          >
                            incl. {formatInrCompact(p.participationFeePaise)} fee
                          </span>
                        )}
                      </td>
                      <td className="tabular text-right" style={{ color: "var(--status-good)" }}>
                        {formatInrCompact(p.platformFundedDiscountPaise)}
                      </td>
                      <td className="tabular text-right" style={{ color: "var(--text-secondary)" }}>
                        {formatPercent(p.platformFundedShare, 0)} them
                      </td>
                      <td className="tabular text-right font-medium">
                        {formatMultiple(p.promoRoas)}
                      </td>
                      <td className="tabular text-right">
                        {p.newCustomers > 0
                          ? formatInrCompact(p.costPerNewCustomerPaise)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 pt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                Brand cost is the brand-funded share of the markdown plus the participation fee.
                Promo ROAS is gross promoted revenue per rupee of that cost — it is not
                comparable to an ad ROAS, because a promotion also cannibalises units that would
                have sold at full price.
              </p>
            </div>
          )}
        </Section>

        {promoInsights.length > 0 && (
          <Section
            title="Flagged here"
            description="Affordability against the brand's contribution target, and fund money at risk."
          >
            <InsightList insights={promoInsights} />
          </Section>
        )}
      </div>
    </>
  );
}
