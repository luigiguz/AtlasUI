"""Usuarios web de Atlas (PostgreSQL/SQLite unificado + Argon2id)."""

from __future__ import annotations

import sys
import time
from datetime import datetime, timezone
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from atlas_core.db.models import AuditWeb, User
from atlas_core.db.session import init_db as init_db_engine, session_scope
from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

import re

_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

USER_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
NAME_RE = re.compile(r"^[\w\s\u00C0-\u024F'.-]{1,64}$", re.UNICODE)
ROLES = frozenset({"admin", "operator", "viewer"})

_DEFAULT_INITIAL_PASSWORD = "Atlas_Admin_Initial12"


def users_db_path():
    """Ruta legacy; la BD activa es `atlas.db` o PostgreSQL."""
    ensure_atlas_data_dir()
    return ATLAS_DATA_DIR / "users.db"


def init_db() -> None:
    init_db_engine()


def count_users() -> int:
    init_db()
    with session_scope() as session:
        return int(session.scalar(select(func.count()).select_from(User)) or 0)


def audit(event: str, username: str | None = None, detail: str = "") -> None:
    try:
        with session_scope() as session:
            session.add(
                AuditWeb(
                    username=username or "",
                    event=event,
                    detail=(detail or "")[:2000],
                )
            )
    except Exception:
        pass


def _normalize_email(raw: str) -> str:
    return raw.strip().lower()


def _validate_profile(*, email: str, first_name: str, last_name: str) -> tuple[str, str, str]:
    em = _normalize_email(email)
    if not em or not EMAIL_RE.match(em):
        raise ValueError("Correo electrónico inválido.")
    fn = first_name.strip()
    ln = last_name.strip()
    if not fn or not NAME_RE.match(fn):
        raise ValueError("Nombre: 1-64 caracteres.")
    if not ln or not NAME_RE.match(ln):
        raise ValueError("Apellido: 1-64 caracteres.")
    return em, fn, ln


def create_user(
    username: str,
    password: str,
    role: str,
    *,
    email: str,
    first_name: str,
    last_name: str,
) -> None:
    if role not in ROLES:
        raise ValueError("Rol inválido.")
    u = username.strip()
    if not USER_RE.match(u):
        raise ValueError("Usuario: 3-32 caracteres, solo letras, números y guión bajo.")
    if len(password) < 12:
        raise ValueError("La contraseña debe tener al menos 12 caracteres.")
    em, fn, ln = _validate_profile(email=email, first_name=first_name, last_name=last_name)
    h = _ph.hash(password)
    key = u.lower()
    try:
        with session_scope() as session:
            session.add(
                User(
                    username=key,
                    email=em,
                    first_name=fn,
                    last_name=ln,
                    password_hash=h,
                    role=role,
                    created_at=datetime.now(timezone.utc),
                )
            )
    except IntegrityError as e:
        err = str(e).lower()
        if "email" in err:
            raise ValueError("Ese correo ya está registrado.") from e
        raise ValueError("Ese nombre de usuario ya existe.") from e
    audit("user_created", key, role)


def verify_login(username: str, password: str) -> dict[str, Any] | None:
    init_db()
    key = username.strip().lower()
    with session_scope() as session:
        row = session.scalar(select(User).where(User.username == key))
        if not row:
            time.sleep(0.55)
            return None
        try:
            _ph.verify(row.password_hash, password)
            if _ph.check_needs_rehash(row.password_hash):
                row.password_hash = _ph.hash(password)
        except (VerifyMismatchError, InvalidHashError):
            time.sleep(0.55)
            return None
        return {"id": int(row.id), "username": row.username, "role": row.role}


def list_users() -> list[dict[str, Any]]:
    init_db()
    out: list[dict[str, Any]] = []
    with session_scope() as session:
        rows = session.scalars(select(User).order_by(User.username)).all()
        for r in rows:
            ts = r.created_at
            created = int(ts.timestamp()) if isinstance(ts, datetime) else int(time.time())
            out.append(
                {
                    "id": int(r.id),
                    "username": r.username,
                    "email": r.email or "",
                    "first_name": r.first_name or "",
                    "last_name": r.last_name or "",
                    "role": r.role,
                    "created_at": created,
                }
            )
    return out


def update_user(
    target_username: str,
    *,
    actor_username: str,
    role: str | None = None,
    password: str | None = None,
    email: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
) -> None:
    profile_change = any(x is not None for x in (email, first_name, last_name))
    if role is None and (password is None or password == "") and not profile_change:
        raise ValueError("Nada que actualizar.")
    target_key = target_username.strip().lower()
    act_key = actor_username.strip().lower()
    if role is not None and role not in ROLES:
        raise ValueError("Rol inválido.")
    try:
        with session_scope() as session:
            row = session.scalar(select(User).where(User.username == target_key))
            if not row:
                raise ValueError("Usuario no encontrado.")
            cur_role = str(row.role)
            new_role = role if role is not None else cur_role
            if cur_role == "admin" and new_role != "admin":
                other = session.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(User.role == "admin", User.username != target_key)
                )
                if not other or int(other) < 1:
                    raise ValueError("No se puede quitar el último administrador.")
            if role is not None:
                row.role = new_role
            if email is not None or first_name is not None or last_name is not None:
                em, fn, ln = _validate_profile(
                    email=email if email is not None else (row.email or ""),
                    first_name=first_name if first_name is not None else (row.first_name or ""),
                    last_name=last_name if last_name is not None else (row.last_name or ""),
                )
                row.email = em
                row.first_name = fn
                row.last_name = ln
            if password is not None and password != "":
                if len(password) < 12:
                    raise ValueError("La contraseña debe tener al menos 12 caracteres.")
                row.password_hash = _ph.hash(password)
                from atlas_core.web_sessions import revoke_all_sessions_for_user

                revoke_all_sessions_for_user(int(row.id))
    except IntegrityError as e:
        if "email" in str(e).lower():
            raise ValueError("Ese correo ya está registrado.") from e
        raise
    audit("user_updated", act_key, f"{target_key}")


def delete_user(target_username: str, *, actor_username: str) -> None:
    target_key = target_username.strip().lower()
    act_key = actor_username.strip().lower()
    if target_key == act_key:
        raise ValueError("No puedes eliminar tu propia cuenta.")
    with session_scope() as session:
        row = session.scalar(select(User).where(User.username == target_key))
        if not row:
            raise ValueError("Usuario no encontrado.")
        if str(row.role) == "admin":
            other = session.scalar(
                select(func.count())
                .select_from(User)
                .where(User.role == "admin", User.username != target_key)
            )
            if not other or int(other) < 1:
                raise ValueError("No se puede eliminar el último administrador.")
        session.delete(row)
    audit("user_deleted", act_key, target_key)


def ensure_default_admin() -> None:
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
    create_user(
        username,
        pwd,
        "admin",
        email=f"{username}@local",
        first_name="Administrador",
        last_name="Atlas",
    )
