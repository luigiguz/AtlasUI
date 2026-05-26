"""Importa SQLite/JSON legacy a la BD unificada (solo si las tablas están vacías)."""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from atlas_core.db.models import AppSetting, User
from atlas_core.db.session import session_scope
from atlas_core.paths import ATLAS_DATA_DIR, SETTINGS_FILE, ensure_atlas_data_dir

log = logging.getLogger(__name__)

_LEGACY_USERS_DB = ATLAS_DATA_DIR / "users.db"
_RANCHER_JSON = ATLAS_DATA_DIR / "rancher.json"
_STORES_JSON = ATLAS_DATA_DIR / "stores.json"


def migrate_legacy_if_needed() -> None:
    _migrate_users_from_sqlite()
    _migrate_settings_from_json()


def _migrate_users_from_sqlite() -> None:
    if not _LEGACY_USERS_DB.is_file():
        return
    with session_scope() as session:
        n = session.scalar(select(func.count()).select_from(User)) or 0
        if n > 0:
            return
        try:
            conn = sqlite3.connect(str(_LEGACY_USERS_DB), timeout=10)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT username, password_hash, role, created_at FROM users"
            ).fetchall()
            conn.close()
        except sqlite3.Error as e:
            log.warning("No se pudo leer users.db legacy: %s", e)
            return
        for r in rows:
            created = _parse_legacy_created_at(r["created_at"])
            session.add(
                User(
                    username=str(r["username"]).lower(),
                    password_hash=str(r["password_hash"]),
                    role=str(r["role"]),
                    created_at=created,
                )
            )
        if rows:
            log.info("Migrados %d usuarios desde users.db", len(rows))


def _parse_legacy_created_at(raw: object) -> datetime:
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(int(raw), tz=timezone.utc)
    if isinstance(raw, str):
        text = raw.strip()
        if text.isdigit():
            return datetime.fromtimestamp(int(text), tz=timezone.utc)
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _migrate_settings_from_json() -> None:
    ensure_atlas_data_dir()
    pairs: list[tuple[str, Path]] = [
        ("cloudflare", SETTINGS_FILE),
        ("rancher", _RANCHER_JSON),
        ("stores", _STORES_JSON),
    ]
    with session_scope() as session:
        existing = {r.namespace for r in session.scalars(select(AppSetting)).all()}
        for namespace, path in pairs:
            if namespace in existing:
                continue
            blob = _load_json(path)
            if not blob:
                continue
            session.add(
                AppSetting(
                    namespace=namespace,
                    data=blob,
                    updated_at=datetime.now(timezone.utc),
                )
            )
            log.info("Migrada configuración %s desde %s", namespace, path.name)
