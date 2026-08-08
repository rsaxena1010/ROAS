from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class PlatformConnection(Base):
    """A brand's link to one marketplace (Amazon, Flipkart, ...).

    `platform_key` must match a key registered in the connector registry
    (see app/connectors/registry.py). `mode` records whether the connection
    is currently running against mock synthetic data, a provider sandbox, or
    live production credentials.
    """

    __tablename__ = "platform_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id"))
    platform_key: Mapped[str] = mapped_column(String(50))
    display_name: Mapped[str] = mapped_column(String(100))
    mode: Mapped[str] = mapped_column(String(20), default="mock")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    brand: Mapped["Brand"] = relationship(back_populates="connections")
    orders: Mapped[list["Order"]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )
    campaigns: Mapped[list["Campaign"]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )
    ad_metrics: Mapped[list["AdMetric"]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )
