/**
 * Flipkart connector.
 *
 * Flipkart's seller APIs are partner-gated with a sandbox host
 * (sandbox-api.flipkart.net) and OAuth2 client-credentials. Ad (PLA) reporting is
 * available to approved sellers via an async report endpoint similar in shape to Amazon's.
 *
 * Access is not granted yet, so the live path here is written to the documented shape and
 * exercised against the sandbox host; sandbox mode uses the local generator.
 */

import { rupeesToPaise } from "@/lib/money";
import { generateSandboxPayload } from "./sandbox/generator";
import { profileFor } from "./sandbox/profiles";
import {
  ConnectorError,
  emptyPayload,
  type AdMetricRecord,
  type Connector,
  type ConnectorContext,
  type ConnectorPayload,
  type DateRange,
} from "./types";

const DEFAULT_BASE_URL = "https://sandbox-api.flipkart.net";

export const flipkartConnector: Connector = {
  platformId: "flipkart",
  displayName: "Flipkart Ads",
  capabilities: {
    ads: true,
    skuAttribution: true,
    totalSales: true,
    promotions: true,
    brandFund: true,
    newToBrand: false,
    attributionWindowDays: 7,
    modes: ["sandbox", "live", "file"],
    note: profileFor("flipkart").integrationNote,
  },
  async fetch(ctx, range) {
    if (ctx.mode !== "live") return generateSandboxPayload(ctx, range);
    return fetchLive(ctx, range);
  },
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(ctx: ConnectorContext): Promise<string> {
  const clientId = required(ctx, "FLIPKART_CLIENT_ID");
  const clientSecret = required(ctx, "FLIPKART_CLIENT_SECRET");
  const baseUrl = ctx.credentials.FLIPKART_BASE_URL || DEFAULT_BASE_URL;

  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(
    `${baseUrl}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`,
    { headers: { Authorization: `Basic ${basic}` } },
  );

  if (!res.ok) {
    throw new ConnectorError(
      `Flipkart token exchange failed (${res.status}): ${await safeText(res)}`,
      "flipkart",
      res.status >= 500,
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(clientId, {
    token: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

async function fetchLive(
  ctx: ConnectorContext,
  range: DateRange,
): Promise<ConnectorPayload> {
  const payload = emptyPayload();
  const baseUrl = ctx.credentials.FLIPKART_BASE_URL || DEFAULT_BASE_URL;
  const token = await getAccessToken(ctx);
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  if (baseUrl.includes("sandbox")) {
    payload.warnings.push(
      "Connected to the Flipkart SANDBOX host. Campaign structure is real-shaped; performance figures are not.",
    );
  }

  const res = await fetch(`${baseUrl}/sellers/v1/ads/campaigns/reports`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      startDate: range.from,
      endDate: range.to,
      granularity: "DAY",
      metrics: [
        "impressions",
        "clicks",
        "spend",
        "orders",
        "units",
        "revenue",
        "returns",
      ],
      groupBy: ["campaign", "fsn"],
    }),
  });

  if (!res.ok) {
    // 403 here almost always means the seller account isn't approved for the Ads scope
    // rather than a bad token, so say so instead of a generic auth error.
    if (res.status === 403) {
      throw new ConnectorError(
        "Flipkart returned 403 for the Ads reporting scope. The seller account needs Ads API approval; keep this account in sandbox or file mode until then.",
        "flipkart",
      );
    }
    throw new ConnectorError(
      `Flipkart ad report failed (${res.status}): ${await safeText(res)}`,
      "flipkart",
      res.status === 429 || res.status >= 500,
    );
  }

  const body = (await res.json()) as { rows?: FlipkartRow[] };
  payload.adMetrics = (body.rows ?? []).map(mapRow);
  payload.warnings.push(
    "Flipkart total-sales and brand-fund statements are separate endpoints on the seller API; not yet wired.",
  );
  return payload;
}

interface FlipkartRow {
  date: string;
  campaignId: string | number;
  campaignName?: string;
  adGroupId?: string | number;
  fsn?: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
  orders?: number;
  units?: number;
  revenue?: number;
  returns?: number;
}

function mapRow(r: FlipkartRow): AdMetricRecord {
  return {
    day: String(r.date).slice(0, 10),
    campaignExternalId: String(r.campaignId),
    assetExternalId: r.adGroupId != null ? String(r.adGroupId) : undefined,
    externalSku: r.fsn,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    spendPaise: rupeesToPaise(Number(r.spend ?? 0)),
    orders: Number(r.orders ?? 0),
    units: Number(r.units ?? 0),
    revenuePaise: rupeesToPaise(Number(r.revenue ?? 0)),
    // Flipkart PLA reporting has no new-to-brand metric. CAC on Flipkart is therefore
    // estimated from the sales-side new-customer count, not the ad platform.
    newCustomerOrders: 0,
    newCustomerRevenuePaise: 0,
    returnedUnits: Number(r.returns ?? 0),
  };
}

function required(ctx: ConnectorContext, key: string): string {
  const value = ctx.credentials[key];
  if (!value) {
    throw new ConnectorError(
      `Missing ${key}. Set it in .env to use Flipkart in live mode, or switch the account to sandbox.`,
      "flipkart",
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
