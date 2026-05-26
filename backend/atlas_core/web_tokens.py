"""JWT de acceso (Bearer) vinculado a sesión en BD (`jti`)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from atlas_core.env import atlas_env

JWT_ALG = "HS256"


def _jwt_secret() -> str:
    j = atlas_env("JWT_SECRET")
    if j:
        return j
    from atlas_core.web_auth import get_session_secret

    return get_session_secret()


def jwt_ttl_seconds() -> int:
    """Access JWT: por defecto 12 h (43200 s)."""
    return int(atlas_env("JWT_EXPIRE_SECONDS", "43200"))


def encode_access_token(*, username: str, role: str, user_id: int, jti: str) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(seconds=max(300, jwt_ttl_seconds()))
    payload: dict[str, Any] = {
        "sub": username,
        "role": role,
        "uid": user_id,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALG)


def decode_access_token(token: str) -> dict[str, Any] | None:
    if not token or not token.strip():
        return None
    try:
        raw = jwt.decode(token.strip(), _jwt_secret(), algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None
    if not isinstance(raw, dict):
        return None
    if raw.get("typ") != "access":
        return None
    if not raw.get("sub") or not raw.get("role") or not raw.get("jti"):
        return None
    return raw


def resolve_user_from_access_token(token: str) -> dict[str, Any] | None:
    """JWT válido + sesión activa en PostgreSQL."""
    from atlas_core.web_sessions import get_active_session, touch_session

    payload = decode_access_token(token)
    if not payload:
        return None
    jti = str(payload["jti"])
    session_user = get_active_session(jti)
    if not session_user:
        return None
    touch_session(jti)
    return session_user
