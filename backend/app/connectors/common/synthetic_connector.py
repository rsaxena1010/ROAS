"""Base class for platforms we don't have a real API integration for yet.

Subclasses just set a handful of class attributes; `SyntheticConnector`
wires them into the shared generator in `synthetic.py`. This is what makes
adding a 10th marketplace a ~15 line diff.
"""
from __future__ import annotations

from datetime import date

from app.connectors.base import (
    AdMetricRecord,
    CampaignRecord,
    ConnectionStatus,
    ConnectorMode,
    MarketplaceConnector,
    OrderRecord,
)
from app.connectors.common import synthetic


class SyntheticConnector(MarketplaceConnector):
    #: tunables — override per platform to give each one a distinct profile
    num_campaigns: int = 5
    avg_daily_spend: float = 4000.0
    target_roas: float = 4.0
    avg_orders_per_day: float = 20.0
    aov: float = 650.0
    new_customer_rate: float = 0.35

    @classmethod
    def resolve_mode(cls, credentials) -> ConnectorMode:  # noqa: ANN001
        # No real API integration exists for this platform yet, so it is
        # always mock regardless of any credentials passed in.
        return ConnectorMode.MOCK

    def test_connection(self) -> ConnectionStatus:
        return ConnectionStatus(
            connected=True,
            mode=ConnectorMode.MOCK,
            detail=f"{self.display_name}: using synthetic sandbox data (no live API integration yet).",
        )

    def fetch_campaigns(self) -> list[CampaignRecord]:
        return synthetic.make_campaigns(
            self.brand_id, self.platform_key, self.display_name, self.num_campaigns
        )

    def fetch_ad_metrics(self, start: date, end: date) -> list[AdMetricRecord]:
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

    def fetch_orders(self, start: date, end: date) -> list[OrderRecord]:
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
