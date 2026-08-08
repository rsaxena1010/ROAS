from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import PlatformPerformanceOut, RecommendationOut, RecommendationsResponse
from app.services.optimizer_service import compute_platform_performance, generate_recommendations

router = APIRouter(prefix="/brands/{brand_id}/recommendations", tags=["recommendations"])


@router.get("", response_model=RecommendationsResponse)
def recommendations(brand_id: int, days: int = 30, db: Session = Depends(get_db)) -> RecommendationsResponse:
    end = date.today()
    start = end - timedelta(days=days - 1)
    performance = compute_platform_performance(db, brand_id, start, end)
    recs = generate_recommendations(db, brand_id, start, end)
    return RecommendationsResponse(
        start=start,
        end=end,
        performance=[PlatformPerformanceOut(**p.__dict__) for p in performance],
        recommendations=[RecommendationOut(**r.__dict__) for r in recs],
    )
