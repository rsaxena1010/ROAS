from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class InstamartConnector(SyntheticConnector):
    """Swiggy Instamart — quick commerce."""

    platform_key = "instamart"
    display_name = "Instamart"

    num_campaigns = 3
    avg_daily_spend = 2000.0
    target_roas = 2.8
    avg_orders_per_day = 60.0
    aov = 350.0
    new_customer_rate = 0.45
