/**
 * Amazon Ads connector.
 *
 * Amazon is the one platform in this set with a mature public API *and* a usable vendor
 * sandbox (advertising-api-test.amazon.com). The live path below implements the real flow:
 *
 *   1. LWA refresh-token grant  -> access token          (api.amazon.com/auth/o2/token)
 *   2. POST /reporting/reports  -> reportId              (async v3 reporting)
 *   3. GET  /reporting/reports/{id} until status=COMPLETED
 *   4. GET  the signed url      -> gzipped JSON rows
 *
 * The sandbox validates request shape and returns structural responses rather than real
 * numbers, which is exactly what we need to harden the integration before production access
 * is granted. When `mode` is sandbox we skip the network entirely and use the local
 * generator instead, so the product can be built and demoed end-to-end today.
 *
 * Docs (for the reader, not fetched at runtime):
 *   https://advertising.amazon.com/API/docs/en-us/offline-report-prod-3p
 */

import { gunzipSync } from "node:zlib";
import { AD_TYPES, type AdType } from "@/db/schema";
import { rupeesToPaise } from "@/lib/money";
import { generateSandboxPayload } from "./sandbox/generator";
import { profileFor } from "./sandbox/profiles";
import {
  ConnectorError,
  emptyPayload,
  type AdMetricRecord,
  type CampaignRecord,
  type Connector,
  type ConnectorContext,
  type ConnectorPayload,
  type DateRange,
} from "./types";

const DEFAULT_BASE_URL = "https://advertising-api-test.amazon.com";
const DEFAULT_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export const amazonAdsConnector: Connector = {
  platformId: "amazon",
  displayName: "Amazon Ads (India)",
  capabilities: {
    ads: true,
    skuAttribution: true,
    totalSales: true,
    promotions: false,
    brandFund: false,
    newToBrand: true,
    attributionWindowDays: 14,
    modes: ["sandbox", "live", "file"],
    note: profileFor("amazon").integrationNote,
  },
  async fetch(ctx, range) {
    if (ctx.mode !== "live") return generateSandboxPayload(ctx, range);
    return fetchLive(ctx, range);
  },
};

/* ------------------------------------------------------------------- live */

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(ctx: ConnectorContext): Promise<string> {
  const clientId = required(ctx, "AMAZON_ADS_CLIENT_ID");
  const clientSecret = required(ctx, "AMAZON_ADS_CLIENT_SECRET");
  const refreshToken = required(ctx, "AMAZON_ADS_REFRESH_TOKEN");
  const tokenUrl = ctx.credentials.AMAZON_LWA_TOKEN_URL || DEFAULT_TOKEN_URL;

  const cacheKey = `${clientId}:${refreshToken.slice(-8)}`;
  const cached = tokenCache.get(cacheKey);
  // 60s of slack so a token can't expire mid-report-poll.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new ConnectorError(
      `Amazon LWA token exchange failed (${res.status}): ${await safeText(res)}`,
      "amazon",
      res.status >= 500,
    );
  }

  const body = (await res.json()) as TokenResponse;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

function adsHeaders(ctx: ConnectorContext, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Amazon-Advertising-API-ClientId": required(ctx, "AMAZON_ADS_CLIENT_ID"),
    "Amazon-Advertising-API-Scope":
      ctx.credentials.AMAZON_ADS_PROFILE_ID ?? ctx.externalAccountId,
    "content-type": "application/json",
  };
}

async function fetchLive(
  ctx: ConnectorContext,
  range: DateRange,
): Promise<ConnectorPayload> {
  const payload = emptyPayload();
  const baseUrl = ctx.credentials.AMAZON_ADS_BASE_URL || DEFAULT_BASE_URL;
  const token = await getAccessToken(ctx);
  const headers = adsHeaders(ctx, token);

  if (baseUrl.includes("-test.")) {
    payload.warnings.push(
      "Connected to the Amazon Ads SANDBOX host. Responses are structurally valid but the figures are not real performance data.",
    );
  }

  payload.campaigns = await listCampaigns(baseUrl, headers, ctx);
  payload.adMetrics = await runAdReport(baseUrl, headers, range, ctx, payload.warnings);

  // Total (ad + organic) sales come from SP-API Sales & Traffic, a different credential
  // set and approval path. Until that's wired, TACOS/blended ROAS need the CSV importer.
  payload.warnings.push(
    "Total sales not fetched: Amazon total-sales data comes from SP-API Sales & Traffic, which needs separate authorisation. TACOS and blended ROAS will use imported sales if available.",
  );

  return payload;
}

/** POST /sp/campaigns/list — the v3 list endpoint, paginated by nextToken. */
async function listCampaigns(
  baseUrl: string,
  headers: Record<string, string>,
  ctx: ConnectorContext,
): Promise<CampaignRecord[]> {
  const out: CampaignRecord[] = [];
  let nextToken: string | undefined;

  do {
    const res = await fetch(`${baseUrl}/sp/campaigns/list`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/vnd.spcampaign.v3+json",
        accept: "application/vnd.spcampaign.v3+json",
      },
      body: JSON.stringify({ maxResults: 100, ...(nextToken ? { nextToken } : {}) }),
    });

    if (!res.ok) {
      throw new ConnectorError(
        `Amazon campaign list failed (${res.status}): ${await safeText(res)}`,
        "amazon",
        res.status === 429 || res.status >= 500,
      );
    }

    const body = (await res.json()) as {
      campaigns?: AmazonCampaign[];
      nextToken?: string;
    };

    for (const c of body.campaigns ?? []) {
      out.push({
        externalId: String(c.campaignId),
        name: c.name ?? `Campaign ${c.campaignId}`,
        adType: mapAdType(c.targetingType, "sponsored_product"),
        fundingSource: "brand_cash",
        dailyBudgetPaise: rupeesToPaise(c.budget?.budget ?? 0),
        bidStrategy: c.dynamicBidding?.strategy,
        status: mapStatus(c.state),
        startDay: c.startDate?.slice(0, 10),
        endDay: c.endDate?.slice(0, 10),
      });
    }
    nextToken = body.nextToken;
  } while (nextToken && out.length < 1000);

  if (out.length === 0) {
    ctx.logger?.("Amazon returned no campaigns — expected on a fresh sandbox profile.");
  }
  return out;
}

interface AmazonCampaign {
  campaignId: string | number;
  name?: string;
  state?: string;
  targetingType?: string;
  budget?: { budget?: number };
  dynamicBidding?: { strategy?: string };
  startDate?: string;
  endDate?: string;
}

/** The v3 async report flow: request -> poll -> download gzipped JSON. */
async function runAdReport(
  baseUrl: string,
  headers: Record<string, string>,
  range: DateRange,
  ctx: ConnectorContext,
  warnings: string[],
): Promise<AdMetricRecord[]> {
  const createRes = await fetch(`${baseUrl}/reporting/reports`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `roas-platform ${range.from}..${range.to}`,
      startDate: range.from,
      endDate: range.to,
      configuration: {
        adProduct: "SPONSORED_PRODUCTS",
        groupBy: ["campaign", "advertiser"],
        columns: [
          "date",
          "campaignId",
          "campaignName",
          "impressions",
          "clicks",
          "cost",
          "purchases14d",
          "unitsSoldClicks14d",
          "sales14d",
          "newToBrandPurchases14d",
          "newToBrandSales14d",
        ],
        reportTypeId: "spCampaigns",
        timeUnit: "DAILY",
        format: "GZIP_JSON",
      },
    }),
  });

  if (!createRes.ok) {
    throw new ConnectorError(
      `Amazon report request failed (${createRes.status}): ${await safeText(createRes)}`,
      "amazon",
      createRes.status === 429 || createRes.status >= 500,
    );
  }

  const { reportId } = (await createRes.json()) as { reportId: string };
  const url = await pollReport(baseUrl, headers, reportId, ctx);
  if (!url) {
    warnings.push(
      `Amazon report ${reportId} did not complete in time. It will be picked up on the next sync.`,
    );
    return [];
  }

  const rows = await downloadReport(url);
  return rows.map((r) => ({
    day: String(r.date).slice(0, 10),
    campaignExternalId: String(r.campaignId),
    externalSku: r.advertisedAsin ? String(r.advertisedAsin) : undefined,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    spendPaise: rupeesToPaise(Number(r.cost ?? 0)),
    orders: Number(r.purchases14d ?? 0),
    units: Number(r.unitsSoldClicks14d ?? 0),
    revenuePaise: rupeesToPaise(Number(r.sales14d ?? 0)),
    newCustomerOrders: Number(r.newToBrandPurchases14d ?? 0),
    newCustomerRevenuePaise: rupeesToPaise(Number(r.newToBrandSales14d ?? 0)),
    returnedUnits: 0,
  }));
}

async function pollReport(
  baseUrl: string,
  headers: Record<string, string>,
  reportId: string,
  ctx: ConnectorContext,
): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/reporting/reports/${reportId}`, { headers });
    if (!res.ok) {
      throw new ConnectorError(
        `Amazon report status failed (${res.status}): ${await safeText(res)}`,
        "amazon",
        res.status === 429 || res.status >= 500,
      );
    }
    const body = (await res.json()) as { status: string; url?: string; failureReason?: string };
    if (body.status === "COMPLETED" && body.url) return body.url;
    if (body.status === "FAILED") {
      throw new ConnectorError(
        `Amazon report failed: ${body.failureReason ?? "no reason given"}`,
        "amazon",
      );
    }
    ctx.logger?.(`Amazon report ${reportId}: ${body.status}`);
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function downloadReport(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ConnectorError(
      `Amazon report download failed (${res.status})`,
      "amazon",
      true,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  // Amazon returns GZIP_JSON; some sandbox responses come back uncompressed.
  const text =
    buffer[0] === 0x1f && buffer[1] === 0x8b
      ? gunzipSync(buffer).toString("utf8")
      : buffer.toString("utf8");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
}

function mapAdType(targetingType: string | undefined, fallback: AdType): AdType {
  const t = (targetingType ?? "").toLowerCase();
  if (t.includes("brand")) return "sponsored_brand";
  if (t.includes("display")) return "sponsored_display";
  const match = AD_TYPES.find((a) => a === t);
  return match ?? fallback;
}

function mapStatus(state: string | undefined): "enabled" | "paused" | "archived" {
  switch ((state ?? "").toUpperCase()) {
    case "PAUSED":
      return "paused";
    case "ARCHIVED":
      return "archived";
    default:
      return "enabled";
  }
}

function required(ctx: ConnectorContext, key: string): string {
  const value = ctx.credentials[key];
  if (!value) {
    throw new ConnectorError(
      `Missing ${key}. Set it in .env to use Amazon in live mode, or switch the account to sandbox.`,
      "amazon",
    );
  }
  return value;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
