"""CRUD de roles y resolución de permisos efectivos."""

from __future__ import annotations

import logging
import re
import threading
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload, selectinload

from atlas_core.db.models import Role, User, UserRole
from atlas_core.db.session import get_engine, session_scope
from atlas_core.permissions import (
    ALL_PERMISSIONS,
    PERM_ROLES_MANAGE,
    PERMISSION_GROUPS,
    SYSTEM_ROLE_DEFINITIONS,
    merge_permissions,
    normalize_permissions,
    primary_role_slug,
)

SLUG_RE = re.compile(r"^[a-z][a-z0-9_-]{2,31}$")
_log = logging.getLogger(__name__)
_system_roles_seeded = False
_roles_seed_lock = threading.Lock()


def _legacy_user_auth(row: User) -> dict[str, Any]:
    """Fallback si la migración RBAC aún no está aplicada."""
    slug = str(row.role or "viewer")
    meta = SYSTEM_ROLE_DEFINITIONS.get(slug, SYSTEM_ROLE_DEFINITIONS["viewer"])
    perms = normalize_permissions(list(meta["permissions"]))
    return {
        "id": int(row.id),
        "username": row.username,
        "role": slug,
        "roles": [{"id": 0, "slug": slug, "name": str(meta["name"])}],
        "permissions": perms,
    }


def ensure_system_roles() -> None:
    """Siembra roles de sistema una vez por proceso (no ejecuta Alembic)."""
    global _system_roles_seeded
    with _roles_seed_lock:
        if _system_roles_seeded:
            return
        get_engine()
        try:
            with session_scope() as session:
                for slug, meta in SYSTEM_ROLE_DEFINITIONS.items():
                    row = session.scalar(select(Role).where(Role.slug == slug))
                    perms = normalize_permissions(list(meta["permissions"]))
                    if row is None:
                        session.add(
                            Role(
                                slug=slug,
                                name=str(meta["name"]),
                                description=str(meta.get("description") or ""),
                                is_system=True,
                                permissions=perms,
                            )
                        )
                    else:
                        row.name = str(meta["name"])
                        row.description = str(meta.get("description") or "")
                        row.is_system = True
                        # No pisar permisos ya guardados (edición desde la UI).
                        if not normalize_permissions(list(row.permissions or [])):
                            row.permissions = perms
        except SQLAlchemyError as e:
            _log.warning(
                "ensure_system_roles omitido (¿migración 20260526_0004 pendiente?): %s", e
            )
            return
        _system_roles_seeded = True


def permission_catalog() -> dict[str, Any]:
    return {
        "groups": PERMISSION_GROUPS,
        "all": sorted(ALL_PERMISSIONS),
    }


def _role_dict(row: Role) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "slug": row.slug,
        "name": row.name,
        "description": row.description or "",
        "is_system": bool(row.is_system),
        "permissions": normalize_permissions(list(row.permissions or [])),
    }


def list_roles() -> list[dict[str, Any]]:
    ensure_system_roles()
    with session_scope() as session:
        rows = session.scalars(select(Role).order_by(Role.is_system.desc(), Role.name)).all()
        return [_role_dict(r) for r in rows]


def get_role_by_slug(slug: str) -> dict[str, Any] | None:
    ensure_system_roles()
    key = slug.strip().lower()
    with session_scope() as session:
        row = session.scalar(select(Role).where(Role.slug == key))
        return _role_dict(row) if row else None


def create_role(*, slug: str, name: str, description: str, permissions: list[str]) -> dict[str, Any]:
    key = slug.strip().lower()
    if key in SYSTEM_ROLE_DEFINITIONS:
        raise ValueError("Ese identificador está reservado para un rol de sistema.")
    if not SLUG_RE.match(key):
        raise ValueError("Identificador: 3-32 caracteres, minúsculas, números, _ o -.")
    nm = name.strip()
    if not nm or len(nm) > 64:
        raise ValueError("Nombre: 1-64 caracteres.")
    perms = normalize_permissions(permissions)
    if not perms:
        raise ValueError("Selecciona al menos un permiso.")
    try:
        with session_scope() as session:
            row = Role(
                slug=key,
                name=nm,
                description=(description or "").strip()[:256],
                is_system=False,
                permissions=perms,
            )
            session.add(row)
            session.flush()
            return _role_dict(row)
    except IntegrityError as e:
        raise ValueError("Ya existe un rol con ese identificador.") from e


def update_role(
    slug: str,
    *,
    name: str | None = None,
    description: str | None = None,
    permissions: list[str] | None = None,
) -> dict[str, Any]:
    key = slug.strip().lower()
    with session_scope() as session:
        row = session.scalar(select(Role).where(Role.slug == key))
        if not row:
            raise ValueError("Rol no encontrado.")
        if name is not None:
            nm = name.strip()
            if not nm or len(nm) > 64:
                raise ValueError("Nombre: 1-64 caracteres.")
            row.name = nm
        if description is not None:
            row.description = description.strip()[:256]
        if permissions is not None:
            perms = normalize_permissions(permissions)
            if not perms:
                raise ValueError("Selecciona al menos un permiso.")
            row.permissions = perms
        return _role_dict(row)


def delete_role(slug: str) -> None:
    key = slug.strip().lower()
    with session_scope() as session:
        row = session.scalar(
            select(Role).where(Role.slug == key).options(joinedload(Role.user_assignments))
        )
        if not row:
            raise ValueError("Rol no encontrado.")
        if row.is_system:
            raise ValueError("No se pueden eliminar roles de sistema.")
        if row.user_assignments:
            raise ValueError("Quita este rol de los usuarios antes de eliminarlo.")
        session.delete(row)
    _audit("role_deleted", None, key)


def _audit(event: str, username: str | None = None, detail: str = "") -> None:
    try:
        from atlas_core.db.models import AuditWeb
        from atlas_core.db.session import session_scope

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


def resolve_role_ids(session, role_ids: list[int]) -> list[Role]:
    if not role_ids:
        raise ValueError("Asigna al menos un rol.")
    rows = session.scalars(select(Role).where(Role.id.in_(role_ids))).all()
    if len(rows) != len(set(role_ids)):
        raise ValueError("Uno o más roles no existen.")
    return list(rows)


def set_user_roles(session, user: User, role_ids: list[int]) -> None:
    roles = resolve_role_ids(session, role_ids)
    session.execute(delete(UserRole).where(UserRole.user_id == user.id))
    for r in roles:
        session.add(UserRole(user_id=int(user.id), role_id=int(r.id)))
    slugs = [r.slug for r in roles]
    user.role = primary_role_slug(slugs)


def _load_user_auth_rbac(user_id: int) -> dict[str, Any] | None:
    ensure_system_roles()
    with session_scope() as session:
        row = session.scalar(
            select(User)
            .where(User.id == user_id)
            .options(
                selectinload(User.role_assignments).selectinload(UserRole.role)
            )
        )
        if not row:
            return None
        roles_out: list[dict[str, Any]] = []
        perm_lists: list[list[str]] = []
        slugs: list[str] = []
        for ur in row.role_assignments:
            role = ur.role
            if not role:
                continue
            slugs.append(role.slug)
            roles_out.append({"id": int(role.id), "slug": role.slug, "name": role.name})
            perm_lists.append(normalize_permissions(list(role.permissions or [])))
        if not slugs:
            legacy = session.scalar(select(Role).where(Role.slug == row.role))
            if legacy:
                slugs = [legacy.slug]
                roles_out = [{"id": int(legacy.id), "slug": legacy.slug, "name": legacy.name}]
                perm_lists = [normalize_permissions(list(legacy.permissions or []))]
        if not slugs:
            return _legacy_user_auth(row)
        permissions = merge_permissions(perm_lists)
        primary = primary_role_slug(slugs)
        return {
            "id": int(row.id),
            "username": row.username,
            "role": primary,
            "roles": roles_out,
            "permissions": permissions,
        }


def load_user_auth(user_id: int) -> dict[str, Any] | None:
    """Permisos efectivos y metadatos para JWT/sesión."""
    try:
        return _load_user_auth_rbac(user_id)
    except SQLAlchemyError as e:
        _log.warning("load_user_auth RBAC falló, usando legacy (user_id=%s): %s", user_id, e)
        with session_scope() as session:
            row = session.scalar(select(User).where(User.id == user_id))
            if not row:
                return None
            return _legacy_user_auth(row)


def count_users_with_role_slug(slug: str, *, exclude_user_id: int | None = None) -> int:
    key = slug.strip().lower()
    with session_scope() as session:
        q = (
            select(func.count())
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.slug == key)
        )
        if exclude_user_id is not None:
            q = q.where(UserRole.user_id != exclude_user_id)
        return int(session.scalar(q) or 0)


def user_has_permission(user_id: int, permission: str) -> bool:
    ctx = load_user_auth(user_id)
    if not ctx:
        return False
    return permission in (ctx.get("permissions") or [])


def assert_can_manage_roles(actor: dict[str, Any]) -> None:
    perms = actor.get("permissions") or []
    if PERM_ROLES_MANAGE not in perms:
        raise ValueError("Sin permiso para gestionar roles.")
