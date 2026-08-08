# Connecting real Amazon accounts

The Amazon connector (`backend/app/connectors/amazon/`) is fully implemented
against Amazon's documented API contracts — LWA OAuth, Ads API v3 reporting,
and SP-API orders — and is covered by tests that mock the HTTP layer with
Amazon's real response shapes
(`backend/app/tests/test_amazon_connector.py`). With no credentials
configured it runs on synthetic data; drop in credentials and it switches
over automatically, with no code changes.

## A note on "Amazon sandbox"

Unlike some other providers, Amazon does not offer a fully open, self-serve
sandbox. What exists instead:

- **Advertising API**: an approved LWA application can hit
  `https://advertising-api-test.amazon.com`, a separate host that accepts
  the same request/response shapes as production but returns Amazon-owned
  test data rather than a real account's data. You still need an approved
  Amazon Ads API developer application to get here.
- **SP-API**: there's no separate sandbox host; self-authorized apps in
  "Draft" status can call a limited set of endpoints against static example
  data before the app is published.

So "linking to Amazon's sandbox" concretely means: register a real app,
get it approved, and point this connector's environment setting at
`sandbox`. There is no anonymous/no-registration sandbox to hit.

## Steps to go from MOCK to SANDBOX

1. **Register an Advertising API application**
   - Go to https://advertising.amazon.com/API/docs/en-us/setting-up/overview
   - Create a Login with Amazon (LWA) security profile to get a Client
     ID/Secret.
   - Apply for Advertising API access (requires an active seller/vendor or
     agency account tied to the profile you'll report on).
   - Complete the LWA authorization code grant once manually to get a
     `refresh_token` (Amazon's OAuth walkthrough covers this — it's a
     one-time browser redirect flow).
   - Note your advertising **profile ID** (`GET /v2/profiles` once you have
     a token) — this scopes which seller account's campaigns you're
     reading.

2. **Register a Selling Partner API application** (for order data)
   - In Seller Central → Apps & Services → Develop Apps, create a
     self-authorized app.
   - Authorize it against your own seller account to get a refresh token.
   - Grab your marketplace ID from
     https://developer-docs.amazon.com/sp-api/docs/marketplace-ids.

3. **Fill in `backend/.env`** (copy from `.env.example`):
   ```
   AMAZON_ADS_CLIENT_ID=...
   AMAZON_ADS_CLIENT_SECRET=...
   AMAZON_ADS_REFRESH_TOKEN=...
   AMAZON_ADS_PROFILE_ID=...
   AMAZON_ADS_ENVIRONMENT=sandbox

   AMAZON_SP_CLIENT_ID=...
   AMAZON_SP_CLIENT_SECRET=...
   AMAZON_SP_REFRESH_TOKEN=...
   AMAZON_SP_MARKETPLACE_ID=...
   AMAZON_SP_REGION=na
   ```

4. **Restart the backend.** `app/connectors/factory.py` reads these on
   every connector construction — the next time you create or sync an
   Amazon connection for a brand, `AmazonConnector.resolve_mode()` will see
   real credentials and switch to `SANDBOX` (or `LIVE` if you set
   `AMAZON_ADS_ENVIRONMENT=live`). Check via:
   ```
   POST /api/brands/{brand_id}/connections/{connection_id}/test
   ```
   which calls `list_campaigns()` for real and reports whether the
   round-trip succeeded.

## What's simplified vs. a production integration

- **SP-API pagination**: `AmazonSpClient.list_orders` fetches one page.
  Production code should follow `NextToken` until exhausted.
- **New-vs-returning customers**: SP-API doesn't expose this, so Amazon's
  CAC falls back to spend ÷ total orders rather than spend ÷ new customers
  (see `metrics_service.py`).
- **Report types**: only the Sponsored Products `spCampaigns` report is
  implemented. Sponsored Brands/Display and search-term-level reports
  follow the same `AmazonAdsClient._create_report` pattern — extend
  `_REPORT_COLUMNS`/`reportTypeId` per
  https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types.
- **Attribution window**: mapped straight from `attributedSales14d`; adjust
  if your brand's consideration cycle needs a different window.
