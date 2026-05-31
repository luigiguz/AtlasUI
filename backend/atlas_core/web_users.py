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
from sqlalchemy.orm import joinedload, selectinload

from atlas_core.db.models import AuditWeb, Role, User, UserRole
from atlas_core.db.session import init_db as init_db_engine, session_scope
from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir
from atlas_core.permissions import SYSTEM_ROLE_DEFINITIONS, SYSTEM_ROLE_OPERATOR
from atlas_core.web_roles import (
    count_users_with_role_slug,
    ensure_system_roles,
    load_user_auth,
    resolve_role_ids,
    set_user_roles,
)

import re

_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)

USER_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
NAME_RE = re.compile(r"^[\w\s\u00C0-\u024F'.-]{1,64}$", re.UNICODE)

_DEFAULT_INITIAL_PASSWORD = "Atlas_Admin_Initial12"


def users_db_path():
    """Ruta legacy; la BD activa es `atlas.db` o PostgreSQL."""
    ensure_atlas_data_dir()
    return ATLAS_DATA_DIR / "users.db"


_roles_seeded = False


def init_db() -> None:
    global _roles_seeded
    init_db_engine()
    if not _roles_seeded:
        ensure_system_roles()
        _roles_seeded = True


def count_users() -> int:
    from atlas_core.db.session import get_engine

    get_engine()
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


def _resolve_role_ids_for_create(role_ids: list[int] | None, role_slug: str | None) -> list[int]:
    ensure_system_roles()
    if role_ids:
        return list(dict.fromkeys(role_ids))
    slug = (role_slug or SYSTEM_ROLE_OPERATOR).strip().lower()
    with session_scope() as session:
        row = session.scalar(select(Role).where(Role.slug == slug))
        if not row:
            raise ValueError("Rol inválido.")
        return [int(row.id)]


def create_user(
    username: str,
    password: str,
    *,
    email: str,
    first_name: str,
    last_name: str,
    role_ids: list[int] | None = None,
    role: str | None = None,
) -> None:
    ids = _resolve_role_ids_for_create(role_ids, role)
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
            user = User(
                username=key,
                email=em,
                first_name=fn,
                last_name=ln,
                password_hash=h,
                role=SYSTEM_ROLE_OPERATOR,
                created_at=datetime.now(timezone.utc),
            )
            session.add(user)
            session.flush()
            set_user_roles(session, user, ids)
    except IntegrityError as e:
        err = str(e).lower()
        if "email" in err:
            raise ValueError("Ese correo ya está registrado.") from e
        raise ValueError("Ese nombre de usuario ya existe.") from e
    audit("user_created", key, ",".join(str(i) for i in ids))


def verify_login(username: str, password: str) -> dict[str, Any] | None:
    """Valida credenciales; no ejecuta migraciones (solo arranque de la API)."""
    from atlas_core.db.session import get_engine
    from atlas_core.web_roles import _legacy_user_auth, load_user_auth

    get_engine()
    key = username.strip().lower()
    user_id: int | None = None
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
        user_id = int(row.id)
    if user_id is None:
        return None
    try:
        return load_user_auth(user_id)
    except Exception:
        with session_scope() as session:
            row = session.scalar(select(User).where(User.id == user_id))
            if row:
                return _legacy_user_auth(row)
        return None


def _roles_for_listed_user(r: User) -> list[dict[str, Any]]:
    roles = [
        {"id": int(ur.role.id), "slug": ur.role.slug, "name": ur.role.name}
        for ur in (r.role_assignments or [])
        if ur.role
    ]
    if roles:
        return roles
    slug = str(r.role or "viewer")
    meta = SYSTEM_ROLE_DEFINITIONS.get(slug, SYSTEM_ROLE_DEFINITIONS.get("viewer", {}))
    return [{"id": 0, "slug": slug, "name": str(meta.get("name") or slug)}]


def _user_row_dict(r: User) -> dict[str, Any]:
    ts = r.created_at
    created = int(ts.timestamp()) if isinstance(ts, datetime) else int(time.time())
    roles = _roles_for_listed_user(r)
    return {
        "id": int(r.id),
        "username": r.username,
        "email": r.email or "",
        "first_name": r.first_name or "",
        "last_name": r.last_name or "",
        "email_notifications_enabled": bool(getattr(r, "email_notifications_enabled", True)),
        "role": r.role,
        "roles": roles,
        "created_at": created,
    }


def list_users() -> list[dict[str, Any]]:
    from atlas_core.db.session import get_engine

    get_engine()
    out: list[dict[str, Any]] = []
    try:
        with session_scope() as session:
            rows = session.scalars(
                select(User)
                .options(
                    selectinload(User.role_assignments).selectinload(UserRole.role)
                )
                .order_by(User.username)
            ).all()
            for r in rows:
                out.append(_user_row_dict(r))
        return out
    except Exception:
        with session_scope() as session:
            rows = session.scalars(select(User).order_by(User.username)).all()
            for r in rows:
                out.append(_user_row_dict(r))
        return out


def _assert_last_admin(
  target_user_id: int,
  *,
  removing_admin: bool,
) -> None:
    if not removing_admin:
        return
    remaining = count_users_with_role_slug("admin", exclude_user_id=target_user_id)
    if remaining < 1:
        raise ValueError("Debe quedar al menos un usuario con rol Administrador.")


def update_user(
    target_username: str,
    *,
    actor_username: str,
    role_ids: list[int] | None = None,
    password: str | None = None,
    email: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    email_notifications: bool | None = None,
) -> None:
    profile_change = any(
        x is not None for x in (email, first_name, last_name, email_notifications)
    )
    if role_ids is None and (password is None or password == "") and not profile_change:
        raise ValueError("Nada que actualizar.")
    target_key = target_username.strip().lower()
    act_key = actor_username.strip().lower()
    try:
        with session_scope() as session:
            row = session.scalar(
                select(User)
                .where(User.username == target_key)
                .options(
                    selectinload(User.role_assignments).selectinload(UserRole.role)
                )
            )
            if not row:
                raise ValueError("Usuario no encontrado.")
            had_admin = any(
                ur.role and ur.role.slug == "admin" for ur in (row.role_assignments or [])
            ) or str(row.role) == "admin"
            if role_ids is not None:
                new_roles = resolve_role_ids(session, role_ids)
                will_have_admin = any(r.slug == "admin" for r in new_roles)
                if had_admin and not will_have_admin:
                    _assert_last_admin(int(row.id), removing_admin=True)
                set_user_roles(session, row, role_ids)
            if email is not None or first_name is not None or last_name is not None:
                em, fn, ln = _validate_profile(
                    email=email if email is not None else (row.email or ""),
                    first_name=first_name if first_name is not None else (row.first_name or ""),
                    last_name=last_name if last_name is not None else (row.last_name or ""),
                )
                row.email = em
                row.first_name = fn
                row.last_name = ln
            if email_notifications is not None:
                row.email_notifications_enabled = bool(email_notifications)
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
        row = session.scalar(
            select(User)
            .where(User.username == target_key)
            .options(
                selectinload(User.role_assignments).selectinload(UserRole.role)
            )
        )
        if not row:
            raise ValueError("Usuario no encontrado.")
        had_admin = any(
            ur.role and ur.role.slug == "admin" for ur in (row.role_assignments or [])
        ) or str(row.role) == "admin"
        if had_admin:
            _assert_last_admin(int(row.id), removing_admin=True)
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
        email=f"{username}@local",
        first_name="Administrador",
        last_name="Atlas",
        role="admin",
    )
