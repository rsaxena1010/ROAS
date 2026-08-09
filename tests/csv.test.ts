import { describe, expect, it } from "vitest";
import { parseAdMetricsCsv, parseCsv, parseDay, parseSalesCsv } from "@/connectors/csv";
import { rupeesToPaise } from "@/lib/money";

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas and escaped quotes", () => {
    const { headers, rows } = parseCsv(
      'name,note\n"Summer, Sale","He said ""hi"""\n',
    );
    expect(headers).toEqual(["name", "note"]);
    expect(rows[0].name).toBe("Summer, Sale");
    expect(rows[0].note).toBe('He said "hi"');
  });

  it("tolerates CRLF, trailing newlines and blank lines", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ a: "3", b: "4" });
  });

  it("returns nothing for an empty document", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
    expect(parseCsv("\n\n")).toEqual({ headers: [], rows: [] });
  });

  it("pads short rows rather than dropping them", () => {
    const { rows } = parseCsv("a,b,c\n1,2\n");
    expect(rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });
});

describe("parseDay", () => {
  it("accepts an ISO day unchanged", () => {
    expect(parseDay("2026-08-09")).toBe("2026-08-09");
  });

  // Regression: `Day` is a string alias, so the ISO type-guard narrowed the remaining
  // formats to `never` and every non-ISO date silently failed to parse.
  it("accepts the non-ISO formats Indian platform exports actually use", () => {
    expect(parseDay("09/08/2026")).toBe("2026-08-09");
    expect(parseDay("9/8/2026")).toBe("2026-08-09");
    expect(parseDay("09-08-2026")).toBe("2026-08-09");
    expect(parseDay("9-Aug-2026")).toBe("2026-08-09");
    expect(parseDay("09 August 2026")).toBe("2026-08-09");
    expect(parseDay("2026-08-09T13:45:00Z")).toBe("2026-08-09");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDay("  2026-08-09  ")).toBe("2026-08-09");
    expect(parseDay(" 09/08/2026 ")).toBe("2026-08-09");
  });

  it("rejects anything it cannot read", () => {
    expect(parseDay(undefined)).toBe(null);
    expect(parseDay("")).toBe(null);
    expect(parseDay("not a date")).toBe(null);
    expect(parseDay("09/08/26")).toBe(null);
    expect(parseDay("9-Xyz-2026")).toBe(null);
  });
});

describe("parseAdMetricsCsv", () => {
  const csv = [
    "Date,Campaign Name,Ad Group,ASIN,Impressions,Clicks,Spend,Orders,Units,Sales,NTB Orders,Returns",
    "2026-08-01,Summer SP,Cluster A,B0TEST123,18400,412,\"₹3,200.50\",26,31,\"14,800\",9,1",
    "09/08/2026,Summer SP,Cluster A,B0TEST123,1000,20,100,2,2,900,1,0",
  ].join("\n");

  it("maps loosely-named headers and converts rupees to paise", () => {
    const { records, skipped, warnings } = parseAdMetricsCsv(csv);
    expect(skipped).toBe(0);
    expect(warnings).toHaveLength(0);
    expect(records).toHaveLength(2);

    const [first] = records;
    expect(first.day).toBe("2026-08-01");
    expect(first.campaignExternalId).toBe("Summer SP");
    expect(first.assetExternalId).toBe("Cluster A");
    expect(first.externalSku).toBe("B0TEST123");
    expect(first.impressions).toBe(18_400);
    // Currency symbols and thousands separators are stripped before conversion.
    expect(first.spendPaise).toBe(rupeesToPaise(3_200.5));
    expect(first.revenuePaise).toBe(rupeesToPaise(14_800));
    expect(first.newCustomerOrders).toBe(9);
    expect(first.returnedUnits).toBe(1);
  });

  it("normalises mixed date formats within one file", () => {
    const { records } = parseAdMetricsCsv(csv);
    expect(records.map((r) => r.day)).toEqual(["2026-08-01", "2026-08-09"]);
  });

  it("skips rows with no date or no campaign and says how many", () => {
    const { records, skipped, warnings } = parseAdMetricsCsv(
      ["date,campaign,spend", "2026-08-01,Has Campaign,100", ",No Date,50", "2026-08-02,,50"].join(
        "\n",
      ),
    );
    expect(records).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(warnings.join(" ")).toMatch(/2 row\(s\) skipped/);
  });

  it("warns when no revenue column was recognised, listing the headers seen", () => {
    const { warnings } = parseAdMetricsCsv(
      ["date,campaign,spend,turnover", "2026-08-01,C,100,5000"].join("\n"),
    );
    expect(warnings.join(" ")).toMatch(/No revenue column recognised/);
    expect(warnings.join(" ")).toMatch(/turnover/);
  });

  it("reports an empty file rather than throwing", () => {
    expect(parseAdMetricsCsv("")).toEqual({ records: [], skipped: 0, warnings: ["Empty file."] });
  });
});

describe("parseSalesCsv", () => {
  it("reads total sales rows including the discount column", () => {
    const { records, skipped } = parseSalesCsv(
      [
        "Date,SKU,Units Sold,GMV,Total Discount,Returns,NTB Customers",
        "2026-08-01,VN-FW-001,120,\"₹96,000\",\"₹12,000\",6,44",
      ].join("\n"),
    );
    expect(skipped).toBe(0);
    expect(records[0]).toEqual({
      day: "2026-08-01",
      externalSku: "VN-FW-001",
      units: 120,
      grossRevenuePaise: rupeesToPaise(96_000),
      discountPaise: rupeesToPaise(12_000),
      returnedUnits: 6,
      newCustomers: 44,
    });
  });

  it("skips rows missing a date or a SKU", () => {
    const { records, skipped } = parseSalesCsv(
      ["date,sku,units", "2026-08-01,VN-1,5", "2026-08-02,,5", ",VN-2,5"].join("\n"),
    );
    expect(records).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it("defaults absent numeric columns to zero instead of NaN", () => {
    const { records } = parseSalesCsv(["date,sku", "2026-08-01,VN-1"].join("\n"));
    expect(records[0].units).toBe(0);
    expect(records[0].grossRevenuePaise).toBe(0);
    expect(records[0].discountPaise).toBe(0);
  });
});
