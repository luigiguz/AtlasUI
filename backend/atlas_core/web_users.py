"""Usuarios web de Atlas (SQLite + Argon2id)."""

from __future__ import annotations

import os
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

_db_lock = threading.Lock()
_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

USER_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
ROLES = frozenset({"admin", "operator", "viewer"})

# Solo si la BD está vacía y no hay ATLAS_DEFAULT_ADMIN_PASSWORD (ver ensure_default_admin).
_DEFAULT_INITIAL_PASSWORD = "Atlas_Admin_Initial12"


def users_db_path() -> Path:
    ensure_atlas_data_dir()
    return ATLAS_DATA_DIR / "users.db"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(users_db_path()), timeout=30)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _db_lock, _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_web (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                username TEXT,
                event TEXT NOT NULL,
                detail TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_web(ts);
            """
        )


def count_users() -> int:
    init_db()
    with _db_lock, _conn() as c:
        row = c.execute("SELECT COUNT(*) AS n FROM users").fetchone()
        return int(row["n"]) if row else 0


def audit(event: str, username: str | None = None, detail: str = "") -> None:
    try:
        with _db_lock, _conn() as c:
            c.execute(
                "INSERT INTO audit_web (ts, username, event, detail) VALUES (?,?,?,?)",
                (int(time.time()), username or "", event, detail[:2000]),
            )
    except Exception:
        pass


def create_user(username: str, password: str, role: str) -> None:
    if role not in ROLES:
        raise ValueError("Rol inválido.")
    u = username.strip()
    if not USER_RE.match(u):
        raise ValueError("Usuario: 3-32 caracteres, solo letras, números y guión bajo.")
    if len(password) < 12:
        raise ValueError("La contraseña debe tener al menos 12 caracteres.")
    h = _ph.hash(password)
    key = u.lower()
    with _db_lock, _conn() as c:
        try:
            c.execute(
                "INSERT INTO users (username, password_hash, role, created_at) VALUES (?,?,?,?)",
                (key, h, role, int(time.time())),
            )
        except sqlite3.IntegrityError as e:
            raise ValueError("Ese nombre de usuario ya existe.") from e
    audit("user_created", key, role)


def verify_login(username: str, password: str) -> dict[str, Any] | None:
    init_db()
    key = username.strip().lower()
    with _db_lock, _conn() as c:
        row = c.execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?",
            (key,),
        ).fetchone()
    if not row:
        time.sleep(0.55)
        return None
    try:
        _ph.verify(row["password_hash"], password)
        if _ph.check_needs_rehash(row["password_hash"]):
            new_h = _ph.hash(password)
            with _db_lock, _conn() as c2:
                c2.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (new_h, row["id"]),
                )
    except (VerifyMismatchError, InvalidHashError):
        time.sleep(0.55)
        return None
    return {"id": int(row["id"]), "username": row["username"], "role": row["role"]}


def list_users() -> list[dict[str, Any]]:
    init_db()
    with _db_lock, _conn() as c:
        rows = c.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY username COLLATE NOCASE"
        ).fetchall()
    return [
        {
            "id": int(r["id"]),
            "username": r["username"],
            "role": r["role"],
            "created_at": int(r["created_at"]),
        }
        for r in rows
    ]


def update_user(
    target_username: str,
    *,
    actor_username: str,
    role: str | None = None,
    password: str | None = None,
) -> None:
    if role is None and (password is None or password == ""):
        raise ValueError("Nada que actualizar.")
    target_key = target_username.strip().lower()
    act_key = actor_username.strip().lower()
    if role is not None and role not in ROLES:
        raise ValueError("Rol inválido.")
    with _db_lock, _conn() as c:
        row = c.execute(
            "SELECT id, username, role FROM users WHERE username = ?",
            (target_key,),
        ).fetchone()
        if not row:
            raise ValueError("Usuario no encontrado.")
        cur_role = str(row["role"])
        new_role = role if role is not None else cur_role
        if cur_role == "admin" and new_role != "admin":
            other = c.execute(
                "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND username != ?",
                (target_key,),
            ).fetchone()
            if not other or int(other["n"]) < 1:
                raise ValueError("No se puede quitar el último administrador.")
        parts: list[str] = []
        params: list[Any] = []
        if role is not None:
            parts.append("role = ?")
            params.append(new_role)
        if password is not None and password != "":
            if len(password) < 12:
                raise ValueError("La contraseña debe tener al menos 12 caracteres.")
            parts.append("password_hash = ?")
            params.append(_ph.hash(password))
        if not parts:
            raise ValueError("Nada que actualizar.")
        params.append(int(row["id"]))
        c.execute(f"UPDATE users SET {', '.join(parts)} WHERE id = ?", params)
    audit("user_updated", act_key, f"{target_key}")


def delete_user(target_username: str, *, actor_username: str) -> None:
    target_key = target_username.strip().lower()
    act_key = actor_username.strip().lower()
    if target_key == act_key:
        raise ValueError("No puedes eliminar tu propia cuenta.")
    with _db_lock, _conn() as c:
        row = c.execute(
            "SELECT id, role FROM users WHERE username = ?",
            (target_key,),
        ).fetchone()
        if not row:
            raise ValueError("Usuario no encontrado.")
        if str(row["role"]) == "admin":
            other = c.execute(
                "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND username != ?",
                (target_key,),
            ).fetchone()
            if not other or int(other["n"]) < 1:
                raise ValueError("No se puede eliminar el último administrador.")
        c.execute("DELETE FROM users WHERE id = ?", (int(row["id"]),))
    audit("user_deleted", act_key, target_key)


def ensure_default_admin() -> None:
    """Si no hay usuarios, crea un administrador inicial (sin endpoint público de bootstrap)."""
    init_db()
    if count_users() > 0:
        return
    raw = atlas_env("DEFAULT_ADMIN_USERNAME", "admin")
    username = raw if USER_RE.match(raw) else "admin"
    pwd = atlas_env("DEFAULT_ADMIN_PASSWORD")
    if not pwd:
        pwd = _DEFAULT_INITIAL_PASSWORD
        print(
            "Atlas: base de usuarios vacía; se creó el administrador inicial. "
            f"Usuario: {username!r}. Define ATLAS_DEFAULT_ADMIN_PASSWORD antes del primer "
            "arranque en producción; si no, usa la contraseña inicial documentada (README / compose).",
            file=sys.stderr,
        )
    create_user(username, pwd, "admin")
