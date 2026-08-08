"""Registry mapping a platform_key to its connector class.

New platforms are added by writing a `MarketplaceConnector` subclass and
decorating it with `@register`. Nothing else in the codebase needs to
change to make it selectable from the API / dashboard.
"""
from __future__ import annotations

from app.connectors.base import MarketplaceConnector

_REGISTRY: dict[str, type[MarketplaceConnector]] = {}


def register(cls: type[MarketplaceConnector]) -> type[MarketplaceConnector]:
    if not cls.platform_key:
        raise ValueError(f"{cls.__name__} must set platform_key")
    _REGISTRY[cls.platform_key] = cls
    return cls


def get_connector_class(platform_key: str) -> type[MarketplaceConnector]:
    try:
        return _REGISTRY[platform_key]
    except KeyError as exc:
        raise KeyError(f"No connector registered for platform '{platform_key}'") from exc


def list_platforms() -> list[dict[str, str]]:
    return [
        {"platform_key": key, "display_name": cls.display_name}
        for key, cls in sorted(_REGISTRY.items())
    ]
