from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import DailyPointOut, MetricsResponse, PlatformMetricsOut
from app.services.metrics_service import get_blended_metrics, get_daily_series, get_platform_metrics

router = APIRouter(prefix="/brands/{brand_id}/metrics", tags=["metrics"])


@router.get("", response_model=MetricsResponse)
def metrics(brand_id: int, days: int = 30, db: Session = Depends(get_db)) -> MetricsResponse:
    end = date.today()
    start = end - timedelta(days=days - 1)
    blended = get_blended_metrics(db, brand_id, start, end)
    by_platform = get_platform_metrics(db, brand_id, start, end)
    daily = get_daily_series(db, brand_id, start, end)
    return MetricsResponse(
        start=start,
        end=end,
        blended=PlatformMetricsOut(**blended.__dict__),
        by_platform=[PlatformMetricsOut(**p.__dict__) for p in by_platform],
        daily=[DailyPointOut(**d.__dict__) for d in daily],
    )
