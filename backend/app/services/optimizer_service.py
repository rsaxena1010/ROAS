"""Budget reallocation recommendations.

Approach: for each platform, fit a simple diminishing-returns (Cobb-Douglas
style) curve `sales = a * spend^b` to that platform's recent daily
spend/attributed-sales pairs via a log-log linear regression. The exponent
`b` (elasticity) captures how much incremental sales an extra rupee of
spend still buys:
  b ~= 1   -> roughly linear, spend hasn't saturated the channel
  b -> 0   -> heavily saturated, more spend barely moves sales

marginal ROAS at the current operating point = b * average_ROAS. Platforms
with high marginal ROAS have room to absorb more budget efficiently;
platforms with low marginal ROAS are over-funded relative to their
efficiency. We recommend shifting a bounded fraction of spend from the
weakest to the strongest platform(s).

This is a heuristic, not a true constrained optimizer — it's meant to
produce directionally sound, explainable recommendations from limited data,
which is the right bar for early-stage D2C ad-spend decisions.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from app.services.metrics_service import DailyPoint, get_daily_series
from app.models import PlatformConnection
from sqlalchemy.orm import Session

MIN_DATA_POINTS = 4
DEFAULT_SHIFT_FRACTION = 0.15
MIN_MARGINAL_ROAS_GAP_RATIO = 1.1


@dataclass
class PlatformPerformance:
    platform_key: str
    display_name: str
    total_spend: float
    total_sales: float
    avg_roas: float
    elasticity: float
    marginal_roas: float
    data_points: int


@dataclass
class BudgetRecommendation:
    from_platform: str
    from_display_name: str
    to_platform: str
    to_display_name: str
    shift_amount: float
    from_marginal_roas: float
    to_marginal_roas: float
    expected_incremental_daily_sales: float
    rationale: str


def _estimate_elasticity(pairs: list[tuple[float, float]]) -> float:
    """log-log OLS slope of sales on spend, clamped to a sane range."""
    xs = [math.log(spend) for spend, sales in pairs if spend > 0 and sales > 0]
    ys = [math.log(sales) for spend, sales in pairs if spend > 0 and sales > 0]
    if len(xs) < MIN_DATA_POINTS:
        return 1.0
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    variance = sum((x - mean_x) ** 2 for x in xs)
    if variance == 0:
        return 1.0
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = covariance / variance
    return max(0.05, min(slope, 1.5))


def compute_platform_performance(
    db: Session, brand_id: int, start: date, end: date
) -> list[PlatformPerformance]:
    connections = (
        db.query(PlatformConnection)
        .filter(PlatformConnection.brand_id == brand_id, PlatformConnection.is_active.is_(True))
        .all()
    )
    results: list[PlatformPerformance] = []
    for connection in connections:
        series: list[DailyPoint] = get_daily_series(db, brand_id, start, end, connection.platform_key)
        pairs = [(p.spend, p.attributed_sales) for p in series]
        total_spend = sum(spend for spend, _ in pairs)
        total_sales = sum(sales for _, sales in pairs)
        if total_spend <= 0:
            continue
        avg_roas = total_sales / total_spend
        elasticity = _estimate_elasticity(pairs)
        results.append(
            PlatformPerformance(
                platform_key=connection.platform_key,
                display_name=connection.display_name,
                total_spend=round(total_spend, 2),
                total_sales=round(total_sales, 2),
                avg_roas=round(avg_roas, 4),
                elasticity=round(elasticity, 4),
                marginal_roas=round(elasticity * avg_roas, 4),
                data_points=len(pairs),
            )
        )
    return results


def generate_recommendations(
    db: Session,
    brand_id: int,
    start: date,
    end: date,
    shift_fraction: float = DEFAULT_SHIFT_FRACTION,
    max_recommendations: int = 3,
) -> list[BudgetRecommendation]:
    performance = [
        p
        for p in compute_platform_performance(db, brand_id, start, end)
        if p.data_points >= MIN_DATA_POINTS
    ]
    if len(performance) < 2:
        return []

    ranked = sorted(performance, key=lambda p: p.marginal_roas, reverse=True)
    strong = ranked[: max(1, len(ranked) // 2)]
    weak = list(reversed(ranked[max(1, len(ranked) // 2):]))

    recommendations: list[BudgetRecommendation] = []
    used_weak: set[str] = set()
    for target in strong:
        if len(recommendations) >= max_recommendations:
            break
        for source in weak:
            if source.platform_key in used_weak or source.platform_key == target.platform_key:
                continue
            if target.marginal_roas < source.marginal_roas * MIN_MARGINAL_ROAS_GAP_RATIO:
                continue
            days = max(1, (end - start).days + 1)
            source_daily_spend = source.total_spend / days
            shift_amount = round(source_daily_spend * shift_fraction, 2)
            if shift_amount <= 0:
                continue
            incremental = round(
                shift_amount * (target.marginal_roas - source.marginal_roas), 2
            )
            recommendations.append(
                BudgetRecommendation(
                    from_platform=source.platform_key,
                    from_display_name=source.display_name,
                    to_platform=target.platform_key,
                    to_display_name=target.display_name,
                    shift_amount=shift_amount,
                    from_marginal_roas=source.marginal_roas,
                    to_marginal_roas=target.marginal_roas,
                    expected_incremental_daily_sales=incremental,
                    rationale=(
                        f"{source.display_name}'s marginal ROAS ({source.marginal_roas:.2f}) is "
                        f"well below {target.display_name}'s ({target.marginal_roas:.2f}). Shifting "
                        f"~₹{shift_amount:,.0f}/day is projected to add ~₹{incremental:,.0f}/day in "
                        f"attributed sales at current elasticity."
                    ),
                )
            )
            used_weak.add(source.platform_key)
            break

    return recommendations
