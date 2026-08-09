/**
 * Per-platform behavioural profiles for the sandbox.
 *
 * The numbers here are the sandbox's opinion of how each platform behaves — CPC levels, ad
 * formats, commission bands, return rates, how much organic sales an ad rupee drags along.
 * They are calibrated to be *plausible* for Indian D2C, not authoritative: they exist so
 * the product can be built and demoed before API access lands, and every one of them is
 * overwritten by real data the moment a live connector is configured.
 *
 * Sources of the shape (not exact values): public rate cards, seller-fee schedules and
 * commonly reported category benchmarks. Treat as synthetic.
 */

import type { AdType } from "@/db/schema";

export interface AdTypeProfile {
  adType: AdType;
  /** Share of the account's ad budget this format usually takes. */
  budgetShare: number;
  /** Cost per click band, paise. */
  cpcPaise: [number, number];
  ctr: [number, number];
  /** New-to-brand share of orders this format delivers. */
  ntbRate: [number, number];
  /** Average ROAS this format tends to report at its usual spend level. */
  reportedRoas: [number, number];
  /**
   * Marginal-to-average return ratio at the usual spend level. Low = already saturated,
   * high = headroom. This is what makes reallocation worth doing.
   */
  marginalRatio: [number, number];
  /** Response-curve family the sandbox generates from. */
  curve: "hill" | "power";
  assetTypes: Array<
    "static_image" | "video" | "carousel" | "keyword_cluster" | "audience" | "coupon"
  >;
  fundingSource?: "brand_cash" | "brand_fund" | "platform_coop";
}

export interface PlatformProfile {
  id: string;
  name: string;
  kind: "marketplace" | "quick_commerce" | "d2c";
  integration: "api" | "api_sandbox_only" | "report_file" | "none";
  attributionWindowDays: number;
  takeRate: number;
  fulfilmentFeePaise: number;
  paymentFeeRate: number;
  /** Share of sales accrued into the co-op/brand marketing fund. */
  brandFundAccrualRate: number;
  /** Organic revenue per rupee of ad-attributed revenue. Halo, not attribution. */
  organicMultiple: [number, number];
  returnRate: [number, number];
  /** Everyday (non-event) discount the brand funds itself. */
  everydayDiscountRate: [number, number];
  /** Units per order. Quick commerce baskets are bigger, apparel is ~1. */
  unitsPerOrder: [number, number];
  adTypes: AdTypeProfile[];
  /** Shown in Settings so the brand knows what it's looking at. */
  integrationNote: string;
}

export const PLATFORM_PROFILES: PlatformProfile[] = [
  {
    id: "amazon",
    name: "Amazon India",
    kind: "marketplace",
    integration: "api_sandbox_only",
    attributionWindowDays: 14,
    takeRate: 0.17,
    fulfilmentFeePaise: 7900,
    paymentFeeRate: 0.02,
    brandFundAccrualRate: 0.0,
    organicMultiple: [1.4, 2.6],
    returnRate: [0.06, 0.13],
    everydayDiscountRate: [0.03, 0.08],
    unitsPerOrder: [1.1, 1.5],
    integrationNote:
      "Amazon Ads has a public API with a vendor sandbox (advertising-api-test.amazon.com). Reporting is v3 async: request a report, poll, download a gzipped JSON. Sandbox returns structural responses, not real numbers.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.55,
        cpcPaise: [900, 2200],
        ctr: [0.003, 0.008],
        ntbRate: [0.28, 0.42],
        reportedRoas: [3.4, 6.2],
        marginalRatio: [0.4, 0.62],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "sponsored_brand",
        budgetShare: 0.22,
        cpcPaise: [1400, 3400],
        ctr: [0.004, 0.011],
        ntbRate: [0.45, 0.62],
        reportedRoas: [2.2, 4.1],
        marginalRatio: [0.55, 0.82],
        curve: "power",
        assetTypes: ["static_image", "video"],
      },
      {
        adType: "sponsored_display",
        budgetShare: 0.16,
        cpcPaise: [500, 1300],
        ctr: [0.0015, 0.005],
        ntbRate: [0.5, 0.68],
        reportedRoas: [1.6, 3.2],
        marginalRatio: [0.6, 0.88],
        curve: "power",
        assetTypes: ["static_image", "audience"],
      },
      {
        adType: "coupon_boost",
        budgetShare: 0.07,
        cpcPaise: [300, 800],
        ctr: [0.006, 0.014],
        ntbRate: [0.34, 0.5],
        reportedRoas: [2.8, 5.0],
        marginalRatio: [0.3, 0.5],
        curve: "hill",
        assetTypes: ["coupon"],
      },
    ],
  },
  {
    id: "flipkart",
    name: "Flipkart",
    kind: "marketplace",
    integration: "api_sandbox_only",
    attributionWindowDays: 7,
    takeRate: 0.19,
    fulfilmentFeePaise: 7200,
    paymentFeeRate: 0.022,
    brandFundAccrualRate: 0.02,
    organicMultiple: [1.2, 2.2],
    returnRate: [0.09, 0.18],
    everydayDiscountRate: [0.05, 0.12],
    unitsPerOrder: [1.05, 1.4],
    integrationNote:
      "Flipkart Seller/Ads APIs are partner-gated with a sandbox host (sandbox-api.flipkart.net) and OAuth client-credentials. PLA reporting is available to approved sellers; treat sandbox figures as structural only.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.52,
        cpcPaise: [700, 1800],
        ctr: [0.004, 0.009],
        ntbRate: [0.25, 0.4],
        reportedRoas: [3.0, 5.6],
        marginalRatio: [0.35, 0.58],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "search_banner",
        budgetShare: 0.2,
        cpcPaise: [1100, 2600],
        ctr: [0.005, 0.012],
        ntbRate: [0.4, 0.55],
        reportedRoas: [2.0, 3.8],
        marginalRatio: [0.5, 0.78],
        curve: "power",
        assetTypes: ["static_image", "carousel"],
      },
      {
        adType: "sponsored_display",
        budgetShare: 0.18,
        cpcPaise: [400, 1100],
        ctr: [0.0018, 0.0055],
        ntbRate: [0.48, 0.66],
        reportedRoas: [1.4, 2.9],
        marginalRatio: [0.62, 0.9],
        curve: "power",
        assetTypes: ["static_image", "audience"],
      },
      {
        adType: "video",
        budgetShare: 0.1,
        cpcPaise: [600, 1500],
        ctr: [0.002, 0.006],
        ntbRate: [0.55, 0.72],
        reportedRoas: [1.1, 2.4],
        marginalRatio: [0.7, 0.95],
        curve: "power",
        assetTypes: ["video"],
        fundingSource: "brand_fund",
      },
    ],
  },
  {
    id: "myntra",
    name: "Myntra",
    kind: "marketplace",
    integration: "report_file",
    attributionWindowDays: 7,
    takeRate: 0.26,
    fulfilmentFeePaise: 9500,
    paymentFeeRate: 0.02,
    brandFundAccrualRate: 0.02,
    organicMultiple: [1.6, 3.2],
    // Myntra's headline return rates are apparel-driven; a beauty/personal-care catalogue
    // there returns far less, though still more than a grocery platform.
    returnRate: [0.08, 0.16],
    everydayDiscountRate: [0.1, 0.22],
    unitsPerOrder: [1.2, 1.9],
    integrationNote:
      "No public self-serve ads API. Myntra PPMP/partner reporting is delivered as scheduled report files; the brand's team drops the weekly export and we parse it. CSV importer at /settings/imports.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.42,
        cpcPaise: [800, 2000],
        ctr: [0.005, 0.012],
        ntbRate: [0.2, 0.34],
        reportedRoas: [3.6, 7.0],
        marginalRatio: [0.32, 0.55],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "category_listing",
        budgetShare: 0.28,
        cpcPaise: [500, 1400],
        ctr: [0.003, 0.009],
        ntbRate: [0.3, 0.46],
        reportedRoas: [2.4, 4.4],
        marginalRatio: [0.45, 0.7],
        curve: "hill",
        assetTypes: ["static_image", "carousel"],
      },
      {
        adType: "homepage_banner",
        budgetShare: 0.2,
        cpcPaise: [1800, 4200],
        ctr: [0.006, 0.016],
        ntbRate: [0.42, 0.6],
        reportedRoas: [1.3, 2.8],
        marginalRatio: [0.55, 0.85],
        curve: "power",
        assetTypes: ["static_image", "video"],
        fundingSource: "brand_fund",
      },
      {
        adType: "influencer",
        budgetShare: 0.1,
        cpcPaise: [1200, 3000],
        ctr: [0.008, 0.02],
        ntbRate: [0.6, 0.78],
        reportedRoas: [0.9, 2.2],
        marginalRatio: [0.75, 0.98],
        curve: "power",
        assetTypes: ["video", "carousel"],
      },
    ],
  },
  {
    id: "nykaa",
    name: "Nykaa",
    kind: "marketplace",
    integration: "report_file",
    attributionWindowDays: 7,
    takeRate: 0.28,
    fulfilmentFeePaise: 6800,
    paymentFeeRate: 0.021,
    brandFundAccrualRate: 0.03,
    organicMultiple: [1.3, 2.4],
    returnRate: [0.05, 0.11],
    everydayDiscountRate: [0.06, 0.15],
    unitsPerOrder: [1.4, 2.4],
    integrationNote:
      "Nykaa ads are bought through the brand's category manager / Nykaa Ads console. No public API — ingestion is via the monthly performance deck export (CSV) plus the co-op fund statement.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.4,
        cpcPaise: [1100, 2600],
        ctr: [0.006, 0.014],
        ntbRate: [0.3, 0.45],
        reportedRoas: [3.2, 6.4],
        marginalRatio: [0.38, 0.6],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "category_listing",
        budgetShare: 0.24,
        cpcPaise: [700, 1900],
        ctr: [0.004, 0.011],
        ntbRate: [0.35, 0.5],
        reportedRoas: [2.6, 4.8],
        marginalRatio: [0.48, 0.72],
        curve: "hill",
        assetTypes: ["static_image", "carousel"],
      },
      {
        adType: "homepage_banner",
        budgetShare: 0.22,
        cpcPaise: [2000, 4600],
        ctr: [0.007, 0.018],
        ntbRate: [0.5, 0.68],
        reportedRoas: [1.2, 2.6],
        marginalRatio: [0.6, 0.9],
        curve: "power",
        assetTypes: ["static_image", "video"],
        fundingSource: "brand_fund",
      },
      {
        adType: "influencer",
        budgetShare: 0.14,
        cpcPaise: [900, 2400],
        ctr: [0.01, 0.024],
        ntbRate: [0.65, 0.82],
        reportedRoas: [1.0, 2.5],
        marginalRatio: [0.78, 0.99],
        curve: "power",
        assetTypes: ["video"],
      },
    ],
  },
  {
    id: "bigbasket",
    name: "BigBasket",
    kind: "quick_commerce",
    integration: "report_file",
    attributionWindowDays: 3,
    takeRate: 0.22,
    fulfilmentFeePaise: 2800,
    paymentFeeRate: 0.018,
    brandFundAccrualRate: 0.025,
    organicMultiple: [2.0, 3.8],
    returnRate: [0.01, 0.04],
    everydayDiscountRate: [0.05, 0.14],
    unitsPerOrder: [1.8, 3.2],
    integrationNote:
      "BigBasket brand ads are managed via the BB Brand Console with weekly XLSX reporting. No public API. Attribution is short (1–3 day) so cross-platform reported-ROAS comparisons are misleading.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.44,
        cpcPaise: [400, 1200],
        ctr: [0.008, 0.02],
        ntbRate: [0.18, 0.32],
        reportedRoas: [4.0, 8.0],
        marginalRatio: [0.3, 0.5],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "category_listing",
        budgetShare: 0.26,
        cpcPaise: [300, 900],
        ctr: [0.006, 0.016],
        ntbRate: [0.22, 0.36],
        reportedRoas: [3.2, 6.0],
        marginalRatio: [0.4, 0.62],
        curve: "hill",
        assetTypes: ["static_image"],
      },
      {
        adType: "homepage_banner",
        budgetShare: 0.2,
        cpcPaise: [900, 2400],
        ctr: [0.01, 0.026],
        ntbRate: [0.38, 0.55],
        reportedRoas: [1.8, 3.6],
        marginalRatio: [0.55, 0.82],
        curve: "power",
        assetTypes: ["static_image", "carousel"],
        fundingSource: "brand_fund",
      },
      {
        adType: "coupon_boost",
        budgetShare: 0.1,
        cpcPaise: [200, 700],
        ctr: [0.012, 0.03],
        ntbRate: [0.3, 0.46],
        reportedRoas: [2.6, 5.2],
        marginalRatio: [0.35, 0.58],
        curve: "hill",
        assetTypes: ["coupon"],
      },
    ],
  },
  {
    id: "blinkit",
    name: "Blinkit",
    kind: "quick_commerce",
    integration: "report_file",
    attributionWindowDays: 1,
    takeRate: 0.24,
    fulfilmentFeePaise: 2200,
    paymentFeeRate: 0.017,
    brandFundAccrualRate: 0.02,
    organicMultiple: [1.8, 3.4],
    returnRate: [0.005, 0.03],
    everydayDiscountRate: [0.04, 0.12],
    unitsPerOrder: [1.6, 2.8],
    integrationNote:
      "Blinkit Brand Central provides self-serve ad buying with dashboard exports; no public API today. 1-day attribution and dark-store level inventory mean ROAS swings hard on availability, not media.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.5,
        cpcPaise: [500, 1500],
        ctr: [0.009, 0.024],
        ntbRate: [0.2, 0.34],
        reportedRoas: [3.6, 7.2],
        marginalRatio: [0.28, 0.48],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "search_banner",
        budgetShare: 0.22,
        cpcPaise: [700, 1900],
        ctr: [0.011, 0.028],
        ntbRate: [0.3, 0.44],
        reportedRoas: [2.4, 4.8],
        marginalRatio: [0.45, 0.7],
        curve: "hill",
        assetTypes: ["static_image"],
      },
      {
        adType: "homepage_banner",
        budgetShare: 0.18,
        cpcPaise: [1200, 3200],
        ctr: [0.013, 0.032],
        ntbRate: [0.42, 0.6],
        reportedRoas: [1.5, 3.2],
        marginalRatio: [0.58, 0.88],
        curve: "power",
        assetTypes: ["static_image", "carousel"],
        fundingSource: "brand_fund",
      },
      {
        adType: "coupon_boost",
        budgetShare: 0.1,
        cpcPaise: [250, 800],
        ctr: [0.015, 0.036],
        ntbRate: [0.34, 0.5],
        reportedRoas: [2.2, 4.6],
        marginalRatio: [0.33, 0.55],
        curve: "hill",
        assetTypes: ["coupon"],
      },
    ],
  },
  {
    id: "zepto",
    name: "Zepto",
    kind: "quick_commerce",
    integration: "report_file",
    attributionWindowDays: 1,
    takeRate: 0.25,
    fulfilmentFeePaise: 2000,
    paymentFeeRate: 0.017,
    brandFundAccrualRate: 0.018,
    organicMultiple: [1.5, 3.0],
    returnRate: [0.005, 0.03],
    everydayDiscountRate: [0.05, 0.16],
    unitsPerOrder: [1.5, 2.6],
    integrationNote:
      "Zepto Atom is the brand-facing analytics/ads surface; access is account-managed with CSV exports and no public API. Same 1-day attribution caveat as Blinkit.",
    adTypes: [
      {
        adType: "sponsored_product",
        budgetShare: 0.48,
        cpcPaise: [450, 1400],
        ctr: [0.01, 0.026],
        ntbRate: [0.22, 0.38],
        reportedRoas: [3.2, 6.6],
        marginalRatio: [0.3, 0.52],
        curve: "hill",
        assetTypes: ["keyword_cluster"],
      },
      {
        adType: "search_banner",
        budgetShare: 0.24,
        cpcPaise: [650, 1800],
        ctr: [0.012, 0.03],
        ntbRate: [0.32, 0.46],
        reportedRoas: [2.2, 4.4],
        marginalRatio: [0.5, 0.76],
        curve: "hill",
        assetTypes: ["static_image"],
      },
      {
        adType: "homepage_banner",
        budgetShare: 0.18,
        cpcPaise: [1100, 3000],
        ctr: [0.014, 0.034],
        ntbRate: [0.44, 0.62],
        reportedRoas: [1.4, 3.0],
        marginalRatio: [0.62, 0.92],
        curve: "power",
        assetTypes: ["static_image", "carousel"],
      },
      {
        adType: "coupon_boost",
        budgetShare: 0.1,
        cpcPaise: [220, 750],
        ctr: [0.016, 0.038],
        ntbRate: [0.36, 0.52],
        reportedRoas: [2.0, 4.2],
        marginalRatio: [0.34, 0.56],
        curve: "hill",
        assetTypes: ["coupon"],
      },
    ],
  },
];

export function profileFor(platformId: string): PlatformProfile {
  const p = PLATFORM_PROFILES.find((x) => x.id === platformId);
  if (!p) throw new Error(`No sandbox profile for platform "${platformId}"`);
  return p;
}
