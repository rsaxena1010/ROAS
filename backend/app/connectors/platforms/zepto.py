from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class ZeptoConnector(SyntheticConnector):
    platform_key = "zepto"
    display_name = "Zepto"

    num_campaigns = 3
    avg_daily_spend = 1800.0
    target_roas = 2.6
    avg_orders_per_day = 55.0
    aov = 320.0
    new_customer_rate = 0.5
