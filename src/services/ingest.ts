/**
 * Ingestion: connector payload -> database.
 *
 * Idempotent by design. Re-syncing a period must overwrite, never duplicate, because
 * platforms restate recent days as attribution windows close (a 14-day Amazon window means
 * yesterday's revenue is still moving for two weeks). Every fact table therefore has a
 * natural-key unique index and we upsert on it.
 *
 * Writes go through `db.batch()` in chunks rather than one statement per row. Against a
 * remote libSQL database each statement is a network round trip, and a 120-day sandbox sync
 * is ~100k rows — batching turns that from minutes into seconds.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  adAssets,
  adMetricsDaily,
  brandFundLedger,
  campaigns,
  listings,
  platformAccounts,
  platforms,
  products,
  promotionMetricsDaily,
  promotionProducts,
  promotions,
  salesDaily,
  syncRuns,
} from "@/db/schema";
import { credentialsFor, getConnector } from "@/connectors/registry";
import type {
  ConnectorContext,
  ConnectorPayload,
  DateRange,
  SkuMapping,
} from "@/connectors/types";
import { ConnectorError } from "@/connectors/types";

/** libSQL caps statements per batch; 400 keeps us well inside it. */
const BATCH_SIZE = 400;

export interface SyncResult {
  platformAccountId: string;
  platformId: string;
  status: "success" | "partial" | "failed";
  rowsWritten: number;
  warnings: string[];
  error?: string;
  durationMs: number;
}

export async function syncAccount(
  platformAccountId: string,
  range: DateRange,
): Promise<SyncResult> {
  const started = Date.now();

  const account = await db.query.platformAccounts.findFirst({
    where: eq(platformAccounts.id, platformAccountId),
  });
  if (!account) throw new Error(`Unknown platform account ${platformAccountId}`);

  const [run] = await db
    .insert(syncRuns)
    .values({
      brandId: account.brandId,
      platformAccountId: account.id,
      mode: account.mode,
      fromDay: range.from,
      toDay: range.to,
      status: "running",
    })
    .returning();

  try {
    const ctx = await buildContext(account);
    const connector = getConnector(account.platformId);
    const payload = await connector.fetch(ctx, range);
    const rowsWritten = await writePayload(ctx, payload);

    const status = payload.warnings.length > 0 ? "partial" : "success";
    await db
      .update(syncRuns)
      .set({
        status,
        rowsWritten,
        message: payload.warnings.join(" | ").slice(0, 2000) || null,
        finishedAt: Date.now(),
      })
      .where(eq(syncRuns.id, run.id));

    await db
      .update(platformAccounts)
      .set({ status: "connected", lastSyncedAt: Date.now(), lastSyncError: null })
      .where(eq(platformAccounts.id, account.id));

    return {
      platformAccountId: account.id,
      platformId: account.platformId,
      status,
      rowsWritten,
      warnings: payload.warnings,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message =
      error instanceof ConnectorError || error instanceof Error
        ? error.message
        : String(error);

    await db
      .update(syncRuns)
      .set({ status: "failed", message: message.slice(0, 2000), finishedAt: Date.now() })
      .where(eq(syncRuns.id, run.id));

    await db
      .update(platformAccounts)
      .set({ status: "error", lastSyncError: message.slice(0, 500) })
      .where(eq(platformAccounts.id, account.id));

    return {
      platformAccountId: account.id,
      platformId: account.platformId,
      status: "failed",
      rowsWritten: 0,
      warnings: [],
      error: message,
      durationMs: Date.now() - started,
    };
  }
}

export async function syncBrand(
  brandId: string,
  range: DateRange,
): Promise<SyncResult[]> {
  const accounts = await db
    .select()
    .from(platformAccounts)
    .where(eq(platformAccounts.brandId, brandId));

  const results: SyncResult[] = [];
  // Sequential: connectors are rate-limited and the sandbox is CPU-bound anyway. Fanning
  // out would trade throughput for 429s in live mode.
  for (const account of accounts) {
    results.push(await syncAccount(account.id, range));
  }
  return results;
}

export async function buildContext(
  account: typeof platformAccounts.$inferSelect,
): Promise<ConnectorContext> {
  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      category: products.category,
      externalSku: listings.externalSku,
      sellingPricePaise: listings.sellingPricePaise,
    })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .where(and(eq(listings.platformAccountId, account.id), eq(listings.isActive, true)));

  const skuMap: SkuMapping[] = rows.map((r) => ({
    productId: r.productId,
    sku: r.sku,
    externalSku: r.externalSku,
    sellingPricePaise: r.sellingPricePaise,
    category: r.category,
  }));

  return {
    brandId: account.brandId,
    platformAccountId: account.id,
    platformId: account.platformId,
    externalAccountId: account.externalAccountId,
    mode: account.mode,
    config: account.config ?? {},
    credentials: credentialsFor(account.platformId),
    skuMap,
    logger: (m) => console.log(`[sync ${account.platformId}] ${m}`),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Statement = any;

async function runBatched(statements: Statement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const chunk = statements.slice(i, i + BATCH_SIZE);
    if (chunk.length === 0) continue;
    await db.batch(chunk as [Statement, ...Statement[]]);
  }
}

/**
 * Write a payload. Returns the number of fact rows written.
 * Exported so the CSV import path can reuse it without going through a connector.
 */
export async function writePayload(
  ctx: ConnectorContext,
  payload: ConnectorPayload,
): Promise<number> {
  let rows = 0;

  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.id, ctx.platformId),
  });
  if (!platform) throw new Error(`Unknown platform ${ctx.platformId}`);

  const skuToProduct = new Map(ctx.skuMap.map((s) => [s.externalSku, s.productId]));

  /* ------------------------------------------------------------ campaigns */

  await runBatched(
    payload.campaigns.map((c) =>
      db
        .insert(campaigns)
        .values({
          brandId: ctx.brandId,
          platformAccountId: ctx.platformAccountId,
          externalId: c.externalId,
          name: c.name,
          adType: c.adType,
          objective: c.objective ?? "sales",
          fundingSource: c.fundingSource ?? "brand_cash",
          dailyBudgetPaise: c.dailyBudgetPaise,
          bidStrategy: c.bidStrategy ?? null,
          status: c.status,
          startDay: c.startDay ?? null,
          endDay: c.endDay ?? null,
        })
        .onConflictDoUpdate({
          target: [campaigns.platformAccountId, campaigns.externalId],
          set: {
            name: c.name,
            adType: c.adType,
            fundingSource: c.fundingSource ?? "brand_cash",
            dailyBudgetPaise: c.dailyBudgetPaise,
            status: c.status,
          },
        }),
    ),
  );

  // Reload to map external ids to internal ids for the fact rows.
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.platformAccountId, ctx.platformAccountId));
  const campaignByExternal = new Map(campaignRows.map((c) => [c.externalId, c]));

  /* --------------------------------------------------------------- assets */

  const assetStatements: Statement[] = [];
  for (const c of payload.campaigns) {
    const parent = campaignByExternal.get(c.externalId);
    if (!parent) continue;
    for (const a of c.assets ?? []) {
      assetStatements.push(
        db
          .insert(adAssets)
          .values({
            brandId: ctx.brandId,
            campaignId: parent.id,
            externalId: a.externalId,
            name: a.name,
            assetType: a.assetType,
            spec: a.spec ?? null,
            status: a.status,
          })
          .onConflictDoUpdate({
            target: [adAssets.campaignId, adAssets.externalId],
            set: { name: a.name, assetType: a.assetType, status: a.status },
          }),
      );
    }
  }
  await runBatched(assetStatements);

  const assetRows =
    campaignRows.length > 0
      ? await db
          .select()
          .from(adAssets)
          .where(
            inArray(
              adAssets.campaignId,
              campaignRows.map((c) => c.id),
            ),
          )
      : [];
  const assetByExternal = new Map(
    assetRows.map((a) => [`${a.campaignId}|${a.externalId}`, a.id]),
  );

  /* ----------------------------------------------------------- ad metrics */

  const unmappedSkus = new Set<string>();
  const adStatements: Statement[] = [];

  for (const m of payload.adMetrics) {
    const campaign = campaignByExternal.get(m.campaignExternalId);
    if (!campaign) continue;

    const assetId = m.assetExternalId
      ? (assetByExternal.get(`${campaign.id}|${m.assetExternalId}`) ?? null)
      : null;

    let productId: string | null = null;
    if (m.externalSku) {
      productId = skuToProduct.get(m.externalSku) ?? null;
      if (!productId) unmappedSkus.add(m.externalSku);
    }

    const grainKey = `${m.day}|${campaign.id}|${assetId ?? "-"}|${productId ?? "-"}`;
    const values = {
      impressions: m.impressions,
      clicks: m.clicks,
      spendPaise: m.spendPaise,
      orders: m.orders,
      units: m.units,
      revenuePaise: m.revenuePaise,
      newCustomerOrders: m.newCustomerOrders,
      newCustomerRevenuePaise: m.newCustomerRevenuePaise,
      returnedUnits: m.returnedUnits,
    };

    adStatements.push(
      db
        .insert(adMetricsDaily)
        .values({
          brandId: ctx.brandId,
          platformId: ctx.platformId,
          platformAccountId: ctx.platformAccountId,
          campaignId: campaign.id,
          adAssetId: assetId,
          productId,
          adType: campaign.adType,
          fundingSource: campaign.fundingSource,
          day: m.day,
          grainKey,
          ...values,
        })
        .onConflictDoUpdate({
          target: adMetricsDaily.grainKey,
          set: {
            adType: campaign.adType,
            fundingSource: campaign.fundingSource,
            ...values,
          },
        }),
    );
    rows++;
  }
  await runBatched(adStatements);

  if (unmappedSkus.size > 0) {
    payload.warnings.push(
      `${unmappedSkus.size} platform SKU(s) had no listing mapping and were recorded without SKU attribution: ${[...unmappedSkus].slice(0, 5).join(", ")}${unmappedSkus.size > 5 ? "…" : ""}`,
    );
  }

  /* ---------------------------------------------------------------- sales */

  const salesStatements: Statement[] = [];
  for (const s of payload.sales) {
    const productId = skuToProduct.get(s.externalSku);
    if (!productId) continue;
    const values = {
      units: s.units,
      grossRevenuePaise: s.grossRevenuePaise,
      discountPaise: s.discountPaise,
      returnedUnits: s.returnedUnits,
      newCustomers: s.newCustomers,
    };
    salesStatements.push(
      db
        .insert(salesDaily)
        .values({
          brandId: ctx.brandId,
          platformId: ctx.platformId,
          platformAccountId: ctx.platformAccountId,
          productId,
          day: s.day,
          ...values,
        })
        .onConflictDoUpdate({
          target: [salesDaily.day, salesDaily.platformAccountId, salesDaily.productId],
          set: values,
        }),
    );
    rows++;
  }
  await runBatched(salesStatements);

  /* ----------------------------------------------------------- promotions */

  await runBatched(
    payload.promotions.map((p) =>
      db
        .insert(promotions)
        .values({
          brandId: ctx.brandId,
          platformAccountId: ctx.platformAccountId,
          externalId: p.externalId,
          name: p.name,
          promoType: p.promoType,
          startDay: p.startDay,
          endDay: p.endDay,
          discountRate: p.discountRate,
          discountFlatPaise: p.discountFlatPaise ?? 0,
          brandFundedShare: p.brandFundedShare,
          participationFeePaise: p.participationFeePaise ?? 0,
          status: p.status,
        })
        .onConflictDoUpdate({
          target: [promotions.platformAccountId, promotions.externalId],
          set: {
            name: p.name,
            promoType: p.promoType,
            startDay: p.startDay,
            endDay: p.endDay,
            discountRate: p.discountRate,
            brandFundedShare: p.brandFundedShare,
            participationFeePaise: p.participationFeePaise ?? 0,
            status: p.status,
          },
        }),
    ),
  );

  const promoRows = await db
    .select()
    .from(promotions)
    .where(eq(promotions.platformAccountId, ctx.platformAccountId));
  const promoByExternal = new Map(promoRows.map((p) => [p.externalId, p.id]));

  const promoStatements: Statement[] = [];
  for (const p of payload.promotions) {
    const promoId = promoByExternal.get(p.externalId);
    if (!promoId) continue;

    for (const sku of p.externalSkus) {
      const productId = skuToProduct.get(sku);
      if (!productId) continue;
      promoStatements.push(
        db
          .insert(promotionProducts)
          .values({ promotionId: promoId, productId })
          .onConflictDoNothing(),
      );
    }

    for (const m of p.metrics ?? []) {
      const productId = skuToProduct.get(m.externalSku);
      if (!productId) continue;
      const values = {
        units: m.units,
        grossRevenuePaise: m.grossRevenuePaise,
        discountPaise: m.discountPaise,
        brandFundedDiscountPaise: m.brandFundedDiscountPaise,
        platformFundedDiscountPaise: m.platformFundedDiscountPaise,
        newCustomers: m.newCustomers,
      };
      promoStatements.push(
        db
          .insert(promotionMetricsDaily)
          .values({
            brandId: ctx.brandId,
            promotionId: promoId,
            platformId: ctx.platformId,
            productId,
            day: m.day,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              promotionMetricsDaily.day,
              promotionMetricsDaily.promotionId,
              promotionMetricsDaily.productId,
            ],
            set: values,
          }),
      );
      rows++;
    }
  }
  await runBatched(promoStatements);

  /* ----------------------------------------------------------- brand fund */

  await runBatched(
    payload.brandFund.map((f) => {
      const entryKey = `${f.day}|${f.entryType}|${f.reference ?? "-"}`;
      rows++;
      return db
        .insert(brandFundLedger)
        .values({
          brandId: ctx.brandId,
          platformAccountId: ctx.platformAccountId,
          day: f.day,
          entryType: f.entryType,
          amountPaise: f.amountPaise,
          reference: f.reference ?? null,
          note: f.note ?? null,
          expiresOn: f.expiresOn ?? null,
          entryKey,
        })
        .onConflictDoUpdate({
          target: [brandFundLedger.platformAccountId, brandFundLedger.entryKey],
          set: {
            amountPaise: f.amountPaise,
            note: f.note ?? null,
            expiresOn: f.expiresOn ?? null,
          },
        });
    }),
  );

  return rows;
}
