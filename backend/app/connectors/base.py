"""Abstract interface every marketplace connector implements.

The rest of the platform (sync service, metrics engine, optimizer) only
ever talks to this interface, never to a specific marketplace's API. That
is what makes "add a new platform" a matter of writing one new connector
class rather than touching the core.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class ConnectorMode(str, Enum):
    #: No real credentials configured — deterministic synthetic data.
    MOCK = "mock"
    #: Real OAuth credentials configured, pointed at the provider's sandbox
    #: / test environment (e.g. Amazon Ads API sandbox).
    SANDBOX = "sandbox"
    #: Real credentials, production endpoints.
    LIVE = "live"


@dataclass(frozen=True)
class CampaignRecord:
    external_campaign_id: str
    name: str
    campaign_type: str = "sponsored_products"


@dataclass(frozen=True)
class AdMetricRecord:
    external_campaign_id: str
    date: date
    impressions: int
    clicks: int
    spend: float
    attributed_sales: float
    attributed_units: int = 0


@dataclass(frozen=True)
class OrderRecord:
    external_order_id: str
    sku: str
    order_date: date
    units: int
    revenue: float
    is_new_customer: bool = False


@dataclass(frozen=True)
class ConnectionStatus:
    connected: bool
    mode: ConnectorMode
    detail: str = ""


@dataclass(frozen=True)
class ConnectorCredentials:
    """Opaque bag of whatever a given connector needs (API keys, tokens...).

    Kept generic so the framework doesn't need to know each platform's
    credential shape.
    """

    values: dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def __bool__(self) -> bool:
        return bool(self.values) and all(self.values.values())


class MarketplaceConnector(ABC):
    """Base class for a single brand's connection to one marketplace."""

    #: Unique slug used in the registry, DB rows, and API responses.
    platform_key: str = ""
    #: Human readable name shown in the UI.
    display_name: str = ""

    def __init__(
        self,
        brand_id: int,
        credentials: ConnectorCredentials | None = None,
        mode: ConnectorMode | None = None,
    ) -> None:
        self.brand_id = brand_id
        self.credentials = credentials or ConnectorCredentials()
        self.mode = mode or self.resolve_mode(self.credentials)

    @classmethod
    def resolve_mode(cls, credentials: ConnectorCredentials) -> ConnectorMode:
        """Pick MOCK unless real credentials are present.

        Individual connectors may override this if they have more nuanced
        rules (e.g. distinguishing sandbox vs. live credentials).
        """
        return ConnectorMode.MOCK if not credentials else ConnectorMode.SANDBOX

    @abstractmethod
    def test_connection(self) -> ConnectionStatus: ...

    @abstractmethod
    def fetch_campaigns(self) -> list[CampaignRecord]: ...

    @abstractmethod
    def fetch_ad_metrics(self, start: date, end: date) -> list[AdMetricRecord]: ...

    @abstractmethod
    def fetch_orders(self, start: date, end: date) -> list[OrderRecord]: ...
