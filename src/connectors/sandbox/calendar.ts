/**
 * Indian digital-commerce event calendar.
 *
 * Demand on these platforms is violently seasonal and the seasonality is platform-specific:
 * a Myntra EORS week and a Blinkit salary-day spike look nothing alike. Modelling this
 * matters because it's the main confounder the product has to help brands see past —
 * "ROAS doubled" during Big Billion Days is not a media-buying win.
 *
 * Events are keyed on MM-DD so the generator works for any year.
 */

import { dayOfWeek, type Day } from "@/lib/date";

export interface SaleEvent {
  name: string;
  /** MM-DD inclusive. */
  from: string;
  to: string;
  platforms: string[];
  /** Demand multiplier at the peak. */
  demandLift: number;
  /** Typical headline discount during the event. */
  discountRate: number;
  /** Share of that discount the brand is expected to fund. */
  brandFundedShare: number;
  promoType:
    | "platform_event"
    | "deal_of_day"
    | "coupon"
    | "price_off"
    | "bank_offer"
    | "cashback";
}

export const SALE_EVENTS: SaleEvent[] = [
  {
    name: "Republic Day Sale",
    from: "01-18",
    to: "01-26",
    platforms: ["amazon", "flipkart", "myntra"],
    demandLift: 2.3,
    discountRate: 0.3,
    brandFundedShare: 0.6,
    promoType: "platform_event",
  },
  {
    name: "Holi Fest",
    from: "03-06",
    to: "03-14",
    platforms: ["bigbasket", "blinkit", "zepto"],
    demandLift: 1.7,
    discountRate: 0.18,
    brandFundedShare: 0.75,
    promoType: "price_off",
  },
  {
    name: "Summer Beauty Bonanza",
    from: "05-16",
    to: "05-24",
    platforms: ["nykaa", "myntra"],
    demandLift: 2.0,
    discountRate: 0.28,
    brandFundedShare: 0.7,
    promoType: "platform_event",
  },
  {
    name: "End Of Reason Sale",
    from: "06-06",
    to: "06-15",
    platforms: ["myntra"],
    demandLift: 3.1,
    discountRate: 0.45,
    brandFundedShare: 0.8,
    promoType: "platform_event",
  },
  {
    name: "Prime Day",
    from: "07-12",
    to: "07-15",
    platforms: ["amazon"],
    demandLift: 2.8,
    discountRate: 0.32,
    brandFundedShare: 0.65,
    promoType: "platform_event",
  },
  {
    name: "Freedom Sale",
    from: "08-05",
    to: "08-12",
    platforms: ["amazon", "flipkart", "nykaa"],
    demandLift: 2.2,
    discountRate: 0.27,
    brandFundedShare: 0.6,
    promoType: "platform_event",
  },
  {
    name: "Monsoon Carnival",
    from: "08-20",
    to: "08-26",
    platforms: ["bigbasket", "blinkit", "zepto"],
    demandLift: 1.5,
    discountRate: 0.15,
    brandFundedShare: 0.85,
    promoType: "cashback",
  },
  {
    name: "Great Indian Festival / Big Billion Days",
    from: "09-27",
    to: "10-10",
    platforms: ["amazon", "flipkart", "myntra", "nykaa"],
    demandLift: 4.2,
    discountRate: 0.42,
    brandFundedShare: 0.7,
    promoType: "platform_event",
  },
  {
    name: "Pink Friday",
    from: "11-20",
    to: "11-30",
    platforms: ["nykaa"],
    demandLift: 2.9,
    discountRate: 0.35,
    brandFundedShare: 0.75,
    promoType: "platform_event",
  },
  {
    name: "Year End Clearance",
    from: "12-22",
    to: "12-31",
    platforms: ["amazon", "flipkart", "myntra", "bigbasket"],
    demandLift: 1.9,
    discountRate: 0.33,
    brandFundedShare: 0.65,
    promoType: "platform_event",
  },
];

export function eventsOn(day: Day, platformId: string): SaleEvent[] {
  const md = day.slice(5);
  return SALE_EVENTS.filter(
    (e) => e.platforms.includes(platformId) && md >= e.from && md <= e.to,
  );
}

/** Peak-shaped lift: ramps up over the event and tails off, rather than a flat step. */
export function eventDemandLift(day: Day, platformId: string): number {
  let lift = 1;
  for (const e of eventsOn(day, platformId)) {
    const md = day.slice(5);
    const span = Math.max(1, dayIndex(e.to) - dayIndex(e.from));
    const pos = (dayIndex(md) - dayIndex(e.from)) / span; // 0..1
    // Front-loaded: day 1–2 of an Indian sale event is the spike.
    const shape = Math.sin(Math.PI * Math.min(1, Math.max(0, pos * 0.85 + 0.15)));
    lift *= 1 + (e.demandLift - 1) * shape;
  }
  return lift;
}

/**
 * Non-event seasonality: weekend uplift on marketplaces, salary-week uplift on quick
 * commerce (1st–5th of the month), plus a mild mid-month trough.
 */
export function baseSeasonality(day: Day, kind: "marketplace" | "quick_commerce" | "d2c"): number {
  const dow = dayOfWeek(day);
  const dom = Number(day.slice(8, 10));

  let f = 1;
  if (kind === "quick_commerce") {
    // Quick commerce peaks Fri–Sun evenings and right after payday.
    f *= dow === 5 || dow === 6 ? 1.22 : dow === 0 ? 1.12 : 0.97;
    f *= dom <= 5 ? 1.18 : dom <= 10 ? 1.05 : dom >= 26 ? 0.9 : 1;
  } else {
    f *= dow === 0 || dow === 6 ? 1.14 : dow === 1 ? 1.03 : 0.98;
    f *= dom <= 4 ? 1.09 : dom >= 25 ? 0.93 : 1;
  }
  return f;
}

function dayIndex(md: string): number {
  const [m, d] = md.split("-").map(Number);
  return m * 31 + d;
}
