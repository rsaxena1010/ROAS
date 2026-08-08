"""Builds a connector instance for a given platform + brand.

Pulls provider credentials out of application settings (env vars) so the
rest of the app never has to know which platforms need which secrets.
Platforms without a real API integration simply ignore credentials and run
in MOCK mode (see `SyntheticConnector.resolve_mode`).
"""
from __future__ import annotations

from app.config import Settings, get_settings
from app.connectors.base import ConnectorCredentials, MarketplaceConnector
from app.connectors.registry import get_connector_class


def _amazon_credentials(settings: Settings) -> ConnectorCredentials:
    values = {
        "ads_client_id": settings.amazon_ads_client_id,
        "ads_client_secret": settings.amazon_ads_client_secret,
        "ads_refresh_token": settings.amazon_ads_refresh_token,
        "ads_profile_id": settings.amazon_ads_profile_id,
        "sp_client_id": settings.amazon_sp_client_id,
        "sp_client_secret": settings.amazon_sp_client_secret,
        "sp_refresh_token": settings.amazon_sp_refresh_token,
        "sp_marketplace_id": settings.amazon_sp_marketplace_id,
        "environment": settings.amazon_ads_environment,
    }
    # Only keep the dict if the *required* Ads API keys are all present;
    # otherwise return an empty bag so the connector falls back to MOCK.
    required = ("ads_client_id", "ads_client_secret", "ads_refresh_token", "ads_profile_id")
    if not all(values.get(k) for k in required):
        return ConnectorCredentials()
    return ConnectorCredentials({k: v for k, v in values.items() if v})


def build_connector(platform_key: str, brand_id: int) -> MarketplaceConnector:
    settings = get_settings()
    connector_cls = get_connector_class(platform_key)

    if platform_key == "amazon":
        credentials = _amazon_credentials(settings)
        return connector_cls(
            brand_id=brand_id,
            credentials=credentials,
            sp_region=settings.amazon_sp_region,
        )

    return connector_cls(brand_id=brand_id)
