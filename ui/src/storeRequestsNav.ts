import type { NotificationItem } from "./notificationTypes";

export type StoreRequestsPanelTab = "queue" | "history";

export type StoreRequestsOpenDetail = {
  tab?: StoreRequestsPanelTab;
  requestId?: number;
};

export const STORE_REQUESTS_OPEN_EVENT = "atlas:open-store-requests";

/** Abre el modal de solicitudes en Gestión de Tiendas (desde notificaciones u otras vistas). */
export function openStoreRequestsModal(detail?: StoreRequestsOpenDetail): void {
  window.dispatchEvent(new CustomEvent(STORE_REQUESTS_OPEN_EVENT, { detail: detail ?? {} }));
}

export function isStoreRequestsNotification(item: NotificationItem): boolean {
  if (item.route !== "rancher-stores") return false;
  if (item.id === "live:stores-pending-approval" || item.id === "live:stores-my-pending") return true;
  if (item.kind?.startsWith("store_change_")) return true;
  return item.source === "event";
}

export function storeRequestsTabFromNotification(item: NotificationItem): StoreRequestsPanelTab {
  if (item.id === "live:stores-pending-approval" || item.id === "live:stores-my-pending") {
    return "queue";
  }
  return "history";
}

export function requestIdFromNotification(item: NotificationItem): number | undefined {
  const raw = item.payload?.requestId;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  return undefined;
}
