import { describe, expect, it } from "vitest";
import {
  breakEvenRoas,
  computeCohortEconomics,
  maxAffordableBrandDiscount,
  resolveFeeProfile,
  type FeeProfile,
} from "@/domain/economics";
import { rupeesToPaise } from "@/lib/money";

const FEES: FeeProfile = {
  takeRate: 0.2,
  fulfilmentFeePaise: rupeesToPaise(70),
  paymentFeeRate: 0.02,
};

describe("computeCohortEconomics", () => {
  it("charges commission and payment fees on what the customer paid, not on list price", () => {
    const econ = computeCohortEconomics(
      {
        units: 10,
        grossRevenuePaise: rupeesToPaise(10_000),
        discountPaise: rupeesToPaise(2_000),
        brandFundedDiscountPaise: rupeesToPaise(2_000),
        cogsPerUnitPaise: rupeesToPaise(300),
      },
      FEES,
    );

    // Customer paid 10,000 - 2,000 = 8,000.
    expect(econ.customerPaidPaise).toBe(rupeesToPaise(8_000));
    expect(econ.commissionPaise).toBe(rupeesToPaise(1_600));
    expect(econ.paymentFeePaise).toBe(rupeesToPaise(160));
  });

  it("does not dock the brand for a platform-funded discount", () => {
    const shared = {
      units: 10,
      grossRevenuePaise: rupeesToPaise(10_000),
      discountPaise: rupeesToPaise(2_000),
      cogsPerUnitPaise: rupeesToPaise(300),
    };

    const brandFunded = computeCohortEconomics(
      { ...shared, brandFundedDiscountPaise: rupeesToPaise(2_000) },
      FEES,
    );
    const platformFunded = computeCohortEconomics(
      { ...shared, brandFundedDiscountPaise: 0 },
      FEES,
    );

    // Same customer price and same fees, but the brand keeps the markdown it didn't fund.
    expect(platformFunded.customerPaidPaise).toBe(brandFunded.customerPaidPaise);
    expect(platformFunded.commissionPaise).toBe(brandFunded.commissionPaise);
    expect(platformFunded.grossContributionPaise - brandFunded.grossContributionPaise).toBe(
      rupeesToPaise(2_000),
    );
    expect(platformFunded.platformFundedDiscountPaise).toBe(rupeesToPaise(2_000));
  });

  it("applies revenue and variable fees only to retained units", () => {
    const econ = computeCohortEconomics(
      {
        units: 10,
        returnedUnits: 2,
        grossRevenuePaise: rupeesToPaise(10_000),
        cogsPerUnitPaise: rupeesToPaise(300),
      },
      FEES,
    );

    expect(econ.netUnits).toBe(8);
    expect(econ.returnRate).toBeCloseTo(0.2, 6);
    expect(econ.retainedGrossPaise).toBe(rupeesToPaise(8_000));
    // Fulfilment is charged on the 8 retained units only.
    expect(econ.fulfilmentPaise).toBe(rupeesToPaise(70) * 8);
    expect(econ.cogsPaise).toBe(rupeesToPaise(300) * 8);
    // Returns still cost the reverse leg plus a write-off on the goods.
    expect(econ.returnCostPaise).toBe(
      rupeesToPaise(70) * 2 + Math.round(rupeesToPaise(300) * 2 * 0.35),
    );
  });

  it("separates co-op spend from cash while charging both to contribution", () => {
    const econ = computeCohortEconomics(
      {
        units: 10,
        grossRevenuePaise: rupeesToPaise(10_000),
        cogsPerUnitPaise: rupeesToPaise(300),
        adSpendPaise: rupeesToPaise(500),
        brandFundSpendPaise: rupeesToPaise(300),
        participationFeePaise: rupeesToPaise(100),
      },
      FEES,
    );

    expect(econ.totalInvestmentPaise).toBe(rupeesToPaise(900));
    // Co-op money is accountable spend but never cash out of the brand's account.
    expect(econ.cashInvestmentPaise).toBe(rupeesToPaise(600));
    expect(econ.netContributionPaise).toBe(
      econ.grossContributionPaise - rupeesToPaise(900),
    );
  });

  it("clamps a brand-funded discount that exceeds the total discount", () => {
    const econ = computeCohortEconomics(
      {
        units: 1,
        grossRevenuePaise: rupeesToPaise(1_000),
        discountPaise: rupeesToPaise(100),
        brandFundedDiscountPaise: rupeesToPaise(900),
        cogsPerUnitPaise: rupeesToPaise(100),
      },
      FEES,
    );
    expect(econ.brandFundedDiscountPaise).toBe(rupeesToPaise(100));
    expect(econ.platformFundedDiscountPaise).toBe(0);
  });
});

describe("breakEvenRoas", () => {
  it("is the reciprocal of the contribution rate", () => {
    expect(breakEvenRoas(0.25)).toBe(4);
    expect(breakEvenRoas(0.2)).toBe(5);
  });

  it("is unattainable when there is no margin to fund marketing", () => {
    expect(breakEvenRoas(0)).toBe(Number.POSITIVE_INFINITY);
    expect(breakEvenRoas(-0.1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("maxAffordableBrandDiscount", () => {
  it("finds a discount that lands on the target contribution rate", () => {
    const price = rupeesToPaise(1_000);
    const cogs = rupeesToPaise(250);
    const target = 0.15;

    const { discountRate } = maxAffordableBrandDiscount(price, cogs, FEES, target);
    expect(discountRate).toBeGreaterThan(0);
    expect(discountRate).toBeLessThan(1);

    // At the reported rate the cohort still clears the target...
    const at = computeCohortEconomics(
      {
        units: 1,
        grossRevenuePaise: price,
        discountPaise: Math.round(price * discountRate),
        brandFundedDiscountPaise: Math.round(price * discountRate),
        cogsPerUnitPaise: cogs,
      },
      FEES,
    );
    expect(at.grossContributionRate).toBeGreaterThanOrEqual(target - 1e-6);

    // ...and a materially larger discount does not.
    const beyond = computeCohortEconomics(
      {
        units: 1,
        grossRevenuePaise: price,
        discountPaise: Math.round(price * (discountRate + 0.05)),
        brandFundedDiscountPaise: Math.round(price * (discountRate + 0.05)),
        cogsPerUnitPaise: cogs,
      },
      FEES,
    );
    expect(beyond.grossContributionRate).toBeLessThan(target);
  });

  it("returns zero headroom when the listing cannot clear the target undiscounted", () => {
    // COGS above the listing price: no discount is affordable.
    const { discountRate } = maxAffordableBrandDiscount(
      rupeesToPaise(500),
      rupeesToPaise(600),
      FEES,
      0.15,
    );
    expect(discountRate).toBeLessThan(1e-6);
  });
});

describe("resolveFeeProfile", () => {
  const platform = {
    defaultTakeRate: 0.18,
    defaultFulfilmentFeePaise: 6500,
    defaultPaymentFeeRate: 0.02,
  };

  it("prefers listing overrides", () => {
    expect(
      resolveFeeProfile({ takeRate: 0.25, fulfilmentFeePaise: 100, paymentFeeRate: 0.01 }, platform),
    ).toEqual({ takeRate: 0.25, fulfilmentFeePaise: 100, paymentFeeRate: 0.01 });
  });

  it("falls back to platform defaults, including for a null listing", () => {
    expect(resolveFeeProfile(null, platform)).toEqual({
      takeRate: 0.18,
      fulfilmentFeePaise: 6500,
      paymentFeeRate: 0.02,
    });
    // A zero override is a real value and must not fall through to the default.
    expect(resolveFeeProfile({ takeRate: 0 }, platform).takeRate).toBe(0);
  });
});
