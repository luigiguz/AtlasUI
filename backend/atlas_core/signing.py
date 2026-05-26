"""Claves de firma con longitud segura para HS256 (>= 32 bytes)."""

from __future__ import annotations

import hashlib


def hmac_signing_key(raw: str) -> str:
    """Normaliza secretos cortos a 64 caracteres hex (32 bytes) para PyJWT."""
    b = (raw or "").encode("utf-8")
    if len(b) >= 32:
        return raw
    return hashlib.sha256(b).hexdigest()
