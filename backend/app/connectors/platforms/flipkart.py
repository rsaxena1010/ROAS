from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class FlipkartConnector(SyntheticConnector):
    platform_key = "flipkart"
    display_name = "Flipkart"

    num_campaigns = 6
    avg_daily_spend = 6000.0
    target_roas = 3.5
    avg_orders_per_day = 45.0
    aov = 550.0
    new_customer_rate = 0.4
