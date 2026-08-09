/**
 * Unit economics for a marketplace/quick-commerce order cohort.
 *
 * The point of this module is that platform-reported ROAS is a vanity number: it divides
 * attributed revenue by ad spend and ignores the commission, the fulfilment fee, the
 * brand-funded half of the "platform" discount, the event participation fee and the
 * returns. A brand at 6x reported ROAS can still be losing money per order.
 *
 * Everything here is integer paise in, integer paise out.
 */

import { safeDiv } from "@/lib/money";

/** Fee structure in force for a listing on a platform. */
export interface FeeProfile {
  /** Commission / take rate as a fraction of what the customer paid. */
  takeRate: number;
  /** Fulfilment + shipping per retained unit, paise. */
  fulfilmentFeePaise: number;
  /** Payment collection fee as a fraction of what the customer paid. */
  paymentFeeRate: number;
  /**
   * Reverse-logistics cost per returned unit, paise. Defaults to the fulfilment fee —
   * a return costs roughly the forward leg again, and the unit often can't be resold.
   */
  returnHandlingFeePaise?: number;
  /** Fraction of a returned unit's cost that is unrecoverable (0 = fully resellable). */
  returnWriteOffRate?: number;
}

export interface CohortInput {
  /** Units ordered, including ones later returned. */
  units: number;
  /** Units returned / RTO'd out of `units`. */
  returnedUnits?: number;
  /** Pre-discount value of all `units` at listing price, paise. */
  grossRevenuePaise: number;
  /** Total discount handed to the customer across all `units`, paise. */
  discountPaise?: number;
  /** Portion of `discountPaise` the brand pays for, paise. */
  brandFundedDiscountPaise?: number;
  /** Landed cost of goods per unit, paise. */
  cogsPerUnitPaise: number;
  /** Ad spend charged to the brand for this cohort, paise. */
  adSpendPaise?: number;
  /** Money drawn from the platform co-op fund. Real spend, but not cash out. */
  brandFundSpendPaise?: number;
  /** Fixed fees to participate in an event/deal, paise. */
  participationFeePaise?: number;
}

export interface CohortEconomics {
  units: number;
  netUnits: number;
  returnRate: number;

  /** Value of retained units at listing price. */
  retainedGrossPaise: number;
  /** What the customer actually paid for retained units. */
  customerPaidPaise: number;
  /** Discount on retained units funded by the brand. */
  brandFundedDiscountPaise: number;
  /** Discount on retained units funded by the platform — free demand, not a brand cost. */
  platformFundedDiscountPaise: number;

  commissionPaise: number;
  fulfilmentPaise: number;
  paymentFeePaise: number;
  returnCostPaise: number;
  /** Net remittance from the platform to the brand for retained units. */
  settlementPaise: number;

  cogsPaise: number;
  /** Settlement minus COGS and return costs. Before any marketing. */
  grossContributionPaise: number;
  grossContributionRate: number;

  adSpendPaise: number;
  brandFundSpendPaise: number;
  participationFeePaise: number;
  /** Every rupee of marketing the brand is accountable for, cash or co-op. */
  totalInvestmentPaise: number;
  /** Marketing that is actually cash out of the brand's bank account. */
  cashInvestmentPaise: number;

  /** Gross contribution minus total marketing investment. The number that matters. */
  netContributionPaise: number;
  netContributionRate: number;

  /**
   * The ROAS at which this cohort breaks even: 1 / grossContributionRate. Spend below
   * this multiple destroys money no matter what the platform dashboard says.
   */
  breakEvenRoas: number;
}

const DEFAULT_RETURN_WRITE_OFF = 0.35;

export function computeCohortEconomics(
  input: CohortInput,
  fees: FeeProfile,
): CohortEconomics {
  const units = Math.max(0, input.units);
  const returnedUnits = clamp(input.returnedUnits ?? 0, 0, units);
  const netUnits = units - returnedUnits;
  // Revenue and variable fees only apply to units the customer kept.
  const retainedShare = units > 0 ? netUnits / units : 0;

  const grossRevenue = Math.max(0, input.grossRevenuePaise);
  const discount = clamp(input.discountPaise ?? 0, 0, grossRevenue);
  const brandDiscount = clamp(input.brandFundedDiscountPaise ?? discount, 0, discount);

  const retainedGross = Math.round(grossRevenue * retainedShare);
  const retainedDiscount = Math.round(discount * retainedShare);
  const retainedBrandDiscount = Math.round(brandDiscount * retainedShare);
  const retainedPlatformDiscount = retainedDiscount - retainedBrandDiscount;

  const customerPaid = Math.max(0, retainedGross - retainedDiscount);

  const commission = Math.round(customerPaid * fees.takeRate);
  const paymentFee = Math.round(customerPaid * fees.paymentFeeRate);
  const fulfilment = fees.fulfilmentFeePaise * netUnits;

  const returnFee = fees.returnHandlingFeePaise ?? fees.fulfilmentFeePaise;
  const writeOffRate = fees.returnWriteOffRate ?? DEFAULT_RETURN_WRITE_OFF;
  const returnCost =
    returnFee * returnedUnits +
    Math.round(input.cogsPerUnitPaise * returnedUnits * writeOffRate);

  // The platform keeps its own funded discount out of the settlement — the brand is only
  // docked for the share it agreed to fund.
  const settlement =
    retainedGross - retainedBrandDiscount - commission - paymentFee - fulfilment;

  const cogs = input.cogsPerUnitPaise * netUnits;
  const grossContribution = settlement - cogs - returnCost;

  const adSpend = Math.max(0, input.adSpendPaise ?? 0);
  const brandFundSpend = Math.max(0, input.brandFundSpendPaise ?? 0);
  const participationFee = Math.max(0, input.participationFeePaise ?? 0);
  const totalInvestment = adSpend + brandFundSpend + participationFee;
  const cashInvestment = adSpend + participationFee;

  const netContribution = grossContribution - totalInvestment;

  return {
    units,
    netUnits,
    returnRate: safeDiv(returnedUnits, units),
    retainedGrossPaise: retainedGross,
    customerPaidPaise: customerPaid,
    brandFundedDiscountPaise: retainedBrandDiscount,
    platformFundedDiscountPaise: retainedPlatformDiscount,
    commissionPaise: commission,
    fulfilmentPaise: fulfilment,
    paymentFeePaise: paymentFee,
    returnCostPaise: returnCost,
    settlementPaise: settlement,
    cogsPaise: cogs,
    grossContributionPaise: grossContribution,
    grossContributionRate: safeDiv(grossContribution, retainedGross),
    adSpendPaise: adSpend,
    brandFundSpendPaise: brandFundSpend,
    participationFeePaise: participationFee,
    totalInvestmentPaise: totalInvestment,
    cashInvestmentPaise: cashInvestment,
    netContributionPaise: netContribution,
    netContributionRate: safeDiv(netContribution, retainedGross),
    breakEvenRoas: breakEvenRoas(safeDiv(grossContribution, retainedGross)),
  };
}

/**
 * The revenue multiple needed to cover a rupee of ad spend at a given contribution rate.
 * Returns Infinity when the cohort has no margin to fund marketing at all.
 */
export function breakEvenRoas(grossContributionRate: number): number {
  if (grossContributionRate <= 0) return Number.POSITIVE_INFINITY;
  return 1 / grossContributionRate;
}

/** Fee profile for a listing, falling back to the platform defaults. */
export function resolveFeeProfile(
  listing: {
    takeRate?: number | null;
    fulfilmentFeePaise?: number | null;
    paymentFeeRate?: number | null;
  } | null,
  platform: {
    defaultTakeRate: number;
    defaultFulfilmentFeePaise: number;
    defaultPaymentFeeRate: number;
  },
): FeeProfile {
  return {
    takeRate: listing?.takeRate ?? platform.defaultTakeRate,
    fulfilmentFeePaise:
      listing?.fulfilmentFeePaise ?? platform.defaultFulfilmentFeePaise,
    paymentFeeRate: listing?.paymentFeeRate ?? platform.defaultPaymentFeeRate,
  };
}

/**
 * Highest discount the brand can fund and still clear `minContributionRate`.
 * Used to sanity-check a promotion before the brand signs up for a platform event.
 */
export function maxAffordableBrandDiscount(
  listingPricePaise: number,
  cogsPerUnitPaise: number,
  fees: FeeProfile,
  minContributionRate: number,
): { discountRate: number; discountPaise: number } {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const econ = computeCohortEconomics(
      {
        units: 1,
        grossRevenuePaise: listingPricePaise,
        discountPaise: Math.round(listingPricePaise * mid),
        brandFundedDiscountPaise: Math.round(listingPricePaise * mid),
        cogsPerUnitPaise,
      },
      fees,
    );
    if (econ.grossContributionRate >= minContributionRate) lo = mid;
    else hi = mid;
  }
  return { discountRate: lo, discountPaise: Math.round(listingPricePaise * lo) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
