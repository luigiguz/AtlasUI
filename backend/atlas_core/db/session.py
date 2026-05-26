"""Motor SQLAlchemy y ciclo de vida de sesión."""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from atlas_core.db.base import Base
from atlas_core.db.config import database_url, is_postgresql_url

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None
_lock = threading.Lock()


def get_engine() -> Engine:
    global _engine, _session_factory
    with _lock:
        if _engine is not None:
            return _engine
        url = database_url()
        connect_args: dict = {}
        if url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
        _engine = create_engine(
            url,
            pool_pre_ping=True,
            future=True,
            connect_args=connect_args,
        )
        if is_postgresql_url(url):

            @event.listens_for(_engine, "connect")
            def _set_pg_timezone(dbapi_conn, _connection_record) -> None:
                cur = dbapi_conn.cursor()
                cur.execute("SET TIME ZONE 'UTC'")
                cur.close()

        _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
        return _engine


def is_postgresql() -> bool:
    return is_postgresql_url(database_url())


@contextmanager
def session_scope() -> Iterator[Session]:
    get_engine()
    assert _session_factory is not None
    session = _session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _run_alembic_upgrade() -> None:
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    backend_root = Path(__file__).resolve().parents[2]
    ini_path = backend_root / "alembic.ini"
    cfg = Config(str(ini_path))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    cfg.set_main_option("prepend_sys_path", str(backend_root))
    command.upgrade(cfg, "head")


def init_db() -> None:
    """Crea tablas, extensiones PG y migra datos legacy si aplica."""
    engine = get_engine()
    if is_postgresql():
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
            conn.commit()
        _run_alembic_upgrade()
    else:
        Base.metadata.create_all(bind=engine)
    from atlas_core.db.migrate_legacy import migrate_legacy_if_needed

    migrate_legacy_if_needed()
