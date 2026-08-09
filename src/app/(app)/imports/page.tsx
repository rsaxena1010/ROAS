import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { platformAccounts, platforms, syncRuns, AD_TYPES } from "@/db/schema";
import { PageHeader } from "@/components/PageHeader";
import { Banner, EmptyState, Section } from "@/components/Section";
import { prettyAdType } from "@/services/analytics";
import { requirePage } from "@/lib/page";
import { importCsvAction } from "./actions";

export const metadata = { title: "Upload data — ROAS" };

const STATUS_STYLE: Record<string, { color: string; icon: string }> = {
  success: { color: "var(--status-good)", icon: "●" },
  partial: { color: "var(--status-warning)", icon: "▲" },
  failed: { color: "var(--status-critical)", icon: "▲" },
  running: { color: "var(--text-muted)", icon: "○" },
};

export default async function ImportsPage() {
  const { brand } = await requirePage();

  const accounts = await db
    .select({
      id: platformAccounts.id,
      label: platformAccounts.label,
      mode: platformAccounts.mode,
      platformId: platformAccounts.platformId,
      platformName: platforms.name,
      integration: platforms.integration,
    })
    .from(platformAccounts)
    .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
    .where(eq(platformAccounts.brandId, brand.id))
    .orderBy(platforms.name);

  const runs = await db
    .select({
      id: syncRuns.id,
      mode: syncRuns.mode,
      status: syncRuns.status,
      rowsWritten: syncRuns.rowsWritten,
      message: syncRuns.message,
      fromDay: syncRuns.fromDay,
      toDay: syncRuns.toDay,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      platformName: platforms.name,
      accountLabel: platformAccounts.label,
    })
    .from(syncRuns)
    .innerJoin(platformAccounts, eq(syncRuns.platformAccountId, platformAccounts.id))
    .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
    .where(eq(syncRuns.brandId, brand.id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(25);

  const fileOnly = accounts.filter((a) => a.integration === "report_file");

  return (
    <>
      <PageHeader
        title="Upload data"
        description="Myntra, Nykaa, BigBasket, Blinkit and Zepto have no public self-serve ads API today. Their numbers arrive as a scheduled report file, and this is where those files become the same facts as an API sync."
        showRange={false}
      />

      <div className="flex flex-col gap-4">
        {fileOnly.length > 0 && (
          <Banner tone="info" title="These platforms depend on file uploads">
            {fileOnly.map((a) => a.platformName).join(", ")} have no ads API we can call. Until a
            partner API is granted, their spend and sales only reach this product through an
            upload here — the sandbox figures you see for them are synthetic.
          </Banner>
        )}

        <Section
          title="Import a report"
          description="CSV or TSV. Column names are matched loosely, so an unmodified platform export usually works."
        >
          {accounts.length === 0 ? (
            <EmptyState
              title="No platform accounts yet"
              hint="Connect a platform in Settings before importing files against it."
            />
          ) : (
            <form action={importCsvAction} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Platform account
                  </span>
                  <select
                    name="platformAccountId"
                    required
                    className="!w-auto !py-1.5 !text-xs"
                    defaultValue={fileOnly[0]?.id ?? accounts[0].id}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.platformName} — {a.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Report type
                  </span>
                  <select name="kind" defaultValue="ads" className="!w-auto !py-1.5 !text-xs">
                    <option value="ads">Ad performance</option>
                    <option value="sales">Total sales (ad + organic)</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Ad type for new campaigns
                  </span>
                  <select
                    name="defaultAdType"
                    defaultValue="sponsored_product"
                    className="!w-auto !py-1.5 !text-xs"
                  >
                    {AD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {prettyAdType(t)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    File
                  </span>
                  <input
                    type="file"
                    name="file"
                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                    className="!py-1.5 !text-xs"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    …or paste rows directly
                  </span>
                  <textarea
                    name="pasted"
                    rows={5}
                    placeholder={"date,campaign,sku,impressions,clicks,spend,orders,units,revenue\n2026-08-01,Summer SP,VN-FW-001,18400,412,3200,26,31,14800"}
                    className="!text-xs"
                    style={{ fontFamily: "ui-monospace, monospace" }}
                  />
                </label>
              </div>

              <button
                type="submit"
                className="self-start rounded-lg px-4 py-2 text-xs font-medium text-white"
                style={{ background: "var(--series-1)" }}
              >
                Import
              </button>
            </form>
          )}
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title="Ad performance columns"
            description="Any one name from each row is enough."
          >
            <dl className="flex flex-col gap-1.5 text-xs">
              {[
                ["Date", "date · day · reportDate · orderDate"],
                ["Campaign", "campaignId · campaign · campaignName"],
                ["Ad group / creative", "adGroupId · adGroup · creative · asset"],
                ["SKU", "sku · asin · fsn · styleId · productId · itemCode"],
                ["Impressions", "impressions · views · impr"],
                ["Clicks", "clicks · click"],
                ["Spend", "spend · cost · amountSpent · adSpend · spends"],
                ["Orders", "orders · conversions · attributedOrders"],
                ["Units", "units · quantity · unitsSold"],
                ["Revenue", "revenue · sales · gmv · attributedSales"],
                ["New to brand", "newCustomerOrders · ntbOrders · newToBrandOrders"],
                ["Returns", "returns · returnedUnits · rto · cancellations"],
              ].map(([label, names]) => (
                <div key={label} className="flex flex-wrap gap-x-2">
                  <dt className="w-40 shrink-0 font-medium">{label}</dt>
                  <dd style={{ color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>
                    {names}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section
            title="Total sales columns"
            description="Needed for TACOS and blended ROAS — without it we only see the ad-attributed slice."
            note="Money columns are read as rupees and stored as integer paise. Dates accept YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY and DD-Mon-YYYY."
          >
            <dl className="flex flex-col gap-1.5 text-xs">
              {[
                ["Date", "date · day · orderDate"],
                ["SKU", "sku · asin · fsn · styleId · productId"],
                ["Units", "units · quantity · unitsSold"],
                ["Gross revenue", "grossRevenue · gmv · revenue · sales · mrpValue"],
                ["Discount", "discount · discountAmount · totalDiscount · promoDiscount"],
                ["Returns", "returns · returnedUnits · rto · cancellations"],
                ["New customers", "newCustomers · ntbCustomers · newToBrand"],
              ].map(([label, names]) => (
                <div key={label} className="flex flex-wrap gap-x-2">
                  <dt className="w-40 shrink-0 font-medium">{label}</dt>
                  <dd style={{ color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>
                    {names}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>

        <Section
          title="Import and sync history"
          description="Every upload and every connector sync, with what it wrote and what it warned about."
          padded={false}
        >
          {runs.length === 0 ? (
            <EmptyState title="Nothing imported or synced yet" />
          ) : (
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Account</th>
                    <th>Mode</th>
                    <th>Period</th>
                    <th className="text-right">Rows</th>
                    <th>Status</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const s = STATUS_STYLE[run.status] ?? STATUS_STYLE.running;
                    return (
                      <tr key={run.id}>
                        <td className="tabular whitespace-nowrap text-xs">
                          {new Date(run.startedAt).toISOString().slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="text-xs">
                          <span className="font-medium">{run.platformName}</span>
                        </td>
                        <td className="text-xs">{run.mode}</td>
                        <td className="tabular text-xs" style={{ color: "var(--text-secondary)" }}>
                          {run.fromDay === "-" ? "—" : `${run.fromDay} → ${run.toDay}`}
                        </td>
                        <td className="tabular text-right">
                          {run.rowsWritten.toLocaleString("en-IN")}
                        </td>
                        <td>
                          <span
                            className="flex items-center gap-1 text-xs font-medium"
                            style={{ color: s.color }}
                          >
                            <span aria-hidden>{s.icon}</span>
                            {run.status}
                          </span>
                        </td>
                        <td
                          className="max-w-xl text-[11px] leading-snug"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {run.message ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
