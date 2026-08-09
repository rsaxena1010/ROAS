/**
 * CSV ingestion for the platforms with no self-serve API (Myntra, Nykaa, BigBasket,
 * Blinkit, Zepto today). The brand's team exports from the platform console; we parse it
 * into the same DTOs a live connector would produce.
 *
 * Header matching is fuzzy on purpose — every platform names these columns differently and
 * renames them between exports. Money columns are accepted in rupees (the unit every
 * platform exports) and converted to paise here.
 */

import { isValidDay, type Day } from "@/lib/date";
import { rupeesToPaise } from "@/lib/money";
import type { AdMetricRecord, SalesRecord } from "./types";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** RFC4180-ish parser: handles quoted fields, embedded commas, CRLF and escaped quotes. */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const out = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows: out };
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First column whose normalised name matches one of `candidates`. */
function pick(row: Record<string, string>, candidates: string[]): string | undefined {
  const map = new Map<string, string>();
  for (const k of Object.keys(row)) map.set(normaliseKey(k), row[k]);
  for (const c of candidates) {
    const v = map.get(normaliseKey(c));
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function num(value: string | undefined): number {
  if (!value) return 0;
  // Strip ₹, commas, spaces, and stray "INR".
  const cleaned = value.replace(/[₹,\s]/g, "").replace(/inr/gi, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function money(value: string | undefined): number {
  return rupeesToPaise(num(value));
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, and DD-Mon-YYYY. */
export function parseDay(value: string | undefined): Day | null {
  if (!value) return null;
  const v = value.trim();
  if (isValidDay(v)) return v;
  // `Day` is a string alias, so the guard above narrows `v` to `never` here. Hand the
  // remaining formats to a helper that takes a plain string rather than fight the narrowing.
  return parseNonIsoDay(v);
}

function parseNonIsoDay(v: string): Day | null {
  const slash = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = v.match(/^(\d{1,2})[- ]([A-Za-z]{3,})[- ](\d{4})$/);
  if (named) {
    const [, d, mon, y] = named;
    const idx = MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
    if (idx >= 0) return `${y}-${String(idx + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // ISO datetime — take the date part.
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return null;
}

export interface CsvIngestResult<T> {
  records: T[];
  skipped: number;
  warnings: string[];
}

/**
 * Ad performance export. Expected (fuzzy-matched) columns:
 *   date, campaign / campaign name, campaign id, ad group / creative, sku / asin / fsn /
 *   style id, impressions, clicks, spend / cost / amount spent, orders / conversions,
 *   units / quantity, revenue / sales / gmv, new customer orders, returns
 */
export function parseAdMetricsCsv(text: string): CsvIngestResult<AdMetricRecord> {
  const { rows, headers } = parseCsv(text);
  const records: AdMetricRecord[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  if (rows.length === 0) return { records, skipped: 0, warnings: ["Empty file."] };

  for (const row of rows) {
    const day = parseDay(pick(row, ["date", "day", "reportdate", "orderdate"]));
    const campaign = pick(row, ["campaignid", "campaign", "campaignname"]);
    if (!day || !campaign) {
      skipped++;
      continue;
    }
    records.push({
      day,
      campaignExternalId: campaign,
      assetExternalId: pick(row, ["adgroupid", "adgroup", "creative", "creativeid", "asset", "assetid"]),
      externalSku: pick(row, ["sku", "asin", "fsn", "styleid", "productid", "itemcode", "skucode"]),
      impressions: num(pick(row, ["impressions", "views", "impr"])),
      clicks: num(pick(row, ["clicks", "click"])),
      spendPaise: money(pick(row, ["spend", "cost", "amountspent", "adspend", "spends"])),
      orders: num(pick(row, ["orders", "conversions", "totalorders", "attributedorders"])),
      units: num(pick(row, ["units", "quantity", "unitssold", "attributedunits"])),
      revenuePaise: money(
        pick(row, ["revenue", "sales", "gmv", "attributedsales", "salesvalue", "adrevenue"]),
      ),
      newCustomerOrders: num(
        pick(row, ["newcustomerorders", "ntborders", "newtobrandorders", "newcustomers"]),
      ),
      newCustomerRevenuePaise: money(
        pick(row, ["newcustomerrevenue", "ntbsales", "newtobrandsales"]),
      ),
      returnedUnits: num(pick(row, ["returns", "returnedunits", "rto", "cancellations"])),
    });
  }

  if (records.length > 0 && records.every((r) => r.revenuePaise === 0)) {
    warnings.push(
      `No revenue column recognised. Headers seen: ${headers.join(", ")}. Rename the sales column to "revenue".`,
    );
  }
  if (skipped > 0) warnings.push(`${skipped} row(s) skipped: missing date or campaign.`);

  return { records, skipped, warnings };
}

/**
 * Total sales export (ad + organic), per SKU per day. Needed for TACOS and blended ROAS.
 *   date, sku, units, gmv / gross revenue, discount, returns, new customers
 */
export function parseSalesCsv(text: string): CsvIngestResult<SalesRecord> {
  const { rows } = parseCsv(text);
  const records: SalesRecord[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const day = parseDay(pick(row, ["date", "day", "orderdate"]));
    const sku = pick(row, ["sku", "asin", "fsn", "styleid", "productid", "itemcode", "skucode"]);
    if (!day || !sku) {
      skipped++;
      continue;
    }
    records.push({
      day,
      externalSku: sku,
      units: num(pick(row, ["units", "quantity", "unitssold"])),
      grossRevenuePaise: money(
        pick(row, ["grossrevenue", "gmv", "revenue", "sales", "mrpvalue", "grosssales"]),
      ),
      discountPaise: money(
        pick(row, ["discount", "discountamount", "totaldiscount", "promodiscount"]),
      ),
      returnedUnits: num(pick(row, ["returns", "returnedunits", "rto", "cancellations"])),
      newCustomers: num(pick(row, ["newcustomers", "ntbcustomers", "newtobrand"])),
    });
  }

  if (skipped > 0) warnings.push(`${skipped} row(s) skipped: missing date or SKU.`);
  return { records, skipped, warnings };
}
