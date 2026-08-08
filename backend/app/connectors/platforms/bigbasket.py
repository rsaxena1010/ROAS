from app.connectors.common.synthetic_connector import SyntheticConnector
from app.connectors.registry import register


@register
class BigBasketConnector(SyntheticConnector):
    platform_key = "bigbasket"
    display_name = "BigBasket"

    num_campaigns = 3
    avg_daily_spend = 2200.0
    target_roas = 3.2
    avg_orders_per_day = 35.0
    aov = 800.0
    new_customer_rate = 0.25
