import os
import tempfile

# Point the app at an isolated, throwaway sqlite file *before* app.db (and
# anything importing it) gets loaded for the first time, so tests never
# touch a developer's local roas.db.
_tmp_dir = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp_dir}/test.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.connectors  # noqa: E402,F401  registers connectors
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client():
    with TestClient(fastapi_app) as c:
        yield c
