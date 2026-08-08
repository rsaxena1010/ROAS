from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class BlinkitConnector(SyntheticConnector):
    platform_key = "blinkit"
    display_name = "Blinkit"

    num_campaigns = 3
    avg_daily_spend = 2400.0
    target_roas = 2.5
    avg_orders_per_day = 70.0
    aov = 300.0
    new_customer_rate = 0.5
