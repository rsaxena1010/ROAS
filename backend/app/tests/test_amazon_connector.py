"""Exercises the Amazon connector's real API code path (LWA + Ads API v3 +
SP-API) against a mocked HTTP transport built from Amazon's documented
response shapes, plus its MOCK-mode fallback.
"""
from __future__ import annotations

import gzip
import json
from datetime import date

import httpx
import pytest

from app.connectors.amazon.connector import AmazonConnector
from app.connectors.base import ConnectorCredentials, ConnectorMode

CAMPAIGN_ID = 111222333
REPORT_ROWS = [
    {
        "campaignId": CAMPAIGN_ID,
        "campaignName": "Brand Defense",
        "date": "2024-01-01",
        "impressions": 10000,
        "clicks": 250,
        "cost": 1500.5,
        "attributedSales14d": 7000.25,
        "attributedUnitsOrdered14d": 40,
    },
    {
        "campaignId": CAMPAIGN_ID,
        "campaignName": "Brand Defense",
        "date": "2024-01-02",
        "impressions": 11000,
        "clicks": 270,
        "cost": 1600.0,
        "attributedSales14d": 7200.0,
        "attributedUnitsOrdered14d": 42,
    },
]


def _handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)

    if url == "https://api.amazon.com/auth/o2/token":
        return httpx.Response(
            200, json={"access_token": "fake-access-token", "token_type": "bearer", "expires_in": 3600}
        )

    if url.endswith("/sp/campaigns/list"):
        return httpx.Response(
            200, json={"campaigns": [{"campaignId": CAMPAIGN_ID, "name": "Brand Defense"}]}
        )

    if url.endswith("/reporting/reports"):
        return httpx.Response(202, json={"reportId": "report-abc", "status": "PENDING"})

    if url.endswith("/reporting/reports/report-abc"):
        return httpx.Response(
            200,
            json={
                "reportId": "report-abc",
                "status": "COMPLETED",
                "url": "https://s3.example.com/report-abc.gz",
            },
        )

    if url == "https://s3.example.com/report-abc.gz":
        return httpx.Response(200, content=gzip.compress(json.dumps(REPORT_ROWS).encode()))

    if url.startswith("https://sellingpartnerapi-na.amazon.com/orders/v0/orders/"):
        return httpx.Response(
            200,
            json={
                "payload": {
                    "OrderItems": [
                        {"SellerSKU": "SKU-001", "QuantityOrdered": 2},
                    ]
                }
            },
        )

    if url.startswith("https://sellingpartnerapi-na.amazon.com/orders/v0/orders"):
        return httpx.Response(
            200,
            json={
                "payload": {
                    "Orders": [
                        {
                            "AmazonOrderId": "111-1234567-1234567",
                            "PurchaseDate": "2024-01-01T10:00:00Z",
                            "OrderTotal": {"Amount": "1499.00", "CurrencyCode": "INR"},
                        }
                    ]
                }
            },
        )

    raise AssertionError(f"unexpected request: {request.method} {url}")


@pytest.fixture
def sandbox_connector() -> AmazonConnector:
    http_client = httpx.Client(transport=httpx.MockTransport(_handler))
    credentials = ConnectorCredentials(
        {
            "ads_client_id": "amzn1.application-oa2-client.fake",
            "ads_client_secret": "fake-secret",
            "ads_refresh_token": "Atzr|fake-refresh-token",
            "ads_profile_id": "1234567890",
            "sp_client_id": "amzn1.application-oa2-client.fake-sp",
            "sp_client_secret": "fake-sp-secret",
            "sp_refresh_token": "Atzr|fake-sp-refresh-token",
            "sp_marketplace_id": "A21TJRUUN4KGV",
            "environment": "sandbox",
        }
    )
    return AmazonConnector(brand_id=1, credentials=credentials, http_client=http_client)


class TestAmazonSandboxMode:
    def test_resolves_to_sandbox_mode(self, sandbox_connector: AmazonConnector):
        assert sandbox_connector.mode == ConnectorMode.SANDBOX

    def test_connection_check_hits_real_endpoints(self, sandbox_connector: AmazonConnector):
        status = sandbox_connector.test_connection()
        assert status.connected is True
        assert status.mode == ConnectorMode.SANDBOX

    def test_fetch_campaigns_parses_ads_api_response(self, sandbox_connector: AmazonConnector):
        campaigns = sandbox_connector.fetch_campaigns()
        assert len(campaigns) == 1
        assert campaigns[0].external_campaign_id == str(CAMPAIGN_ID)
        assert campaigns[0].name == "Brand Defense"

    def test_fetch_ad_metrics_runs_full_report_workflow(self, sandbox_connector: AmazonConnector):
        metrics = sandbox_connector.fetch_ad_metrics(date(2024, 1, 1), date(2024, 1, 2))
        assert len(metrics) == 2
        assert metrics[0].spend == 1500.5
        assert metrics[0].attributed_sales == 7000.25
        assert metrics[1].date == date(2024, 1, 2)

    def test_fetch_orders_joins_order_items(self, sandbox_connector: AmazonConnector):
        orders = sandbox_connector.fetch_orders(date(2024, 1, 1), date(2024, 1, 2))
        assert len(orders) == 1
        assert orders[0].sku == "SKU-001"
        assert orders[0].units == 2
        assert orders[0].revenue == 1499.00


class TestAmazonMockMode:
    def test_defaults_to_mock_without_credentials(self):
        connector = AmazonConnector(brand_id=1)
        assert connector.mode == ConnectorMode.MOCK

    def test_mock_mode_never_makes_network_calls(self):
        def _fail(_request: httpx.Request) -> httpx.Response:
            raise AssertionError("mock mode must not perform HTTP requests")

        connector = AmazonConnector(
            brand_id=1, http_client=httpx.Client(transport=httpx.MockTransport(_fail))
        )
        campaigns = connector.fetch_campaigns()
        metrics = connector.fetch_ad_metrics(date(2024, 1, 1), date(2024, 1, 7))
        orders = connector.fetch_orders(date(2024, 1, 1), date(2024, 1, 7))

        assert len(campaigns) == connector.num_campaigns
        assert len(metrics) > 0
        assert len(orders) > 0
        assert connector.test_connection().connected is True

    def test_mock_data_is_deterministic_per_brand(self):
        a = AmazonConnector(brand_id=42).fetch_ad_metrics(date(2024, 1, 1), date(2024, 1, 3))
        b = AmazonConnector(brand_id=42).fetch_ad_metrics(date(2024, 1, 1), date(2024, 1, 3))
        assert a == b
