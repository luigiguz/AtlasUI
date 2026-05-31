import type { LucideIcon } from "lucide-react";
import {
  Box,
  Cloud,
  Home,
  Info,
  KeyRound,
  Server,
  Settings,
  Shield,
  Store,
  Users,
  Wifi,
} from "lucide-react";

import {
  hasAnyPermission,
  hasPermission,
  PERM_CF_READ,
  PERM_ROLES_LIST,
  PERM_STORES_READ,
  PERM_USERS_LIST,
  type AuthUser,
} from "./atlasAuth";

/** Rutas de la consola web Atlas (plataforma). */
export type AtlasRouteId =
  | "home"
  | "conn"
  | "poslite"
  | "cf"
  | "rancher-stores"
  | "rancher-clusters"
  | "rancher-pods"
  | "users"
  | "roles"
  | "about";

/** Rutas del módulo Atlas VPN (sync CF, túneles, Poslite). */
export const ATLAS_VPN_ROUTE_IDS = ["conn", "poslite", "cf"] as const satisfies readonly AtlasRouteId[];

export function isAtlasVpnRoute(route: AtlasRouteId): boolean {
  return (ATLAS_VPN_ROUTE_IDS as readonly AtlasRouteId[]).includes(route);
}

export type AtlasNavLeaf = {
  kind: "leaf";
  id: string;
  route: AtlasRouteId;
  label: string;
  icon: LucideIcon;
  /** Solo administradores */
  adminOnly?: boolean;
  /** Visible pero deshabilitado (próximamente) */
  comingSoon?: boolean;
};

export type AtlasNavGroup = {
  kind: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  defaultOpen?: boolean;
  children: AtlasNavLeaf[];
};

export type AtlasNavEntry = AtlasNavLeaf | AtlasNavGroup;

/** Menú lateral: plataforma Atlas → productos → páginas. Ampliar `children` al añadir módulos. */
export function buildAtlasNav(user: AuthUser): AtlasNavEntry[] {
  const canCf = hasPermission(user, PERM_CF_READ);
  const canStoresRead = hasPermission(user, PERM_STORES_READ);
  const vpnChildren: AtlasNavLeaf[] = [
    { kind: "leaf", id: "vpn-conn", route: "conn", label: "Conexiones", icon: Wifi },
    { kind: "leaf", id: "vpn-poslite", route: "poslite", label: "Poslite", icon: Store },
    ...(canCf
      ? ([
          { kind: "leaf", id: "vpn-cf", route: "cf", label: "Cloudflare", icon: Cloud, adminOnly: true },
        ] satisfies AtlasNavLeaf[])
      : []),
  ];

  const entries: AtlasNavEntry[] = [
    { kind: "leaf", id: "home", route: "home", label: "Inicio", icon: Home },
    {
      kind: "group",
      id: "atlas-vpn",
      label: "Atlas VPN",
      icon: Shield,
      defaultOpen: true,
      children: vpnChildren,
    },
    {
      kind: "group",
      id: "atlas-rancher",
      label: "Atlas Rancher",
      icon: Server,
      defaultOpen: true,
      children: [
        ...(canStoresRead
          ? ([
              {
                kind: "leaf",
                id: "rancher-stores",
                route: "rancher-stores",
                label: "Tiendas",
                icon: Store,
              },
            ] satisfies AtlasNavLeaf[])
          : []),
        {
          kind: "leaf",
          id: "rancher-clusters",
          route: "rancher-clusters",
          label: "Equipos",
          icon: Server,
        },
        {
          kind: "leaf",
          id: "rancher-pods",
          route: "rancher-pods",
          label: "Contenedores",
          icon: Box,
        },
      ],
    },
  ];

  const adminChildren: AtlasNavLeaf[] = [];
  if (hasPermission(user, PERM_USERS_LIST)) {
    adminChildren.push({
      kind: "leaf",
      id: "admin-users",
      route: "users",
      label: "Usuarios",
      icon: Users,
      adminOnly: true,
    });
  }
  if (hasAnyPermission(user, PERM_ROLES_LIST)) {
    adminChildren.push({
      kind: "leaf",
      id: "admin-roles",
      route: "roles",
      label: "Roles",
      icon: KeyRound,
      adminOnly: true,
    });
  }
  if (adminChildren.length) {
    entries.push({
      kind: "group",
      id: "atlas-admin",
      label: "Administración",
      icon: Settings,
      defaultOpen: true,
      children: adminChildren,
    });
  }

  entries.push({ kind: "leaf", id: "about", route: "about", label: "Acerca de", icon: Info });

  return entries;
}

export function routeMeta(route: AtlasRouteId): { title: string; breadcrumb: string[] } {
  switch (route) {
    case "home":
      return { title: "Inicio de la cuenta", breadcrumb: ["Atlas", "Inicio"] };
    case "conn":
      return { title: "Conexiones", breadcrumb: ["Atlas", "Atlas VPN", "Conexiones"] };
    case "poslite":
      return { title: "Poslite", breadcrumb: ["Atlas", "Atlas VPN", "Poslite"] };
    case "cf":
      return { title: "Cloudflare", breadcrumb: ["Atlas", "Atlas VPN", "Cloudflare"] };
    case "rancher-stores":
      return { title: "Gestión de Tiendas", breadcrumb: ["Atlas", "Atlas Rancher", "Tiendas"] };
    case "rancher-clusters":
      return { title: "Equipos", breadcrumb: ["Atlas", "Atlas Rancher", "Equipos"] };
    case "rancher-pods":
      return { title: "Contenedores", breadcrumb: ["Atlas", "Atlas Rancher", "Contenedores"] };
    case "users":
      return { title: "Usuarios", breadcrumb: ["Atlas", "Administración", "Usuarios"] };
    case "roles":
      return { title: "Roles y permisos", breadcrumb: ["Atlas", "Administración", "Roles"] };
    case "about":
      return { title: "Acerca de", breadcrumb: ["Atlas", "Acerca de"] };
    default:
      return { title: "Atlas", breadcrumb: ["Atlas"] };
  }
}

export function flattenNavRoutes(entries: AtlasNavEntry[]): AtlasNavLeaf[] {
  const out: AtlasNavLeaf[] = [];
  for (const e of entries) {
    if (e.kind === "leaf") out.push(e);
    else out.push(...e.children);
  }
  return out;
}
