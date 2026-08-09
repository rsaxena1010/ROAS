/**
 * Connector contract.
 *
 * Every platform — Amazon's mature Ads API, Flipkart's partner API, Blinkit's weekly
 * spreadsheet — lands in the same normalised DTOs. Nothing downstream of `ingest.ts`
 * knows which platform a row came from beyond its `platformId`.
 *
 * Three modes:
 *   sandbox  deterministic synthetic data generated locally. No credentials, no network.
 *   live     real HTTP calls (pointed at the vendor sandbox host by default).
 *   file     parse a report the brand's team exported. The only option on platforms with
 *            no self-serve ads API today.
 */

import type { AdType, FundingSource, PromoType } from "@/db/schema";
import type { Day } from "@/lib/date";

export type ConnectorMode = "sandbox" | "live" | "file";

export interface DateRange {
  from: Day;
  to: Day;
}

export interface ConnectorContext {
  brandId: string;
  platformAccountId: string;
  platformId: string;
  externalAccountId: string;
  mode: ConnectorMode;
  /** Non-secret connector settings from platform_accounts.config. */
  config: Record<string, unknown>;
  /** Secrets, read from env by the registry — never persisted in the DB. */
  credentials: Record<string, string | undefined>;
  /** Brand catalogue, so connectors can map platform SKUs back to internal SKUs. */
  skuMap: SkuMapping[];
  logger?: (message: string) => void;
}

export interface SkuMapping {
  productId: string;
  /** The brand's internal SKU. */
  sku: string;
  /** ASIN / FSN / styleId as it appears on this platform. */
  externalSku: string;
  /** Listing price on this platform, paise. Lets the sandbox keep units/revenue coherent. */
  sellingPricePaise?: number;
  category?: string;
}

/* ------------------------------------------------------------------- DTOs */

export interface CampaignRecord {
  externalId: string;
  name: string;
  adType: AdType;
  objective?: "sales" | "acquisition" | "awareness" | "defence";
  fundingSource?: FundingSource;
  dailyBudgetPaise: number;
  bidStrategy?: string;
  status: "enabled" | "paused" | "archived";
  startDay?: Day;
  endDay?: Day;
  assets?: AdAssetRecord[];
}

export interface AdAssetRecord {
  externalId: string;
  name: string;
  assetType:
    | "static_image"
    | "video"
    | "carousel"
    | "keyword_cluster"
    | "audience"
    | "coupon";
  spec?: Record<string, unknown>;
  status: "enabled" | "paused" | "archived";
}

export interface AdMetricRecord {
  day: Day;
  campaignExternalId: string;
  assetExternalId?: string;
  /** Platform SKU; resolved to a productId during ingest. Absent = not SKU-attributed. */
  externalSku?: string;
  impressions: number;
  clicks: number;
  spendPaise: number;
  orders: number;
  units: number;
  revenuePaise: number;
  newCustomerOrders: number;
  newCustomerRevenuePaise: number;
  returnedUnits: number;
}

export interface SalesRecord {
  day: Day;
  externalSku: string;
  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  returnedUnits: number;
  newCustomers: number;
}

export interface PromotionRecord {
  externalId: string;
  name: string;
  promoType: PromoType;
  startDay: Day;
  endDay: Day;
  discountRate: number;
  discountFlatPaise?: number;
  brandFundedShare: number;
  participationFeePaise?: number;
  status: "planned" | "live" | "ended" | "cancelled";
  externalSkus: string[];
  metrics?: PromotionMetricRecord[];
}

export interface PromotionMetricRecord {
  day: Day;
  externalSku: string;
  units: number;
  grossRevenuePaise: number;
  discountPaise: number;
  brandFundedDiscountPaise: number;
  platformFundedDiscountPaise: number;
  newCustomers: number;
}

export interface BrandFundRecord {
  day: Day;
  entryType: "accrual" | "utilization" | "expiry" | "adjustment";
  /** Signed paise: accruals positive, draws negative. */
  amountPaise: number;
  reference?: string;
  note?: string;
  expiresOn?: Day;
}

export interface ConnectorPayload {
  campaigns: CampaignRecord[];
  adMetrics: AdMetricRecord[];
  sales: SalesRecord[];
  promotions: PromotionRecord[];
  brandFund: BrandFundRecord[];
  /** Non-fatal problems: partial days, unmapped SKUs, throttling. */
  warnings: string[];
}

export function emptyPayload(): ConnectorPayload {
  return {
    campaigns: [],
    adMetrics: [],
    sales: [],
    promotions: [],
    brandFund: [],
    warnings: [],
  };
}

/* -------------------------------------------------------------- capability */

export interface ConnectorCapabilities {
  /** Can we pull ad performance at all? */
  ads: boolean;
  /** Does the platform attribute ad revenue down to a SKU? */
  skuAttribution: boolean;
  /** Total (ad + organic) sales available? Needed for TACOS and blended ROAS. */
  totalSales: boolean;
  promotions: boolean;
  brandFund: boolean;
  /** New-to-brand reporting. Without it, CAC is estimated from a repeat-rate assumption. */
  newToBrand: boolean;
  attributionWindowDays: number;
  /** Modes this connector actually supports. */
  modes: ConnectorMode[];
  /** Honest note about the real-world integration status, shown in Settings. */
  note: string;
}

export interface Connector {
  platformId: string;
  displayName: string;
  capabilities: ConnectorCapabilities;
  fetch(ctx: ConnectorContext, range: DateRange): Promise<ConnectorPayload>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly platformId: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
