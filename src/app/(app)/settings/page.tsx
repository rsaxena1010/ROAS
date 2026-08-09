import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformAccounts, platforms, products } from "@/db/schema";
import { PageHeader } from "@/components/PageHeader";
import { Banner, KeyValue, Section } from "@/components/Section";
import { listConnectors } from "@/connectors/registry";
import { breakEvenRoas } from "@/domain/economics";
import { formatInr, formatMultiple, formatPercent } from "@/lib/money";
import { requirePage } from "@/lib/page";
import {
  syncAccountAction,
  updateAccountModeAction,
  updateTargetsAction,
} from "./actions";

export const metadata = { title: "Settings — ROAS" };

const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  connected: { color: "var(--status-good)", icon: "●" },
  error: { color: "var(--status-critical)", icon: "▲" },
  disconnected: { color: "var(--text-muted)", icon: "○" },
};

const INTEGRATION_LABEL: Record<string, string> = {
  api: "Live API available",
  api_sandbox_only: "Vendor sandbox only",
  report_file: "Report file / partner API",
  none: "No integration",
};

export default async function SettingsPage() {
  const { brand, user } = await requirePage();

  const [accounts, productRows] = await Promise.all([
    db
      .select({
        id: platformAccounts.id,
        label: platformAccounts.label,
        externalAccountId: platformAccounts.externalAccountId,
        mode: platformAccounts.mode,
        status: platformAccounts.status,
        lastSyncedAt: platformAccounts.lastSyncedAt,
        lastSyncError: platformAccounts.lastSyncError,
        platformId: platformAccounts.platformId,
        platformName: platforms.name,
        kind: platforms.kind,
        integration: platforms.integration,
        attributionWindowDays: platforms.attributionWindowDays,
        defaultTakeRate: platforms.defaultTakeRate,
        defaultFulfilmentFeePaise: platforms.defaultFulfilmentFeePaise,
        defaultPaymentFeeRate: platforms.defaultPaymentFeeRate,
        defaultBrandFundAccrualRate: platforms.defaultBrandFundAccrualRate,
      })
      .from(platformAccounts)
      .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
      .where(eq(platformAccounts.brandId, brand.id))
      .orderBy(platforms.name),
    db
      .select({ sku: products.sku, name: products.name, category: products.category })
      .from(products)
      .where(eq(products.brandId, brand.id)),
  ]);

  const connectors = listConnectors();
  const connectorById = new Map(connectors.map((c) => [c.platformId, c]));
  const impliedBreakEven = breakEvenRoas(brand.targetContributionMargin);
  const liveAccounts = accounts.filter((a) => a.mode === "live");

  return (
    <>
      <PageHeader
        title="Settings"
        description={`${brand.name} · signed in as ${user.email}`}
        showRange={false}
      />

      <div className="flex flex-col gap-4">
        <Section
          title="Targets"
          description="These are not decoration: the contribution-margin target sets the break-even multiple every channel is judged against, and the CAC target drives the acquisition alerts."
        >
          <form action={updateTargetsAction} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Target ROAS
              </span>
              <input
                type="number"
                name="targetRoas"
                min={0.5}
                max={50}
                // "any" rather than a fixed step: a step the entered value doesn't land on
                // makes the browser block submission silently.
                step="any"
                defaultValue={brand.targetRoas}
                className="!w-28 !py-1.5 !text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Target CAC (₹)
              </span>
              <input
                type="number"
                name="targetCac"
                min={1}
                step={1}
                defaultValue={brand.targetCacPaise / 100}
                className="!w-32 !py-1.5 !text-xs"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Contribution margin (%)
              </span>
              <input
                type="number"
                name="targetMargin"
                min={0}
                max={95}
                step="any"
                defaultValue={Number((brand.targetContributionMargin * 100).toFixed(1))}
                className="!w-36 !py-1.5 !text-xs"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg px-4 py-2 text-xs font-medium text-white"
              style={{ background: "var(--series-1)" }}
            >
              Save targets
            </button>
          </form>

          <div className="grid gap-3 pt-1 sm:grid-cols-3">
            <KeyValue
              label="Implied break-even ROAS"
              value={
                Number.isFinite(impliedBreakEven) ? formatMultiple(impliedBreakEven) : "no margin"
              }
              hint={`At a ${formatPercent(brand.targetContributionMargin, 1)} margin, revenue must be this multiple of spend to break even.`}
            />
            <KeyValue
              label="Target ROAS vs break-even"
              value={
                Number.isFinite(impliedBreakEven)
                  ? `${(brand.targetRoas / impliedBreakEven).toFixed(2)}x headroom`
                  : "—"
              }
              hint={
                brand.targetRoas < impliedBreakEven
                  ? "Your ROAS target is below your own break-even — hitting it would still lose money."
                  : "A target above break-even leaves room for profitable growth."
              }
            />
            <KeyValue
              label="Catalogue"
              value={`${productRows.length} SKUs`}
              hint={`${new Set(productRows.map((p) => p.category)).size} categories`}
            />
          </div>

          {Number.isFinite(impliedBreakEven) && brand.targetRoas < impliedBreakEven && (
            <Banner tone="warning" title="Your ROAS target is below your break-even">
              A campaign hitting exactly {formatMultiple(brand.targetRoas)} still destroys
              contribution, because {formatPercent(brand.targetContributionMargin, 1)} margin needs{" "}
              {formatMultiple(impliedBreakEven)} to cover its own cost. Raise the ROAS target or
              fix the unit economics.
            </Banner>
          )}
        </Section>

        {liveAccounts.length > 0 && (
          <Banner tone="warning" title={`${liveAccounts.length} account(s) are in live mode`}>
            Live mode calls the real vendor API using credentials from the environment. Secrets
            are never stored in the database — if a call fails, check the environment variables
            rather than these settings.
          </Banner>
        )}

        <Section
          title="Platform accounts"
          description="Fee defaults come from the platform and are overridden per listing where a real rate is known."
          padded={false}
        >
          <div className="flex flex-col">
            {accounts.map((a) => {
              const s = STATUS_STYLE[a.status] ?? STATUS_STYLE.disconnected;
              const connector = connectorById.get(a.platformId);
              const caps = connector?.capabilities;

              return (
                <div
                  key={a.id}
                  className="flex flex-col gap-3 border-b p-4 last:border-b-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        {a.platformName}
                        <span
                          className="flex items-center gap-1 text-xs font-medium"
                          style={{ color: s.color }}
                        >
                          <span aria-hidden>{s.icon}</span>
                          {a.status}
                        </span>
                      </h3>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {a.label} · account {a.externalAccountId} ·{" "}
                        {INTEGRATION_LABEL[a.integration] ?? a.integration}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <form action={updateAccountModeAction} className="flex items-end gap-1.5">
                        <input type="hidden" name="platformAccountId" value={a.id} />
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            Mode
                          </span>
                          <select
                            name="mode"
                            defaultValue={a.mode}
                            className="!w-auto !py-1 !text-xs"
                          >
                            {(caps?.modes ?? ["sandbox"]).map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="rounded-lg border px-2.5 py-1 text-xs"
                          style={{ borderColor: "var(--border)" }}
                        >
                          Set
                        </button>
                      </form>

                      <form action={syncAccountAction} className="flex items-end gap-1.5">
                        <input type="hidden" name="platformAccountId" value={a.id} />
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            Sync last
                          </span>
                          <select name="days" defaultValue={30} className="!w-auto !py-1 !text-xs">
                            {[7, 14, 30, 90].map((d) => (
                              <option key={d} value={d}>
                                {d} days
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-white"
                          style={{ background: "var(--series-1)" }}
                        >
                          Sync now
                        </button>
                      </form>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <KeyValue
                      label="Take rate"
                      value={formatPercent(a.defaultTakeRate, 1)}
                      hint="commission"
                    />
                    <KeyValue
                      label="Fulfilment"
                      value={formatInr(a.defaultFulfilmentFeePaise)}
                      hint="per unit"
                    />
                    <KeyValue label="Payment" value={formatPercent(a.defaultPaymentFeeRate, 1)} />
                    <KeyValue
                      label="Co-op accrual"
                      value={formatPercent(a.defaultBrandFundAccrualRate, 1)}
                      hint="of sales"
                    />
                    <KeyValue
                      label="Attribution"
                      value={`${a.attributionWindowDays} days`}
                    />
                    <KeyValue
                      label="Last synced"
                      value={
                        a.lastSyncedAt
                          ? new Date(a.lastSyncedAt)
                              .toISOString()
                              .slice(0, 16)
                              .replace("T", " ")
                          : "never"
                      }
                    />
                  </div>

                  {caps && (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      {(
                        [
                          ["Ads", caps.ads],
                          ["SKU attribution", caps.skuAttribution],
                          ["Total sales", caps.totalSales],
                          ["Promotions", caps.promotions],
                          ["Co-op fund", caps.brandFund],
                          ["New to brand", caps.newToBrand],
                        ] as const
                      ).map(([label, ok]) => (
                        <li
                          key={label}
                          className="flex items-center gap-1"
                          style={{ color: ok ? "var(--text-secondary)" : "var(--text-muted)" }}
                        >
                          <span aria-hidden style={{ color: ok ? "var(--status-good)" : undefined }}>
                            {ok ? "✓" : "✕"}
                          </span>
                          {label}
                        </li>
                      ))}
                    </ul>
                  )}

                  {caps?.note && (
                    <p
                      className="text-[11px] leading-relaxed"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {caps.note}
                    </p>
                  )}

                  {a.lastSyncError && (
                    <p className="text-[11px]" style={{ color: "var(--status-critical)" }}>
                      Last error: {a.lastSyncError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          title="Connector status across all platforms"
          description="What each integration can actually deliver today, rather than what a roadmap says."
          padded={false}
          note="Where a capability is missing the product degrades explicitly — a platform with no new-to-brand reporting shows an estimated CAC rather than a confident one."
        >
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Modes</th>
                  <th className="text-right">Attribution</th>
                  <th>Ads</th>
                  <th>SKU</th>
                  <th>Sales</th>
                  <th>Promos</th>
                  <th>Co-op</th>
                  <th>NTB</th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((c) => {
                  const caps = c.capabilities;
                  const cell = (ok: boolean) => (
                    <td
                      className="text-center"
                      style={{ color: ok ? "var(--status-good)" : "var(--text-muted)" }}
                    >
                      <span aria-label={ok ? "yes" : "no"}>{ok ? "✓" : "✕"}</span>
                    </td>
                  );
                  return (
                    <tr key={c.platformId}>
                      <td className="font-medium">{c.displayName}</td>
                      <td className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {caps.modes.join(", ")}
                      </td>
                      <td className="tabular text-right">{caps.attributionWindowDays}d</td>
                      {cell(caps.ads)}
                      {cell(caps.skuAttribution)}
                      {cell(caps.totalSales)}
                      {cell(caps.promotions)}
                      {cell(caps.brandFund)}
                      {cell(caps.newToBrand)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
