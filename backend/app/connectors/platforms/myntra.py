from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class MyntraConnector(SyntheticConnector):
    platform_key = "myntra"
    display_name = "Myntra"

    num_campaigns = 5
    avg_daily_spend = 3500.0
    target_roas = 4.2
    avg_orders_per_day = 18.0
    aov = 900.0
    new_customer_rate = 0.33
