from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.connectors  # noqa: F401  registers every connector on import
from app.api.routes import brands, metrics, platforms, recommendations
from app.config import get_settings
from app.db import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="ROAS — D2C Ad Spend Optimization Platform", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(platforms.router, prefix="/api")
app.include_router(brands.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(recommendations.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
