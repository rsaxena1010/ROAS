from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class NykaaConnector(SyntheticConnector):
    platform_key = "nykaa"
    display_name = "Nykaa"

    num_campaigns = 4
    avg_daily_spend = 3000.0
    target_roas = 5.5
    avg_orders_per_day = 22.0
    aov = 750.0
    new_customer_rate = 0.3
