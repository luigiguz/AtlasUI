import { motion } from "framer-motion";
import { ArrowRight, Box, Cloud, Loader2, Server, Store, Wifi } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../apiClient";
import type { AtlasRouteId } from "../atlasNav";
import { normalizeState } from "../rancherLabels";
import type { ClustersResponse } from "../rancherTypes";
import type { StoresListResponse } from "../storeTypes";

type SiteRow = {
  id: string;
  name: string;
  sshStatus: string;
  dbStatus: string;
};

type Props = {
  sites: SiteRow[];
  canAdmin: boolean;
  syncMsg: string;
  syncOk: boolean;
  lastSyncAt: string | null;
  onNavigate: (route: AtlasRouteId) => void;
};

type VpnStats = {
  siteCount: number;
  tunnelsActive: number;
  incidents: number;
  sitesAllUp: number;
};

function computeVpnStats(sites: SiteRow[]): VpnStats {
  let tunnelsActive = 0;
  let incidents = 0;
  let sitesAllUp = 0;
  for (const s of sites) {
    const sshUp = s.sshStatus === "active";
    const dbUp = s.dbStatus === "active";
    if (sshUp) tunnelsActive++;
    if (dbUp) tunnelsActive++;
    if (s.sshStatus === "dead") incidents++;
    if (s.dbStatus === "dead") incidents++;
    if (sshUp && dbUp) sitesAllUp++;
  }
  return { siteCount: sites.length, tunnelsActive, incidents, sitesAllUp };
}

function isClusterReady(state: string): boolean {
  const s = state.toLowerCase();
  return s.includes("ready") || s === "active";
}

function isClusterDisconnected(state: string): boolean {
  return state.toLowerCase().includes("disconnect");
}

function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  loading,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "ok" | "warn" | "muted";
  loading?: boolean;
  onClick?: () => void;
}) {
  const valueCls =
    tone === "ok"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-rose-400"
        : tone === "muted"
          ? "text-zinc-500"
          : "text-zinc-50";

  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums leading-none ${valueCls}`}>
        {loading ? <Loader2 className="h-7 w-7 animate-spin text-zinc-600" aria-hidden /> : value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-zinc-600">{hint}</p> : null}
    </>
  );

  const className =
    "rounded-xl border border-white/[0.08] bg-[#111418]/90 p-4 text-left ring-1 ring-white/[0.03] transition " +
    (onClick ? "hover:border-cf-orange/30 hover:ring-cf-orange/20 cursor-pointer" : "");

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{children}</p>
  );
}

function QuickLink({
  label,
  route,
  icon: Icon,
  primary,
  onNavigate,
}: {
  label: string;
  route: AtlasRouteId;
  icon: typeof Wifi;
  primary?: boolean;
  onNavigate: (route: AtlasRouteId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(route)}
      className={
        primary
          ? "inline-flex items-center gap-2 rounded-lg bg-cf-orange px-3 py-2 text-xs font-semibold text-black"
          : "inline-flex items-center gap-2 rounded-lg bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700/60 hover:bg-zinc-700/80"
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
      <ArrowRight className="h-3 w-3 opacity-60" aria-hidden />
    </button>
  );
}

export function AtlasHomeView({ sites, canAdmin, syncMsg, syncOk, lastSyncAt, onNavigate }: Props) {
  const vpn = useMemo(() => computeVpnStats(sites), [sites]);

  const [rancherClustersLoading, setRancherClustersLoading] = useState(true);
  const [rancherConfigured, setRancherConfigured] = useState(false);
  const [equipos, setEquipos] = useState(0);
  const [equiposReady, setEquiposReady] = useState(0);
  const [equiposOffline, setEquiposOffline] = useState(0);

  const [storesLoading, setStoresLoading] = useState(true);
  const [storesCount, setStoresCount] = useState<number | null>(null);
  const [storesConfigured, setStoresConfigured] = useState(false);

  const loadRancherMetrics = useCallback(async () => {
    setRancherClustersLoading(true);
    try {
      const data = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
      const list = data.clusters ?? [];
      const configured = data.configured !== false;
      setRancherConfigured(configured);
      if (!configured) {
        setEquipos(0);
        setEquiposReady(0);
        setEquiposOffline(0);
        return;
      }
      setEquipos(list.length);
      setEquiposReady(list.filter((c) => isClusterReady(normalizeState(c.state))).length);
      setEquiposOffline(list.filter((c) => isClusterDisconnected(normalizeState(c.state))).length);
    } catch {
      setRancherConfigured(false);
      setEquipos(0);
      setEquiposReady(0);
      setEquiposOffline(0);
    } finally {
      setRancherClustersLoading(false);
    }
  }, []);

  const loadStoresMetric = useCallback(async () => {
    setStoresLoading(true);
    try {
      const data = await api<StoresListResponse>("/api/atlas-stores/stores");
      setStoresConfigured(data.configured !== false);
      setStoresCount(data.configured === false ? null : (data.count ?? data.stores?.length ?? 0));
    } catch {
      setStoresConfigured(false);
      setStoresCount(null);
    } finally {
      setStoresLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRancherMetrics();
    void loadStoresMetric();
  }, [loadRancherMetrics, loadStoresMetric]);

  const cfStatusLabel = syncOk ? "OK" : "Pendiente";
  const cfHint =
    lastSyncAt != null
      ? `Última sync · ${lastSyncAt}`
      : syncOk && syncMsg
        ? syncMsg
        : "Sin sincronizar";

  return (
    <motion.div layout className="mx-auto max-w-6xl space-y-8">
      <section className="space-y-3">
        <SectionLabel>Atlas VPN</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Sitios"
            value={vpn.siteCount}
            hint="Cloudflare Access"
            onClick={() => onNavigate("conn")}
          />
          <MetricCard
            label="Túneles activos"
            value={vpn.tunnelsActive}
            hint="SSH + BD"
            tone={vpn.tunnelsActive > 0 ? "ok" : "muted"}
            onClick={() => onNavigate("conn")}
          />
          <MetricCard
            label="Sitios al 100%"
            value={vpn.sitesAllUp}
            hint="SSH y BD activos"
            tone={vpn.sitesAllUp > 0 ? "ok" : "muted"}
            onClick={() => onNavigate("conn")}
          />
          <MetricCard
            label="Incidencias"
            value={vpn.incidents}
            hint="Estado dead"
            tone={vpn.incidents > 0 ? "warn" : "muted"}
            onClick={() => onNavigate("conn")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickLink label="Conexiones" route="conn" icon={Wifi} primary onNavigate={onNavigate} />
          <QuickLink label="Poslite" route="poslite" icon={Store} onNavigate={onNavigate} />
          {canAdmin ? <QuickLink label="Cloudflare" route="cf" icon={Cloud} onNavigate={onNavigate} /> : null}
        </div>
      </section>

      <section className="space-y-3">
        <SectionLabel>Atlas Rancher</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Equipos"
            value={rancherConfigured ? equipos : "—"}
            hint={rancherConfigured ? "Clusters registrados" : "Rancher sin configurar"}
            loading={rancherClustersLoading}
            onClick={() => onNavigate("rancher-clusters")}
          />
          <MetricCard
            label="Ready"
            value={rancherConfigured ? equiposReady : "—"}
            hint="Estado operativo"
            tone={equiposReady > 0 ? "ok" : "muted"}
            loading={rancherClustersLoading}
            onClick={() => onNavigate("rancher-clusters")}
          />
          <MetricCard
            label="Desconectados"
            value={rancherConfigured ? equiposOffline : "—"}
            hint="Revisar enlace"
            tone={equiposOffline > 0 ? "warn" : "muted"}
            loading={rancherClustersLoading}
            onClick={() => onNavigate("rancher-clusters")}
          />
          <MetricCard
            label="Tiendas Git"
            value={storesConfigured ? (storesCount ?? 0) : "—"}
            hint={storesConfigured ? "Repo atlas-stores" : "Git sin configurar"}
            loading={storesLoading}
            onClick={() => onNavigate("rancher-stores")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickLink label="Tiendas" route="rancher-stores" icon={Store} primary onNavigate={onNavigate} />
          <QuickLink label="Equipos" route="rancher-clusters" icon={Server} onNavigate={onNavigate} />
          <QuickLink label="Contenedores" route="rancher-pods" icon={Box} onNavigate={onNavigate} />
        </div>
      </section>

      {canAdmin ? (
        <section className="space-y-3">
          <SectionLabel>Cloudflare</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label="Sync"
              value={cfStatusLabel}
              hint={cfHint}
              tone={syncOk ? "ok" : "warn"}
              onClick={() => onNavigate("cf")}
            />
            <MetricCard
              label="Sitios en catálogo"
              value={vpn.siteCount}
              hint="tunnels.json"
              onClick={() => onNavigate("cf")}
            />
            <MetricCard
              label="Intervalo"
              value="15 s"
              hint="Actualización automática"
              tone="muted"
              onClick={() => onNavigate("cf")}
            />
          </div>
        </section>
      ) : null}
    </motion.div>
  );
}
