"""Lectura/escritura de `app_settings` por namespace."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select

from atlas_core.db.models import AppSetting
from atlas_core.db.session import session_scope


def load_namespace(namespace: str) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(AppSetting, namespace)
        if not row or not isinstance(row.data, dict):
            return {}
        return dict(row.data)


def save_namespace(namespace: str, data: dict[str, Any]) -> None:
    with session_scope() as session:
        row = session.get(AppSetting, namespace)
        if row is None:
            row = AppSetting(namespace=namespace, data=data, updated_at=datetime.now(timezone.utc))
            session.add(row)
        else:
            row.data = data
            row.updated_at = datetime.now(timezone.utc)


def count_namespaces() -> int:
    with session_scope() as session:
        return int(session.scalar(select(func.count()).select_from(AppSetting)) or 0)
