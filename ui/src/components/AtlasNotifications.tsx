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
import { createPortal } from "react-dom";

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

function severityAccent(severity: NotificationSeverity): string {
  if (severity === "critical") return "border-l-red-400 bg-red-500/[0.07]";
  if (severity === "warning") return "border-l-amber-400 bg-amber-500/[0.07]";
  if (severity === "success") return "border-l-emerald-400 bg-emerald-500/[0.07]";
  return "border-l-sky-400 bg-sky-500/[0.05]";
}

function severityIconBg(severity: NotificationSeverity): string {
  if (severity === "critical") return "bg-red-500/15 ring-red-500/25";
  if (severity === "warning") return "bg-amber-500/15 ring-amber-500/25";
  if (severity === "success") return "bg-emerald-500/15 ring-emerald-500/25";
  return "bg-sky-500/10 ring-sky-500/20";
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
  const [panelStyle, setPanelStyle] = useState<{ top: number; right: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updatePanelPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPanelStyle({
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, []);

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
    updatePanelPosition();
    void load();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onResize = () => updatePanelPosition();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, load, updatePanelPosition]);

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

  const dismiss = async (id: string) => {
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

  const panel =
    open && panelStyle ? (
      <motion.div
        ref={panelRef}
        initial={{ opacity: 0, y: -6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ duration: 0.15 }}
        style={{ top: panelStyle.top, right: panelStyle.right }}
        className="fixed z-[200] w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-white/10 bg-[#161a21] text-zinc-100 shadow-2xl shadow-black/50"
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <p className="text-sm font-semibold text-zinc-50">Notificaciones</p>
          <div className="flex items-center gap-2">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" aria-hidden /> : null}
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
              >
                Marcar todo leído
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-400">Sin notificaciones</p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-stretch border-l-[3px] ${severityAccent(item.severity)} ${
                    item.read ? "opacity-70" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className="flex min-w-0 flex-1 gap-3 px-3 py-3 text-left text-zinc-100 transition hover:bg-white/[0.04]"
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${severityIconBg(item.severity)}`}
                    >
                      {severityIcon(item.severity)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold leading-snug text-zinc-50">{item.title}</span>
                        <span className="shrink-0 pt-0.5 text-[10px] text-zinc-400">{formatWhen(item.createdAt)}</span>
                      </span>
                      {item.body ? (
                        <span className="mt-1 block text-xs leading-relaxed text-zinc-300">{item.body}</span>
                      ) : null}
                      {item.source === "live" ? (
                        <span className="mt-1.5 inline-block rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                          Alerta activa
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {item.dismissible ? (
                    <button
                      type="button"
                      onClick={() => void dismiss(item.id)}
                      className="shrink-0 self-start px-2 py-3 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      title="Descartar alerta"
                      aria-label="Descartar alerta"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) requestAnimationFrame(updatePanelPosition);
            return next;
          });
        }}
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-lg ring-1 transition ${
          open
            ? "bg-white/10 text-zinc-100 ring-white/20"
            : "text-zinc-300 ring-white/10 hover:bg-white/5 hover:text-zinc-100"
        }`}
        title="Notificaciones"
        aria-label={unreadCount > 0 ? `Notificaciones (${unreadCount} sin leer)` : "Notificaciones"}
        aria-expanded={open}
      >
        <Bell className="h-[1.125rem] w-[1.125rem]" strokeWidth={2} aria-hidden />
        {unreadCount > 0 ? (
          <span className="pointer-events-none absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-cf-orange px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[#0d0f12]">
            {badge}
          </span>
        ) : null}
      </button>

      {typeof document !== "undefined"
        ? createPortal(<AnimatePresence>{panel}</AnimatePresence>, document.body)
        : null}
    </>
  );
}
