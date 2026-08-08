from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.connectors.factory import build_connector
from app.connectors.registry import get_connector_class
from app.db import get_db
from app.models import Brand, PlatformConnection
from app.schemas import (
    BrandCreate,
    BrandOut,
    ConnectionCreate,
    ConnectionOut,
    ConnectionStatusOut,
    SyncResultOut,
)
from app.services.sync_service import sync_platform_connection

router = APIRouter(prefix="/brands", tags=["brands"])


def _get_brand_or_404(db: Session, brand_id: int) -> Brand:
    brand = db.get(Brand, brand_id)
    if brand is None:
        raise HTTPException(status_code=404, detail="Brand not found")
    return brand


def _get_connection_or_404(db: Session, brand_id: int, connection_id: int) -> PlatformConnection:
    connection = (
        db.query(PlatformConnection)
        .filter(PlatformConnection.id == connection_id, PlatformConnection.brand_id == brand_id)
        .one_or_none()
    )
    if connection is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return connection


@router.post("", response_model=BrandOut)
def create_brand(payload: BrandCreate, db: Session = Depends(get_db)) -> Brand:
    if db.query(Brand).filter(Brand.name == payload.name).first():
        raise HTTPException(status_code=409, detail="A brand with this name already exists")
    brand = Brand(name=payload.name)
    db.add(brand)
    db.commit()
    db.refresh(brand)
    return brand


@router.get("", response_model=list[BrandOut])
def list_brands(db: Session = Depends(get_db)) -> list[Brand]:
    return db.query(Brand).order_by(Brand.name).all()


@router.get("/{brand_id}", response_model=BrandOut)
def get_brand(brand_id: int, db: Session = Depends(get_db)) -> Brand:
    return _get_brand_or_404(db, brand_id)


@router.post("/{brand_id}/connections", response_model=ConnectionOut)
def create_connection(
    brand_id: int, payload: ConnectionCreate, db: Session = Depends(get_db)
) -> PlatformConnection:
    _get_brand_or_404(db, brand_id)
    try:
        connector_cls = get_connector_class(payload.platform_key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    existing = (
        db.query(PlatformConnection)
        .filter(
            PlatformConnection.brand_id == brand_id,
            PlatformConnection.platform_key == payload.platform_key,
        )
        .one_or_none()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Connection already exists for this platform")

    connector = build_connector(payload.platform_key, brand_id)
    connection = PlatformConnection(
        brand_id=brand_id,
        platform_key=payload.platform_key,
        display_name=connector_cls.display_name,
        mode=connector.mode.value,
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


@router.get("/{brand_id}/connections", response_model=list[ConnectionOut])
def list_connections(brand_id: int, db: Session = Depends(get_db)) -> list[PlatformConnection]:
    _get_brand_or_404(db, brand_id)
    return db.query(PlatformConnection).filter(PlatformConnection.brand_id == brand_id).all()


@router.post("/{brand_id}/connections/{connection_id}/test", response_model=ConnectionStatusOut)
def test_connection(brand_id: int, connection_id: int, db: Session = Depends(get_db)) -> ConnectionStatusOut:
    connection = _get_connection_or_404(db, brand_id, connection_id)
    connector = build_connector(connection.platform_key, brand_id)
    status = connector.test_connection()
    return ConnectionStatusOut(connected=status.connected, mode=status.mode.value, detail=status.detail)


@router.post("/{brand_id}/connections/{connection_id}/sync", response_model=SyncResultOut)
def sync_connection(
    brand_id: int, connection_id: int, days: int = 30, db: Session = Depends(get_db)
) -> SyncResultOut:
    connection = _get_connection_or_404(db, brand_id, connection_id)
    end = date.today()
    start = end - timedelta(days=days - 1)
    result = sync_platform_connection(db, connection, start, end)
    return SyncResultOut(**result.__dict__)


@router.post("/{brand_id}/sync", response_model=list[SyncResultOut])
def sync_all_connections(brand_id: int, days: int = 30, db: Session = Depends(get_db)) -> list[SyncResultOut]:
    _get_brand_or_404(db, brand_id)
    connections = (
        db.query(PlatformConnection)
        .filter(PlatformConnection.brand_id == brand_id, PlatformConnection.is_active.is_(True))
        .all()
    )
    end = date.today()
    start = end - timedelta(days=days - 1)
    return [
        SyncResultOut(**sync_platform_connection(db, connection, start, end).__dict__)
        for connection in connections
    ]
