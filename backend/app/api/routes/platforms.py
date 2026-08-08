from fastapi import APIRouter

from app.connectors import registry
from app.schemas import PlatformCatalogEntry

router = APIRouter(prefix="/platforms", tags=["platforms"])


@router.get("", response_model=list[PlatformCatalogEntry])
def list_platforms() -> list[dict]:
    return registry.list_platforms()
