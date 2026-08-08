"""Pulls data out of a marketplace connector and into the local DB.

Sync is idempotent: for the requested date range it replaces existing
ad-metric and order rows rather than trying to diff/merge, which keeps the
logic simple and safe to re-run (e.g. a daily cron re-syncing the trailing
7 days to pick up attribution windows catching up).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.connectors.factory import build_connector
from app.models import AdMetric, Campaign, Order, PlatformConnection


@dataclass
class SyncResult:
    connection_id: int
    platform_key: str
    mode: str
    campaigns_synced: int
    ad_metric_rows_synced: int
    orders_synced: int


def _get_or_create_campaign(
    db: Session, connection: PlatformConnection, external_id: str, name: str, campaign_type: str
) -> Campaign:
    campaign = (
        db.query(Campaign)
        .filter_by(connection_id=connection.id, external_campaign_id=external_id)
        .one_or_none()
    )
    if campaign is None:
        campaign = Campaign(
            connection_id=connection.id,
            external_campaign_id=external_id,
            name=name,
            campaign_type=campaign_type,
        )
        db.add(campaign)
        db.flush()
    else:
        campaign.name = name
        campaign.campaign_type = campaign_type
    return campaign


def sync_platform_connection(
    db: Session, connection: PlatformConnection, start: date, end: date
) -> SyncResult:
    connector = build_connector(connection.platform_key, connection.brand_id)

    campaign_records = connector.fetch_campaigns()
    campaign_by_external_id = {
        record.external_campaign_id: _get_or_create_campaign(
            db, connection, record.external_campaign_id, record.name, record.campaign_type
        )
        for record in campaign_records
    }

    db.execute(
        delete(AdMetric).where(
            AdMetric.connection_id == connection.id,
            AdMetric.date >= start,
            AdMetric.date <= end,
        )
    )
    ad_metric_records = connector.fetch_ad_metrics(start, end)
    for record in ad_metric_records:
        campaign = campaign_by_external_id.get(record.external_campaign_id)
        if campaign is None:
            # metric references a campaign that wasn't in fetch_campaigns();
            # create a placeholder so the row still has a valid FK.
            campaign = _get_or_create_campaign(
                db, connection, record.external_campaign_id, record.external_campaign_id, "unknown"
            )
            campaign_by_external_id[record.external_campaign_id] = campaign
        db.add(
            AdMetric(
                connection_id=connection.id,
                campaign_id=campaign.id,
                external_campaign_id=record.external_campaign_id,
                date=record.date,
                impressions=record.impressions,
                clicks=record.clicks,
                spend=record.spend,
                attributed_sales=record.attributed_sales,
                attributed_units=record.attributed_units,
            )
        )

    db.execute(
        delete(Order).where(
            Order.connection_id == connection.id,
            Order.order_date >= start,
            Order.order_date <= end,
        )
    )
    order_records = connector.fetch_orders(start, end)
    for record in order_records:
        db.add(
            Order(
                connection_id=connection.id,
                external_order_id=record.external_order_id,
                sku=record.sku,
                order_date=record.order_date,
                units=record.units,
                revenue=record.revenue,
                is_new_customer=record.is_new_customer,
            )
        )

    connection.last_synced_at = datetime.now(timezone.utc)
    connection.mode = connector.mode.value
    db.commit()

    return SyncResult(
        connection_id=connection.id,
        platform_key=connection.platform_key,
        mode=connector.mode.value,
        campaigns_synced=len(campaign_records),
        ad_metric_rows_synced=len(ad_metric_records),
        orders_synced=len(order_records),
    )
