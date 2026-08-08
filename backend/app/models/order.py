from datetime import date as date_type

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(ForeignKey("platform_connections.id"))
    external_order_id: Mapped[str] = mapped_column(String(100))
    sku: Mapped[str] = mapped_column(String(100))
    order_date: Mapped[date_type] = mapped_column(Date)
    units: Mapped[int] = mapped_column(Integer, default=1)
    revenue: Mapped[float] = mapped_column(Float, default=0.0)
    is_new_customer: Mapped[bool] = mapped_column(Boolean, default=False)

    connection: Mapped["PlatformConnection"] = relationship(back_populates="orders")
