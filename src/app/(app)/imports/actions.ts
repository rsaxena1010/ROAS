"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, platformAccounts, syncRuns, AD_TYPES, type AdType } from "@/db/schema";
import { requirePrincipal } from "@/lib/auth";
import { buildContext, writePayload } from "@/services/ingest";
import { parseAdMetricsCsv, parseSalesCsv } from "@/connectors/csv";
import { emptyPayload, type AdMetricRecord, type CampaignRecord } from "@/connectors/types";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upload a platform report file.
 *
 * The outcome is recorded as a `sync_runs` row rather than returned to the caller, so the
 * result survives the redirect and an operator can see later what a number came from. Every
 * import is therefore auditable next to the connector-driven syncs.
 */
export async function importCsvAction(formData: FormData): Promise<void> {
  const { brand } = await requirePrincipal();

  const accountId = String(formData.get("platformAccountId") ?? "");
  const kind = String(formData.get("kind") ?? "ads");
  const defaultAdType = pickAdType(String(formData.get("defaultAdType") ?? ""));

  // Tenancy: the account must belong to the caller's brand.
  const account = await db.query.platformAccounts.findFirst({
    where: and(eq(platformAccounts.id, accountId), eq(platformAccounts.brandId, brand.id)),
  });
  if (!account) throw new Error("Unknown platform account.");

  const file = formData.get("file");
  const pasted = String(formData.get("pasted") ?? "").trim();

  let text = "";
  let sourceLabel = "pasted text";
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      await record(brand.id, account.id, "failed", 0, `File is larger than 8 MB.`, null, null);
      revalidatePath("/imports");
      return;
    }
    text = await file.text();
    sourceLabel = file.name;
  } else if (pasted) {
    text = pasted;
  } else {
    await record(brand.id, account.id, "failed", 0, "No file or pasted rows supplied.", null, null);
    revalidatePath("/imports");
    return;
  }

  const payload = emptyPayload();
  let fromDay: string | null = null;
  let toDay: string | null = null;

  try {
    if (kind === "sales") {
      const parsed = parseSalesCsv(text);
      payload.sales = parsed.records;
      payload.warnings.push(...parsed.warnings);
      ({ fromDay, toDay } = dayBounds(parsed.records.map((r) => r.day)));
      if (parsed.records.length === 0) {
        await record(
          brand.id,
          account.id,
          "failed",
          0,
          `No usable rows in ${sourceLabel}. ${parsed.warnings.join(" ")}`,
          null,
          null,
        );
        revalidatePath("/imports");
        return;
      }
    } else {
      const parsed = parseAdMetricsCsv(text);
      payload.warnings.push(...parsed.warnings);
      if (parsed.records.length === 0) {
        await record(
          brand.id,
          account.id,
          "failed",
          0,
          `No usable rows in ${sourceLabel}. ${parsed.warnings.join(" ")}`,
          null,
          null,
        );
        revalidatePath("/imports");
        return;
      }

      // Uploads land at (day, campaign, SKU). Asset ids in the file are summed away rather
      // than invented as ad assets: ingest keys ad rows on
      // day|campaign|asset|product, so writing two asset rows without first creating those
      // assets would collapse them onto one key and silently lose the second.
      const { records, merged } = mergeToCampaignSkuGrain(parsed.records);
      payload.adMetrics = records;
      if (merged > 0) {
        payload.warnings.push(
          `${merged} row(s) were summed together: uploads are stored at campaign × SKU × day grain, so ad-group/creative detail in the file is aggregated away.`,
        );
      }

      // Ad metric rows whose campaign does not exist yet are dropped by ingest, so create
      // any missing campaign first. Report it — an auto-created campaign is a guess about
      // ad type, and the operator needs to know one was made.
      const externalIds = [...new Set(records.map((r) => r.campaignExternalId))];
      const existing = await db
        .select({ externalId: campaigns.externalId })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.platformAccountId, account.id),
            inArray(campaigns.externalId, externalIds),
          ),
        );
      const known = new Set(existing.map((c) => c.externalId));
      const missing = externalIds.filter((id) => !known.has(id));

      payload.campaigns = missing.map(
        (id): CampaignRecord => ({
          externalId: id,
          name: id,
          adType: defaultAdType,
          dailyBudgetPaise: 0,
          status: "enabled",
        }),
      );
      if (missing.length > 0) {
        payload.warnings.push(
          `${missing.length} campaign(s) in the file were not known and have been created as "${defaultAdType}": ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}. Correct the ad type if that is wrong, or the channel cuts will mis-group them.`,
        );
      }

      ({ fromDay, toDay } = dayBounds(records.map((r) => r.day)));
    }

    const ctx = await buildContext(account);
    // writePayload appends its own warnings (unmapped SKUs) to the payload.
    const rows = await writePayload(ctx, payload);

    await record(
      brand.id,
      account.id,
      payload.warnings.length > 0 ? "partial" : "success",
      rows,
      [`Imported ${sourceLabel}.`, ...payload.warnings].join(" | "),
      fromDay,
      toDay,
    );
  } catch (error) {
    await record(
      brand.id,
      account.id,
      "failed",
      0,
      `${sourceLabel}: ${error instanceof Error ? error.message : String(error)}`,
      fromDay,
      toDay,
    );
  }

  revalidatePath("/imports");
  revalidatePath("/");
}

/** Sum the numeric columns for rows that share (day, campaign, SKU). */
function mergeToCampaignSkuGrain(rows: AdMetricRecord[]): {
  records: AdMetricRecord[];
  merged: number;
} {
  const byKey = new Map<string, AdMetricRecord>();
  let merged = 0;

  for (const row of rows) {
    const key = `${row.day}|${row.campaignExternalId}|${row.externalSku ?? "-"}`;
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, { ...row, assetExternalId: undefined });
      continue;
    }
    merged++;
    hit.impressions += row.impressions;
    hit.clicks += row.clicks;
    hit.spendPaise += row.spendPaise;
    hit.orders += row.orders;
    hit.units += row.units;
    hit.revenuePaise += row.revenuePaise;
    hit.newCustomerOrders += row.newCustomerOrders;
    hit.newCustomerRevenuePaise += row.newCustomerRevenuePaise;
    hit.returnedUnits += row.returnedUnits;
  }

  return { records: [...byKey.values()], merged };
}

function dayBounds(days: string[]): { fromDay: string | null; toDay: string | null } {
  if (days.length === 0) return { fromDay: null, toDay: null };
  const sorted = [...days].sort();
  return { fromDay: sorted[0], toDay: sorted[sorted.length - 1] };
}

function pickAdType(value: string): AdType {
  return (AD_TYPES as readonly string[]).includes(value)
    ? (value as AdType)
    : "sponsored_product";
}

async function record(
  brandId: string,
  platformAccountId: string,
  status: "success" | "partial" | "failed",
  rowsWritten: number,
  message: string,
  fromDay: string | null,
  toDay: string | null,
) {
  const now = Date.now();
  await db.insert(syncRuns).values({
    brandId,
    platformAccountId,
    mode: "file",
    fromDay: fromDay ?? "-",
    toDay: toDay ?? "-",
    status,
    rowsWritten,
    message: message.slice(0, 2000),
    startedAt: now,
    finishedAt: now,
  });
}
