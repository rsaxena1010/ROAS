/**
 * Seed: platforms, two demo D2C brands with real-ish catalogues, then a full sandbox sync
 * so the app has 120 days of data to work with.
 *
 *   npm run db:reset   # wipe + push schema + seed
 *
 * Everything generated here is synthetic, and deterministic — reseeding produces the same
 * numbers, so screenshots and tests stay valid.
 */

import { and, eq } from "drizzle-orm";
import { PLATFORM_PROFILES } from "@/connectors/sandbox/profiles";
import { hashPassword } from "@/lib/auth";
import { addDays, toDay } from "@/lib/date";
import { rupeesToPaise } from "@/lib/money";
import { syncBrand } from "@/services/ingest";
import { db } from "./index";
import {
  brandMembers,
  brands,
  listings,
  platformAccounts,
  platforms,
  products,
  users,
} from "./schema";

const HISTORY_DAYS = 120;
export const DEMO_PASSWORD = "demo1234";

interface SeedProduct {
  sku: string;
  name: string;
  category: string;
  mrp: number;
  cogs: number;
  repeat: number;
}

/** A plausible mid-size Indian D2C personal-care catalogue. */
const VANYA_PRODUCTS: SeedProduct[] = [
  { sku: "VN-FW-100", name: "Vitamin C Face Wash 100ml", category: "Face Care", mrp: 449, cogs: 118, repeat: 2.8 },
  { sku: "VN-SER-30", name: "10% Niacinamide Serum 30ml", category: "Face Care", mrp: 699, cogs: 165, repeat: 2.2 },
  { sku: "VN-SUN-50", name: "SPF 50 Mineral Sunscreen 50g", category: "Sun Care", mrp: 599, cogs: 148, repeat: 2.6 },
  { sku: "VN-MOI-50", name: "Ceramide Moisturiser 50g", category: "Face Care", mrp: 649, cogs: 152, repeat: 2.4 },
  { sku: "VN-HO-100", name: "Rosemary Hair Oil 100ml", category: "Hair Care", mrp: 499, cogs: 96, repeat: 3.1 },
  { sku: "VN-SHA-300", name: "Sulphate-free Shampoo 300ml", category: "Hair Care", mrp: 549, cogs: 132, repeat: 3.4 },
  { sku: "VN-CON-250", name: "Protein Conditioner 250ml", category: "Hair Care", mrp: 499, cogs: 121, repeat: 3.0 },
  { sku: "VN-BW-250", name: "Coffee Body Wash 250ml", category: "Body Care", mrp: 399, cogs: 88, repeat: 3.2 },
  { sku: "VN-BL-200", name: "Ubtan Body Lotion 200ml", category: "Body Care", mrp: 449, cogs: 102, repeat: 2.9 },
  { sku: "VN-LIP-4", name: "Tinted Lip Balm 4g", category: "Make-up", mrp: 299, cogs: 62, repeat: 2.1 },
  { sku: "VN-KIT-GLO", name: "Glow Ritual Kit (4 pc)", category: "Kits", mrp: 1699, cogs: 421, repeat: 1.3 },
  { sku: "VN-KIT-HAIR", name: "Hair Fall Control Kit (3 pc)", category: "Kits", mrp: 1399, cogs: 338, repeat: 1.4 },
  { sku: "VN-UBT-100", name: "Detan Ubtan Scrub 100g", category: "Body Care", mrp: 399, cogs: 84, repeat: 2.3 },
  { sku: "VN-EYE-15", name: "Caffeine Under-eye Gel 15ml", category: "Face Care", mrp: 549, cogs: 128, repeat: 1.9 },
];

const HARVEST_PRODUCTS: SeedProduct[] = [
  { sku: "HV-GRA-500", name: "Millet Granola 500g", category: "Breakfast", mrp: 549, cogs: 178, repeat: 4.2 },
  { sku: "HV-PB-500", name: "Peanut Butter Crunchy 500g", category: "Spreads", mrp: 449, cogs: 142, repeat: 4.8 },
  { sku: "HV-MUE-400", name: "Fruit & Nut Muesli 400g", category: "Breakfast", mrp: 399, cogs: 131, repeat: 3.9 },
  { sku: "HV-SEED-200", name: "Roasted Seed Mix 200g", category: "Snacks", mrp: 299, cogs: 92, repeat: 3.6 },
  { sku: "HV-CHOC-90", name: "70% Dark Chocolate 90g", category: "Snacks", mrp: 249, cogs: 71, repeat: 3.1 },
];

/**
 * Selling price relative to MRP, per platform. Marketplaces discount off MRP structurally;
 * quick commerce holds closer to MRP but charges a higher take rate.
 */
const PRICE_INDEX: Record<string, number> = {
  amazon: 0.86,
  flipkart: 0.83,
  myntra: 0.78,
  nykaa: 0.9,
  bigbasket: 0.92,
  blinkit: 0.95,
  zepto: 0.94,
};

/** Platform-specific external SKU formats — ASINs, FSNs, style ids. */
function externalSku(platformId: string, sku: string, index: number): string {
  const pad = String(index + 1).padStart(3, "0");
  switch (platformId) {
    case "amazon":
      return `B0${hashish(sku).slice(0, 8).toUpperCase()}`;
    case "flipkart":
      return hashish(sku).slice(0, 12).toUpperCase();
    case "myntra":
      return String(20000000 + Number(pad) * 137);
    case "nykaa":
      return `NYK-${hashish(sku).slice(0, 6).toUpperCase()}`;
    default:
      return `${platformId.slice(0, 2).toUpperCase()}${pad}-${sku}`;
  }
}

function hashish(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36).padEnd(12, "x");
}

interface BrandSpec {
  slug: string;
  name: string;
  targetRoas: number;
  targetCac: number;
  targetMargin: number;
  email: string;
  userName: string;
  catalogue: SeedProduct[];
  platformIds: string[];
}

const BRAND_SPECS: BrandSpec[] = [
  {
    slug: "vanya-naturals",
    name: "Vanya Naturals",
    targetRoas: 4.2,
    targetCac: 320,
    targetMargin: 0.18,
    email: "growth@vanyanaturals.in",
    userName: "Ananya Rao",
    catalogue: VANYA_PRODUCTS,
    platformIds: PLATFORM_PROFILES.map((p) => p.id),
  },
  {
    slug: "harvest-co",
    name: "Harvest & Co.",
    targetRoas: 3.4,
    targetCac: 260,
    targetMargin: 0.14,
    email: "marketing@harvestco.in",
    userName: "Kabir Menon",
    catalogue: HARVEST_PRODUCTS,
    platformIds: ["amazon", "bigbasket", "blinkit", "zepto"],
  },
];

export const PORTFOLIO_EMAIL = "portfolio@demo.in";

/**
 * A portfolio operator with read access to every demo brand, so the cross-brand cut has
 * something to show. The two brand owners deliberately get no membership rows: they are
 * independent tenants and must not see each other's numbers.
 */
async function seedPortfolioUser(passwordHash: string): Promise<void> {
  const all = await db.select().from(brands);
  if (all.length === 0) return;
  const home = all.find((b) => b.slug === BRAND_SPECS[0].slug) ?? all[0];

  await db
    .insert(users)
    .values({
      brandId: home.id,
      email: PORTFOLIO_EMAIL,
      name: "Priya Iyer",
      passwordHash,
      role: "analyst",
    })
    .onConflictDoNothing();

  const user = await db.query.users.findFirst({ where: eq(users.email, PORTFOLIO_EMAIL) });
  if (!user) return;

  for (const brand of all) {
    await db
      .insert(brandMembers)
      .values({ userId: user.id, brandId: brand.id, role: "viewer" })
      .onConflictDoNothing();
  }
  console.log(`  portfolio user: ${PORTFOLIO_EMAIL} across ${all.length} brands`);
}

export async function seedPlatforms(): Promise<void> {
  for (const p of PLATFORM_PROFILES) {
    const values = {
      name: p.name,
      kind: p.kind,
      defaultTakeRate: p.takeRate,
      defaultFulfilmentFeePaise: p.fulfilmentFeePaise,
      defaultPaymentFeeRate: p.paymentFeeRate,
      defaultBrandFundAccrualRate: p.brandFundAccrualRate,
      integration: p.integration,
      attributionWindowDays: p.attributionWindowDays,
    };
    await db
      .insert(platforms)
      .values({ id: p.id, ...values })
      .onConflictDoUpdate({ target: platforms.id, set: values });
  }
}

async function seedBrand(spec: BrandSpec, passwordHash: string) {
  let brand = await db.query.brands.findFirst({ where: eq(brands.slug, spec.slug) });
  if (!brand) {
    [brand] = await db
      .insert(brands)
      .values({
        name: spec.name,
        slug: spec.slug,
        targetRoas: spec.targetRoas,
        targetCacPaise: rupeesToPaise(spec.targetCac),
        targetContributionMargin: spec.targetMargin,
      })
      .returning();
  }

  await db
    .insert(users)
    .values({
      brandId: brand.id,
      email: spec.email,
      name: spec.userName,
      passwordHash,
      role: "owner",
    })
    .onConflictDoNothing();

  /* ------------------------------------------------------------ catalogue */

  const productIds: { id: string; sku: string; mrp: number }[] = [];
  for (const p of spec.catalogue) {
    let row = await db.query.products.findFirst({
      where: and(eq(products.brandId, brand.id), eq(products.sku, p.sku)),
    });
    if (!row) {
      [row] = await db
        .insert(products)
        .values({
          brandId: brand.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          mrpPaise: rupeesToPaise(p.mrp),
          cogsPaise: rupeesToPaise(p.cogs),
          expectedRepeatPurchases: p.repeat,
        })
        .returning();
    }
    productIds.push({ id: row.id, sku: p.sku, mrp: p.mrp });
  }

  /* ------------------------------------------------- accounts + listings */

  for (const platformId of spec.platformIds) {
    const externalAccountId = `${spec.slug}-${platformId}`;
    let account = await db.query.platformAccounts.findFirst({
      where: and(
        eq(platformAccounts.brandId, brand.id),
        eq(platformAccounts.externalAccountId, externalAccountId),
      ),
    });
    if (!account) {
      [account] = await db
        .insert(platformAccounts)
        .values({
          brandId: brand.id,
          platformId,
          externalAccountId,
          label: `${spec.name} — ${platformId}`,
          mode: "sandbox",
          status: "connected",
          config: {},
        })
        .returning();
    }

    const profile = PLATFORM_PROFILES.find((p) => p.id === platformId)!;
    const priceIndex = PRICE_INDEX[platformId] ?? 0.88;

    for (const [i, product] of productIds.entries()) {
      await db
        .insert(listings)
        .values({
          brandId: brand.id,
          productId: product.id,
          platformAccountId: account.id,
          externalSku: externalSku(platformId, product.sku, i),
          sellingPricePaise: rupeesToPaise(Math.round(product.mrp * priceIndex)),
          takeRate: profile.takeRate,
          fulfilmentFeePaise: profile.fulfilmentFeePaise,
          paymentFeeRate: profile.paymentFeeRate,
        })
        .onConflictDoNothing();
    }
  }

  return brand;
}

async function main() {
  const today = toDay(Date.now());
  const from = addDays(today, -(HISTORY_DAYS - 1));

  console.log(`Seeding ROAS platform (${from} .. ${today})`);

  await seedPlatforms();
  console.log(`  platforms: ${PLATFORM_PROFILES.length}`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const spec of BRAND_SPECS) {
    const brand = await seedBrand(spec, passwordHash);
    console.log(
      `  ${spec.name}: ${spec.catalogue.length} SKUs across ${spec.platformIds.length} platforms`,
    );

    const started = Date.now();
    const results = await syncBrand(brand.id, { from, to: today });
    const rows = results.reduce((s, r) => s + r.rowsWritten, 0);
    console.log(
      `    synced ${rows.toLocaleString("en-IN")} fact rows in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    for (const f of results.filter((r) => r.status === "failed")) {
      console.error(`    ! ${f.platformId}: ${f.error}`);
    }
  }

  await seedPortfolioUser(passwordHash);

  console.log("\nDone. Log in with:");
  for (const spec of BRAND_SPECS) console.log(`  ${spec.email} / ${DEMO_PASSWORD}`);
  console.log(`  ${PORTFOLIO_EMAIL} / ${DEMO_PASSWORD}  (sees both brands)`);
}

// `tsx src/db/seed.ts` runs this directly; importing the module (tests) does not.
if (process.argv[1]?.includes("seed")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
