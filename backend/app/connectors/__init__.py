"""Marketplace connector framework.

Importing this package registers every built-in connector (Amazon plus the
synthetic connectors for the other marketplaces) against the registry in
`app.connectors.registry`.
"""
from app.connectors import registry  # noqa: F401
from app.connectors.amazon.connector import AmazonConnector  # noqa: F401
from app.connectors.platforms import (  # noqa: F401
    bigbasket,
    blinkit,
    flipkart,
    instamart,
    jiomart,
    myntra,
    nykaa,
    zepto,
)

__all__ = ["registry"]
