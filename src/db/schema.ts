/**
 * Schema notes
 * ------------
 * - All money is stored as INTEGER paise (1 INR = 100 paise). Never floats for money.
 *   Rates/ratios/percentages are REAL in the 0..1 range.
 * - Daily fact tables key on `day` as TEXT 'YYYY-MM-DD' (IST business day, see lib/date.ts).
 * - Timestamps are INTEGER epoch milliseconds.
 * - Written for SQLite so the whole thing runs with zero infra; every construct used here
 *   has a 1:1 Postgres equivalent (see docs/architecture.md for the port notes).
 */
import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now());

/* ------------------------------------------------------------------ tenancy */

export const brands = sqliteTable("brands", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Default blended target used when a plan does not override it. */
  targetRoas: real("target_roas").notNull().default(4),
  /** Target customer acquisition cost, in paise. */
  targetCacPaise: integer("target_cac_paise").notNull().default(30000),
  /** Contribution margin the brand needs to keep after all platform costs. */
  targetContributionMargin: real("target_contribution_margin")
    .notNull()
    .default(0.15),
  currency: text("currency").notNull().default("INR"),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  "users",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // scrypt: "<saltHex>:<hashHex>"
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "analyst", "viewer"] })
      .notNull()
      .default("owner"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/**
 * Extra brands a user may read.
 *
 * `users.brandId` is the home brand and always remains accessible; this table grants the
 * additional ones an agency or a house-of-brands operator needs in order to cut spend across
 * a portfolio. Modelled as a join table rather than a column so a portfolio can grow without
 * a migration, and kept read-only in intent: cross-brand views aggregate, they never write.
 *
 * With no rows here every user sees exactly their own brand, so the cross-brand cut degrades
 * to a single row rather than breaking.
 */
export const brandMembers = sqliteTable(
  "brand_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "analyst", "viewer"] })
      .notNull()
      .default("viewer"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("brand_members_pk").on(t.userId, t.brandId),
    index("brand_members_user_idx").on(t.userId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* --------------------------------------------------------------- platforms */

/**
 * One row per marketplace/quick-commerce platform. `takeRate` and the fee fields are
 * category-agnostic fallbacks; per-listing overrides on `listings` win when present.
 */
export const platforms = sqliteTable("platforms", {
  /** Stable slug: amazon | flipkart | myntra | nykaa | bigbasket | blinkit | zepto ... */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["marketplace", "quick_commerce", "d2c"] })
    .notNull()
    .default("marketplace"),
  /** Default commission / take rate as a fraction of selling price. */
  defaultTakeRate: real("default_take_rate").notNull().default(0.15),
  /** Typical fulfilment + shipping fee per unit, paise. */
  defaultFulfilmentFeePaise: integer("default_fulfilment_fee_paise")
    .notNull()
    .default(6500),
  /** Payment gateway / collection fee as a fraction of selling price. */
  defaultPaymentFeeRate: real("default_payment_fee_rate").notNull().default(0.02),
  /** Share of sales the platform accrues into a co-op marketing (brand) fund. */
  defaultBrandFundAccrualRate: real("default_brand_fund_accrual_rate")
    .notNull()
    .default(0),
  /** Whether we can pull ad reporting over an API today, and how. */
  integration: text("integration", {
    enum: ["api", "api_sandbox_only", "report_file", "none"],
  })
    .notNull()
    .default("report_file"),
  /** Attribution window the platform reports on, in days. Drives comparability warnings. */
  attributionWindowDays: integer("attribution_window_days").notNull().default(14),
  createdAt: createdAt(),
});

/** A brand's seller/vendor account on one platform. */
export const platformAccounts = sqliteTable(
  "platform_accounts",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformId: text("platform_id")
      .notNull()
      .references(() => platforms.id),
    /** Seller/vendor id on the platform (ASIN profile, Flipkart seller id, ...). */
    externalAccountId: text("external_account_id").notNull(),
    label: text("label").notNull(),
    mode: text("mode", { enum: ["sandbox", "live", "file"] })
      .notNull()
      .default("sandbox"),
    status: text("status", { enum: ["connected", "error", "disconnected"] })
      .notNull()
      .default("connected"),
    /** Opaque, connector-specific settings. Secrets live in env/secret store, not here. */
    config: text("config", { mode: "json" }).$type<Record<string, unknown>>(),
    lastSyncedAt: integer("last_synced_at"),
    lastSyncError: text("last_sync_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("platform_accounts_unique").on(
      t.brandId,
      t.platformId,
      t.externalAccountId,
    ),
    index("platform_accounts_brand_idx").on(t.brandId),
  ],
);

/* ----------------------------------------------------------------- catalog */

export const products = sqliteTable(
  "products",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The brand's own internal SKU code — the join key across platforms. */
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    mrpPaise: integer("mrp_paise").notNull(),
    /** Landed cost of goods per unit, paise. Drives contribution margin. */
    cogsPaise: integer("cogs_paise").notNull(),
    gstRate: real("gst_rate").notNull().default(0.18),
    /** Expected repeat purchases in the first year — used for LTV:CAC. */
    expectedRepeatPurchases: real("expected_repeat_purchases").notNull().default(1.6),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_brand_sku_unique").on(t.brandId, t.sku)],
);

/** One product listed on one platform. Holds the platform-specific price and fees. */
export const listings = sqliteTable(
  "listings",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    /** ASIN / FSN / styleId / product code on the platform. */
    externalSku: text("external_sku").notNull(),
    /** Pre-promotion listing price, paise. */
    sellingPricePaise: integer("selling_price_paise").notNull(),
    /** Overrides the platform default when set. */
    takeRate: real("take_rate"),
    fulfilmentFeePaise: integer("fulfilment_fee_paise"),
    paymentFeeRate: real("payment_fee_rate"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("listings_unique").on(t.platformAccountId, t.externalSku),
    index("listings_product_idx").on(t.productId),
  ],
);

/* --------------------------------------------------------------------- ads */

/**
 * Normalised ad type across platforms. The optimizer treats (platform, adType) as an
 * investment channel, so this vocabulary has to be stable.
 */
export const AD_TYPES = [
  "sponsored_product",
  "sponsored_brand",
  "sponsored_display",
  "search_banner",
  "homepage_banner",
  "category_listing",
  "video",
  "influencer",
  "coupon_boost",
] as const;
export type AdType = (typeof AD_TYPES)[number];

/**
 * Where the money comes from. This is the crux of "true" ROAS: co-op / brand-fund money
 * hits the same campaigns as cash, but it is not cash out of the brand's pocket at the
 * same rate, and platform-funded spend should not be charged to the brand at all.
 */
export const FUNDING_SOURCES = ["brand_cash", "brand_fund", "platform_coop"] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

export const campaigns = sqliteTable(
  "campaigns",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    adType: text("ad_type", { enum: AD_TYPES }).notNull(),
    objective: text("objective", {
      enum: ["sales", "acquisition", "awareness", "defence"],
    })
      .notNull()
      .default("sales"),
    fundingSource: text("funding_source", { enum: FUNDING_SOURCES })
      .notNull()
      .default("brand_cash"),
    dailyBudgetPaise: integer("daily_budget_paise").notNull().default(0),
    bidStrategy: text("bid_strategy"),
    status: text("status", { enum: ["enabled", "paused", "archived"] })
      .notNull()
      .default("enabled"),
    startDay: text("start_day"),
    endDay: text("end_day"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaigns_external_unique").on(t.platformAccountId, t.externalId),
    index("campaigns_brand_idx").on(t.brandId),
  ],
);

/**
 * A creative / targeting asset inside a campaign — the "asset" axis the brand can shift
 * money across (a 15s video vs a static banner vs a keyword cluster).
 */
export const adAssets = sqliteTable(
  "ad_assets",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type", {
      enum: ["static_image", "video", "carousel", "keyword_cluster", "audience", "coupon"],
    }).notNull(),
    /** Free-form: aspect ratio, duration, keyword theme, audience definition. */
    spec: text("spec", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: ["enabled", "paused", "archived"] })
      .notNull()
      .default("enabled"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ad_assets_external_unique").on(t.campaignId, t.externalId),
    index("ad_assets_brand_idx").on(t.brandId),
  ],
);

/**
 * The core ad fact table. One row per (day, campaign, asset, product) as reported by the
 * platform. `productId` is null when the platform does not attribute to a SKU.
 *
 * Denormalised brand/platform/adType columns are deliberate: every dashboard query
 * filters on them, and SQLite has no materialised views.
 */
export const adMetricsDaily = sqliteTable(
  "ad_metrics_daily",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformId: text("platform_id")
      .notNull()
      .references(() => platforms.id),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    adAssetId: text("ad_asset_id").references(() => adAssets.id, {
      onDelete: "cascade",
    }),
    productId: text("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    adType: text("ad_type", { enum: AD_TYPES }).notNull(),
    fundingSource: text("funding_source", { enum: FUNDING_SOURCES }).notNull(),
    day: text("day").notNull(),
    /**
     * `day|campaignId|assetId|productId` with '-' for absent parts. SQLite (and Postgres)
     * treat NULLs as distinct in unique indexes, so a natural-key index over the nullable
     * asset/product columns would let a re-sync insert duplicates. This collapses them.
     */
    grainKey: text("grain_key").notNull(),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    spendPaise: integer("spend_paise").notNull().default(0),
    /** Orders attributed to the ad within the platform's attribution window. */
    orders: integer("orders").notNull().default(0),
    units: integer("units").notNull().default(0),
    /** Attributed gross revenue (pre-discount, pre-return), paise. */
    revenuePaise: integer("revenue_paise").notNull().default(0),
    /** New-to-brand orders. The denominator for CAC. */
    newCustomerOrders: integer("new_customer_orders").notNull().default(0),
    newCustomerRevenuePaise: integer("new_customer_revenue_paise")
      .notNull()
      .default(0),
    /** Units returned/RTO'd against attributed orders. Erodes real ROAS. */
    returnedUnits: integer("returned_units").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ad_metrics_daily_grain").on(t.grainKey),
    index("ad_metrics_brand_day_idx").on(t.brandId, t.day),
    index("ad_metrics_platform_day_idx").on(t.platformId, t.day),
    index("ad_metrics_product_day_idx").on(t.productId, t.day),
  ],
);

/**
 * Total (ad + organic) platform sales per SKU per day. Needed for TACOS, blended ROAS
 * and to tell an ad-driven lift apart from a category-wide tailwind.
 */
export const salesDaily = sqliteTable(
  "sales_daily",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformId: text("platform_id")
      .notNull()
      .references(() => platforms.id),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    units: integer("units").notNull().default(0),
    /** Gross merchandise value before any discount, paise. */
    grossRevenuePaise: integer("gross_revenue_paise").notNull().default(0),
    /** Total discount given, paise (brand + platform funded, see promotionMetricsDaily). */
    discountPaise: integer("discount_paise").notNull().default(0),
    returnedUnits: integer("returned_units").notNull().default(0),
    /** Distinct new customers on this SKU/day, for organic-inclusive CAC. */
    newCustomers: integer("new_customers").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_daily_grain").on(t.day, t.platformAccountId, t.productId),
    index("sales_daily_brand_day_idx").on(t.brandId, t.day),
  ],
);

/* -------------------------------------------------- promotions & brand fund */

export const PROMO_TYPES = [
  "deal_of_day",
  "coupon",
  "price_off",
  "bank_offer",
  "cashback",
  "bxgy",
  "bundle",
  "platform_event",
] as const;
export type PromoType = (typeof PROMO_TYPES)[number];

export const promotions = sqliteTable(
  "promotions",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    name: text("name").notNull(),
    promoType: text("promo_type", { enum: PROMO_TYPES }).notNull(),
    startDay: text("start_day").notNull(),
    endDay: text("end_day").notNull(),
    /** Headline discount as a fraction of selling price (0.20 = 20% off). */
    discountRate: real("discount_rate").notNull().default(0),
    /** Flat discount per unit in paise, if the promo is absolute rather than a %. */
    discountFlatPaise: integer("discount_flat_paise").notNull().default(0),
    /**
     * Share of the discount the BRAND pays. The rest is platform funded.
     * Big-billion / GOSF style events often land at 0.5–1.0 for the brand.
     */
    brandFundedShare: real("brand_funded_share").notNull().default(1),
    /** Fixed participation/visibility fee charged to join the event, paise. */
    participationFeePaise: integer("participation_fee_paise").notNull().default(0),
    status: text("status", { enum: ["planned", "live", "ended", "cancelled"] })
      .notNull()
      .default("planned"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("promotions_external_unique").on(t.platformAccountId, t.externalId),
    index("promotions_brand_idx").on(t.brandId, t.startDay),
  ],
);

export const promotionProducts = sqliteTable(
  "promotion_products",
  {
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("promotion_products_pk").on(t.promotionId, t.productId)],
);

export const promotionMetricsDaily = sqliteTable(
  "promotion_metrics_daily",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promotionId: text("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    platformId: text("platform_id")
      .notNull()
      .references(() => platforms.id),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    units: integer("units").notNull().default(0),
    grossRevenuePaise: integer("gross_revenue_paise").notNull().default(0),
    discountPaise: integer("discount_paise").notNull().default(0),
    brandFundedDiscountPaise: integer("brand_funded_discount_paise")
      .notNull()
      .default(0),
    platformFundedDiscountPaise: integer("platform_funded_discount_paise")
      .notNull()
      .default(0),
    newCustomers: integer("new_customers").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("promotion_metrics_grain").on(t.day, t.promotionId, t.productId),
    index("promotion_metrics_brand_day_idx").on(t.brandId, t.day),
  ],
);

/**
 * Co-op / brand-fund ledger. Platforms accrue a % of the brand's sales into a marketing
 * fund, then the brand draws it down against ads and events. Money drawn from here is
 * real spend for ROAS purposes but NOT cash out, so the two views must both be available.
 */
export const brandFundLedger = sqliteTable(
  "brand_fund_ledger",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    entryType: text("entry_type", {
      enum: ["accrual", "utilization", "expiry", "adjustment"],
    }).notNull(),
    /** Signed paise: accruals positive, utilizations/expiries negative. */
    amountPaise: integer("amount_paise").notNull(),
    /** What consumed/created it: campaign id, promotion id, invoice no. */
    reference: text("reference"),
    note: text("note"),
    /** Accruals expire if unused; drives the "use it or lose it" alert. */
    expiresOn: text("expires_on"),
    /** `day|entryType|reference` — makes re-syncing a period idempotent. */
    entryKey: text("entry_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("brand_fund_entry_unique").on(t.platformAccountId, t.entryKey),
    index("brand_fund_account_day_idx").on(t.platformAccountId, t.day),
    index("brand_fund_brand_day_idx").on(t.brandId, t.day),
  ],
);

/* ----------------------------------------------------- planning & insights */

export const budgetPlans = sqliteTable(
  "budget_plans",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    totalBudgetPaise: integer("total_budget_paise").notNull(),
    objective: text("objective", {
      enum: ["max_revenue", "max_contribution", "max_new_customers", "hit_target_roas"],
    })
      .notNull()
      .default("max_contribution"),
    /** Target used when objective is hit_target_roas. */
    targetRoas: real("target_roas"),
    /** Per-channel floors/caps and other guardrails. See domain/optimizer.ts. */
    constraints: text("constraints", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: ["draft", "approved", "applied"] })
      .notNull()
      .default("draft"),
    createdAt: createdAt(),
  },
  (t) => [index("budget_plans_brand_idx").on(t.brandId)],
);

export const budgetAllocations = sqliteTable(
  "budget_allocations",
  {
    id: id(),
    planId: text("plan_id")
      .notNull()
      .references(() => budgetPlans.id, { onDelete: "cascade" }),
    /** What the money is being allocated to. */
    dimension: text("dimension", {
      enum: ["platform", "campaign", "ad_type", "product", "asset"],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    entityLabel: text("entity_label").notNull(),
    currentSpendPaise: integer("current_spend_paise").notNull(),
    recommendedSpendPaise: integer("recommended_spend_paise").notNull(),
    projectedRevenuePaise: integer("projected_revenue_paise").notNull(),
    projectedContributionPaise: integer("projected_contribution_paise")
      .notNull()
      .default(0),
    projectedRoas: real("projected_roas").notNull(),
    /** Revenue from the next rupee of spend. Equalised across channels at the optimum. */
    marginalRoas: real("marginal_roas").notNull(),
    /** Fitted saturation curve parameters, kept for explainability. */
    curve: text("curve", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("budget_allocations_plan_idx").on(t.planId)],
);

export const recommendations = sqliteTable(
  "recommendations",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: ["critical", "warning", "info"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Rupee impact if acted on (positive = upside), paise. */
    impactPaise: integer("impact_paise").notNull().default(0),
    dimension: text("dimension"),
    entityId: text("entity_id"),
    entityLabel: text("entity_label"),
    evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>(),
    status: text("status", { enum: ["open", "accepted", "dismissed", "done"] })
      .notNull()
      .default("open"),
    day: text("day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("recommendations_brand_idx").on(t.brandId, t.status)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: id(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platformAccountId: text("platform_account_id")
      .notNull()
      .references(() => platformAccounts.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    fromDay: text("from_day").notNull(),
    toDay: text("to_day").notNull(),
    status: text("status", { enum: ["running", "success", "partial", "failed"] })
      .notNull()
      .default("running"),
    rowsWritten: integer("rows_written").notNull().default(0),
    message: text("message"),
    startedAt: integer("started_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("sync_runs_account_idx").on(t.platformAccountId, t.startedAt)],
);

/* -------------------------------------------------------------- relations */

export const brandsRelations = relations(brands, ({ many }) => ({
  users: many(users),
  products: many(products),
  platformAccounts: many(platformAccounts),
}));

export const platformAccountsRelations = relations(
  platformAccounts,
  ({ one, many }) => ({
    brand: one(brands, {
      fields: [platformAccounts.brandId],
      references: [brands.id],
    }),
    platform: one(platforms, {
      fields: [platformAccounts.platformId],
      references: [platforms.id],
    }),
    campaigns: many(campaigns),
    listings: many(listings),
  }),
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  platformAccount: one(platformAccounts, {
    fields: [campaigns.platformAccountId],
    references: [platformAccounts.id],
  }),
  assets: many(adAssets),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  listings: many(listings),
}));

export const SQL_NOW = sql`(unixepoch() * 1000)`;

export type Brand = typeof brands.$inferSelect;
export type User = typeof users.$inferSelect;
export type Platform = typeof platforms.$inferSelect;
export type PlatformAccount = typeof platformAccounts.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdAsset = typeof adAssets.$inferSelect;
export type AdMetricRow = typeof adMetricsDaily.$inferSelect;
export type SalesRow = typeof salesDaily.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type PromotionMetricRow = typeof promotionMetricsDaily.$inferSelect;
export type BrandFundEntry = typeof brandFundLedger.$inferSelect;
export type BudgetPlan = typeof budgetPlans.$inferSelect;
export type BudgetAllocation = typeof budgetAllocations.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
