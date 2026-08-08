"""Amazon Selling Partner API (SP-API) client — Orders v0.

Since September 2023 SP-API no longer requires AWS SigV4 request signing for
self-authorized applications; an LWA access token in the `x-amz-access-token`
header is sufficient. See
https://developer-docs.amazon.com/sp-api/docs/self-authorization

Hosts:
  NA : https://sellingpartnerapi-na.amazon.com
  EU : https://sellingpartnerapi-eu.amazon.com
  FE : https://sellingpartnerapi-fe.amazon.com

Note: this client fetches one page of orders (and each order's line items)
per call. A production implementation would follow `NextToken` for full
pagination — omitted here to keep the sandbox/demo footprint small.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timezone

import httpx

HOSTS = {
    "na": "https://sellingpartnerapi-na.amazon.com",
    "eu": "https://sellingpartnerapi-eu.amazon.com",
    "fe": "https://sellingpartnerapi-fe.amazon.com",
}


class AmazonSpApiError(RuntimeError):
    pass


class AmazonSpClient:
    def __init__(
        self,
        client: httpx.Client,
        host: str,
        marketplace_id: str,
        token_provider: Callable[[], str],
    ) -> None:
        self._client = client
        self._host = host.rstrip("/")
        self._marketplace_id = marketplace_id
        self._token_provider = token_provider

    def _headers(self) -> dict[str, str]:
        return {"x-amz-access-token": self._token_provider()}

    def list_orders(self, created_after: date, created_before: date) -> list[dict]:
        params = {
            "MarketplaceIds": self._marketplace_id,
            "CreatedAfter": _to_iso(created_after),
            "CreatedBefore": _to_iso(created_before),
        }
        response = self._client.get(
            f"{self._host}/orders/v0/orders", headers=self._headers(), params=params
        )
        if response.status_code != 200:
            raise AmazonSpApiError(f"list_orders failed ({response.status_code}): {response.text}")
        return response.json().get("payload", {}).get("Orders", [])

    def get_order_items(self, amazon_order_id: str) -> list[dict]:
        response = self._client.get(
            f"{self._host}/orders/v0/orders/{amazon_order_id}/orderItems",
            headers=self._headers(),
        )
        if response.status_code != 200:
            raise AmazonSpApiError(
                f"get_order_items failed ({response.status_code}): {response.text}"
            )
        return response.json().get("payload", {}).get("OrderItems", [])


def _to_iso(d: date) -> str:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
