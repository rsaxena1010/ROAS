from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class JioMartConnector(SyntheticConnector):
    platform_key = "jiomart"
    display_name = "JioMart"

    num_campaigns = 4
    avg_daily_spend = 2500.0
    target_roas = 3.0
    avg_orders_per_day = 30.0
    aov = 500.0
    new_customer_rate = 0.4
