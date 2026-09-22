"""
Shared in-memory SQLite database for the API tests. One engine for the whole
process, installed as the FastAPI dependency override in each test's setUp,
so modules can't clobber each other's override when run together.
"""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from airflow_home.database.connection import Base, get_db
from api.main import app, require_admin

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Not used as a context manager on purpose: that keeps the real startup hook
# (production DB migration + scheduler) from running.
client = TestClient(app)


def override_get_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


def install_overrides():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[require_admin] = lambda: None


def reset_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
