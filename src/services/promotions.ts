/**
 * Promotion rollups for the Promos & funds view.
 *
 * Promotions are the line brands consistently under-count: the discount is booked as a price
 * change rather than as marketing, the participation fee arrives on a separate invoice, and
 * the platform's share of the markdown is invisible in most reporting. This assembles all
 * three into one cost per promotion, and pairs it with the new customers it produced.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  platformAccounts,
  platforms,
  promotionMetricsDaily,
  promotions,
  type PromoType,
} from "@/db/schema";
import { safeDiv } from "@/lib/money";
import type { Day } from "@/lib/date";
import type { DateRange } from "@/connectors/types";

export interface PromotionSummary {
  promotionId: string;
  name: string;
  promoType: PromoType;
  platformId: string;
  platformName: string;
  startDay: Day;
  endDay: Day;
  status: string;
  /** Headline discount the shopper sees. */
  discountRate: number;
  /** Contracted share of the markdown the brand pays. */
  brandFundedShare: number;
  participationFeePaise: number;

  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  brandFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  newCustomers: number;

  /** Brand-funded discount plus the event fee: the real cost of taking part. */
  brandCostPaise: number;
  /** What the brand actually paid as a share of revenue, vs the contracted share. */
  effectiveBrandDiscountRate: number;
  /** Share of the total markdown that the platform absorbed. Higher is a better deal. */
  platformFundedShare: number;
  costPerNewCustomerPaise: number;
  /** Revenue per rupee of brand cost — the promotion's own ROAS. */
  promoRoas: number;
}

export async function promotionSummaries(
  brandId: string,
  range: DateRange,
): Promise<PromotionSummary[]> {
  const [defs, metricRows] = await Promise.all([
    db
      .select({
        promotionId: promotions.id,
        name: promotions.name,
        promoType: promotions.promoType,
        startDay: promotions.startDay,
        endDay: promotions.endDay,
        status: promotions.status,
        discountRate: promotions.discountRate,
        brandFundedShare: promotions.brandFundedShare,
        participationFeePaise: promotions.participationFeePaise,
        platformId: platformAccounts.platformId,
        platformName: platforms.name,
      })
      .from(promotions)
      .innerJoin(platformAccounts, eq(promotions.platformAccountId, platformAccounts.id))
      .innerJoin(platforms, eq(platformAccounts.platformId, platforms.id))
      .where(
        and(
          eq(promotions.brandId, brandId),
          // Overlaps the window, rather than sits inside it.
          lte(promotions.startDay, range.to),
          gte(promotions.endDay, range.from),
        ),
      ),
    db
      .select({
        promotionId: promotionMetricsDaily.promotionId,
        units: promotionMetricsDaily.units,
        grossRevenuePaise: promotionMetricsDaily.grossRevenuePaise,
        discountPaise: promotionMetricsDaily.discountPaise,
        brandFundedDiscountPaise: promotionMetricsDaily.brandFundedDiscountPaise,
        platformFundedDiscountPaise: promotionMetricsDaily.platformFundedDiscountPaise,
        newCustomers: promotionMetricsDaily.newCustomers,
      })
      .from(promotionMetricsDaily)
      .where(
        and(
          eq(promotionMetricsDaily.brandId, brandId),
          gte(promotionMetricsDaily.day, range.from),
          lte(promotionMetricsDaily.day, range.to),
        ),
      ),
  ]);

  const totals = new Map<
    string,
    {
      units: number;
      grossRevenuePaise: number;
      discountPaise: number;
      brandFundedDiscountPaise: number;
      platformFundedDiscountPaise: number;
      newCustomers: number;
    }
  >();
  for (const r of metricRows) {
    const acc =
      totals.get(r.promotionId) ??
      {
        units: 0,
        grossRevenuePaise: 0,
        discountPaise: 0,
        brandFundedDiscountPaise: 0,
        platformFundedDiscountPaise: 0,
        newCustomers: 0,
      };
    acc.units += r.units;
    acc.grossRevenuePaise += r.grossRevenuePaise;
    acc.discountPaise += r.discountPaise;
    acc.brandFundedDiscountPaise += r.brandFundedDiscountPaise;
    acc.platformFundedDiscountPaise += r.platformFundedDiscountPaise;
    acc.newCustomers += r.newCustomers;
    totals.set(r.promotionId, acc);
  }

  const out: PromotionSummary[] = defs.map((d) => {
    const t =
      totals.get(d.promotionId) ??
      {
        units: 0,
        grossRevenuePaise: 0,
        discountPaise: 0,
        brandFundedDiscountPaise: 0,
        platformFundedDiscountPaise: 0,
        newCustomers: 0,
      };
    const brandCost = t.brandFundedDiscountPaise + d.participationFeePaise;

    return {
      ...d,
      ...t,
      brandCostPaise: brandCost,
      effectiveBrandDiscountRate: safeDiv(t.brandFundedDiscountPaise, t.grossRevenuePaise),
      platformFundedShare: safeDiv(t.platformFundedDiscountPaise, t.discountPaise),
      costPerNewCustomerPaise: Math.round(safeDiv(brandCost, t.newCustomers)),
      promoRoas: safeDiv(t.grossRevenuePaise, brandCost),
    };
  });

  return out.sort((a, b) => b.brandCostPaise - a.brandCostPaise);
}

export function prettyPromoType(promoType: string): string {
  switch (promoType) {
    case "deal_of_day":
      return "Deal of the day";
    case "bxgy":
      return "Buy X get Y";
    case "bank_offer":
      return "Bank offer";
    case "price_off":
      return "Price off";
    case "platform_event":
      return "Platform event";
    default:
      return promoType
        .split("_")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ");
  }
}
