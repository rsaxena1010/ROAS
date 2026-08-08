from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    connection_id: Mapped[int] = mapped_column(ForeignKey("platform_connections.id"))
    external_campaign_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(255))
    campaign_type: Mapped[str] = mapped_column(String(50), default="sponsored_products")

    connection: Mapped["PlatformConnection"] = relationship(back_populates="campaigns")
