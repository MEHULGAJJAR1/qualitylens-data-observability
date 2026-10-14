from __future__ import annotations

import logging

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class DatabaseUnavailable(RuntimeError):
    pass


def _make_url(url: str) -> str:
    # psycopg 3 is the supported PostgreSQL driver in requirements.txt.
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


engine: Engine | None = None
ENGINE_CREATION_ERROR: str | None = None
try:
    database_url = _make_url(settings.database_url)
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
    if database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
except Exception as exc:  # preserve startup so /health can explain invalid DB configuration
    ENGINE_CREATION_ERROR = f"{type(exc).__name__}: {exc}"
    logger.exception("database_engine_initialization_failed")

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False) if engine else None


def require_engine() -> Engine:
    if engine is None:
        raise DatabaseUnavailable(ENGINE_CREATION_ERROR or "Database engine is unavailable")
    return engine


def check_connection() -> tuple[bool, str | None]:
    if engine is None:
        return False, ENGINE_CREATION_ERROR or "Database engine is unavailable"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def create_schema() -> None:
    from app import models  # noqa: F401 - register declarative metadata
    require_engine()
    Base.metadata.create_all(bind=engine)


def new_session():
    if SessionLocal is None:
        raise DatabaseUnavailable(ENGINE_CREATION_ERROR or "Database engine is unavailable")
    return SessionLocal()
