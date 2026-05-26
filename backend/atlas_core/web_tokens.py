"""JWT de acceso (Bearer) para API detrás de otro origen (p. ej. UI en Cloudflare)."""

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
    return int(atlas_env("JWT_EXPIRE_SECONDS", "604800"))


def encode_access_token(*, username: str, role: str, user_id: int) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(seconds=max(300, jwt_ttl_seconds()))
    payload: dict[str, Any] = {
        "sub": username,
        "role": role,
        "uid": user_id,
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
    if not raw.get("sub") or not raw.get("role"):
        return None
    return raw
