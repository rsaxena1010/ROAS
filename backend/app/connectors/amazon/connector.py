"""Amazon connector: Sponsored Products (Ads API v3) + Orders (SP-API).

In MOCK mode (no credentials configured) this produces synthetic data
through the same generator every other platform uses, so the rest of the
app behaves identically regardless of mode. In SANDBOX/LIVE mode it drives
the real LWA OAuth + Ads API + SP-API request/response flows implemented in
`ads_client.py` / `sp_client.py` / `auth.py`.

To go live: set AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET /
AMAZON_ADS_REFRESH_TOKEN / AMAZON_ADS_PROFILE_ID and AMAZON_SP_CLIENT_ID /
AMAZON_SP_CLIENT_SECRET / AMAZON_SP_REFRESH_TOKEN / AMAZON_SP_MARKETPLACE_ID
(see .env.example and docs/AMAZON_INTEGRATION.md). Nothing else changes —
the connector automatically switches out of MOCK mode.
"""
from __future__ import annotations

from datetime import date

import httpx

from app.connectors.amazon.ads_client import (
    PRODUCTION_HOST as ADS_PRODUCTION_HOST,
)
from app.connectors.amazon.ads_client import (
    SANDBOX_HOST as ADS_SANDBOX_HOST,
)
from app.connectors.amazon.ads_client import AmazonAdsClient
from app.connectors.amazon.auth import LwaTokenProvider
from app.connectors.amazon.sp_client import HOSTS as SP_HOSTS
from app.connectors.amazon.sp_client import AmazonSpClient
from app.connectors.base import (
    AdMetricRecord,
    CampaignRecord,
    ConnectionStatus,
    ConnectorCredentials,
    ConnectorMode,
    MarketplaceConnector,
    OrderRecord,
)
from app.connectors.common import synthetic
from app.connectors.registry import register

_REQUIRED_ADS_KEYS = ("ads_client_id", "ads_client_secret", "ads_refresh_token", "ads_profile_id")
_REQUIRED_SP_KEYS = ("sp_client_id", "sp_client_secret", "sp_refresh_token", "sp_marketplace_id")


@register
class AmazonConnector(MarketplaceConnector):
    platform_key = "amazon"
    display_name = "Amazon"

    # mock-mode tuning — Amazon is usually a brand's largest, most efficient channel
    num_campaigns = 6
    avg_daily_spend = 9000.0
    target_roas = 4.6
    avg_orders_per_day = 55.0
    aov = 620.0
    new_customer_rate = 0.3

    def __init__(
        self,
        brand_id: int,
        credentials: ConnectorCredentials | None = None,
        mode: ConnectorMode | None = None,
        environment: str = "sandbox",
        sp_region: str = "na",
        http_client: httpx.Client | None = None,
    ) -> None:
        self.environment = environment
        self.sp_region = sp_region
        self._http_client = http_client or httpx.Client(timeout=30.0)
        super().__init__(brand_id, credentials, mode)

    @classmethod
    def resolve_mode(cls, credentials: ConnectorCredentials) -> ConnectorMode:
        if not credentials or not all(credentials.get(k) for k in _REQUIRED_ADS_KEYS):
            return ConnectorMode.MOCK
        return ConnectorMode.LIVE if credentials.get("environment") == "live" else ConnectorMode.SANDBOX

    # -- lazy real-API clients, only ever constructed outside MOCK mode -----
    @property
    def _ads_client(self) -> AmazonAdsClient:
        host = ADS_PRODUCTION_HOST if self.mode == ConnectorMode.LIVE else ADS_SANDBOX_HOST
        token_provider = LwaTokenProvider(
            self._http_client,
            self.credentials.get("ads_client_id"),
            self.credentials.get("ads_client_secret"),
            self.credentials.get("ads_refresh_token"),
        )
        return AmazonAdsClient(
            self._http_client,
            host,
            self.credentials.get("ads_client_id"),
            self.credentials.get("ads_profile_id"),
            token_provider.get_token,
            poll_interval_seconds=0 if self.mode == ConnectorMode.SANDBOX else 2.0,
        )

    @property
    def _sp_client(self) -> AmazonSpClient | None:
        if not all(self.credentials.get(k) for k in _REQUIRED_SP_KEYS):
            return None
        host = SP_HOSTS.get(self.sp_region, SP_HOSTS["na"])
        token_provider = LwaTokenProvider(
            self._http_client,
            self.credentials.get("sp_client_id"),
            self.credentials.get("sp_client_secret"),
            self.credentials.get("sp_refresh_token"),
        )
        return AmazonSpClient(
            self._http_client, host, self.credentials.get("sp_marketplace_id"), token_provider.get_token
        )

    def test_connection(self) -> ConnectionStatus:
        if self.mode == ConnectorMode.MOCK:
            return ConnectionStatus(
                connected=True,
                mode=ConnectorMode.MOCK,
                detail="Amazon: using synthetic data — no Ads API / SP-API credentials configured.",
            )
        try:
            self._ads_client.list_campaigns()
        except Exception as exc:  # noqa: BLE001
            return ConnectionStatus(connected=False, mode=self.mode, detail=str(exc))
        return ConnectionStatus(
            connected=True, mode=self.mode, detail=f"Amazon Ads API reachable ({self.mode.value})."
        )

    def fetch_campaigns(self) -> list[CampaignRecord]:
        if self.mode == ConnectorMode.MOCK:
            return synthetic.make_campaigns(
                self.brand_id, self.platform_key, self.display_name, self.num_campaigns
            )
        rows = self._ads_client.list_campaigns()
        return [
            CampaignRecord(
                external_campaign_id=str(row["campaignId"]),
                name=row.get("name", f"Campaign {row['campaignId']}"),
                campaign_type="sponsored_products",
            )
            for row in rows
        ]

    def fetch_ad_metrics(self, start: date, end: date) -> list[AdMetricRecord]:
        if self.mode == ConnectorMode.MOCK:
            campaigns = self.fetch_campaigns()
            return synthetic.make_ad_metrics(
                self.brand_id,
                self.platform_key,
                campaigns,
                start,
                end,
                avg_daily_spend=self.avg_daily_spend,
                target_roas=self.target_roas,
            )
        rows = self._ads_client.fetch_campaign_report(start, end)
        return [
            AdMetricRecord(
                external_campaign_id=str(row["campaignId"]),
                date=date.fromisoformat(row["date"]),
                impressions=int(row.get("impressions", 0)),
                clicks=int(row.get("clicks", 0)),
                spend=float(row.get("cost", 0.0)),
                attributed_sales=float(row.get("attributedSales14d", 0.0)),
                attributed_units=int(row.get("attributedUnitsOrdered14d", 0)),
            )
            for row in rows
        ]

    def fetch_orders(self, start: date, end: date) -> list[OrderRecord]:
        if self.mode == ConnectorMode.MOCK or self._sp_client is None:
            ad_metrics = self.fetch_ad_metrics(start, end)
            return synthetic.make_orders(
                self.brand_id,
                self.platform_key,
                start,
                end,
                avg_orders_per_day=self.avg_orders_per_day,
                aov=self.aov,
                new_customer_rate=self.new_customer_rate,
                daily_attributed_sales=synthetic.daily_attributed_sales_map(ad_metrics),
            )
        orders = self._sp_client.list_orders(start, end)
        records: list[OrderRecord] = []
        for order in orders:
            order_id = order["AmazonOrderId"]
            items = self._sp_client.get_order_items(order_id)
            sku = items[0]["SellerSKU"] if items else "UNKNOWN"
            units = sum(int(i.get("QuantityOrdered", 1)) for i in items) or 1
            total = order.get("OrderTotal", {})
            records.append(
                OrderRecord(
                    external_order_id=order_id,
                    sku=sku,
                    order_date=date.fromisoformat(order["PurchaseDate"][:10]),
                    units=units,
                    revenue=float(total.get("Amount", 0.0)),
                    # SP-API does not expose new-vs-returning customer status;
                    # CAC for Amazon falls back to an orders-based proxy.
                    is_new_customer=False,
                )
            )
        return records
