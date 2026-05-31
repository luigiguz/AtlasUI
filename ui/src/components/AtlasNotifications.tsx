import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../apiClient";
import type { AtlasRouteId } from "../atlasNav";
import type { NotificationItem, NotificationsResponse, NotificationSeverity } from "../notificationTypes";

const POLL_MS = 60_000;

type Props = {
  onNavigate: (route: AtlasRouteId) => void;
};

function severityIcon(severity: NotificationSeverity): ReactNode {
  if (severity === "critical") return <AlertTriangle className="h-4 w-4 text-red-400" aria-hidden />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />;
  if (severity === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />;
  return <Info className="h-4 w-4 text-sky-400" aria-hidden />;
}

function severityRing(severity: NotificationSeverity): string {
  if (severity === "critical") return "ring-red-500/30";
  if (severity === "warning") return "ring-amber-500/30";
  if (severity === "success") return "ring-emerald-500/30";
  return "ring-white/10";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "Ahora";
  if (diff < 3_600_000) return `Hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `Hace ${Math.floor(diff / 3_600_000)} h`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function isAtlasRoute(route: string): route is AtlasRouteId {
  return [
    "home",
    "conn",
    "poslite",
    "cf",
    "rancher-stores",
    "rancher-clusters",
    "rancher-pods",
    "users",
    "roles",
    "about",
  ].includes(route);
}

export function AtlasNotifications({ onNavigate }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api<NotificationsResponse>("/api/notifications");
      setItems(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      /* ignore polling errors */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, load]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await api("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i)));
      setUnreadCount((n) => Math.max(0, n - ids.filter((id) => items.find((i) => i.id === id && !i.read)).length));
    } catch {
      /* ignore */
    }
  };

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  };

  const dismiss = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api("/api/notifications/dismiss", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
      setItems((prev) => prev.filter((i) => i.id !== id));
      setUnreadCount((n) => Math.max(0, n - (items.find((i) => i.id === id && !i.read) ? 1 : 0)));
    } catch {
      /* ignore */
    }
  };

  const onPick = (item: NotificationItem) => {
    if (!item.read) void markRead([item.id]);
    if (isAtlasRoute(item.route)) onNavigate(item.route);
    setOpen(false);
  };

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 ring-1 ring-white/10 hover:bg-white/5 hover:text-zinc-200"
        title="Notificaciones"
        aria-label={unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : "Notificaciones"}
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cf-orange px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/10 bg-[#12151a] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
              <p className="text-sm font-medium text-zinc-100">Notificaciones</p>
              <div className="flex items-center gap-1">
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" aria-hidden /> : null}
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                  >
                    Marcar todo leído
                  </button>
                ) : null}
              </div>
            </div>

            <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-zinc-500">Sin notificaciones</p>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onPick(item)}
                        className={`flex w-full gap-2.5 px-3 py-3 text-left transition hover:bg-white/[0.03] ${
                          item.read ? "opacity-75" : ""
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/30 ring-1 ${severityRing(item.severity)}`}
                        >
                          {severityIcon(item.severity)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-zinc-100">{item.title}</span>
                            <span className="shrink-0 text-[10px] text-zinc-500">{formatWhen(item.createdAt)}</span>
                          </span>
                          {item.body ? (
                            <span className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{item.body}</span>
                          ) : null}
                          {item.source === "live" ? (
                            <span className="mt-1 inline-block rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-400/90">
                              Alerta activa
                            </span>
                          ) : null}
                        </span>
                        {item.dismissible ? (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => void dismiss(item.id, e)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") void dismiss(item.id, e as unknown as React.MouseEvent);
                            }}
                            className="shrink-0 rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                            title="Descartar alerta"
                            aria-label="Descartar alerta"
                          >
                            <X className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
