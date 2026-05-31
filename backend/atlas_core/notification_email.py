"""Envío de notificaciones Atlas por correo (SMTP)."""

from __future__ import annotations

import base64
import logging
import smtplib
import ssl
import threading
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import select

from atlas_core.db.models import Role, User, UserRole
from atlas_core.db.session import session_scope
from atlas_core.env import atlas_env, atlas_env_flag
from atlas_core.notification_email_template import render_notification_email, render_store_request_email
from atlas_core.paths import resolve_logo_path
from atlas_core.permissions import SYSTEM_ROLE_DEFINITIONS, normalize_permissions

_log = logging.getLogger(__name__)

STORE_EMAIL_KINDS = frozenset(
    {
        "store_change_pending",
        "store_change_approved",
        "store_change_rejected",
    }
)

_logo_cache: str | None | bool = False


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    user: str
    password: str
    from_addr: str
    use_tls: bool
    use_ssl: bool


def smtp_config() -> SmtpConfig | None:
    host = atlas_env("SMTP_HOST")
    if not host:
        return None
    port_raw = atlas_env("SMTP_PORT", "587")
    try:
        port = int(port_raw)
    except ValueError:
        port = 587
    use_ssl = atlas_env_flag("SMTP_USE_SSL")
    use_tls = atlas_env_flag("SMTP_USE_TLS") if not use_ssl else False
    if not use_ssl and not use_tls and port == 587:
        use_tls = True
    from_addr = atlas_env("SMTP_FROM") or atlas_env("SMTP_USER") or "Atlas <noreply@local>"
    return SmtpConfig(
        host=host,
        port=port,
        user=atlas_env("SMTP_USER"),
        password=atlas_env("SMTP_PASSWORD"),
        from_addr=from_addr,
        use_tls=use_tls,
        use_ssl=use_ssl,
    )


def email_notifications_globally_enabled() -> bool:
    if atlas_env_flag("NOTIFICATIONS_EMAIL_DISABLED"):
        return False
    if atlas_env_flag("NOTIFICATIONS_EMAIL_ENABLED"):
        return True
    return smtp_config() is not None


def public_ui_base_url() -> str:
    base = (
        atlas_env("PUBLIC_UI_URL")
        or atlas_env("PUBLIC_URL")
        or "https://atlas-ui.verkku.com"
    ).rstrip("/")
    return base


def notification_action_url(route: str, payload: dict[str, Any] | None = None) -> str:
    params: dict[str, str] = {"route": (route or "home").strip() or "home"}
    if isinstance(payload, dict):
        req_id = payload.get("requestId")
        if req_id is not None:
            params["requestId"] = str(req_id)
    q = urlencode(params)
    return f"{public_ui_base_url()}/?{q}"


def _logo_data_uri() -> str | None:
    global _logo_cache
    if _logo_cache is not False:
        return _logo_cache or None
    p = resolve_logo_path()
    if not p or not p.is_file():
        _logo_cache = None
        return None
    try:
        raw = p.read_bytes()
        if len(raw) > 400_000:
            _logo_cache = None
            return None
        b64 = base64.b64encode(raw).decode("ascii")
        _logo_cache = f"data:image/png;base64,{b64}"
        return _logo_cache
    except OSError:
        _logo_cache = None
        return None


def _recipient_display_name(user: User) -> str:
    fn = (user.first_name or "").strip()
    ln = (user.last_name or "").strip()
    full = f"{fn} {ln}".strip()
    if full:
        return full
    return user.username


def _load_email_recipient(user_id: int) -> tuple[str, str] | None:
    with session_scope() as session:
        row = session.get(User, int(user_id))
        if not row:
            return None
        if not getattr(row, "email_notifications_enabled", True):
            return None
        email = (row.email or "").strip()
        if not email or "@" not in email:
            return None
        return email, _recipient_display_name(row)


def _email_enabled_for_kind(kind: str) -> bool:
    if atlas_env_flag("NOTIFICATIONS_EMAIL_ALL"):
        return True
    k = (kind or "").strip()
    if k in STORE_EMAIL_KINDS:
        return True
    if k.startswith("store_change_"):
        return True
    return False


def send_notification_email_sync(
    *,
    user_id: int,
    title: str,
    body: str,
    severity: str,
    route: str,
    payload: dict[str, Any] | None = None,
    kind: str = "",
) -> bool:
    if not email_notifications_globally_enabled():
        return False
    if not _email_enabled_for_kind(kind):
        return False
    cfg = smtp_config()
    if not cfg:
        return False
    recipient = _load_email_recipient(user_id)
    if not recipient:
        return False
    to_email, display_name = recipient
    action_url = notification_action_url(route, payload)
    k = (kind or "").strip()
    if k in STORE_EMAIL_KINDS or k.startswith("store_change_"):
        html_body, plain_body, subject = render_store_request_email(
            kind=k or "store_change_pending",
            title=title,
            body=body,
            route=route,
            action_url=action_url,
            recipient_name=display_name,
            payload=payload,
            logo_data_uri=_logo_data_uri(),
        )
    else:
        html_body, plain_body = render_notification_email(
            title=title,
            body=body,
            severity=severity,
            route=route,
            action_url=action_url,
            recipient_name=display_name,
            logo_data_uri=_logo_data_uri(),
        )
        subject = f"Atlas — {title.strip()[:180]}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject[:200]
    msg["From"] = cfg.from_addr
    msg["To"] = to_email
    msg.attach(MIMEText(plain_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        if cfg.use_ssl:
            with smtplib.SMTP_SSL(cfg.host, cfg.port, timeout=30, context=ssl.create_default_context()) as smtp:
                if cfg.user:
                    smtp.login(cfg.user, cfg.password)
                smtp.sendmail(cfg.from_addr, [to_email], msg.as_string())
        else:
            with smtplib.SMTP(cfg.host, cfg.port, timeout=30) as smtp:
                smtp.ehlo()
                if cfg.use_tls:
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()
                if cfg.user:
                    smtp.login(cfg.user, cfg.password)
                smtp.sendmail(cfg.from_addr, [to_email], msg.as_string())
        _log.info("notification email sent user_id=%s to=%s", user_id, to_email)
        return True
    except Exception as e:
        _log.warning("notification email failed user_id=%s: %s", user_id, e)
        return False


def queue_notification_email(
    *,
    user_id: int,
    title: str,
    body: str,
    severity: str,
    route: str,
    payload: dict[str, Any] | None = None,
    kind: str = "",
) -> None:
    """Envía correo en segundo plano (best-effort)."""
    if not email_notifications_globally_enabled() or not smtp_config():
        return
    if not _email_enabled_for_kind(kind):
        return

    def _run() -> None:
        send_notification_email_sync(
            user_id=user_id,
            title=title,
            body=body,
            severity=severity,
            route=route,
            payload=payload,
            kind=kind,
        )

    threading.Thread(target=_run, name=f"atlas-email-{user_id}", daemon=True).start()


def user_ids_with_permission(permission: str) -> list[int]:
    """Usuarios con un permiso RBAC efectivo."""
    perm = permission.strip()
    ids: set[int] = set()
    with session_scope() as session:
        roles = session.scalars(select(Role)).all()
        role_ids: list[int] = []
        for role in roles:
            perms = normalize_permissions(list(role.permissions or []))
            if perm in perms:
                role_ids.append(int(role.id))
        if role_ids:
            rows = session.scalars(select(UserRole.user_id).where(UserRole.role_id.in_(role_ids))).all()
            ids.update(int(r) for r in rows)
        legacy_slugs = [
            slug
            for slug, meta in SYSTEM_ROLE_DEFINITIONS.items()
            if perm in (meta.get("permissions") or [])
        ]
        if legacy_slugs:
            rows = session.scalars(select(User.id).where(User.role.in_(legacy_slugs))).all()
            ids.update(int(r) for r in rows)
    return sorted(ids)
