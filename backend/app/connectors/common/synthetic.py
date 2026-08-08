"""Deterministic synthetic data generator shared by every mock connector.

Given the same (brand_id, platform_key) pair the generator always produces
the same numbers for a given date range, so a demo brand's dashboard looks
stable across repeated syncs instead of re-randomizing every call. Numbers
vary day to day (weekday/weekend seasonality + noise) so charts look like
real performance data rather than flat lines.
"""
from __future__ import annotations

import random
from datetime import date, timedelta

from app.connectors.base import AdMetricRecord, CampaignRecord, OrderRecord


def _rng_for(brand_id: int, platform_key: str) -> random.Random:
    return random.Random(f"{platform_key}:{brand_id}")


def make_campaigns(
    brand_id: int, platform_key: str, name_prefix: str, count: int
) -> list[CampaignRecord]:
    rng = _rng_for(brand_id, platform_key)
    themes = [
        "Brand Defense",
        "Category Conquest",
        "Best Sellers",
        "New Launch",
        "Festive Push",
        "Retargeting",
        "Auto Discovery",
        "Competitor Conquest",
    ]
    rng.shuffle(themes)
    return [
        CampaignRecord(
            external_campaign_id=f"{platform_key}-camp-{i + 1:03d}",
            name=f"{name_prefix} {themes[i % len(themes)]}",
            campaign_type="sponsored_products" if i % 3 else "sponsored_brands",
        )
        for i in range(count)
    ]


def _daterange(start: date, end: date):
    days = (end - start).days
    for i in range(days + 1):
        yield start + timedelta(days=i)


def make_ad_metrics(
    brand_id: int,
    platform_key: str,
    campaigns: list[CampaignRecord],
    start: date,
    end: date,
    *,
    avg_daily_spend: float,
    target_roas: float,
    roas_volatility: float = 0.22,
) -> list[AdMetricRecord]:
    """Generate per-campaign daily spend/sales with mild seasonality.

    `target_roas` is the *center* of the distribution each campaign's daily
    ROAS wobbles around; `roas_volatility` controls how much day-to-day
    noise is layered on top, so the optimizer has real variance to reason
    about instead of a perfectly flat series.
    """
    rng = _rng_for(brand_id, f"{platform_key}:metrics")
    records: list[AdMetricRecord] = []
    per_campaign_weight = [rng.uniform(0.6, 1.6) for _ in campaigns]
    weight_sum = sum(per_campaign_weight) or 1.0

    for day in _daterange(start, end):
        weekend_mult = 1.25 if day.weekday() >= 5 else 1.0
        # gentle upward trend over the window so recent days look "fresher"
        day_index = (day - start).days
        trend_mult = 1.0 + 0.01 * day_index

        for campaign, weight in zip(campaigns, per_campaign_weight):
            share = weight / weight_sum
            # `share` sums to 1 across campaigns, so total daily spend stays
            # centered on avg_daily_spend regardless of campaign count.
            spend = max(
                1.0,
                avg_daily_spend * share * weekend_mult * trend_mult * rng.uniform(0.75, 1.25),
            )
            campaign_roas = max(
                0.3, rng.gauss(target_roas * (weight / 1.1), target_roas * roas_volatility)
            )
            attributed_sales = spend * campaign_roas
            # rough CPC-driven click estimate so CTR/CPC style metrics are derivable
            cpc = rng.uniform(0.15, 0.6) * (1.0 if platform_key == "amazon" else 0.8)
            clicks = max(1, int(spend / cpc))
            ctr = rng.uniform(0.003, 0.012)
            impressions = max(clicks, int(clicks / ctr))
            aov_guess = rng.uniform(300, 900)
            attributed_units = max(1, int(attributed_sales / aov_guess))

            records.append(
                AdMetricRecord(
                    external_campaign_id=campaign.external_campaign_id,
                    date=day,
                    impressions=impressions,
                    clicks=clicks,
                    spend=round(spend, 2),
                    attributed_sales=round(attributed_sales, 2),
                    attributed_units=attributed_units,
                )
            )
    return records


def daily_attributed_sales_map(ad_metrics: list[AdMetricRecord]) -> dict[date, float]:
    totals: dict[date, float] = {}
    for record in ad_metrics:
        totals[record.date] = totals.get(record.date, 0.0) + record.attributed_sales
    return totals


def make_orders(
    brand_id: int,
    platform_key: str,
    start: date,
    end: date,
    *,
    avg_orders_per_day: float,
    aov: float,
    new_customer_rate: float = 0.35,
    daily_attributed_sales: dict[date, float] | None = None,
) -> list[OrderRecord]:
    """Generates total order revenue per day, then splits it into orders.

    Ad-attributed sales are, by definition, a subset of total order revenue
    (you can't attribute more sales to ads than the store actually made).
    When `daily_attributed_sales` is supplied (the day's total from
    `fetch_ad_metrics`), that day's total order revenue is floored well
    above it — organic/brand-search revenue always exists alongside
    attributed ad revenue — so downstream ACOS/TACOS stay in a realistic
    relationship (TACOS <= ACOS).
    """
    rng = _rng_for(brand_id, f"{platform_key}:orders")
    daily_attributed_sales = daily_attributed_sales or {}
    records: list[OrderRecord] = []
    seq = 0
    for day in _daterange(start, end):
        weekend_mult = 1.3 if day.weekday() >= 5 else 1.0
        organic_target = avg_orders_per_day * aov * weekend_mult * rng.uniform(0.85, 1.15)
        attributed_floor = daily_attributed_sales.get(day, 0.0) * rng.uniform(1.35, 1.9)
        target_revenue = max(organic_target, attributed_floor)

        n_orders = max(1, round(target_revenue / aov))
        for _ in range(n_orders):
            seq += 1
            units = rng.choice([1, 1, 1, 2, 2, 3])
            revenue = round(max(50.0, rng.gauss(aov, aov * 0.25)), 2)
            records.append(
                OrderRecord(
                    external_order_id=f"{platform_key}-ord-{day.isoformat()}-{seq:04d}",
                    sku=f"SKU-{rng.randint(1, 25):03d}",
                    order_date=day,
                    units=units,
                    revenue=revenue,
                    is_new_customer=rng.random() < new_customer_rate,
                )
            )
    return records
