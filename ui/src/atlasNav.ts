import type { LucideIcon } from "lucide-react";
import {
  Box,
  Cloud,
  Clock,
  Globe,
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
  PERM_STORES_APPROVE,
  PERM_STORES_READ,
  PERM_STORES_WRITE,
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
  | "rancher-store-requests"
  | "rancher-clusters"
  | "rancher-pods"
  | "users"
  | "roles"
  | "about";

/** Rutas del módulo Atlas VPN (sync CF, túneles, DNS). */
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
  /** Si está definida, el encabezado del grupo navega a esta ruta. */
  route?: AtlasRouteId;
  children: AtlasNavEntry[];
};

export type AtlasNavEntry = AtlasNavLeaf | AtlasNavGroup;

/** Menú lateral: plataforma Atlas → productos → páginas. Ampliar `children` al añadir módulos. */
export function buildAtlasNav(user: AuthUser): AtlasNavEntry[] {
  const canCf = hasPermission(user, PERM_CF_READ);
  const canStoresRead = hasPermission(user, PERM_STORES_READ);
  const canStoresRequests = hasAnyPermission(user, PERM_STORES_WRITE, PERM_STORES_APPROVE);
  const vpnChildren: AtlasNavLeaf[] = [
    { kind: "leaf", id: "vpn-conn", route: "conn", label: "Conexiones", icon: Wifi },
    { kind: "leaf", id: "vpn-dns", route: "poslite", label: "DNS", icon: Globe },
    ...(canCf
      ? ([
          { kind: "leaf", id: "vpn-cf", route: "cf", label: "Cloudflare", icon: Cloud, adminOnly: true },
        ] satisfies AtlasNavLeaf[])
      : []),
  ];

  const rancherChildren: AtlasNavEntry[] = [];

  if (canStoresRead) {
    const tiendasChildren: AtlasNavLeaf[] = canStoresRequests
      ? [
          {
            kind: "leaf",
            id: "rancher-store-requests",
            route: "rancher-store-requests",
            label: "Solicitudes",
            icon: Clock,
          },
        ]
      : [];

    rancherChildren.push({
      kind: "group",
      id: "rancher-tiendas",
      label: "Tiendas",
      icon: Store,
      route: "rancher-stores",
      defaultOpen: false,
      children: tiendasChildren,
    });
  }

  rancherChildren.push(
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
    }
  );

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
      children: rancherChildren,
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
      return { title: "DNS", breadcrumb: ["Atlas", "Atlas VPN", "DNS"] };
    case "cf":
      return { title: "Cloudflare", breadcrumb: ["Atlas", "Atlas VPN", "Cloudflare"] };
    case "rancher-stores":
      return { title: "Gestión de Tiendas", breadcrumb: ["Atlas", "Atlas Rancher", "Tiendas"] };
    case "rancher-store-requests":
      return {
        title: "Solicitudes de cambio",
        breadcrumb: ["Atlas", "Atlas Rancher", "Tiendas", "Solicitudes"],
      };
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
    else out.push(...flattenNavRoutes(e.children));
  }
  return out;
}

export function isNavLeafActive(leaf: AtlasNavLeaf, route: AtlasRouteId): boolean {
  if (leaf.comingSoon) return false;
  return leaf.route === route;
}

export function isNavGroupActive(group: AtlasNavGroup, route: AtlasRouteId): boolean {
  if (group.route === route) return true;
  return group.children.some((c) => isNavEntryActive(c, route));
}

export function isNavEntryActive(entry: AtlasNavEntry, route: AtlasRouteId): boolean {
  if (entry.kind === "leaf") return isNavLeafActive(entry, route);
  return isNavGroupActive(entry, route);
}
