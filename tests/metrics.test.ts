import { describe, expect, it } from "vitest";
import {
  addAdTotals,
  addSalesTotals,
  computeMetrics,
  deltaVerdict,
  emptyAdTotals,
  emptySalesTotals,
  type AdTotals,
  type SalesTotals,
} from "@/domain/metrics";

/**
 * The scenario these tests are built around is the product's central claim: a channel that
 * reports a comfortable 5x against a 4x break-even is actually below water once the
 * brand-funded discount and the platform-funded media are accounted for.
 */
const ad: AdTotals = {
  ...emptyAdTotals(),
  spendPaise: 1_000,
  platformFundedSpendPaise: 200,
  brandFundSpendPaise: 300,
  revenuePaise: 5_000,
  impressions: 100_000,
  clicks: 2_000,
  orders: 100,
  units: 100,
  newCustomerOrders: 40,
};

const sales: SalesTotals = {
  ...emptySalesTotals(),
  units: 200,
  grossRevenuePaise: 10_000,
  discountPaise: 1_000,
  brandFundedDiscountPaise: 1_000,
  participationFeePaise: 0,
  newCustomers: 50,
};

const metrics = computeMetrics(ad, sales, { grossContributionRate: 0.25 });

describe("computeMetrics — investment bases", () => {
  it("excludes platform-funded media from what the brand is accountable for", () => {
    expect(metrics.adSpendPaise).toBe(800);
    // Co-op money is accountable but is not cash.
    expect(metrics.cashAdSpendPaise).toBe(500);
    expect(metrics.brandFundSpendPaise).toBe(300);
  });

  it("charges ads only their attributed share of the discount bill", () => {
    // Ads were credited with 5,000 of 10,000 of trade.
    expect(metrics.attributedShare).toBeCloseTo(0.5, 9);
    // Channel basis: 800 accountable ads + 50% of the 1,000 discount.
    expect(metrics.totalInvestmentPaise).toBe(1_300);
    // Platform basis: the same ads plus the WHOLE discount bill.
    expect(metrics.platformInvestmentPaise).toBe(1_800);
  });

  it("caps attributed share at 1 when ads are credited with more than total trade", () => {
    const over = computeMetrics(
      { ...ad, revenuePaise: 50_000 },
      sales,
      { grossContributionRate: 0.25 },
    );
    expect(over.attributedShare).toBe(1);
  });
});

describe("computeMetrics — reported vs true", () => {
  it("reports the platform's own flattering number unchanged", () => {
    // Reported ROAS divides by all spend, including the platform-funded part.
    expect(metrics.reportedRoas).toBe(5);
  });

  it("puts true ROAS below break-even where reported ROAS sits above it", () => {
    // 5,000 attributed less the ads' 500 share of brand-funded discount.
    expect(metrics.netAttributedRevenuePaise).toBe(4_500);
    expect(metrics.trueRoas).toBeCloseTo(4_500 / 1_300, 9);

    expect(metrics.breakEvenRoas).toBe(4);
    expect(metrics.reportedRoas).toBeGreaterThan(metrics.breakEvenRoas);
    expect(metrics.trueRoas).toBeLessThan(metrics.breakEvenRoas);
    expect(metrics.efficiencyIndex).toBeLessThan(1);
  });

  it("nets returns out of attributed revenue", () => {
    const withReturns = computeMetrics(
      { ...ad, returnedUnits: 20 },
      sales,
      { grossContributionRate: 0.25 },
    );
    // 20% of units returned removes 20% of attributed revenue before the discount share.
    expect(withReturns.netAttributedRevenuePaise).toBe(5_000 - 1_000 - 500);
    expect(withReturns.trueRoas).toBeLessThan(metrics.trueRoas);
  });
});

describe("computeMetrics — blended and profit", () => {
  it("computes MER on the platform basis", () => {
    expect(metrics.netTotalRevenuePaise).toBe(9_000);
    expect(metrics.blendedRoas).toBeCloseTo(9_000 / 1_800, 9);
  });

  it("charges contribution the full platform cost, not the ads' share", () => {
    expect(metrics.grossContributionPaise).toBe(2_250);
    expect(metrics.netContributionPaise).toBe(2_250 - 1_800);
  });

  it("distinguishes ad-only TACOS from all-in TACOS", () => {
    expect(metrics.tacos).toBeCloseTo(0.1, 9);
    expect(metrics.trueTacos).toBeCloseTo(0.18, 9);
    expect(metrics.trueTacos).toBeGreaterThan(metrics.tacos);
  });

  it("pairs blended CAC with every new customer, paid and organic", () => {
    expect(metrics.newCustomers).toBe(50);
    expect(metrics.cacPaise).toBe(1_800 / 50);
    // Paid CAC uses accountable ad spend against ad-attributed new customers only.
    expect(metrics.paidCacPaise).toBe(800 / 40);
  });

  it("falls back to ad-side new customers when there is no sales-side count", () => {
    const adOnly = computeMetrics(ad, { ...sales, newCustomers: 0 }, {
      grossContributionRate: 0.25,
    });
    expect(adOnly.newCustomers).toBe(40);
  });
});

describe("computeMetrics — degenerate inputs", () => {
  it("returns zeros rather than NaN when there is no activity", () => {
    const zero = computeMetrics(emptyAdTotals(), emptySalesTotals(), {
      grossContributionRate: 0,
    });
    for (const [key, value] of Object.entries(zero)) {
      if (key === "comparability" || key === "breakEvenRoas") continue;
      expect(Number.isFinite(value as number), `${key} should be finite`).toBe(true);
    }
    expect(zero.breakEvenRoas).toBe(Number.POSITIVE_INFINITY);
    // With no margin at all there is no efficiency to report, not an infinite one.
    expect(zero.efficiencyIndex).toBe(0);
  });
});

describe("comparability", () => {
  it("is aligned for a single attribution window", () => {
    const one = computeMetrics(ad, sales, {
      grossContributionRate: 0.25,
      attributionWindowDays: [14, 14],
    });
    expect(one.comparability.attributionAligned).toBe(true);
    expect(one.comparability.attributionWindowDays).toEqual([14]);
    expect(one.comparability.notes).toHaveLength(0);
  });

  it("warns when windows are mixed, because reported ROAS is then incomparable", () => {
    const mixed = computeMetrics(ad, sales, {
      grossContributionRate: 0.25,
      attributionWindowDays: [14, 1, 7],
    });
    expect(mixed.comparability.attributionAligned).toBe(false);
    expect(mixed.comparability.attributionWindowDays).toEqual([1, 7, 14]);
    expect(mixed.comparability.notes[0]).toMatch(/not directly comparable/i);
  });
});

describe("totals accumulate", () => {
  it("sums ad and sales totals field-wise", () => {
    const summed = addAdTotals(addAdTotals(emptyAdTotals(), ad), ad);
    expect(summed.spendPaise).toBe(2_000);
    expect(summed.platformFundedSpendPaise).toBe(400);

    const salesSum = addSalesTotals(addSalesTotals(emptySalesTotals(), sales), sales);
    expect(salesSum.grossRevenuePaise).toBe(20_000);
    expect(salesSum.newCustomers).toBe(100);
  });
});

describe("deltaVerdict", () => {
  it("knows which direction is an improvement for each metric", () => {
    // More ROAS is better.
    expect(deltaVerdict("trueRoas", 5, 4).good).toBe(true);
    expect(deltaVerdict("trueRoas", 3, 4).good).toBe(false);
    // Cheaper acquisition is better.
    expect(deltaVerdict("cacPaise", 300, 400).good).toBe(true);
    expect(deltaVerdict("cacPaise", 500, 400).good).toBe(false);
  });

  it("declines to judge an unknown metric or a missing baseline", () => {
    expect(deltaVerdict("impressions", 10, 5).good).toBe(null);
    expect(deltaVerdict("trueRoas", 5, 0)).toEqual({ pct: 0, good: null });
  });

  it("reports the change as a signed fraction of the baseline", () => {
    expect(deltaVerdict("trueRoas", 5, 4).pct).toBeCloseTo(0.25, 9);
  });
});
