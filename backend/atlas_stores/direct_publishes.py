"""Historial de publicaciones directas en tiendas (admins sin cola de aprobación)."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import select

from atlas_core.db.models import StoreDirectPublish
from atlas_core.db.session import session_scope
KIND_UPDATE = "update"
KIND_CREATE = "create"

from atlas_stores.change_requests import (
    _compare_store_snapshots,
    _create_request_lines,
    _merge_store_with_patch,
    _summarize_create,
    _summarize_update,
)
from atlas_stores.git_repo import resolve_repo_root
from atlas_stores.settings_store import load_stores_settings
from atlas_stores.yaml_store import load_store

STATUS_PUBLISHED = "published"
ENTRY_DIRECT = "direct"


class DirectPublishError(Exception):
    pass


def _user_id(user: dict[str, Any]) -> int:
    uid = user.get("id")
    if uid is None:
        raise DirectPublishError("Sesión sin identificador de usuario.")
    return int(uid)


def _username(user: dict[str, Any]) -> str:
    return str(user.get("username") or "").strip() or "?"


def _parse_date_param(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw[:10])
    except ValueError:
        return None
    t = time(23, 59, 59, 999999) if end_of_day else time.min
    return datetime.combine(d, t, tzinfo=timezone.utc)


def _direct_change_lines(
    *,
    kind: str,
    folder_name: str,
    store_id: str,
    patch: dict[str, Any] | None,
    body: dict[str, Any] | None,
) -> list[str]:
    if kind == KIND_CREATE:
        payload = body if isinstance(body, dict) else {}
        return _create_request_lines(payload, store_id)
    if kind != KIND_UPDATE or not isinstance(patch, dict):
        return []
    try:
        settings = load_stores_settings()
        root = resolve_repo_root(settings, pull=False)
        current = load_store(root, folder_name)
        proposed = _merge_store_with_patch(current, patch)
        return _compare_store_snapshots(current, proposed)
    except Exception:
        return []


def _direct_row_dict(row: StoreDirectPublish) -> dict[str, Any]:
    return {
        "entryType": ENTRY_DIRECT,
        "id": int(row.id),
        "kind": row.kind,
        "folderName": row.folder_name,
        "storeId": row.store_id,
        "status": STATUS_PUBLISHED,
        "summary": row.summary,
        "commitMessage": row.commit_message,
        "createdByUserId": int(row.published_by_user_id),
        "createdByUsername": row.published_by_username,
        "createdAt": row.published_at.isoformat() if row.published_at else None,
        "reviewedByUsername": row.published_by_username,
        "reviewedAt": row.published_at.isoformat() if row.published_at else None,
        "reviewNote": None,
        "changeLines": list(row.change_lines) if isinstance(row.change_lines, list) else [],
    }


def record_direct_publish(
    user: dict[str, Any],
    *,
    kind: str,
    folder_name: str,
    store_id: str,
    summary: str,
    commit_message: str,
    patch: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    folder = folder_name.strip()
    sid = store_id.strip() or folder
    lines = _direct_change_lines(kind=kind, folder_name=folder, store_id=sid, patch=patch, body=body)
    with session_scope() as session:
        row = StoreDirectPublish(
            kind=kind,
            folder_name=folder,
            store_id=sid,
            summary=(summary or "").strip()[:512],
            commit_message=(commit_message or "").strip()[:256],
            change_lines=lines,
            published_by_user_id=_user_id(user),
            published_by_username=_username(user),
        )
        session.add(row)
        session.flush()
        return _direct_row_dict(row)


def list_direct_publishes(
    *,
    limit: int = 100,
    folder: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    folder_q = (folder or "").strip()
    dt_from = _parse_date_param(date_from)
    dt_to = _parse_date_param(date_to, end_of_day=True)
    with session_scope() as session:
        q = select(StoreDirectPublish).order_by(StoreDirectPublish.published_at.desc()).limit(lim)
        if folder_q:
            q = q.where(StoreDirectPublish.folder_name.ilike(f"%{folder_q}%"))
        if dt_from is not None:
            q = q.where(StoreDirectPublish.published_at >= dt_from)
        if dt_to is not None:
            q = q.where(StoreDirectPublish.published_at <= dt_to)
        rows = session.scalars(q).all()
        return [_direct_row_dict(r) for r in rows]


def get_direct_publish(publish_id: int) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(StoreDirectPublish, publish_id)
        if not row:
            raise DirectPublishError("Publicación no encontrada.")
        return _direct_row_dict(row)


def summarize_direct_update(folder_name: str, patch: dict[str, Any]) -> str:
    return _summarize_update(folder_name, patch)


def summarize_direct_create(body: dict[str, Any]) -> str:
    return _summarize_create(body)
