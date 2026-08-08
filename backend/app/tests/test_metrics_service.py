from datetime import date

from app.models import AdMetric, Brand, Campaign, Order, PlatformConnection
from app.services.metrics_service import get_blended_metrics, get_daily_series, get_platform_metrics


def _seed(db):
    brand = Brand(name="Test Brand")
    db.add(brand)
    db.flush()

    connection = PlatformConnection(
        brand_id=brand.id, platform_key="amazon", display_name="Amazon", mode="mock"
    )
    db.add(connection)
    db.flush()

    campaign = Campaign(connection_id=connection.id, external_campaign_id="c1", name="Camp 1")
    db.add(campaign)
    db.flush()

    db.add_all(
        [
            AdMetric(
                connection_id=connection.id,
                campaign_id=campaign.id,
                external_campaign_id="c1",
                date=date(2024, 1, 1),
                impressions=1000,
                clicks=20,
                spend=100.0,
                attributed_sales=500.0,
                attributed_units=2,
            ),
            AdMetric(
                connection_id=connection.id,
                campaign_id=campaign.id,
                external_campaign_id="c1",
                date=date(2024, 1, 2),
                impressions=1200,
                clicks=25,
                spend=150.0,
                attributed_sales=450.0,
                attributed_units=2,
            ),
        ]
    )
    db.add_all(
        [
            Order(
                connection_id=connection.id,
                external_order_id="o1",
                sku="SKU-1",
                order_date=date(2024, 1, 1),
                units=1,
                revenue=600.0,
                is_new_customer=True,
            ),
            Order(
                connection_id=connection.id,
                external_order_id="o2",
                sku="SKU-1",
                order_date=date(2024, 1, 2),
                units=1,
                revenue=400.0,
                is_new_customer=False,
            ),
        ]
    )
    db.commit()
    return brand, connection


def test_platform_metrics_computes_roas_acos_cac_tacos(db):
    brand, _connection = _seed(db)
    metrics = get_platform_metrics(db, brand.id, date(2024, 1, 1), date(2024, 1, 2))
    assert len(metrics) == 1
    m = metrics[0]

    assert m.spend == 250.0
    assert m.attributed_sales == 950.0
    assert m.revenue == 1000.0
    assert m.orders_count == 2
    assert m.new_customers == 1

    assert m.roas == round(950.0 / 250.0, 4)
    assert m.acos == round(250.0 / 950.0, 4)
    # CAC falls back to new-customer count (1) since it's > 0
    assert m.cac == round(250.0 / 1, 4)
    assert m.tacos == round(250.0 / 1000.0, 4)


def test_cac_falls_back_to_orders_when_no_new_customers(db):
    brand = Brand(name="No New Customers Brand")
    db.add(brand)
    db.flush()
    connection = PlatformConnection(
        brand_id=brand.id, platform_key="amazon", display_name="Amazon", mode="mock"
    )
    db.add(connection)
    db.flush()
    db.add(
        AdMetric(
            connection_id=connection.id,
            campaign_id=None,
            external_campaign_id="c1",
            date=date(2024, 1, 1),
            impressions=100,
            clicks=5,
            spend=50.0,
            attributed_sales=200.0,
        )
    )
    db.add(
        Order(
            connection_id=connection.id,
            external_order_id="o1",
            sku="SKU-1",
            order_date=date(2024, 1, 1),
            units=1,
            revenue=200.0,
            is_new_customer=False,
        )
    )
    db.commit()

    metrics = get_platform_metrics(db, brand.id, date(2024, 1, 1), date(2024, 1, 1))
    assert metrics[0].new_customers == 0
    assert metrics[0].cac == 50.0  # spend / 1 order, not division by zero


def test_blended_metrics_sums_across_platforms(db):
    brand, _connection = _seed(db)
    second_connection = PlatformConnection(
        brand_id=brand.id, platform_key="flipkart", display_name="Flipkart", mode="mock"
    )
    db.add(second_connection)
    db.flush()
    db.add(
        AdMetric(
            connection_id=second_connection.id,
            campaign_id=None,
            external_campaign_id="fk-1",
            date=date(2024, 1, 1),
            impressions=500,
            clicks=10,
            spend=50.0,
            attributed_sales=100.0,
        )
    )
    db.commit()

    blended = get_blended_metrics(db, brand.id, date(2024, 1, 1), date(2024, 1, 2))
    assert blended.spend == 300.0
    assert blended.attributed_sales == 1050.0


def test_daily_series_is_sorted_and_filterable_by_platform(db):
    brand, connection = _seed(db)
    series = get_daily_series(db, brand.id, date(2024, 1, 1), date(2024, 1, 2))
    assert [p.date for p in series] == [date(2024, 1, 1), date(2024, 1, 2)]
    assert series[0].spend == 100.0
    assert series[1].spend == 150.0

    filtered = get_daily_series(db, brand.id, date(2024, 1, 1), date(2024, 1, 2), platform_key="amazon")
    assert len(filtered) == 2
    empty = get_daily_series(db, brand.id, date(2024, 1, 1), date(2024, 1, 2), platform_key="myntra")
    assert empty == []
