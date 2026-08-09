/**
 * Connector registry.
 *
 * Amazon and Flipkart have hand-written adapters because they have real APIs to talk to.
 * Myntra, Nykaa, BigBasket, Blinkit and Zepto have no public self-serve ads API today, so
 * they get a generic connector: sandbox data for building and demoing, CSV/report-file
 * ingestion for real numbers, and a clear error if someone flips them to live mode.
 *
 * Adding a real adapter later is a one-line change here — nothing downstream cares.
 */

import { amazonAdsConnector } from "./amazon-ads";
import { flipkartConnector } from "./flipkart-ads";
import { generateSandboxPayload } from "./sandbox/generator";
import { PLATFORM_PROFILES, profileFor } from "./sandbox/profiles";
import {
  ConnectorError,
  type Connector,
  type ConnectorCapabilities,
} from "./types";

/** Platforms we model but can only reach through exported report files. */
const FILE_ONLY_PLATFORMS = ["myntra", "nykaa", "bigbasket", "blinkit", "zepto"] as const;

function fileOnlyConnector(platformId: string): Connector {
  const profile = profileFor(platformId);
  const capabilities: ConnectorCapabilities = {
    ads: true,
    skuAttribution: true,
    totalSales: true,
    promotions: true,
    brandFund: profile.brandFundAccrualRate > 0,
    // Quick-commerce consoles generally don't expose new-to-brand; CAC falls back to the
    // sales-side new-customer count.
    newToBrand: profile.kind !== "quick_commerce",
    attributionWindowDays: profile.attributionWindowDays,
    modes: ["sandbox", "file"],
    note: profile.integrationNote,
  };

  return {
    platformId,
    displayName: profile.name,
    capabilities,
    async fetch(ctx, range) {
      if (ctx.mode === "live") {
        throw new ConnectorError(
          `${profile.name} has no public ads API to call. Use sandbox mode to build against synthetic data, or file mode and upload the console export at /settings/imports.`,
          platformId,
        );
      }
      if (ctx.mode === "file") {
        // File-mode rows arrive through the import endpoint, not a pull. Returning an
        // empty payload keeps the sync log honest rather than inventing data.
        return {
          campaigns: [],
          adMetrics: [],
          sales: [],
          promotions: [],
          brandFund: [],
          warnings: [
            `${profile.name} is in file mode: nothing to pull. Upload the latest export at /settings/imports.`,
          ],
        };
      }
      return generateSandboxPayload(ctx, range);
    },
  };
}

const CONNECTORS = new Map<string, Connector>([
  [amazonAdsConnector.platformId, amazonAdsConnector],
  [flipkartConnector.platformId, flipkartConnector],
  ...FILE_ONLY_PLATFORMS.map(
    (id) => [id, fileOnlyConnector(id)] as [string, Connector],
  ),
]);

export function getConnector(platformId: string): Connector {
  const c = CONNECTORS.get(platformId);
  if (!c) {
    throw new ConnectorError(`No connector registered for "${platformId}"`, platformId);
  }
  return c;
}

export function listConnectors(): Connector[] {
  return PLATFORM_PROFILES.map((p) => getConnector(p.id));
}

/**
 * Secrets are read from the environment per platform and passed to the connector at call
 * time. They are deliberately never written to the database — platform_accounts.config
 * holds non-secret settings only.
 */
export function credentialsFor(platformId: string): Record<string, string | undefined> {
  const e = process.env;
  switch (platformId) {
    case "amazon":
      return {
        AMAZON_ADS_CLIENT_ID: e.AMAZON_ADS_CLIENT_ID,
        AMAZON_ADS_CLIENT_SECRET: e.AMAZON_ADS_CLIENT_SECRET,
        AMAZON_ADS_REFRESH_TOKEN: e.AMAZON_ADS_REFRESH_TOKEN,
        AMAZON_ADS_PROFILE_ID: e.AMAZON_ADS_PROFILE_ID,
        AMAZON_ADS_BASE_URL: e.AMAZON_ADS_BASE_URL,
        AMAZON_LWA_TOKEN_URL: e.AMAZON_LWA_TOKEN_URL,
      };
    case "flipkart":
      return {
        FLIPKART_CLIENT_ID: e.FLIPKART_CLIENT_ID,
        FLIPKART_CLIENT_SECRET: e.FLIPKART_CLIENT_SECRET,
        FLIPKART_BASE_URL: e.FLIPKART_BASE_URL,
      };
    default:
      return {
        BASE_URL: e[`${platformId.toUpperCase()}_BASE_URL`],
      };
  }
}

/** The mode an account should use when the operator hasn't chosen one explicitly. */
export function defaultModeFor(platformId: string): "sandbox" | "live" | "file" {
  const envMode = process.env.CONNECTOR_MODE;
  if (envMode === "live") {
    const connector = getConnector(platformId);
    return connector.capabilities.modes.includes("live") ? "live" : "sandbox";
  }
  return "sandbox";
}
