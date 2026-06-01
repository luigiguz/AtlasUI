import { motion } from "framer-motion";
import {
  CheckCircle2,
  Pencil,
  PlusCircle,
  Terminal,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE, api, apiUrl, bearerHeaders, clearAuthTokens } from "./apiClient";
import { clearSessionActivity, touchSessionActivity, useIdleLogout } from "./useIdleLogout";
import {
  hasAnyPermission,
  hasPermission,
  parseAuthUser,
  PERM_CF_READ,
  PERM_CF_SYNC,
  PERM_RANCHER_CONFIGURE,
  PERM_RANCHER_WRITE,
  PERM_ROLES_LIST,
  PERM_ROLES_MANAGE,
  PERM_STORES_READ,
  PERM_STORES_WRITE,
  PERM_STORES_APPROVE,
  PERM_STORES_CONFIGURE,
  PERM_USERS_LIST,
  PERM_VPN_OPERATE,
  type AuthUser,
} from "./atlasAuth";
import type { AtlasRouteId } from "./atlasNav";
import { AtlasConfirmDialog } from "./components/AtlasConfirmDialog";
import { AuthLoginPanel } from "./components/AuthLoginPanel";
import { AtlasLoadingSplash } from "./components/AtlasLoadingSplash";
import { AtlasShell } from "./components/AtlasShell";
import {
  filterSitesByNameQuery,
  siteDisplayName,
  SITES_PAGE_SIZE,
  SitePaginationBar,
  SiteSearchInput,
  siteListVariants,
  siteRowVariants,
  type SiteRow,
} from "./components/AtlasSiteListUi";
import { PoweredByVerkkutech } from "./components/PoweredByVerkkutech";
import {
  parseSshWebPopoutParams,
  SshWebPopoutApp,
  SSH_WEB_REATTACH_MESSAGE_TYPE,
  WebSshSessionsDock,
  type SshWebSession,
} from "./WebSshSessionsDock";
import { rememberTiendaForContainers } from "./rancherContainersNav";
import { focusStoreRequestsView } from "./storeRequestsNav";
import { AtlasDnsView } from "./views/AtlasDnsView";
import { AtlasHomeView } from "./views/AtlasHomeView";
import { AtlasRancherClustersView } from "./views/AtlasRancherClustersView";
import { AtlasRancherPodsView } from "./views/AtlasRancherPodsView";
import { AtlasStoreRequestsView } from "./views/AtlasStoreRequestsView";
import { AtlasStoresView } from "./views/AtlasStoresView";
import { AtlasRolesView } from "./views/AtlasRolesView";
import { AtlasUsersView } from "./views/AtlasUsersView";

type SitesResponse = { configPath: string; domainSuffix?: string; sites: SiteRow[] };

type AuthStatusResponse = {
  authenticated: boolean;
  user?: {
    username: string;
    role: string;
    roles?: { id: number; slug: string; name: string }[];
    permissions?: string[];
  };
};

/** Resumen por sitio para Conexiones (túnel SSH / terminal web). */
function siteTunnelSummary(s: SiteRow): {
  tone: "up" | "down" | "idle";
  label: string;
  hint: string;
} {
  if (!s.ssh) {
    return { tone: "idle", label: "—", hint: "Sitio sin SSH configurado" };
  }
  if (s.sshStatus === "active") {
    return { tone: "up", label: "UP", hint: "Túnel SSH activo — Terminal web disponible" };
  }
  if (s.sshStatus === "dead") {
    return { tone: "down", label: "DOWN", hint: "Túnel SSH caído — se recuperará automáticamente" };
  }
  return { tone: "idle", label: "…", hint: "Túnel SSH arrancando" };
}

function siteTunnelRailClass(tone: "up" | "down" | "idle"): string {
  if (tone === "up") {
    return "bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[inset_-1px_0_0_rgba(0,0,0,0.2)]";
  }
  if (tone === "down") {
    return "bg-gradient-to-b from-rose-400 to-rose-700 shadow-[inset_-1px_0_0_rgba(0,0,0,0.25)]";
  }
  return "bg-zinc-600/90";
}

function siteTunnelDotClass(tone: "up" | "down" | "idle"): string {
  if (tone === "up") {
    return "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)] animate-pulse";
  }
  if (tone === "down") {
    return "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.55)]";
  }
  return "bg-zinc-500";
}

function StatusPill({ kind }: { kind: string }) {
  const active = kind === "active";
  return (
    <span
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 bg-emerald-500/15 text-emerald-300 ring-emerald-500/40 animate-pulse-ring"
          : kind === "dead"
            ? "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 bg-rose-500/15 text-rose-300 ring-rose-500/35"
            : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 bg-zinc-500/15 text-zinc-400 ring-zinc-600/50"
      }
    >
      {active ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
      ) : null}
      {active ? "Activo" : kind === "dead" ? "Muerto" : "—"}
    </span>
  );
}

/** Sincronización automática Cloudflare → tunnels.json (mismo criterio que Rancher). */
const CF_SYNC_INTERVAL_MS = 15_000;

export default function App() {
  const [authPhase, setAuthPhase] = useState<"loading" | "login" | "app">("loading");
  const [me, setMe] = useState<AuthUser | null>(null);

  const [tab, setTab] = useState<AtlasRouteId>("home");
  /** Tienda a preseleccionar al abrir Contenedores desde Equipos. */
  const [containersFocusId, setContainersFocusId] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [sitesDomainSuffix, setSitesDomainSuffix] = useState<string | undefined>();
  const [connSiteQuery, setConnSiteQuery] = useState("");
  const [connListPage, setConnListPage] = useState(0);
  const [logOpen, setLogOpen] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: "danger" | "default";
    onConfirm: () => void;
  } | null>(null);
  const [sshWebSessions, setSshWebSessions] = useState<SshWebSession[]>([]);
  const [activeSshWebId, setActiveSshWebId] = useState<string | null>(null);
  const [sshPopoutParams] = useState(() =>
    typeof window !== "undefined" ? parseSshWebPopoutParams(window.location.search) : null,
  );
  const sshPopoutSite = sshPopoutParams?.site ?? null;
  const sshPopoutDockSessionId = sshPopoutParams?.dockSessionId ?? null;

  const openSshWebSession = useCallback((site: string) => {
    const id = crypto.randomUUID();
    setSshWebSessions((prev) => [...prev, { id, site, minimized: false }]);
    setActiveSshWebId(id);
  }, []);

  useEffect(() => {
    if (sshPopoutSite) return;
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as { type?: string; site?: string; dockSessionId?: string } | null;
      if (!d || d.type !== SSH_WEB_REATTACH_MESSAGE_TYPE) return;
      const site = typeof d.site === "string" ? d.site.trim() : "";
      const dockSessionId = typeof d.dockSessionId === "string" ? d.dockSessionId.trim() : "";
      if (dockSessionId) {
        setSshWebSessions((prev) =>
          prev.map((s) => (s.id === dockSessionId ? { ...s, poppedOut: false } : s)),
        );
        setActiveSshWebId(dockSessionId);
        return;
      }
      if (!site) return;
      openSshWebSession(site);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sshPopoutSite, openSshWebSession]);

  const logRef = useRef<HTMLPreElement>(null);

  const [acc, setAcc] = useState("");
  const [tok, setTok] = useState("");
  const [suf, setSuf] = useState("asptienda.com");
  const [zone, setZone] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncOk, setSyncOk] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  /** Cloudflare: tras guardar, vista resumida para no editar Account ID por accidente. */
  const [cfCredentialsLocked, setCfCredentialsLocked] = useState(false);

  const appendLog = useCallback((lines: string[]) => {
    setLogs((prev) => [...prev, ...lines].slice(-200));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(apiUrl("/api/auth/status"), {
          credentials: API_BASE ? "omit" : "include",
          headers: { ...bearerHeaders() },
        });
        const s = (await r.json()) as AuthStatusResponse;
        if (s.authenticated && s.user) {
          setMe(parseAuthUser(s.user));
          setAuthPhase("app");
          return;
        }
        setAuthPhase("login");
      } catch {
        setAuthPhase("login");
      }
    })();
  }, []);

  const endSession = useCallback(() => {
    clearSessionActivity();
    clearAuthTokens();
    setMe(null);
    setAuthPhase("login");
    setTab("conn");
    setSshWebSessions([]);
    setActiveSshWebId(null);
  }, []);

  const doLogout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    endSession();
  }, [endSession]);

  useIdleLogout(authPhase === "app" && me !== null, () => {
    void (async () => {
      try {
        await api("/api/auth/logout", { method: "POST", body: "{}" });
      } catch {
        /* ignore */
      }
      endSession();
    })();
  });

  useEffect(() => {
    const h = () => endSession();
    window.addEventListener("atlas-unauthorized", h);
    return () => window.removeEventListener("atlas-unauthorized", h);
  }, [endSession]);

  const loadSites = useCallback(async () => {
    try {
      const d = await api<SitesResponse>("/api/sites");
      setSites(d.sites);
      setSitesDomainSuffix(d.domainSuffix);
    } catch {
      setSites([]);
    }
  }, []);

  useEffect(() => {
    if (authPhase !== "app") return;
    void loadSites();
    const t = window.setInterval(() => void loadSites(), 3000);
    return () => window.clearInterval(t);
  }, [authPhase, loadSites]);

  useEffect(() => {
    if (authPhase !== "app" || !me) return;
    const params = new URLSearchParams(window.location.search);
    const routeParam = params.get("route");
    if (!routeParam) return;
    setTab(routeParam as AtlasRouteId);
    const requestIdRaw = params.get("requestId");
    if (routeParam === "rancher-store-requests" && requestIdRaw) {
      const requestId = Number(requestIdRaw);
      if (Number.isFinite(requestId)) {
        window.setTimeout(
          () => focusStoreRequestsView({ tab: "queue", requestId }),
          350
        );
      }
    }
    params.delete("route");
    params.delete("requestId");
    const rest = params.toString();
    const nextUrl = `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [authPhase, me]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (authPhase !== "app" || !me) return;
    void (async () => {
      try {
        const s = await api<{
          account_id: string;
          api_token: string;
          domain_suffix: string;
          zone_id: string;
        }>("/api/settings");
        setAcc(s.account_id);
        setTok(s.api_token);
        setSuf(s.domain_suffix || "asptienda.com");
        setZone(s.zone_id || "");
        setCfCredentialsLocked(
          Boolean((s.account_id || "").trim() && (s.api_token || "").trim())
        );
      } catch {
        /* ignore */
      }
    })();
  }, [authPhase, me]);

  const runCfSync = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!acc.trim() || !tok.trim()) return;
      const silent = opts?.silent ?? false;
      if (!silent) {
        setSyncing(true);
        setSyncOk(false);
        setSyncMsg("");
      }
      try {
        const r = await api<{ ok: boolean; sitesCount: number; message: string }>("/api/sync", {
          method: "POST",
          body: JSON.stringify({
            account_id: acc,
            api_token: tok,
            domain_suffix: suf,
            zone_id: zone,
          }),
        });
        setSyncOk(true);
        setSyncMsg(`${r.sitesCount} sitios`);
        setLastSyncAt(
          new Date().toLocaleString("es", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        );
        await loadSites();
        if (!silent) appendLog([r.message]);
      } catch (e) {
        if (!silent) {
          appendLog([`ERROR sync: ${String(e)}`]);
          setSyncOk(false);
          setSyncMsg("");
        }
      } finally {
        if (!silent) setSyncing(false);
      }
    },
    [acc, tok, suf, zone, appendLog, loadSites]
  );

  useEffect(() => {
    if (authPhase !== "app" || !me || !hasPermission(me, PERM_CF_SYNC)) return;
    if (!acc.trim() || !tok.trim()) return;

    void runCfSync({ silent: true });

    const id = window.setInterval(() => {
      if (document.hidden) return;
      void runCfSync({ silent: true });
    }, CF_SYNC_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [authPhase, me?.role, acc, tok, suf, zone, runCfSync]);

  useEffect(() => {
    if (me && me.role !== "admin" && (tab === "cf" || tab === "users")) setTab("home");
  }, [me, tab]);

  const doSaveSettings = async () => {
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          account_id: acc,
          api_token: tok,
          domain_suffix: suf,
          zone_id: zone,
        }),
      });
      appendLog(["Ajustes guardados en .atlas/settings.json"]);
      setCfCredentialsLocked(true);
      await runCfSync({ silent: false });
    } catch (e) {
      appendLog([String(e)]);
    }
  };

  const maskAccountId = (id: string) => {
    const t = id.trim();
    if (!t) return "—";
    if (t.length <= 10) return "••••••••";
    return `${t.slice(0, 6)}…${t.slice(-4)}`;
  };

  const maskZoneId = (z: string) => {
    const t = z.trim();
    if (!t) return "—";
    if (t.length <= 10) return "••••••••";
    return `${t.slice(0, 4)}…${t.slice(-4)}`;
  };

  const deleteCfCredentials = async () => {
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          account_id: "",
          api_token: "",
          domain_suffix: "asptienda.com",
          zone_id: "",
        }),
      });
      setAcc("");
      setTok("");
      setSuf("asptienda.com");
      setZone("");
      setCfCredentialsLocked(false);
      setSyncOk(false);
      setSyncMsg("");
      appendLog(["Credenciales Cloudflare eliminadas del archivo local."]);
    } catch (e) {
      appendLog([String(e)]);
    }
  };

  const newCfConfigurationForm = () => {
    setAcc("");
    setTok("");
    setZone("");
    setSuf("asptienda.com");
    setCfCredentialsLocked(false);
  };

  const connFiltered = useMemo(() => filterSitesByNameQuery(sites, connSiteQuery), [sites, connSiteQuery]);
  const connTotalPages = Math.max(1, Math.ceil(connFiltered.length / SITES_PAGE_SIZE));
  const connPageSafe = Math.min(connListPage, connTotalPages - 1);
  const connPageSlice = useMemo(
    () => connFiltered.slice(connPageSafe * SITES_PAGE_SIZE, (connPageSafe + 1) * SITES_PAGE_SIZE),
    [connFiltered, connPageSafe],
  );

  useEffect(() => {
    setConnListPage((p) => Math.min(p, connTotalPages - 1));
  }, [connTotalPages]);

  useEffect(() => {
    setConnListPage(0);
  }, [connSiteQuery]);

  if (sshPopoutSite) {
    if (authPhase === "loading") {
      return <AtlasLoadingSplash fullscreen message="Iniciando Atlas…" />;
    }
    if (authPhase === "login") {
      return (
        <AuthLoginPanel
          onDone={(u) => {
            touchSessionActivity();
            setMe(u);
            setAuthPhase("app");
          }}
        />
      );
    }
    if (!me) {
      return <AtlasLoadingSplash fullscreen message="Iniciando Atlas…" />;
    }
    return <SshWebPopoutApp site={sshPopoutSite} dockSessionId={sshPopoutDockSessionId} />;
  }

  if (authPhase === "loading") {
    return <AtlasLoadingSplash fullscreen message="Iniciando Atlas…" />;
  }
  if (authPhase === "login") {
    return (
      <AuthLoginPanel
        onDone={(u) => {
          touchSessionActivity();
          setMe(u);
          setAuthPhase("app");
        }}
      />
    );
  }
  if (!me) {
    return <AtlasLoadingSplash fullscreen message="Iniciando Atlas…" />;
  }

  const canOperate = hasPermission(me, PERM_VPN_OPERATE);
  const canCfRead = hasPermission(me, PERM_CF_READ);
  const canRancherConfigure = hasPermission(me, PERM_RANCHER_CONFIGURE);
  const canRancherWrite = hasPermission(me, PERM_RANCHER_WRITE);
  const canStoresRead = hasPermission(me, PERM_STORES_READ);
  const canStoresWrite = hasPermission(me, PERM_STORES_WRITE);
  const canStoresApprove = hasPermission(me, PERM_STORES_APPROVE);
  const canStoresConfigure = hasPermission(me, PERM_STORES_CONFIGURE);
  const canUsers = hasPermission(me, PERM_USERS_LIST);
  const canRoles = hasAnyPermission(me, PERM_ROLES_LIST, PERM_ROLES_MANAGE);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0b0d10] text-zinc-100">
      {sshWebSessions.length > 0 ? (
        <WebSshSessionsDock
          sessions={sshWebSessions}
          activeId={activeSshWebId}
          setSessions={setSshWebSessions}
          setActiveId={setActiveSshWebId}
        />
      ) : null}

      <AtlasShell
        route={tab}
        onNavigate={setTab}
        user={me}
        onLogout={() => void doLogout()}
      >
        {tab === "home" && (
          <AtlasHomeView
            sites={sites}
            canAdmin={canCfRead}
            syncMsg={syncMsg}
            syncOk={syncOk}
            lastSyncAt={lastSyncAt}
            onNavigate={setTab}
          />
        )}

        {tab === "rancher-stores" && canStoresRead && (
          <AtlasStoresView
            canAdmin={canStoresConfigure}
            canEdit={canStoresWrite}
            canApprove={canStoresApprove}
          />
        )}
        {tab === "rancher-stores" && !canStoresRead && (
          <div className="mx-auto max-w-lg rounded-xl border border-cf-line/80 bg-cf-panel/80 p-6 text-center text-sm text-zinc-400">
            No tienes permiso para ver Gestión de Tiendas.
          </div>
        )}

        {tab === "rancher-store-requests" && (canStoresWrite || canStoresApprove) && (
          <AtlasStoreRequestsView canEdit={canStoresWrite} canApprove={canStoresApprove} />
        )}
        {tab === "rancher-store-requests" && !canStoresWrite && !canStoresApprove && (
          <div className="mx-auto max-w-lg rounded-xl border border-cf-line/80 bg-cf-panel/80 p-6 text-center text-sm text-zinc-400">
            No tienes permiso para ver solicitudes de tiendas.
          </div>
        )}

        {tab === "rancher-clusters" && (
          <AtlasRancherClustersView
            canAdmin={canRancherConfigure}
            canEditLabels={canRancherWrite}
            onOpenContainers={(clusterId) => {
              rememberTiendaForContainers(clusterId);
              setContainersFocusId(clusterId);
              setTab("rancher-pods");
            }}
          />
        )}

        {tab === "rancher-pods" && (
          <AtlasRancherPodsView
            canAdmin={canRancherConfigure}
            canEdit={canRancherWrite}
            focusTiendaId={containersFocusId}
            onFocusTiendaConsumed={() => setContainersFocusId(null)}
          />
        )}

        {tab === "conn" && (
          <motion.div
            key="conn"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="flex min-h-[calc(100dvh-9rem)] flex-col gap-3"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <SiteSearchInput
                  id="conn-site-search"
                  value={connSiteQuery}
                  onChange={setConnSiteQuery}
                  placeholder="Buscar por nombre de sitio…"
                />
                <p className="shrink-0 text-xs tabular-nums text-zinc-500">
                  {connFiltered.length} de {sites.length} sitio{sites.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cf-line/60 bg-black/[0.12]">
              <motion.div
                variants={siteListVariants}
                initial="hidden"
                animate="show"
                className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto p-2 pb-1 sm:grid-cols-2 sm:p-3 lg:grid-cols-3 [scrollbar-gutter:stable]"
              >
                {sites.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-dashed border-cf-line bg-cf-panel/50 p-10 text-center text-zinc-500">
                    No hay sitios en tunnels.json. Sincroniza desde Cloudflare o crea plantilla.
                  </div>
                )}
                {sites.length > 0 && connFiltered.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-dashed border-cf-line bg-cf-panel/50 p-10 text-center text-zinc-500">
                    Ningún sitio coincide con «{connSiteQuery.trim()}». Prueba otro texto o borra el filtro.
                  </div>
                )}
                {connPageSlice.map((s) => {
                  const tun = siteTunnelSummary(s);
                  const sshReady = Boolean(s.ssh && s.sshStatus === "active");
                  return (
                    <motion.div
                      key={s.id}
                      variants={siteRowVariants}
                      layout
                      className="group flex flex-row overflow-hidden rounded-2xl border border-cf-line bg-cf-card/90 ring-1 ring-transparent hover:border-zinc-600 hover:bg-cf-card"
                      aria-label={`${siteDisplayName(s)}: ${tun.hint}`}
                    >
                      <div
                        className={`w-2 shrink-0 self-stretch ${siteTunnelRailClass(tun.tone)}`}
                        title={tun.hint}
                        aria-hidden
                      />
                      <div className="flex min-w-0 flex-1 flex-col p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="flex shrink-0 flex-col items-center gap-1 border-r border-white/10 pr-3 pt-0.5"
                            title={tun.hint}
                          >
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${siteTunnelDotClass(tun.tone)}`}
                              aria-hidden
                            />
                            <span
                              className={`text-[9px] font-bold uppercase leading-none tracking-tight ${
                                tun.tone === "up"
                                  ? "text-emerald-400"
                                  : tun.tone === "down"
                                    ? "text-rose-300"
                                    : "text-zinc-500"
                              }`}
                            >
                              {tun.label}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold tracking-tight">{siteDisplayName(s)}</span>
                            {s.tunnelName && s.tunnelName !== s.name ? (
                              <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
                                {s.name}
                              </span>
                            ) : null}
                            <p className="mt-1 text-[11px] text-zinc-500">{tun.hint}</p>
                            {s.ssh ? (
                              <div className="mt-2">
                                <StatusPill kind={s.sshStatus} />
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {s.ssh && canOperate ? (
                            <motion.button
                              type="button"
                              whileHover={sshReady ? { scale: 1.02 } : undefined}
                              whileTap={sshReady ? { scale: 0.98 } : undefined}
                              disabled={!sshReady}
                              title={
                                sshReady
                                  ? "Abrir terminal web SSH"
                                  : "Espera a que el túnel SSH esté activo"
                              }
                              onClick={() => sshReady && openSshWebSession(s.id)}
                              className={
                                sshReady
                                  ? "flex items-center gap-2 rounded-lg bg-cf-orange px-3 py-2 text-xs font-semibold text-black shadow-md sm:text-sm"
                                  : "flex cursor-not-allowed items-center gap-2 rounded-lg bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-500 ring-1 ring-zinc-700 sm:text-sm"
                              }
                            >
                              <Terminal className="h-4 w-4" />
                              Terminal web
                            </motion.button>
                          ) : s.ssh ? (
                            <p className="text-xs text-zinc-500">
                              Tu rol no permite abrir la terminal web.
                            </p>
                          ) : (
                            <p className="text-xs text-zinc-500">Sin SSH en este sitio.</p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
              {sites.length > 0 ? (
                <SitePaginationBar
                  page={connListPage}
                  setPage={setConnListPage}
                  totalItems={connFiltered.length}
                  pageSize={SITES_PAGE_SIZE}
                />
              ) : null}
              </div>

              <div className="shrink-0 rounded-xl border border-cf-line bg-cf-panel/95 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cf-line/60 px-3 py-2">
                  <span className="text-xs font-medium text-zinc-400">
                    Túneles gestionados automáticamente por atlas-tunnels
                  </span>
                  <button
                    type="button"
                    onClick={() => setLogOpen((v) => !v)}
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-zinc-600 hover:bg-zinc-700"
                  >
                    {logOpen ? "Ocultar registro" : "Mostrar registro"}
                  </button>
                </div>
                {logOpen ? (
                  <div
                    className="overflow-hidden rounded-b-xl border-t border-transparent"
                    style={{ maxHeight: "min(28vh, 220px)" }}
                  >
                    <pre
                      ref={logRef}
                      className="max-h-[28vh] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-emerald-100/90 sm:max-h-[220px]"
                    >
                      {logs.join("\n")}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        )}

        {canCfRead && tab === "cf" && (
          <motion.div
            key="cf"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto w-full max-w-xl space-y-4"
          >
            <p className="text-sm text-zinc-400">Cuenta y dominio Cloudflare.</p>

            {cfCredentialsLocked ? (
              <div className="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 ring-1 ring-emerald-500/20">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-zinc-100">Credenciales guardadas</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      Los valores sensibles no se muestran completos para evitar cambios accidentales. Los sitios se
                      sincronizan solos cada 15 s mientras Atlas esté abierto.
                    </p>
                    {syncOk && syncMsg && lastSyncAt ? (
                      <p className="mt-2 text-xs text-emerald-400/90">
                        {syncMsg} · última sync {lastSyncAt}
                      </p>
                    ) : null}
                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-zinc-500">Account ID</dt>
                        <dd className="font-mono text-zinc-200">{maskAccountId(acc)}</dd>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-zinc-500">API Token</dt>
                        <dd className="text-zinc-200">Guardado (oculto)</dd>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-zinc-500">Sufijo dominio</dt>
                        <dd className="font-mono text-zinc-200">{suf || "—"}</dd>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <dt className="text-zinc-500">Zone ID</dt>
                        <dd className="font-mono text-zinc-200">{zone.trim() ? maskZoneId(zone) : "—"}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setCfCredentialsLocked(false)}
                    className="inline-flex items-center gap-2 rounded-xl bg-cf-orange px-4 py-2.5 text-sm font-semibold text-black"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() =>
                      setPendingConfirm({
                        title: "Eliminar credenciales Cloudflare",
                        message:
                          "¿Eliminar las credenciales guardadas en este equipo (.atlas/settings.json)?",
                        confirmLabel: "Eliminar",
                        variant: "danger",
                        onConfirm: () => void deleteCfCredentials(),
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-950/80 px-4 py-2.5 text-sm font-medium text-rose-100 ring-1 ring-rose-500/40"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </motion.button>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() =>
                      setPendingConfirm({
                        title: "Nueva configuración",
                        message:
                          "¿Vaciar el formulario para una configuración nueva? Los datos en disco no cambian hasta que pulses «Guardar».",
                        confirmLabel: "Vaciar formulario",
                        onConfirm: newCfConfigurationForm,
                      })
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 ring-1 ring-zinc-600"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Nueva configuración
                  </motion.button>
                </div>
              </div>
            ) : (
              <>
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Account ID
                </label>
                <input
                  value={acc}
                  onChange={(e) => setAcc(e.target.value)}
                  autoComplete="off"
                  className="w-full rounded-xl border border-cf-line bg-cf-panel px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cf-orange/40"
                />
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  API Token
                </label>
                <input
                  value={tok}
                  onChange={(e) => setTok(e.target.value)}
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-xl border border-cf-line bg-cf-panel px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cf-orange/40"
                />
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Sufijo dominio
                </label>
                <input
                  value={suf}
                  onChange={(e) => setSuf(e.target.value)}
                  className="w-full rounded-xl border border-cf-line bg-cf-panel px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cf-orange/40"
                />
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Zone ID (opcional)
                </label>
                <input
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  className="w-full rounded-xl border border-cf-line bg-cf-panel px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-cf-orange/40"
                />
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <motion.button
                    type="button"
                    disabled={syncing}
                    whileHover={{ scale: syncing ? 1 : 1.02 }}
                    whileTap={{ scale: syncing ? 1 : 0.98 }}
                    onClick={() => void doSaveSettings()}
                    className="rounded-xl bg-zinc-800 px-5 py-3 text-sm font-medium ring-1 ring-zinc-600"
                  >
                    Guardar
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
        )}

        {canUsers && tab === "users" && me && <AtlasUsersView me={me} />}

        {canRoles && tab === "roles" && me && <AtlasRolesView me={me} />}

        {tab === "poslite" && <AtlasDnsView sites={sites} domainSuffix={sitesDomainSuffix} />}

        {tab === "about" && (
          <motion.div
            key="about"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="rounded-2xl border border-cf-line bg-cf-card/80 p-6 ring-1 ring-white/[0.03]"
            >
              <h3 className="font-semibold text-cf-orange">Qué es</h3>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-300">
                <p>
                  <span className="font-medium text-zinc-200">Atlas</span> es la plataforma web; el módulo <span className="font-medium text-zinc-200">Atlas VPN</span> es una aplicación destinada a la
                  administración de accesos remotos hacia los sistemas de sus locales u oficinas. Ofrece un panel único
                  en el navegador desde el que se consulta el estado de cada sitio, se inician o detienen los túneles
                  cifrados cuando procede y se accede, cuando el túnel está activo, a utilidades como la terminal por
                  SSH o la conexión a base de datos, sin que el operador deba editar a mano archivos de configuración
                  en cada sesión de trabajo.
                </p>
                <p>
                  La herramienta se integra con la infraestructura habitual basada en{" "}
                  <span className="text-zinc-200">Cloudflare Access</span> y en el cliente{" "}
                  <span className="text-zinc-200">cloudflared</span>: la función de sincronización obtiene desde la API
                  de Cloudflare la relación de sitios y túneles autorizados y vuelca esa información en la
                  configuración local, de modo que lo definido en la nube y lo mostrado en la aplicación permanezcan
                  alineados.
                </p>
                <p>
                  En conjunto, el objetivo es reducir incidencias por desajustes de configuración, acortar los tiempos
                  de soporte a tienda y dejar constancia clara del estado operativo de cada conexión en un solo lugar.
                </p>
              </div>
              <div className="mt-8 border-t border-cf-line/70 pt-6">
                <PoweredByVerkkutech />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AtlasShell>

      <AtlasConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel}
        variant={pendingConfirm?.variant ?? "default"}
        onConfirm={() => {
          const fn = pendingConfirm?.onConfirm;
          setPendingConfirm(null);
          fn?.();
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
