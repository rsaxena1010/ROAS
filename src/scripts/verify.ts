/**
 * Data doctor: `npm run verify`
 *
 * Runs the full chain — load, aggregate, fit curves, optimize, generate insights — against
 * every seeded brand and prints what it found. Two jobs:
 *
 *   1. catch integrity problems (orphan rows, discounts exceeding revenue, negative spend)
 *   2. show whether the response curves are actually recoverable from the data, because if
 *      they aren't, the optimizer's recommendations are decoration
 *
 * Exits non-zero on a hard integrity failure so it can gate CI.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { lastNDays, toDay } from "@/lib/date";
import { formatInrCompact, formatMultiple, formatPercent } from "@/lib/money";
import { aggregate, aggregateTotal, brandFundSummary, loadBrandData } from "@/services/analytics";
import { generateInsights } from "@/services/insights";
import { runPlan } from "@/services/planner";

interface Check {
  name: string;
  sql: string;
  /** A non-zero count is a hard failure rather than a warning. */
  fatal: boolean;
}

const INTEGRITY_CHECKS: Check[] = [
  {
    name: "ad rows with negative spend",
    sql: "SELECT COUNT(*) n FROM ad_metrics_daily WHERE spend_paise < 0",
    fatal: true,
  },
  {
    name: "ad rows referencing a missing campaign",
    sql: "SELECT COUNT(*) n FROM ad_metrics_daily m LEFT JOIN campaigns c ON c.id = m.campaign_id WHERE c.id IS NULL",
    fatal: true,
  },
  {
    name: "sales rows referencing a missing product",
    sql: "SELECT COUNT(*) n FROM sales_daily s LEFT JOIN products p ON p.id = s.product_id WHERE p.id IS NULL",
    fatal: true,
  },
  {
    name: "sales rows where discount exceeds gross revenue",
    sql: "SELECT COUNT(*) n FROM sales_daily WHERE discount_paise > gross_revenue_paise",
    fatal: true,
  },
  {
    name: "promo rows where funded split doesn't equal the discount",
    sql: "SELECT COUNT(*) n FROM promotion_metrics_daily WHERE brand_funded_discount_paise + platform_funded_discount_paise <> discount_paise",
    fatal: true,
  },
  {
    name: "ad rows with returns exceeding units",
    sql: "SELECT COUNT(*) n FROM ad_metrics_daily WHERE returned_units > units",
    fatal: false,
  },
  {
    name: "listings without an active product",
    sql: "SELECT COUNT(*) n FROM listings l JOIN products p ON p.id = l.product_id WHERE p.is_active = 0",
    fatal: false,
  },
  {
    name: "duplicate ad grain keys",
    sql: "SELECT COUNT(*) n FROM (SELECT grain_key FROM ad_metrics_daily GROUP BY grain_key HAVING COUNT(*) > 1)",
    fatal: true,
  },
];

async function main() {
  const today = toDay(Date.now());
  let failures = 0;

  console.log("=== Integrity checks ===");
  for (const check of INTEGRITY_CHECKS) {
    const result = await db.run(sql.raw(check.sql));
    const n = Number((result.rows[0] as Record<string, unknown>).n ?? 0);
    const ok = n === 0;
    const mark = ok ? "ok  " : check.fatal ? "FAIL" : "warn";
    if (!ok && check.fatal) failures++;
    console.log(`  [${mark}] ${check.name}${ok ? "" : `: ${n}`}`);
  }

  const brandRows = await db.select().from(brands);
  const range = lastNDays(30, today);

  for (const brand of brandRows) {
    console.log(`\n=== ${brand.name} (${range.from} .. ${range.to}) ===`);
    const data = await loadBrandData(brand, range);
    const total = aggregateTotal(data);
    const m = total.metrics;

    console.log(
      [
        `  ad spend        ${formatInrCompact(m.adSpendPaise)}`,
        `  brand discount  ${formatInrCompact(m.brandFundedDiscountPaise)}`,
        `  event fees      ${formatInrCompact(m.participationFeePaise)}`,
        `  TOTAL invested  ${formatInrCompact(m.totalInvestmentPaise)}`,
        `  attributed rev  ${formatInrCompact(m.attributedRevenuePaise)}`,
        `  total revenue   ${formatInrCompact(m.totalRevenuePaise)}`,
      ].join("\n"),
    );
    console.log(
      [
        `  reported ROAS   ${formatMultiple(m.reportedRoas)}`,
        `  TRUE ROAS       ${formatMultiple(m.trueRoas)}   (break-even ${formatMultiple(m.breakEvenRoas)})`,
        `  blended / MER   ${formatMultiple(m.blendedRoas)}`,
        `  TACOS / true    ${formatPercent(m.tacos)} / ${formatPercent(m.trueTacos)}`,
        `  CAC             ${formatInrCompact(m.cacPaise)} (paid ${formatInrCompact(m.paidCacPaise)}, target ${formatInrCompact(brand.targetCacPaise)})`,
        `  LTV:CAC         ${formatMultiple(m.ltvToCac)}`,
        `  contribution    ${formatInrCompact(m.netContributionPaise)} (${formatPercent(m.netContributionRate)})`,
      ].join("\n"),
    );

    if (m.trueRoas > m.reportedRoas) {
      console.log(
        "  [warn] True ROAS exceeds reported ROAS — check the discount/return netting.",
      );
    }

    /* ------------------------------------------------------ curve recovery */

    const plan = runPlan(data, {
      dimension: "platform_ad_type",
      objective: "max_contribution",
    });

    const fitted = plan.diagnostics.filter((d) => !d.curve.assumed);
    console.log(
      `\n  curves: ${fitted.length}/${plan.diagnostics.length} fitted from data (rest fell back to a prior)`,
    );
    const table = [...plan.diagnostics]
      .sort((a, b) => b.currentDailySpendPaise - a.currentDailySpendPaise)
      .slice(0, 8)
      .map((d) => ({
        channel: `${d.sublabel ?? ""} ${d.label}`.trim().slice(0, 34),
        "spend/day": formatInrCompact(d.currentDailySpendPaise),
        avgROAS: d.averageRoas.toFixed(2),
        margROAS: d.marginalRoas.toFixed(2),
        satur: formatPercent(d.saturation, 0),
        curve: d.curve.assumed ? "prior" : `${d.curve.kind} r²=${d.curve.r2.toFixed(2)}`,
        conf: d.curve.confidence.toFixed(2),
        // A frontier outside the observed spend range is an extrapolation; showing a precise
        // rupee figure there would imply precision we don't have.
        frontier: d.frontierExtrapolated
          ? d.efficientFrontierSpendPaise < d.currentDailySpendPaise
            ? "< observed"
            : "> observed"
          : formatInrCompact(d.efficientFrontierSpendPaise),
      }));
    console.table(table);

    const r = plan.result;
    console.log(
      [
        `  optimizer (max_contribution, budget held at ${formatInrCompact(r.totalBudgetPaise)}/day):`,
        `    revenue      ${formatInrCompact(r.currentRevenuePaise)} -> ${formatInrCompact(r.projectedRevenuePaise)} (${formatInrCompact(r.revenueUpliftPaise)}/day uplift)`,
        `    contribution ${formatInrCompact(r.currentContributionPaise)} -> ${formatInrCompact(r.projectedContributionPaise)} (${formatInrCompact(r.contributionUpliftPaise)}/day)`,
        `    clearing marginal ROAS ${formatMultiple(r.clearingMarginalRoas)}`,
        `    unallocated  ${formatInrCompact(r.unallocatedPaise)}`,
      ].join("\n"),
    );
    for (const w of r.warnings) console.log(`    [warn] ${w}`);

    const moves = r.allocations
      .filter((a) => a.action !== "hold")
      .slice(0, 6)
      .map((a) => ({
        channel: a.channel.label.slice(0, 30),
        from: formatInrCompact(a.currentSpendPaise),
        to: formatInrCompact(a.recommendedSpendPaise),
        delta: `${a.deltaPaise > 0 ? "+" : ""}${formatInrCompact(a.deltaPaise)}`,
        margROAS: a.marginalRoas.toFixed(2),
        why: a.binding,
      }));
    if (moves.length > 0) {
      console.log("\n  top moves:");
      console.table(moves);
    }

    /* ------------------------------------------------------------ funds */

    const funds = await brandFundSummary(data, today);
    if (funds.length > 0) {
      console.log("  co-op / brand fund:");
      console.table(
        funds.map((f) => ({
          platform: f.platformName,
          accrued: formatInrCompact(f.accruedPaise),
          used: formatInrCompact(f.utilisedPaise),
          balance: formatInrCompact(f.balancePaise),
          used_pct: formatPercent(f.utilisationRate, 0),
          expiring_60d: formatInrCompact(f.expiringSoonPaise),
        })),
      );
    }

    /* --------------------------------------------------------- insights */

    const insights = await generateInsights(data, today);
    console.log(`\n  insights: ${insights.length}`);
    for (const i of insights.slice(0, 6)) {
      console.log(
        `    [${i.severity}] ${i.title} — ${formatInrCompact(i.impactPaise)}`,
      );
    }

    /* ------------------------------------------- cross-platform sanity */

    const byPlatform = aggregate(data, "platform");
    console.table(
      byPlatform.map((g) => ({
        platform: g.label,
        invested: formatInrCompact(g.metrics.totalInvestmentPaise),
        reported: formatMultiple(g.metrics.reportedRoas),
        true: formatMultiple(g.metrics.trueRoas),
        breakeven: formatMultiple(g.metrics.breakEvenRoas),
        eff_index: g.metrics.efficiencyIndex.toFixed(2),
        CAC: formatInrCompact(g.metrics.cacPaise),
        contrib: formatInrCompact(g.metrics.netContributionPaise),
      })),
    );
  }

  console.log(
    `\n${failures === 0 ? "All fatal integrity checks passed." : `${failures} fatal integrity failure(s).`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
