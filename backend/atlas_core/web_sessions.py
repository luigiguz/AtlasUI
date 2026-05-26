"""Sesiones de usuario en PostgreSQL (JWT con jti + refresh token)."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from atlas_core.db.models import UserSession
from atlas_core.db.session import session_scope
from atlas_core.env import atlas_env
from atlas_core.web_tokens import jwt_ttl_seconds


def refresh_ttl_days() -> int:
    """Refresh token: por defecto 14 días."""
    return max(1, int(atlas_env("REFRESH_TTL_DAYS", "14")))


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_user_session(
    *,
    user_id: int,
    ip_address: str = "",
    user_agent: str = "",
) -> tuple[str, str]:
    """Crea fila en BD; devuelve (jti, refresh_token en claro)."""
    jti = str(uuid.uuid4())
    refresh_plain = secrets.token_urlsafe(48)
    now = _utcnow()
    access_exp = now + timedelta(seconds=max(300, jwt_ttl_seconds()))
    refresh_exp = now + timedelta(days=refresh_ttl_days())
    with session_scope() as session:
        session.add(
            UserSession(
                id=jti,
                user_id=user_id,
                refresh_token_hash=_hash_token(refresh_plain),
                created_at=now,
                access_expires_at=access_exp,
                refresh_expires_at=refresh_exp,
                last_seen_at=now,
                ip_address=(ip_address or "")[:64],
                user_agent=(user_agent or "")[:512],
            )
        )
    return jti, refresh_plain


def touch_session(jti: str) -> None:
    with session_scope() as session:
        row = session.get(UserSession, jti)
        if row and row.revoked_at is None:
            row.last_seen_at = _utcnow()


def get_active_session(jti: str) -> dict[str, Any] | None:
    """Valida jti en BD (no revocada, access no expirado)."""
    with session_scope() as session:
        row = (
            session.scalar(
                select(UserSession)
                .where(UserSession.id == jti)
                .options(joinedload(UserSession.user))
            )
        )
        if not row or row.revoked_at is not None:
            return None
        if row.access_expires_at < _utcnow():
            return None
        user = row.user
        if not user:
            return None
        from atlas_core.web_roles import load_user_auth

        auth = load_user_auth(int(user.id))
        if not auth:
            return None
        auth["jti"] = row.id
        return auth


def refresh_access_session(refresh_token: str) -> tuple[str, str, dict[str, Any]] | None:
    """Intercambia refresh por nuevo par (jti, refresh) y datos de usuario."""
    h = _hash_token(refresh_token.strip())
    now = _utcnow()
    with session_scope() as session:
        row = session.scalar(
            select(UserSession)
            .where(UserSession.refresh_token_hash == h)
            .options(joinedload(UserSession.user))
        )
        if not row or row.revoked_at is not None or row.refresh_expires_at < now:
            return None
        user = row.user
        if not user:
            return None
        row.revoked_at = now
        new_jti = str(uuid.uuid4())
        new_refresh = secrets.token_urlsafe(48)
        access_exp = now + timedelta(seconds=max(300, jwt_ttl_seconds()))
        refresh_exp = now + timedelta(days=refresh_ttl_days())
        session.add(
            UserSession(
                id=new_jti,
                user_id=user.id,
                refresh_token_hash=_hash_token(new_refresh),
                created_at=now,
                access_expires_at=access_exp,
                refresh_expires_at=refresh_exp,
                last_seen_at=now,
                ip_address=row.ip_address,
                user_agent=row.user_agent,
            )
        )
        from atlas_core.web_roles import load_user_auth

        user_dict = load_user_auth(int(user.id))
        if not user_dict:
            return None
    return new_jti, new_refresh, user_dict


def revoke_session(jti: str) -> bool:
    with session_scope() as session:
        row = session.get(UserSession, jti)
        if not row or row.revoked_at is not None:
            return False
        row.revoked_at = _utcnow()
        return True


def revoke_all_sessions_for_user(user_id: int, *, except_jti: str | None = None) -> int:
    now = _utcnow()
    n = 0
    with session_scope() as session:
        rows = session.scalars(select(UserSession).where(UserSession.user_id == user_id)).all()
        for row in rows:
            if row.revoked_at is not None:
                continue
            if except_jti and row.id == except_jti:
                continue
            row.revoked_at = now
            n += 1
    return n


def list_active_sessions_for_user(user_id: int) -> list[dict[str, Any]]:
    now = _utcnow()
    out: list[dict[str, Any]] = []
    with session_scope() as session:
        rows = session.scalars(
            select(UserSession)
            .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
            .order_by(UserSession.created_at.desc())
        ).all()
        for row in rows:
            if row.refresh_expires_at < now:
                continue
            out.append(
                {
                    "id": row.id,
                    "created_at": int(row.created_at.timestamp()),
                    "last_seen_at": int(row.last_seen_at.timestamp()) if row.last_seen_at else None,
                    "access_expires_at": int(row.access_expires_at.timestamp()),
                    "refresh_expires_at": int(row.refresh_expires_at.timestamp()),
                    "ip_address": row.ip_address or "",
                    "user_agent": (row.user_agent or "")[:120],
                }
            )
    return out
