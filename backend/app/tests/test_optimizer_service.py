from datetime import date, timedelta

from app.models import AdMetric, Brand, PlatformConnection
from app.services.optimizer_service import compute_platform_performance, generate_recommendations


def _add_daily_metrics(db, connection, start, spends_and_sales):
    for i, (spend, sales) in enumerate(spends_and_sales):
        db.add(
            AdMetric(
                connection_id=connection.id,
                campaign_id=None,
                external_campaign_id="c1",
                date=start + timedelta(days=i),
                impressions=1000,
                clicks=20,
                spend=spend,
                attributed_sales=sales,
            )
        )


def test_recommends_shifting_budget_from_saturated_to_efficient_platform(db):
    brand = Brand(name="Optimizer Brand")
    db.add(brand)
    db.flush()

    # Saturated platform: spend keeps climbing, sales barely move (diminishing returns).
    saturated = PlatformConnection(
        brand_id=brand.id, platform_key="amazon", display_name="Amazon", mode="mock"
    )
    # Efficient platform: sales scale almost linearly with spend, high ROAS.
    efficient = PlatformConnection(
        brand_id=brand.id, platform_key="nykaa", display_name="Nykaa", mode="mock"
    )
    db.add_all([saturated, efficient])
    db.flush()

    start = date(2024, 1, 1)
    saturated_series = [(1000, 2200), (2000, 2600), (4000, 2900), (8000, 3100), (12000, 3200), (16000, 3250)]
    efficient_series = [(200, 900), (400, 1750), (800, 3400), (1200, 5000), (1600, 6500), (2000, 8000)]
    _add_daily_metrics(db, saturated, start, saturated_series)
    _add_daily_metrics(db, efficient, start, efficient_series)
    db.commit()

    end = start + timedelta(days=len(saturated_series) - 1)
    performance = compute_platform_performance(db, brand.id, start, end)
    perf_by_key = {p.platform_key: p for p in performance}

    assert perf_by_key["amazon"].elasticity < perf_by_key["nykaa"].elasticity
    assert perf_by_key["nykaa"].marginal_roas > perf_by_key["amazon"].marginal_roas

    recs = generate_recommendations(db, brand.id, start, end)
    assert len(recs) == 1
    rec = recs[0]
    assert rec.from_platform == "amazon"
    assert rec.to_platform == "nykaa"
    assert rec.shift_amount > 0
    assert rec.expected_incremental_daily_sales > 0


def test_no_recommendations_with_insufficient_data(db):
    brand = Brand(name="Sparse Data Brand")
    db.add(brand)
    db.flush()
    connection = PlatformConnection(
        brand_id=brand.id, platform_key="amazon", display_name="Amazon", mode="mock"
    )
    db.add(connection)
    db.flush()
    _add_daily_metrics(db, connection, date(2024, 1, 1), [(100, 300)])
    db.commit()

    recs = generate_recommendations(db, brand.id, date(2024, 1, 1), date(2024, 1, 1))
    assert recs == []
