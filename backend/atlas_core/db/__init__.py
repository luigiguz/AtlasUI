"""Persistencia Atlas: PostgreSQL (producción) o SQLite (desarrollo local sin Docker)."""

from atlas_core.db.session import get_engine, init_db, is_postgresql, session_scope

__all__ = ["get_engine", "init_db", "is_postgresql", "session_scope"]
