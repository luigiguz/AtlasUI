import type { AtlasRouteId } from "./atlasNav";

export type NotificationSeverity = "critical" | "warning" | "info" | "success";

export type NotificationItem = {
  id: string;
  source: "live" | "event";
  severity: NotificationSeverity;
  title: string;
  body: string;
  route: AtlasRouteId | string;
  createdAt: string;
  read: boolean;
  dismissible: boolean;
  kind?: string;
  payload?: Record<string, unknown>;
};

export type NotificationsResponse = {
  ok: boolean;
  unreadCount: number;
  items: NotificationItem[];
};
