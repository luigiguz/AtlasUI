"""Sesiones firmadas y dependencias de autenticación para la API web."""

from __future__ import annotations

import os
import secrets
import time
from collections import defaultdict
from typing import Any

from fastapi import Depends, HTTPException, Request

from atlas_core.env import atlas_env, atlas_env_flag
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir
from atlas_core.web_tokens import decode_access_token

SESSION_SECRET_FILE = ATLAS_DATA_DIR / "session.secret"

# IP -> lista de timestamps de intentos fallidos
_failed_logins: defaultdict[str, list[float]] = defaultdict(list)
_FAIL_WINDOW_S = 120.0
_FAIL_MAX = 10


def get_session_secret() -> str:
    env = atlas_env("SESSION_SECRET")
    if env:
        return env
    ensure_atlas_data_dir()
    if SESSION_SECRET_FILE.is_file():
        return SESSION_SECRET_FILE.read_text(encoding="utf-8").strip()
    s = secrets.token_hex(32)
    SESSION_SECRET_FILE.write_text(s, encoding="utf-8")
    try:
        SESSION_SECRET_FILE.chmod(0o600)
    except OSError:
        pass
    return s


def session_middleware_config() -> dict[str, Any]:
    https_only = atlas_env_flag("SECURE_COOKIES")
    max_age = int(atlas_env("SESSION_MAX_AGE", "604800"))
    return {
        "secret_key": get_session_secret(),
        "session_cookie": "atlas_session",
        "max_age": max_age,
        "same_site": "lax",
        "https_only": https_only,
    }


def _client_ip(request: Request) -> str:
    if request.client:
        return request.client.host or "unknown"
    return "unknown"


def register_failed_login(request: Request) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    lst = _failed_logins[ip]
    lst[:] = [t for t in lst if now - t < _FAIL_WINDOW_S]
    lst.append(now)


def assert_login_allowed(request: Request) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    lst = _failed_logins[ip]
    lst[:] = [t for t in lst if now - t < _FAIL_WINDOW_S]
    if len(lst) >= _FAIL_MAX:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos fallidos. Espera unos minutos.",
        )


def clear_failed_logins(request: Request) -> None:
    ip = _client_ip(request)
    _failed_logins.pop(ip, None)


def _bearer_token(request: Request) -> str | None:
    h = request.headers.get("Authorization") or ""
    if len(h) < 8 or h[:7].lower() != "bearer ":
        return None
    return h[7:].strip() or None


def resolve_user_dict(request: Request) -> dict[str, Any] | None:
    """Usuario desde Authorization Bearer (JWT) o cookie de sesión."""
    tok = _bearer_token(request)
    if tok:
        payload = decode_access_token(tok)
        if payload:
            try:
                uid = int(payload.get("uid", 0))
            except (TypeError, ValueError):
                uid = 0
            return {
                "username": str(payload["sub"]),
                "role": str(payload["role"]),
                "id": uid,
            }
    raw = request.session.get("user")
    if isinstance(raw, dict) and raw.get("username") and raw.get("role"):
        return raw
    return None


def current_user(request: Request) -> dict[str, Any]:
    u = resolve_user_dict(request)
    if not u:
        raise HTTPException(status_code=401, detail="No autenticado")
    return u


def require_roles(*roles: str):
    """Dependencia: usuario en sesión con uno de los roles indicados."""

    def _dep(request: Request) -> dict[str, Any]:
        u = current_user(request)
        if roles and u.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Sin permiso para esta acción")
        return u

    return _dep
