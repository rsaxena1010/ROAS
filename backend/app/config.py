"""Application configuration.

All marketplace credentials are optional. When a platform's credentials are
absent, its connector automatically falls back to MOCK mode so the rest of
the platform (metrics, optimizer, dashboard) keeps working without any
external account. See `app/connectors/base.py` for the mode resolution
logic.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    database_url: str = "sqlite:///./roas.db"

    # --- Amazon Advertising API (LWA OAuth) ---
    amazon_ads_client_id: str | None = None
    amazon_ads_client_secret: str | None = None
    amazon_ads_refresh_token: str | None = None
    amazon_ads_profile_id: str | None = None
    # "sandbox" or "live" — selects the Ads API host. Sandbox still requires
    # a real, approved LWA app; see docs/AMAZON_INTEGRATION.md.
    amazon_ads_environment: str = "sandbox"

    # --- Amazon Selling Partner API (orders) ---
    amazon_sp_client_id: str | None = None
    amazon_sp_client_secret: str | None = None
    amazon_sp_refresh_token: str | None = None
    amazon_sp_marketplace_id: str | None = None
    amazon_sp_region: str = "na"  # na | eu | fe

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
