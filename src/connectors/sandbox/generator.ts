/**
 * Sandbox data generator.
 *
 * Produces a full ConnectorPayload for any platform without touching the network. The
 * generator is not a random-number sprayer: each campaign is given a hidden "true"
 * concave response curve, and daily spend is deliberately varied (budget regime changes
 * plus noise) so that the curve fitter in domain/curves.ts has something to recover. That
 * makes the optimizer's recommendations meaningful in the demo rather than decorative.
 *
 * Layered on top:
 *   - weekday / payday seasonality per platform kind
 *   - the Indian sale-event calendar, with CPC inflation and discount funding splits
 *   - returns, everyday discounts, brand-fund accrual and drawdown
 *
 * Deterministic: same (brand, account, range) always yields the same numbers.
 */

import { addDays, dayRange, type Day } from "@/lib/date";
import { splitPaise } from "@/lib/money";
import {
  emptyPayload,
  type AdAssetRecord,
  type AdMetricRecord,
  type BrandFundRecord,
  type CampaignRecord,
  type ConnectorContext,
  type ConnectorPayload,
  type DateRange,
  type PromotionMetricRecord,
  type PromotionRecord,
  type SalesRecord,
  type SkuMapping,
} from "../types";
import { baseSeasonality, eventDemandLift, eventsOn } from "./calendar";
import { profileFor, type AdTypeProfile, type PlatformProfile } from "./profiles";
import { Rng } from "./rng";

/** Hidden truth for one campaign. Never exposed — the product has to infer it. */
interface TrueCurve {
  kind: "hill" | "power";
  a: number;
  b: number;
}

interface SandboxCampaign {
  record: CampaignRecord;
  profile: AdTypeProfile;
  curve: TrueCurve;
  /** Typical daily spend, paise. */
  baseSpendPaise: number;
  cpcPaise: number;
  ctr: number;
  ntbRate: number;
  aovPaise: number;
  targets: SkuMapping[];
  assetWeights: number[];
}

export interface SandboxOptions {
  /** Total daily ad budget across all campaigns on this account, paise. */
  dailyBudgetPaise?: number;
  /** Number of campaigns per ad type. */
  campaignsPerAdType?: number;
}

export function generateSandboxPayload(
  ctx: ConnectorContext,
  range: DateRange,
  options: SandboxOptions = {},
): ConnectorPayload {
  const profile = profileFor(ctx.platformId);
  const payload = emptyPayload();

  if (ctx.skuMap.length === 0) {
    payload.warnings.push(
      `No listings mapped for ${profile.name}; nothing to generate. Add products and listings first.`,
    );
    return payload;
  }

  const rng = new Rng("sandbox", ctx.brandId, ctx.platformAccountId);
  const dailyBudget =
    options.dailyBudgetPaise ??
    (typeof ctx.config.dailyBudgetPaise === "number"
      ? ctx.config.dailyBudgetPaise
      : defaultDailyBudget(profile, ctx.skuMap.length, rng));

  const campaigns = buildCampaigns(
    ctx,
    profile,
    dailyBudget,
    options.campaignsPerAdType ?? 1,
    rng,
  );
  payload.campaigns = campaigns.map((c) => c.record);

  const days = dayRange(range.from, range.to);

  /* ---------------------------------------------------------------- ad rows */

  // One regime per ~17 days: brands step budgets up and down, which is exactly the spend
  // variation the curve fitter needs. Without it every channel looks like a flat ratio.
  const regimeFor = (campaignIdx: number, day: Day): number => {
    const bucket = Math.floor(dayOrdinal(day) / 17);
    return new Rng("regime", campaignIdx, bucket).float(0.55, 1.65);
  };

  const adRows: AdMetricRecord[] = [];
  // productId -> day -> attributed revenue, for the organic halo and sales roll-up.
  const attributedByProductDay = new Map<string, Map<Day, { revenue: number; units: number; ntb: number }>>();

  campaigns.forEach((campaign, ci) => {
    for (const day of days) {
      if (campaign.record.status !== "enabled") continue;

      const events = eventsOn(day, profile.id);
      const inEvent = events.length > 0;
      const demand =
        baseSeasonality(day, profile.kind) * eventDemandLift(day, profile.id);

      const dayRng = new Rng("day", ctx.platformAccountId, campaign.record.externalId, day);

      // Spend: base × regime × event push × noise.
      const eventSpendPush = inEvent ? dayRng.float(1.4, 2.4) : 1;
      const spend = Math.round(
        campaign.baseSpendPaise * regimeFor(ci, day) * eventSpendPush * dayRng.jitter(0.22),
      );
      if (spend <= 0) continue;

      // Revenue from the hidden curve, scaled by demand. Demand shifts the whole curve,
      // which is why naive ROAS reads as "media got better" during a sale event.
      const revenue = Math.round(
        evalTrueCurve(campaign.curve, spend) * demand * dayRng.jitter(0.18),
      );

      // Auction heats up in events: CPC inflates, so clicks don't scale 1:1 with spend.
      const cpc = Math.round(campaign.cpcPaise * (inEvent ? dayRng.float(1.15, 1.6) : dayRng.jitter(0.1)));
      const clicks = Math.max(0, Math.round(spend / Math.max(1, cpc)));
      const ctr = campaign.ctr * dayRng.jitter(0.12);
      const impressions = Math.round(clicks / Math.max(0.0005, ctr));

      const aov = Math.round(campaign.aovPaise * (inEvent ? dayRng.float(0.78, 0.95) : dayRng.jitter(0.08)));
      const orders = Math.max(0, Math.round(revenue / Math.max(1, aov)));
      const unitsPerOrder = dayRng.float(...profile.unitsPerOrder);
      const units = Math.max(orders, Math.round(orders * unitsPerOrder));

      // Events pull in more new customers but at worse economics.
      const ntb = campaign.ntbRate * (inEvent ? dayRng.float(1.05, 1.35) : dayRng.jitter(0.1));
      const newCustomerOrders = Math.round(orders * Math.min(0.95, ntb));
      const returnRate = dayRng.float(...profile.returnRate) * (inEvent ? 1.25 : 1);
      const returnedUnits = Math.round(units * Math.min(0.6, returnRate));

      // Split the campaign's day across its target SKUs and assets.
      const skuWeights = campaign.targets.map((_, i) =>
        new Rng("skuw", campaign.record.externalId, i).float(0.5, 1.5),
      );
      const skuShares = normalise(skuWeights);
      const assets = campaign.record.assets ?? [];
      const assetShares = normalise(campaign.assetWeights);

      campaign.targets.forEach((target, si) => {
        const sShare = skuShares[si];
        const assetCount = Math.max(1, assets.length);
        for (let ai = 0; ai < assetCount; ai++) {
          const aShare = assets.length > 0 ? assetShares[ai] : 1;
          const share = sShare * aShare;
          if (share <= 0) continue;

          const row: AdMetricRecord = {
            day,
            campaignExternalId: campaign.record.externalId,
            assetExternalId: assets[ai]?.externalId,
            externalSku: target.externalSku,
            impressions: Math.round(impressions * share),
            clicks: Math.round(clicks * share),
            spendPaise: Math.round(spend * share),
            orders: Math.round(orders * share),
            units: Math.round(units * share),
            revenuePaise: Math.round(revenue * share),
            newCustomerOrders: Math.round(newCustomerOrders * share),
            newCustomerRevenuePaise: Math.round(revenue * share * ntb * 0.95),
            returnedUnits: Math.round(returnedUnits * share),
          };
          if (row.spendPaise <= 0 && row.impressions <= 0) continue;
          adRows.push(row);

          const byDay =
            attributedByProductDay.get(target.productId) ??
            new Map<Day, { revenue: number; units: number; ntb: number }>();
          const acc = byDay.get(day) ?? { revenue: 0, units: 0, ntb: 0 };
          acc.revenue += row.revenuePaise;
          acc.units += row.units;
          acc.ntb += row.newCustomerOrders;
          byDay.set(day, acc);
          attributedByProductDay.set(target.productId, byDay);
        }
      });
    }
  });
  payload.adMetrics = adRows;

  /* --------------------------------------------------- promotions & sales */

  const promotions = buildPromotions(ctx, profile, range, rng);

  // Which promo (if any) applies to a product on a day. Event promos beat everyday ones.
  const promoIndex = new Map<string, PromotionRecord[]>();
  for (const promo of promotions) {
    for (const sku of promo.externalSkus) {
      const list = promoIndex.get(sku) ?? [];
      list.push(promo);
      promoIndex.set(sku, list);
    }
  }

  const salesRows: SalesRecord[] = [];
  const promoMetrics = new Map<string, PromotionMetricRecord[]>();

  for (const target of ctx.skuMap) {
    const listPrice = target.sellingPricePaise ?? 79900;
    const byDay = attributedByProductDay.get(target.productId);

    for (const day of days) {
      const dayRng = new Rng("sales", ctx.platformAccountId, target.externalSku, day);
      const attributed = byDay?.get(day);
      const demand = baseSeasonality(day, profile.kind) * eventDemandLift(day, profile.id);

      // Organic: a halo on ad-driven demand plus a baseline that exists regardless.
      const halo = attributed
        ? attributed.revenue * dayRng.float(...profile.organicMultiple)
        : 0;
      const baseline = Math.round(
        listPrice * dayRng.float(0.4, 2.2) * demand * dayRng.jitter(0.3),
      );
      const grossRevenue = Math.round((attributed?.revenue ?? 0) + halo + baseline);
      if (grossRevenue <= 0) continue;

      const units = Math.max(1, Math.round(grossRevenue / listPrice));
      const returnRate = dayRng.float(...profile.returnRate);
      const returnedUnits = Math.round(units * returnRate);

      // Discounting: strongest applicable promo wins.
      const applicable = (promoIndex.get(target.externalSku) ?? []).filter(
        (p) => day >= p.startDay && day <= p.endDay,
      );
      const promo =
        applicable.sort((a, b) => b.discountRate - a.discountRate)[0] ?? undefined;
      const discountRate = promo?.discountRate ?? 0;
      const discount = Math.round(grossRevenue * discountRate);
      const [brandFunded, platformFunded] = splitPaise(
        discount,
        promo?.brandFundedShare ?? 1,
      );

      const newCustomers = Math.max(
        attributed?.ntb ?? 0,
        Math.round(units * dayRng.float(0.12, 0.4)),
      );

      salesRows.push({
        day,
        externalSku: target.externalSku,
        units,
        grossRevenuePaise: grossRevenue,
        discountPaise: discount,
        returnedUnits,
        newCustomers,
      });

      if (promo && discount > 0) {
        const list = promoMetrics.get(promo.externalId) ?? [];
        list.push({
          day,
          externalSku: target.externalSku,
          units,
          grossRevenuePaise: grossRevenue,
          discountPaise: discount,
          brandFundedDiscountPaise: brandFunded,
          platformFundedDiscountPaise: platformFunded,
          newCustomers,
        });
        promoMetrics.set(promo.externalId, list);
      }
    }
  }

  payload.sales = salesRows;
  payload.promotions = promotions.map((p) => ({
    ...p,
    metrics: promoMetrics.get(p.externalId) ?? [],
  }));

  /* ------------------------------------------------------------ brand fund */

  payload.brandFund = buildBrandFund(profile, range, salesRows, adRows, campaigns);

  if (profile.integration !== "api") {
    payload.warnings.push(
      `${profile.name}: ${profile.integrationNote}`,
    );
  }
  payload.warnings.push(
    `Generated ${adRows.length} ad rows and ${salesRows.length} sales rows in SANDBOX mode. Figures are synthetic.`,
  );

  return payload;
}

/* ---------------------------------------------------------------- helpers */

function defaultDailyBudget(
  profile: PlatformProfile,
  skuCount: number,
  rng: Rng,
): number {
  // Roughly ₹1.5k–₹6k per SKU per day, scaled by how ad-heavy the platform is.
  const perSku = rng.float(150000, 600000);
  const platformWeight = profile.kind === "quick_commerce" ? 0.7 : 1;
  return Math.round(perSku * Math.min(skuCount, 12) * platformWeight);
}

function buildCampaigns(
  ctx: ConnectorContext,
  profile: PlatformProfile,
  dailyBudget: number,
  perAdType: number,
  rng: Rng,
): SandboxCampaign[] {
  const out: SandboxCampaign[] = [];

  for (const adTypeProfile of profile.adTypes) {
    for (let n = 0; n < perAdType; n++) {
      const externalId = `${profile.id.toUpperCase()}-${adTypeProfile.adType.toUpperCase()}-${n + 1}`;
      const cRng = new Rng("campaign", ctx.platformAccountId, externalId);

      const targets = cRng.sample(
        ctx.skuMap,
        Math.min(ctx.skuMap.length, cRng.int(2, 5)),
      );
      const baseSpend = Math.round(
        (dailyBudget * adTypeProfile.budgetShare) / perAdType,
      );
      const reportedRoas = cRng.float(...adTypeProfile.reportedRoas);
      const marginalRatio = cRng.float(...adTypeProfile.marginalRatio);

      const avgPrice =
        targets.reduce((s, t) => s + (t.sellingPricePaise ?? 79900), 0) /
        Math.max(1, targets.length);

      const assets: AdAssetRecord[] = adTypeProfile.assetTypes.flatMap((assetType, i) =>
        Array.from({ length: assetType === "keyword_cluster" ? 2 : 1 }, (_, j) => ({
          externalId: `${externalId}-A${i}${j}`,
          name: assetName(assetType, j, profile.name),
          assetType,
          spec: assetSpec(assetType, cRng),
          status: "enabled" as const,
        })),
      );

      out.push({
        record: {
          externalId,
          name: campaignName(profile, adTypeProfile, n),
          adType: adTypeProfile.adType,
          objective:
            adTypeProfile.ntbRate[0] > 0.45
              ? "acquisition"
              : adTypeProfile.adType === "sponsored_product"
                ? "sales"
                : "awareness",
          fundingSource: adTypeProfile.fundingSource ?? "brand_cash",
          dailyBudgetPaise: Math.round(baseSpend * 1.3),
          bidStrategy: cRng.pick(["dynamic_down", "dynamic_up_down", "fixed"]),
          status: cRng.bool(0.92) ? "enabled" : "paused",
          assets,
        },
        profile: adTypeProfile,
        curve: makeTrueCurve(adTypeProfile.curve, baseSpend, reportedRoas, marginalRatio),
        baseSpendPaise: baseSpend,
        cpcPaise: Math.round(cRng.float(...adTypeProfile.cpcPaise)),
        ctr: cRng.float(...adTypeProfile.ctr),
        ntbRate: cRng.float(...adTypeProfile.ntbRate),
        aovPaise: Math.round(avgPrice * cRng.float(1.0, 1.6)),
        targets,
        assetWeights: assets.map((_, i) => new Rng("aw", externalId, i).float(0.4, 1.6)),
      });
    }
  }

  return out;
}

/**
 * Build a concave curve pinned to (baseSpend → baseSpend×roas) with a chosen
 * marginal/average ratio at that point.
 *
 *   power: R = a·S^b. marginal/average = b, so b IS the ratio.
 *   hill:  R = V·S/(k+S) with k = m·base. marginal/average = m/(m+1) at S=base,
 *          so m = ratio/(1-ratio), and V = roas·base·(m+1).
 */
function makeTrueCurve(
  kind: "hill" | "power",
  baseSpend: number,
  roas: number,
  marginalRatio: number,
): TrueCurve {
  const ratio = Math.min(0.95, Math.max(0.15, marginalRatio));
  if (kind === "power") {
    const b = ratio;
    const a = (roas * baseSpend) / Math.pow(baseSpend, b);
    return { kind: "power", a, b };
  }
  const m = ratio / (1 - ratio);
  const k = m * baseSpend;
  const v = roas * baseSpend * (m + 1);
  return { kind: "hill", a: v, b: k };
}

function evalTrueCurve(curve: TrueCurve, spend: number): number {
  if (spend <= 0) return 0;
  return curve.kind === "hill"
    ? (curve.a * spend) / (curve.b + spend)
    : curve.a * Math.pow(spend, curve.b);
}

function buildPromotions(
  ctx: ConnectorContext,
  profile: PlatformProfile,
  range: DateRange,
  rng: Rng,
): PromotionRecord[] {
  const out: PromotionRecord[] = [];
  const allSkus = ctx.skuMap.map((s) => s.externalSku);

  // Everyday price-off: fully brand funded, always on. This is the discount brands forget
  // to count as marketing spend, and it is often larger than the ad budget.
  out.push({
    externalId: `${profile.id.toUpperCase()}-EVERYDAY`,
    name: `${profile.name} everyday price off`,
    promoType: "price_off",
    startDay: range.from,
    endDay: range.to,
    discountRate: rng.float(...profile.everydayDiscountRate),
    brandFundedShare: 1,
    participationFeePaise: 0,
    status: "live",
    externalSkus: allSkus,
  });

  // Sale events that overlap the window.
  const seen = new Set<string>();
  for (const day of dayRange(range.from, range.to)) {
    for (const event of eventsOn(day, profile.id)) {
      if (seen.has(event.name)) continue;
      seen.add(event.name);
      const eRng = new Rng("promo", ctx.platformAccountId, event.name);
      const skus = eRng.sample(allSkus, Math.max(1, Math.ceil(allSkus.length * eRng.float(0.5, 1))));
      const year = day.slice(0, 4);
      out.push({
        externalId: `${profile.id.toUpperCase()}-${event.name.replace(/[^A-Z0-9]+/gi, "-").toUpperCase()}`,
        name: `${event.name} ${year}`,
        promoType: event.promoType,
        startDay: clampDay(`${year}-${event.from}`, range),
        endDay: clampDay(`${year}-${event.to}`, range),
        discountRate: event.discountRate * eRng.jitter(0.08),
        brandFundedShare: Math.min(1, event.brandFundedShare * eRng.jitter(0.06)),
        // Visibility slots in Indian sale events carry a fixed fee on top of the discount.
        participationFeePaise: Math.round(eRng.float(50000, 900000)),
        status: "ended",
        externalSkus: skus,
      });
    }
  }

  return out;
}

function buildBrandFund(
  profile: PlatformProfile,
  range: DateRange,
  sales: SalesRecord[],
  adRows: AdMetricRecord[],
  campaigns: SandboxCampaign[],
): BrandFundRecord[] {
  if (profile.brandFundAccrualRate <= 0) return [];

  const byMonth = new Map<string, number>();
  for (const s of sales) {
    const month = s.day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + s.grossRevenuePaise);
  }
  const monthlyRevenue = [...byMonth].sort();
  const averageMonthly =
    monthlyRevenue.reduce((s, [, v]) => s + v, 0) / Math.max(1, monthlyRevenue.length);

  // Accruals: an opening balance carried in from before the window, then a monthly credit
  // on the prior month's sales. Without the opening balance every account looks massively
  // over-drawn at the start of the window purely because history was truncated.
  const accruals: BrandFundRecord[] = [
    {
      day: range.from,
      entryType: "accrual",
      amountPaise: Math.round(averageMonthly * profile.brandFundAccrualRate * 2),
      reference: "accrual:opening",
      note: "Opening co-op balance carried forward",
      expiresOn: addDays(range.from, 120),
    },
  ];
  for (const [month, revenue] of monthlyRevenue) {
    const creditDay = `${addDays(`${month}-01`, 31).slice(0, 7)}-01`;
    if (creditDay > range.to) continue;
    accruals.push({
      day: creditDay,
      entryType: "accrual",
      amountPaise: Math.round(revenue * profile.brandFundAccrualRate),
      reference: `accrual:${month}`,
      note: `${(profile.brandFundAccrualRate * 100).toFixed(1)}% co-op accrual on ${month} sales`,
      expiresOn: addDays(creditDay, 183),
    });
  }

  // Drawdown: spend on campaigns marked brand_fund is charged against the fund — but only
  // up to the balance available on the day. A platform will not let a brand overdraw its
  // co-op account, so neither will the sandbox; the excess is simply cash spend.
  const fundCampaigns = new Set(
    campaigns
      .filter((c) => c.record.fundingSource === "brand_fund")
      .map((c) => c.record.externalId),
  );
  const drawByDay = new Map<Day, number>();
  for (const row of adRows) {
    if (!fundCampaigns.has(row.campaignExternalId)) continue;
    drawByDay.set(row.day, (drawByDay.get(row.day) ?? 0) + row.spendPaise);
  }

  const accrualByDay = new Map<Day, number>();
  for (const a of accruals) {
    accrualByDay.set(a.day, (accrualByDay.get(a.day) ?? 0) + a.amountPaise);
  }

  const out: BrandFundRecord[] = [...accruals];
  let balance = 0;
  for (const day of dayRange(range.from, range.to)) {
    balance += accrualByDay.get(day) ?? 0;
    const wanted = drawByDay.get(day) ?? 0;
    const drawn = Math.min(wanted, balance);
    if (drawn <= 0) continue;
    balance -= drawn;
    out.push({
      day,
      entryType: "utilization",
      amountPaise: -drawn,
      reference: "coop-media",
      note:
        drawn < wanted
          ? "Co-op funded media drawdown (capped at available balance)"
          : "Co-op funded media drawdown",
    });
  }

  return out.sort((a, b) => a.day.localeCompare(b.day));
}

function campaignName(
  profile: PlatformProfile,
  adType: AdTypeProfile,
  n: number,
): string {
  const label = adType.adType
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return `${profile.name} | ${label} ${n + 1}`;
}

function assetName(assetType: string, j: number, platform: string): string {
  switch (assetType) {
    case "keyword_cluster":
      return j === 0 ? "Brand + category keywords" : "Competitor conquesting";
    case "video":
      return "15s hero video";
    case "carousel":
      return "3-frame benefit carousel";
    case "coupon":
      return `${platform} coupon boost`;
    case "audience":
      return "Lookalike + retargeting";
    default:
      return "Static hero creative";
  }
}

function assetSpec(assetType: string, rng: Rng): Record<string, unknown> {
  switch (assetType) {
    case "video":
      return { durationSeconds: rng.pick([6, 15, 21, 30]), aspectRatio: "9:16" };
    case "carousel":
      return { frames: rng.int(3, 5), aspectRatio: "1:1" };
    case "keyword_cluster":
      return { matchType: rng.pick(["broad", "phrase", "exact"]), keywords: rng.int(18, 120) };
    case "audience":
      return { audience: rng.pick(["lookalike_1pct", "cart_abandoners", "category_browsers"]) };
    case "coupon":
      return { couponPct: rng.pick([5, 10, 15]) };
    default:
      return { aspectRatio: rng.pick(["1:1", "4:5", "16:9"]) };
  }
}

function normalise(weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => 0);
  return weights.map((w) => w / total);
}

function clampDay(day: Day, range: DateRange): Day {
  if (day < range.from) return range.from;
  if (day > range.to) return range.to;
  return day;
}

function dayOrdinal(day: Day): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
}
