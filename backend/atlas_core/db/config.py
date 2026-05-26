"""URL de base de datos (`ATLAS_DATABASE_URL`)."""

from __future__ import annotations

from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir


def database_url() -> str:
    """
    PostgreSQL en Docker/producción: postgresql+psycopg://user:pass@host:5432/atlas
    Desarrollo sin URL: SQLite en .atlas/atlas.db
    """
    url = atlas_env("DATABASE_URL")
    if url:
        return url
    ensure_atlas_data_dir()
    path = (ATLAS_DATA_DIR / "atlas.db").resolve()
    return f"sqlite:///{path.as_posix()}"


def is_postgresql_url(url: str) -> bool:
    return url.startswith("postgresql") or url.startswith("postgres+")
