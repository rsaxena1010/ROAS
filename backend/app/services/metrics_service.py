"""ROAS / CAC / ACOS / TACOS calculation engine.

Definitions used throughout:
  ROAS  (Return on Ad Spend)   = attributed ad sales / ad spend
  ACOS  (Ad Cost of Sale)      = ad spend / attributed ad sales   (== 1/ROAS)
  TACOS (Total ACOS)           = ad spend / total order revenue — how much
                                  of *all* revenue (not just attributed) is
                                  being spent acquiring it.
  CAC   (Customer Acquisition Cost) = ad spend / new customers acquired.
                                  Falls back to spend / total orders when a
                                  platform doesn't expose new-vs-returning
                                  status (e.g. Amazon's SP-API today).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import Integer, func
from sqlalchemy.orm import Session

from app.models import AdMetric, Order, PlatformConnection


@dataclass
class PlatformMetrics:
    platform_key: str
    display_name: str
    spend: float
    attributed_sales: float
    revenue: float
    orders_count: int
    new_customers: int
    roas: float | None
    acos: float | None
    cac: float | None
    tacos: float | None


@dataclass
class DailyPoint:
    date: date
    spend: float
    attributed_sales: float
    revenue: float
    orders_count: int


def _safe_div(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return numerator / denominator


def _build_metrics(platform_key: str, display_name: str, spend: float, sales: float,
                    revenue: float, orders_count: int, new_customers: int) -> PlatformMetrics:
    cac_denominator = new_customers or orders_count
    return PlatformMetrics(
        platform_key=platform_key,
        display_name=display_name,
        spend=round(spend, 2),
        attributed_sales=round(sales, 2),
        revenue=round(revenue, 2),
        orders_count=orders_count,
        new_customers=new_customers,
        roas=_and_round(_safe_div(sales, spend)),
        acos=_and_round(_safe_div(spend, sales)),
        cac=_and_round(_safe_div(spend, cac_denominator)),
        tacos=_and_round(_safe_div(spend, revenue)),
    )


def _and_round(value: float | None) -> float | None:
    return round(value, 4) if value is not None else None


def get_platform_metrics(
    db: Session, brand_id: int, start: date, end: date
) -> list[PlatformMetrics]:
    connections = (
        db.query(PlatformConnection)
        .filter(PlatformConnection.brand_id == brand_id, PlatformConnection.is_active.is_(True))
        .all()
    )
    results: list[PlatformMetrics] = []
    for connection in connections:
        spend, sales = (
            db.query(
                func.coalesce(func.sum(AdMetric.spend), 0.0),
                func.coalesce(func.sum(AdMetric.attributed_sales), 0.0),
            )
            .filter(
                AdMetric.connection_id == connection.id,
                AdMetric.date >= start,
                AdMetric.date <= end,
            )
            .one()
        )
        revenue, orders_count, new_customers = (
            db.query(
                func.coalesce(func.sum(Order.revenue), 0.0),
                func.count(Order.id),
                func.coalesce(func.sum(func.cast(Order.is_new_customer, Integer)), 0),
            )
            .filter(
                Order.connection_id == connection.id,
                Order.order_date >= start,
                Order.order_date <= end,
            )
            .one()
        )
        results.append(
            _build_metrics(
                connection.platform_key,
                connection.display_name,
                float(spend),
                float(sales),
                float(revenue),
                int(orders_count),
                int(new_customers),
            )
        )
    return results


def get_blended_metrics(db: Session, brand_id: int, start: date, end: date) -> PlatformMetrics:
    per_platform = get_platform_metrics(db, brand_id, start, end)
    spend = sum(p.spend for p in per_platform)
    sales = sum(p.attributed_sales for p in per_platform)
    revenue = sum(p.revenue for p in per_platform)
    orders_count = sum(p.orders_count for p in per_platform)
    new_customers = sum(p.new_customers for p in per_platform)
    return _build_metrics("blended", "All Platforms", spend, sales, revenue, orders_count, new_customers)


def get_daily_series(
    db: Session, brand_id: int, start: date, end: date, platform_key: str | None = None
) -> list[DailyPoint]:
    connection_ids = [
        c.id
        for c in db.query(PlatformConnection).filter(
            PlatformConnection.brand_id == brand_id,
            PlatformConnection.is_active.is_(True),
            *([PlatformConnection.platform_key == platform_key] if platform_key else []),
        )
    ]
    if not connection_ids:
        return []

    spend_rows = dict(
        db.query(AdMetric.date, func.sum(AdMetric.spend))
        .filter(AdMetric.connection_id.in_(connection_ids), AdMetric.date >= start, AdMetric.date <= end)
        .group_by(AdMetric.date)
        .all()
    )
    sales_rows = dict(
        db.query(AdMetric.date, func.sum(AdMetric.attributed_sales))
        .filter(AdMetric.connection_id.in_(connection_ids), AdMetric.date >= start, AdMetric.date <= end)
        .group_by(AdMetric.date)
        .all()
    )
    revenue_rows = dict(
        db.query(Order.order_date, func.sum(Order.revenue))
        .filter(Order.connection_id.in_(connection_ids), Order.order_date >= start, Order.order_date <= end)
        .group_by(Order.order_date)
        .all()
    )
    orders_rows = dict(
        db.query(Order.order_date, func.count(Order.id))
        .filter(Order.connection_id.in_(connection_ids), Order.order_date >= start, Order.order_date <= end)
        .group_by(Order.order_date)
        .all()
    )

    all_dates = sorted(set(spend_rows) | set(sales_rows) | set(revenue_rows) | set(orders_rows))
    return [
        DailyPoint(
            date=d,
            spend=round(float(spend_rows.get(d, 0.0)), 2),
            attributed_sales=round(float(sales_rows.get(d, 0.0)), 2),
            revenue=round(float(revenue_rows.get(d, 0.0)), 2),
            orders_count=int(orders_rows.get(d, 0)),
        )
        for d in all_dates
    ]
