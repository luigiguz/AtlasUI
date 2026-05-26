import type { AtlasRouteId } from "./atlasNav";

export const TIENDA_SELECTED_KEY = "atlas-containers-tienda-id";
const TIENDA_RECENT_KEY = "atlas-containers-tiendas-recientes";
const TIENDA_RECENT_MAX = 6;

function readRecentTiendaIds(): string[] {
  try {
    const raw = localStorage.getItem(TIENDA_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Persiste la tienda elegida para la vista Contenedores (selector + recientes). */
export function rememberTiendaForContainers(id: string): void {
  try {
    const prev = readRecentTiendaIds().filter((x) => x !== id);
    localStorage.setItem(TIENDA_SELECTED_KEY, id);
    localStorage.setItem(
      TIENDA_RECENT_KEY,
      JSON.stringify([id, ...prev].slice(0, TIENDA_RECENT_MAX))
    );
  } catch {
    /* ignore */
  }
}

export function openContainersForTienda(
  clusterId: string,
  onNavigate: (route: AtlasRouteId) => void
): void {
  rememberTiendaForContainers(clusterId);
  onNavigate("rancher-pods");
}
