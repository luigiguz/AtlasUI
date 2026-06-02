import type { AtlasRouteId, AtlasNavEntry } from "./atlasNav";
import type { StoreChangeRequestEntryType } from "./storeTypes";

export type StoreRequestsPanelTab = "queue" | "history";

export type StoreRequestsOpenDetail = {
  tab?: StoreRequestsPanelTab;
  requestId?: number;
  entryType?: StoreChangeRequestEntryType;
};

export const STORE_REQUESTS_ROUTE = "rancher-store-requests" satisfies AtlasRouteId;

export const STORE_REQUESTS_OPEN_EVENT = "atlas:open-store-requests";

/** Enfoca la vista de solicitudes (pestaña / detalle) tras navegar a la ruta. */
export function focusStoreRequestsView(detail?: StoreRequestsOpenDetail): void {
  window.dispatchEvent(new CustomEvent(STORE_REQUESTS_OPEN_EVENT, { detail: detail ?? {} }));
}

export function isStoreRequestsNotification(item: { route: string; id: string; kind?: string; source?: string }): boolean {
  if (item.route === STORE_REQUESTS_ROUTE || item.route === "rancher-stores") {
    if (item.id === "live:stores-pending-approval" || item.id === "live:stores-my-pending") return true;
    if (item.kind?.startsWith("store_change_")) return true;
    return item.source === "event";
  }
  return false;
}

export function storeRequestsTabFromNotification(item: { id: string }): StoreRequestsPanelTab {
  if (item.id === "live:stores-pending-approval" || item.id === "live:stores-my-pending") {
    return "queue";
  }
  return "history";
}

export function requestIdFromNotification(item: { payload?: { requestId?: unknown } }): number | undefined {
  const raw = item.payload?.requestId;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return undefined;
}

export function filterNavEntries(entries: AtlasNavEntry[], q: string): AtlasNavEntry[] {
  const query = q.trim().toLowerCase();
  if (!query) return entries;
  const out: AtlasNavEntry[] = [];
  for (const e of entries) {
    if (e.kind === "leaf") {
      if (e.label.toLowerCase().includes(query) || e.id.toLowerCase().includes(query)) out.push(e);
      continue;
    }
    const kids = filterNavEntries(e.children, query);
    if (kids.length > 0 || e.label.toLowerCase().includes(query)) {
      out.push({ ...e, children: kids.length > 0 ? kids : e.children });
    }
  }
  return out;
}
