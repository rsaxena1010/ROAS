"""Amazon Ads API v3 client (Sponsored Products campaigns + reporting).

Implements the real async-report workflow documented at
https://advertising.amazon.com/API/docs/en-us/reporting/v3/report-types :
  1. POST /reporting/reports        -> create an async report request
  2. GET  /reporting/reports/{id}   -> poll until status == COMPLETED
  3. GET  <presigned url>           -> download gzip-compressed JSON rows

Hosts:
  production NA : https://advertising-api.amazon.com
  production EU : https://advertising-api-eu.amazon.com
  production FE : https://advertising-api-fe.amazon.com
  sandbox       : https://advertising-api-test.amazon.com
"""
from __future__ import annotations

import gzip
import json
import time
from collections.abc import Callable
from datetime import date

import httpx

PRODUCTION_HOST = "https://advertising-api.amazon.com"
SANDBOX_HOST = "https://advertising-api-test.amazon.com"

_REPORT_COLUMNS = [
    "campaignId",
    "campaignName",
    "date",
    "impressions",
    "clicks",
    "cost",
    "attributedSales14d",
    "attributedUnitsOrdered14d",
]


class AmazonAdsApiError(RuntimeError):
    pass


class AmazonAdsClient:
    def __init__(
        self,
        client: httpx.Client,
        host: str,
        client_id: str,
        profile_id: str,
        token_provider: Callable[[], str],
        poll_interval_seconds: float = 2.0,
        max_polls: int = 15,
    ) -> None:
        self._client = client
        self._host = host.rstrip("/")
        self._client_id = client_id
        self._profile_id = profile_id
        self._token_provider = token_provider
        self._poll_interval = poll_interval_seconds
        self._max_polls = max_polls

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token_provider()}",
            "Amazon-Advertising-API-ClientId": self._client_id,
            "Amazon-Advertising-API-Scope": self._profile_id,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def list_campaigns(self) -> list[dict]:
        response = self._client.post(
            f"{self._host}/sp/campaigns/list",
            headers=self._headers("application/vnd.spCampaign.v3+json"),
            json={},
        )
        if response.status_code != 200:
            raise AmazonAdsApiError(
                f"list_campaigns failed ({response.status_code}): {response.text}"
            )
        return response.json().get("campaigns", [])

    def _create_report(self, start: date, end: date) -> str:
        body = {
            "name": f"sp-campaigns-{start.isoformat()}-{end.isoformat()}",
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "configuration": {
                "adProduct": "SPONSORED_PRODUCTS",
                "groupBy": ["campaign"],
                "columns": _REPORT_COLUMNS,
                "reportTypeId": "spCampaigns",
                "timeUnit": "DAILY",
                "format": "GZIP_JSON",
            },
        }
        response = self._client.post(
            f"{self._host}/reporting/reports",
            headers=self._headers("application/vnd.createasyncreportrequest.v3+json"),
            json=body,
        )
        if response.status_code not in (200, 202):
            raise AmazonAdsApiError(
                f"create report failed ({response.status_code}): {response.text}"
            )
        return response.json()["reportId"]

    def _poll_report(self, report_id: str) -> dict:
        for _ in range(self._max_polls):
            response = self._client.get(
                f"{self._host}/reporting/reports/{report_id}", headers=self._headers()
            )
            if response.status_code != 200:
                raise AmazonAdsApiError(
                    f"poll report failed ({response.status_code}): {response.text}"
                )
            payload = response.json()
            status = payload.get("status")
            if status == "COMPLETED":
                return payload
            if status == "FAILED":
                raise AmazonAdsApiError(f"report {report_id} failed to generate")
            if self._poll_interval:
                time.sleep(self._poll_interval)
        raise AmazonAdsApiError(f"report {report_id} did not complete in time")

    def _download_report(self, url: str) -> list[dict]:
        response = self._client.get(url)
        if response.status_code != 200:
            raise AmazonAdsApiError(f"report download failed ({response.status_code})")
        raw = response.content
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass  # already decompressed (e.g. by test fixtures)
        return json.loads(raw)

    def fetch_campaign_report(self, start: date, end: date) -> list[dict]:
        """Runs the full create -> poll -> download workflow and returns rows."""
        report_id = self._create_report(start, end)
        completed = self._poll_report(report_id)
        return self._download_report(completed["url"])
