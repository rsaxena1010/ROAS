from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class BrandCreate(BaseModel):
    name: str


class BrandOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    created_at: datetime


class PlatformCatalogEntry(BaseModel):
    platform_key: str
    display_name: str


class ConnectionCreate(BaseModel):
    platform_key: str


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    brand_id: int
    platform_key: str
    display_name: str
    mode: str
    is_active: bool
    last_synced_at: datetime | None = None


class ConnectionStatusOut(BaseModel):
    connected: bool
    mode: str
    detail: str


class SyncResultOut(BaseModel):
    connection_id: int
    platform_key: str
    mode: str
    campaigns_synced: int
    ad_metric_rows_synced: int
    orders_synced: int


class PlatformMetricsOut(BaseModel):
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


class DailyPointOut(BaseModel):
    date: date
    spend: float
    attributed_sales: float
    revenue: float
    orders_count: int


class MetricsResponse(BaseModel):
    start: date
    end: date
    blended: PlatformMetricsOut
    by_platform: list[PlatformMetricsOut]
    daily: list[DailyPointOut]


class RecommendationOut(BaseModel):
    from_platform: str
    from_display_name: str
    to_platform: str
    to_display_name: str
    shift_amount: float
    from_marginal_roas: float
    to_marginal_roas: float
    expected_incremental_daily_sales: float
    rationale: str


class PlatformPerformanceOut(BaseModel):
    platform_key: str
    display_name: str
    total_spend: float
    total_sales: float
    avg_roas: float
    elasticity: float
    marginal_roas: float
    data_points: int


class RecommendationsResponse(BaseModel):
    start: date
    end: date
    performance: list[PlatformPerformanceOut]
    recommendations: list[RecommendationOut]
