"""Catálogo de permisos Atlas (RBAC granular, estilo IAM simplificado)."""

from __future__ import annotations

from typing import Any

# Convención: atlas:<módulo>:<acción>
PERM_USERS_LIST = "atlas:users:List"
PERM_USERS_CREATE = "atlas:users:Create"
PERM_USERS_UPDATE = "atlas:users:Update"
PERM_USERS_DELETE = "atlas:users:Delete"

PERM_ROLES_LIST = "atlas:roles:List"
PERM_ROLES_MANAGE = "atlas:roles:Manage"

PERM_CF_READ = "atlas:cf:ReadSettings"
PERM_CF_WRITE = "atlas:cf:WriteSettings"
PERM_CF_SYNC = "atlas:cf:Sync"

PERM_VPN_READ = "atlas:vpn:Read"
PERM_VPN_OPERATE = "atlas:vpn:Operate"
PERM_VPN_INIT = "atlas:vpn:InitTemplate"

PERM_RANCHER_READ = "atlas:rancher:Read"
PERM_RANCHER_WRITE = "atlas:rancher:Write"
PERM_RANCHER_CONFIGURE = "atlas:rancher:Configure"

PERM_STORES_READ = "atlas:stores:Read"
PERM_STORES_WRITE = "atlas:stores:Write"
PERM_STORES_CONFIGURE = "atlas:stores:Configure"

ALL_PERMISSIONS: frozenset[str] = frozenset(
    {
        PERM_USERS_LIST,
        PERM_USERS_CREATE,
        PERM_USERS_UPDATE,
        PERM_USERS_DELETE,
        PERM_ROLES_LIST,
        PERM_ROLES_MANAGE,
        PERM_CF_READ,
        PERM_CF_WRITE,
        PERM_CF_SYNC,
        PERM_VPN_READ,
        PERM_VPN_OPERATE,
        PERM_VPN_INIT,
        PERM_RANCHER_READ,
        PERM_RANCHER_WRITE,
        PERM_RANCHER_CONFIGURE,
        PERM_STORES_READ,
        PERM_STORES_WRITE,
        PERM_STORES_CONFIGURE,
    }
)

# Grupos para la UI de edición de roles
PERMISSION_GROUPS: list[dict[str, Any]] = [
    {
        "id": "admin",
        "label": "Administración",
        "permissions": [
            {"id": PERM_USERS_LIST, "label": "Listar usuarios"},
            {"id": PERM_USERS_CREATE, "label": "Crear usuarios"},
            {"id": PERM_USERS_UPDATE, "label": "Editar usuarios"},
            {"id": PERM_USERS_DELETE, "label": "Eliminar usuarios"},
            {"id": PERM_ROLES_LIST, "label": "Ver roles"},
            {"id": PERM_ROLES_MANAGE, "label": "Gestionar roles y permisos"},
        ],
    },
    {
        "id": "vpn",
        "label": "Atlas VPN",
        "permissions": [
            {"id": PERM_VPN_READ, "label": "Ver conexiones y estado"},
            {"id": PERM_VPN_OPERATE, "label": "Iniciar/detener túneles y terminales"},
            {"id": PERM_CF_READ, "label": "Ver credenciales Cloudflare"},
            {"id": PERM_CF_WRITE, "label": "Editar credenciales Cloudflare"},
            {"id": PERM_CF_SYNC, "label": "Sincronizar con Cloudflare"},
            {"id": PERM_VPN_INIT, "label": "Inicializar plantilla tunnels.json"},
        ],
    },
    {
        "id": "rancher",
        "label": "Atlas Rancher",
        "permissions": [
            {"id": PERM_RANCHER_READ, "label": "Consultar equipos y contenedores"},
            {"id": PERM_RANCHER_WRITE, "label": "Rollout y cambios operativos"},
            {"id": PERM_RANCHER_CONFIGURE, "label": "Configuración de conexión Rancher"},
        ],
    },
    {
        "id": "stores",
        "label": "Tiendas (Git)",
        "permissions": [
            {"id": PERM_STORES_READ, "label": "Consultar tiendas"},
            {"id": PERM_STORES_WRITE, "label": "Editar, sincronizar Git y publicar fleets"},
            {"id": PERM_STORES_CONFIGURE, "label": "Configuración avanzada del módulo tiendas"},
        ],
    },
]

# Roles de sistema (slug = valor legacy en users.role)
SYSTEM_ROLE_ADMIN = "admin"
SYSTEM_ROLE_OPERATOR = "operator"
SYSTEM_ROLE_VIEWER = "viewer"

SYSTEM_ROLE_DEFINITIONS: dict[str, dict[str, Any]] = {
    SYSTEM_ROLE_ADMIN: {
        "name": "Administrador",
        "description": "Usuarios, credenciales Cloudflare y configuración global.",
        "permissions": sorted(ALL_PERMISSIONS),
    },
    SYSTEM_ROLE_OPERATOR: {
        "name": "Operador",
        "description": "Túneles y operación; sin credenciales Cloudflare ni administración.",
        "permissions": sorted(
            {
                PERM_VPN_READ,
                PERM_VPN_OPERATE,
                PERM_RANCHER_READ,
                PERM_RANCHER_WRITE,
                PERM_STORES_READ,
                PERM_STORES_WRITE,
            }
        ),
    },
    SYSTEM_ROLE_VIEWER: {
        "name": "Solo lectura",
        "description": "Consulta de estado sin cambios.",
        "permissions": sorted(
            {
                PERM_VPN_READ,
                PERM_RANCHER_READ,
                PERM_STORES_READ,
            }
        ),
    },
}

# Prioridad para rol «primario» mostrado en JWT/UI legacy
ROLE_PRIORITY: dict[str, int] = {
    SYSTEM_ROLE_ADMIN: 0,
    SYSTEM_ROLE_OPERATOR: 1,
    SYSTEM_ROLE_VIEWER: 2,
}


def normalize_permissions(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for p in raw:
        key = str(p).strip()
        if key in ALL_PERMISSIONS and key not in seen:
            seen.add(key)
            out.append(key)
    return sorted(out)


def merge_permissions(per_role_lists: list[list[str]]) -> list[str]:
    merged: set[str] = set()
    for lst in per_role_lists:
        merged.update(lst)
    return sorted(merged)


def has_permission(user: dict[str, Any], permission: str) -> bool:
    perms = user.get("permissions")
    if isinstance(perms, list) and permission in perms:
        return True
    # Compatibilidad mínima si solo llega role legacy sin permissions
    role = str(user.get("role") or "")
    legacy = SYSTEM_ROLE_DEFINITIONS.get(role, {}).get("permissions") or []
    return permission in legacy


def has_any_permission(user: dict[str, Any], *permissions: str) -> bool:
    return any(has_permission(user, p) for p in permissions)


def primary_role_slug(slugs: list[str]) -> str:
    if not slugs:
        return SYSTEM_ROLE_VIEWER
    return sorted(slugs, key=lambda s: ROLE_PRIORITY.get(s, 99))[0]
