"""Notificaciones in-app Atlas: eventos persistidos + alertas en vivo."""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select, update

from atlas_core.db.models import AuditWeb, NotificationDismissal, StoreChangeRequest, UserNotification
from atlas_core.db.session import session_scope
from atlas_core.permissions import (
    PERM_CF_SYNC,
    PERM_RANCHER_READ,
    PERM_STORES_APPROVE,
    PERM_STORES_READ,
    PERM_STORES_WRITE,
    PERM_USERS_LIST,
    PERM_VPN_READ,
    has_permission,
)

_log = logging.getLogger(__name__)

_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2, "success": 3}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _user_id(user: dict[str, Any]) -> int:
    uid = user.get("id")
    if uid is None:
        raise ValueError("Sesión sin identificador de usuario.")
    return int(uid)


def notify_user(
    *,
    user_id: int,
    kind: str,
    severity: str,
    title: str,
    body: str = "",
    route: str = "home",
    payload: dict[str, Any] | None = None,
) -> None:
    """Crea una notificación persistida (best-effort)."""
    try:
        with session_scope() as session:
            session.add(
                UserNotification(
                    user_id=int(user_id),
                    kind=kind.strip()[:64],
                    severity=severity.strip()[:16] or "info",
                    title=title.strip()[:256],
                    body=(body or "").strip()[:1024],
                    route=(route or "home").strip()[:32],
                    payload=payload if isinstance(payload, dict) else {},
                )
            )
    except Exception as e:
        _log.warning("notify_user failed kind=%s user_id=%s: %s", kind, user_id, e)


def _item_dict(
    *,
    item_id: str,
    source: str,
    severity: str,
    title: str,
    body: str,
    route: str,
    created_at: datetime | None,
    read: bool,
    dismissible: bool,
    kind: str = "",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": item_id,
        "source": source,
        "severity": severity,
        "title": title,
        "body": body,
        "route": route,
        "createdAt": (created_at or _utcnow()).isoformat(),
        "read": read,
        "dismissible": dismissible,
    }
    if kind:
        out["kind"] = kind
    if isinstance(payload, dict) and payload:
        out["payload"] = payload
    return out


def _dismissed_keys(user_id: int) -> set[str]:
    with session_scope() as session:
        rows = session.scalars(
            select(NotificationDismissal.dismiss_key).where(NotificationDismissal.user_id == user_id)
        ).all()
        return {str(r) for r in rows}


def _clear_dismissal(user_id: int, key: str) -> None:
    with session_scope() as session:
        session.execute(
            delete(NotificationDismissal).where(
                NotificationDismissal.user_id == user_id,
                NotificationDismissal.dismiss_key == key,
            )
        )


def dismiss_notification(user: dict[str, Any], item_id: str) -> None:
    uid = _user_id(user)
    if not item_id.startswith("live:"):
        return
    key = item_id[5:]
    with session_scope() as session:
        session.merge(NotificationDismissal(user_id=uid, dismiss_key=key))


def mark_notifications_read(user: dict[str, Any], *, item_ids: list[str] | None = None, all_items: bool = False) -> int:
    uid = _user_id(user)
    now = _utcnow()
    event_ids: list[int] = []
    if item_ids:
        for raw in item_ids:
            if raw.startswith("event:"):
                try:
                    event_ids.append(int(raw.split(":", 1)[1]))
                except ValueError:
                    continue
    with session_scope() as session:
        if all_items:
            result = session.execute(
                update(UserNotification)
                .where(UserNotification.user_id == uid, UserNotification.read_at.is_(None))
                .values(read_at=now)
            )
            return int(result.rowcount or 0)
        if not event_ids:
            return 0
        result = session.execute(
            update(UserNotification)
            .where(
                UserNotification.user_id == uid,
                UserNotification.id.in_(event_ids),
                UserNotification.read_at.is_(None),
            )
            .values(read_at=now)
        )
        return int(result.rowcount or 0)


def _proc_for_site_label(state: dict[str, Any], site: str, label: str) -> dict[str, Any] | None:
    for row in state.get("processes", []):
        if isinstance(row, dict) and row.get("site") == site and row.get("label") == label:
            return row
    return None


def _tunnel_status(row: dict[str, Any] | None, pid_alive_fn) -> str:
    if not row:
        return "idle"
    pid = int(row["pid"])
    return "active" if pid_alive_fn(pid) else "dead"


def _live_vpn(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_VPN_READ):
        return []
    key = "vpn-tunnels-down"
    try:
        scripts = Path(__file__).resolve().parents[2] / "scripts"
        if str(scripts) not in sys.path:
            sys.path.insert(0, str(scripts))
        import tunnel_manager as tm  # noqa: PLC0415

        cfg = tm.load_config_optional(tm.default_config_path())
        if not cfg:
            return []
        state = tm.read_state()
        dead: list[str] = []
        for name in sorted((cfg.get("sites") or {}).keys()):
            e = (cfg.get("sites") or {}).get(name) or {}
            if not isinstance(e, dict):
                continue
            for label in ("ssh", "db"):
                block = e.get(label)
                if not isinstance(block, dict):
                    continue
                row = _proc_for_site_label(state, name, label)
                if _tunnel_status(row, tm.pid_alive) == "dead":
                    dead.append(f"{name}:{label}")
        if not dead:
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        sample = ", ".join(dead[:3])
        more = f" (+{len(dead) - 3})" if len(dead) > 3 else ""
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="critical",
                title=f"{len(dead)} túnel(es) VPN caído(s)",
                body=f"{sample}{more}",
                route="conn",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
            )
        ]
    except Exception as e:
        _log.debug("live vpn notifications skipped: %s", e)
        return []


def _live_stores_pending_approval(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_STORES_APPROVE):
        return []
    key = "stores-pending-approval"
    try:
        with session_scope() as session:
            count = session.scalar(
                select(func.count())
                .select_from(StoreChangeRequest)
                .where(StoreChangeRequest.status == "pending")
            ) or 0
        if count <= 0:
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="warning",
                title=f"{count} solicitud(es) de tienda pendiente(s)",
                body="Revisa la cola de aprobación en Gestión de Tiendas.",
                route="rancher-stores",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
                kind="stores_pending_approval",
            )
        ]
    except Exception as e:
        _log.debug("live stores pending skipped: %s", e)
        return []


def _live_my_store_requests(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_STORES_WRITE):
        return []
    key = "stores-my-pending"
    try:
        uid = _user_id(user)
        with session_scope() as session:
            count = session.scalar(
                select(func.count())
                .select_from(StoreChangeRequest)
                .where(
                    StoreChangeRequest.status == "pending",
                    StoreChangeRequest.created_by_user_id == uid,
                )
            ) or 0
        if count <= 0:
            if key in dismissed:
                _clear_dismissal(uid, key)
            return []
        if key in dismissed:
            return []
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="info",
                title=f"{count} solicitud(es) tuya(s) en espera",
                body="Un administrador debe aprobarlas para publicar en Git.",
                route="rancher-stores",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
                kind="stores_my_pending",
            )
        ]
    except Exception as e:
        _log.debug("live my store requests skipped: %s", e)
        return []


def _live_git_blocked(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_STORES_READ):
        return []
    key = "stores-git-blocked"
    try:
        from atlas_stores.git_repo import git_working_status
        from atlas_stores.settings_store import load_stores_settings

        settings = load_stores_settings()
        if not str(settings.get("repo_url") or "").strip():
            return []
        status = git_working_status(settings)
        if not status.get("blocked") and not status.get("dirty"):
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        summary = str(status.get("summary") or "Cambios locales en el caché Git")
        severity = "critical" if status.get("blocked") else "warning"
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity=severity,
                title="Repositorio de tiendas necesita atención",
                body=summary,
                route="rancher-stores",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
            )
        ]
    except Exception as e:
        _log.debug("live git blocked skipped: %s", e)
        return []


def _live_rancher_disconnected(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_RANCHER_READ):
        return []
    key = "rancher-disconnected"
    try:
        from atlas_rancher.client import list_custom_clusters
        from atlas_rancher.settings_store import load_rancher_settings

        settings = load_rancher_settings()
        if not settings.get("url") or not settings.get("token"):
            return []
        clusters = list_custom_clusters(settings)
        disconnected = [
            c
            for c in clusters
            if "disconnect" in str(c.get("state") or "").lower()
        ]
        if not disconnected:
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        names = ", ".join(
            str(c.get("displayName") or c.get("name") or "?") for c in disconnected[:3]
        )
        more = f" (+{len(disconnected) - 3})" if len(disconnected) > 3 else ""
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="warning",
                title=f"{len(disconnected)} equipo(s) desconectado(s)",
                body=f"{names}{more}",
                route="rancher-clusters",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
            )
        ]
    except Exception as e:
        _log.debug("live rancher disconnected skipped: %s", e)
        return []


def _live_cf_sync_failed(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_CF_SYNC):
        return []
    key = "cf-sync-failed"
    try:
        from atlas_core.db.settings import load_namespace

        data = load_namespace("cloudflare") or {}
        if data.get("last_sync_ok") is not False:
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        msg = str(data.get("last_sync_message") or "Error al sincronizar con Cloudflare.")
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="warning",
                title="Sync Cloudflare fallido",
                body=msg[:500],
                route="cf",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
            )
        ]
    except Exception as e:
        _log.debug("live cf sync skipped: %s", e)
        return []


def _live_security_failed_logins(user: dict[str, Any], dismissed: set[str]) -> list[dict[str, Any]]:
    if not has_permission(user, PERM_USERS_LIST):
        return []
    key = "security-login-failed"
    try:
        since = _utcnow() - timedelta(hours=24)
        with session_scope() as session:
            count = session.scalar(
                select(func.count())
                .select_from(AuditWeb)
                .where(
                    AuditWeb.event == "login_failed",
                    AuditWeb.ts >= since,
                )
            ) or 0
        if count < 5:
            if key in dismissed:
                _clear_dismissal(_user_id(user), key)
            return []
        if key in dismissed:
            return []
        return [
            _item_dict(
                item_id=f"live:{key}",
                source="live",
                severity="warning",
                title=f"{count} intentos de login fallidos (24 h)",
                body="Revisa usuarios y accesos en Administración.",
                route="users",
                created_at=_utcnow(),
                read=False,
                dismissible=True,
            )
        ]
    except Exception as e:
        _log.debug("live security skipped: %s", e)
        return []


def _persisted_notifications(user: dict[str, Any], limit: int = 40) -> list[dict[str, Any]]:
    uid = _user_id(user)
    with session_scope() as session:
        rows = session.scalars(
            select(UserNotification)
            .where(UserNotification.user_id == uid)
            .order_by(UserNotification.created_at.desc())
            .limit(limit)
        ).all()
        return [
            _item_dict(
                item_id=f"event:{row.id}",
                source="event",
                severity=str(row.severity or "info"),
                title=str(row.title),
                body=str(row.body or ""),
                route=str(row.route or "home"),
                created_at=row.created_at,
                read=row.read_at is not None,
                dismissible=False,
                kind=str(row.kind or ""),
                payload=row.payload if isinstance(row.payload, dict) else {},
            )
            for row in rows
        ]


def list_notifications(user: dict[str, Any]) -> dict[str, Any]:
    uid = _user_id(user)
    dismissed = _dismissed_keys(uid)
    live: list[dict[str, Any]] = []
    live.extend(_live_stores_pending_approval(user, dismissed))
    live.extend(_live_my_store_requests(user, dismissed))
    live.extend(_live_git_blocked(user, dismissed))
    live.extend(_live_vpn(user, dismissed))
    live.extend(_live_rancher_disconnected(user, dismissed))
    live.extend(_live_cf_sync_failed(user, dismissed))
    live.extend(_live_security_failed_logins(user, dismissed))
    events = _persisted_notifications(user)

    items = live + events
    items.sort(
        key=lambda x: (
            _SEVERITY_ORDER.get(str(x.get("severity")), 9),
            x.get("createdAt") or "",
        )
    )

    unread = sum(1 for i in items if not i.get("read"))
    return {"ok": True, "unreadCount": unread, "items": items[:60]}


def record_cf_sync_result(*, ok: bool, message: str) -> None:
    """Guarda resultado del último sync Cloudflare para alertas en vivo."""
    try:
        from atlas_core.db.settings import load_namespace, save_namespace

        data = dict(load_namespace("cloudflare") or {})
        data["last_sync_ok"] = bool(ok)
        data["last_sync_message"] = (message or "")[:500]
        data["last_sync_at"] = _utcnow().isoformat()
        save_namespace("cloudflare", data)
    except Exception as e:
        _log.debug("record_cf_sync_result failed: %s", e)
