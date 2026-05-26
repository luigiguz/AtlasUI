/** Tipos y helpers RBAC (alineados con backend atlas_core.permissions). */

export type AtlasRoleRef = { id: number; slug: string; name: string };

export type AuthUser = {
  username: string;
  /** Rol primario (legacy UI); derivado del rol de mayor prioridad. */
  role: string;
  roles?: AtlasRoleRef[];
  permissions?: string[];
};

export const PERM_USERS_LIST = "atlas:users:List";
export const PERM_USERS_CREATE = "atlas:users:Create";
export const PERM_USERS_UPDATE = "atlas:users:Update";
export const PERM_USERS_DELETE = "atlas:users:Delete";
export const PERM_ROLES_LIST = "atlas:roles:List";
export const PERM_ROLES_MANAGE = "atlas:roles:Manage";
export const PERM_CF_READ = "atlas:cf:ReadSettings";
export const PERM_CF_WRITE = "atlas:cf:WriteSettings";
export const PERM_CF_SYNC = "atlas:cf:Sync";
export const PERM_VPN_READ = "atlas:vpn:Read";
export const PERM_VPN_OPERATE = "atlas:vpn:Operate";
export const PERM_RANCHER_READ = "atlas:rancher:Read";
export const PERM_RANCHER_WRITE = "atlas:rancher:Write";
export const PERM_RANCHER_CONFIGURE = "atlas:rancher:Configure";
export const PERM_STORES_READ = "atlas:stores:Read";
export const PERM_STORES_WRITE = "atlas:stores:Write";
export const PERM_STORES_CONFIGURE = "atlas:stores:Configure";

const LEGACY_ADMIN: string[] = [
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
  PERM_RANCHER_READ,
  PERM_RANCHER_WRITE,
  PERM_RANCHER_CONFIGURE,
  PERM_STORES_READ,
  PERM_STORES_WRITE,
  PERM_STORES_CONFIGURE,
];

const LEGACY_OPERATOR: string[] = [
  PERM_VPN_OPERATE,
  PERM_RANCHER_WRITE,
  PERM_STORES_WRITE,
  PERM_VPN_READ,
  PERM_RANCHER_READ,
  PERM_STORES_READ,
];

const LEGACY_VIEWER: string[] = [PERM_VPN_READ, PERM_RANCHER_READ, PERM_STORES_READ];

function legacyPermissions(role: string): string[] {
  if (role === "admin") return LEGACY_ADMIN;
  if (role === "operator") return LEGACY_OPERATOR;
  if (role === "viewer") return LEGACY_VIEWER;
  return [];
}

export function effectivePermissions(user: AuthUser | null | undefined): string[] {
  if (!user) return [];
  if (user.permissions && user.permissions.length > 0) return user.permissions;
  return legacyPermissions(user.role);
}

export function hasPermission(user: AuthUser | null | undefined, permission: string): boolean {
  return effectivePermissions(user).includes(permission);
}

export function hasAnyPermission(
  user: AuthUser | null | undefined,
  ...permissions: string[]
): boolean {
  const set = new Set(effectivePermissions(user));
  return permissions.some((p) => set.has(p));
}

export function parseAuthUser(raw: {
  username: string;
  role: string;
  roles?: AtlasRoleRef[];
  permissions?: string[];
}): AuthUser {
  return {
    username: raw.username,
    role: raw.role,
    roles: raw.roles,
    permissions: raw.permissions,
  };
}

export function showAdminNav(user: AuthUser): boolean {
  return hasAnyPermission(
    user,
    PERM_USERS_LIST,
    PERM_ROLES_LIST,
    PERM_ROLES_MANAGE,
    PERM_CF_READ,
    PERM_CF_WRITE
  );
}
