from datetime import date as date_type

from sqlalchemy import Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class AdMetric(Base):
    """Daily ad performance for one campaign on one platform connection."""

    __tablename__ = "ad_metrics"

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(ForeignKey("platform_connections.id"))
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id"), nullable=True)
    external_campaign_id: Mapped[str] = mapped_column(String(100))
    date: Mapped[date_type] = mapped_column(Date)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    spend: Mapped[float] = mapped_column(Float, default=0.0)
    attributed_sales: Mapped[float] = mapped_column(Float, default=0.0)
    attributed_units: Mapped[int] = mapped_column(Integer, default=0)

    connection: Mapped["PlatformConnection"] = relationship(back_populates="ad_metrics")
