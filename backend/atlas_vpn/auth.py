"""Contraseña local de la plataforma Atlas (PBKDF2, solo almacena hash)."""

from __future__ import annotations

import hashlib
import json
import secrets
from pathlib import Path

from atlas_core.paths import AUTH_FILE, ensure_atlas_data_dir

PBKDF2_ITERS = 310_000


class AuthError(Exception):
    pass


def _load_blob() -> dict | None:
    if not AUTH_FILE.is_file():
        return None
    with AUTH_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def has_password() -> bool:
    return AUTH_FILE.is_file()


def set_password(password: str) -> None:
    if len(password) < 8:
        raise AuthError("La contraseña debe tener al menos 8 caracteres.")
    salt = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERS)
    ensure_atlas_data_dir()
    blob = {
        "v": 1,
        "alg": "pbkdf2-sha256",
        "iterations": PBKDF2_ITERS,
        "salt_hex": salt.hex(),
        "hash_hex": h.hex(),
    }
    with AUTH_FILE.open("w", encoding="utf-8") as f:
        json.dump(blob, f, indent=0)


def verify_password(password: str) -> bool:
    blob = _load_blob()
    if not blob:
        return False
    salt = bytes.fromhex(blob["salt_hex"])
    iters = int(blob.get("iterations", PBKDF2_ITERS))
    expected = bytes.fromhex(blob["hash_hex"])
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iters)
    return secrets.compare_digest(h, expected)
