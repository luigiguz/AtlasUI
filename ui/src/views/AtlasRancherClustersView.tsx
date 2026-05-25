import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "../apiClient";
import {
  isPosliteApplication,
  isValidPosliteDistro,
  normalizeApplication,
  normalizeDistro,
  normalizeState,
  POSLITE_DISTROS,
} from "../rancherLabels";

export type RancherCustomCluster = {
  id: string;
  name: string;
  namespace: string;
  displayName: string;
  state: string;
  kubernetesVersion: string;
  ready: boolean | null;
  kind: string;
  createdAt?: string | null;
  labels?: Record<string, string>;
  application: string;
  distro: string;
  store: string;
  atlas: string;
};

type ClustersResponse = {
  ok: boolean;
  configured?: boolean;
  message?: string;
  source: string;
  rancherUrl: string;
  count: number;
  clusters: RancherCustomCluster[];
};

type SettingsResponse = {
  url: string;
  token: string;
  insecure_tls: boolean;
  configured: boolean;
};

type Props = {
  canAdmin: boolean;
};

const FILTER_ALL = "";

type SortKey = "name" | "store" | "distro" | "application" | "state" | "kubernetes";
type SortDir = "asc" | "desc";

type ColumnFilters = {
  store: string;
  distro: string;
  application: string;
  state: string;
  kubernetes: string;
};

const EMPTY_FILTERS: ColumnFilters = {
  store: FILTER_ALL,
  distro: FILTER_ALL,
  application: FILTER_ALL,
  state: FILTER_ALL,
  kubernetes: FILTER_ALL,
};

function stateTone(state: string): string {
  const s = state.toLowerCase();
  if (s.includes("ready") || s === "active") return "text-emerald-400";
  if (s.includes("disconnect")) return "text-zinc-400";
  if (s.includes("error") || s.includes("fail")) return "text-red-400";
  if (s.includes("provision") || s.includes("pending") || s.includes("reconcil")) return "text-amber-400";
  return "text-zinc-400";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

function clusterDisplayName(c: RancherCustomCluster): string {
  return (c.displayName || c.name).trim();
}

function matchesColumnFilters(c: RancherCustomCluster, f: ColumnFilters): boolean {
  if (f.application && normalizeApplication(c.application) !== normalizeApplication(f.application)) {
    return false;
  }
  const appNorm = normalizeApplication(f.application || c.application);
  if (isPosliteApplication(appNorm) && !isValidPosliteDistro(c.distro)) {
    return false;
  }
  if (f.distro && normalizeDistro(c.distro) !== normalizeDistro(f.distro)) {
    return false;
  }
  if (f.store && (c.store || "").trim() !== f.store) {
    return false;
  }
  if (f.state && normalizeState(c.state) !== normalizeState(f.state)) {
    return false;
  }
  if (f.kubernetes && (c.kubernetesVersion || "").trim() !== f.kubernetes) {
    return false;
  }
  return true;
}

function sortValue(c: RancherCustomCluster, key: SortKey): string {
  switch (key) {
    case "name":
      return clusterDisplayName(c);
    case "store":
      return c.store || "";
    case "distro":
      return c.distro || "";
    case "application":
      return c.application || "";
    case "state":
      return normalizeState(c.state);
    case "kubernetes":
      return c.kubernetesVersion || "";
    default:
      return "";
  }
}

function sortClusters(
  list: RancherCustomCluster[],
  key: SortKey,
  dir: SortDir
): RancherCustomCluster[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => mul * sortValue(a, key).localeCompare(sortValue(b, key), "es", { sensitivity: "base" }));
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3 text-cf-orange" aria-hidden />
  ) : (
    <ArrowDown className="h-3 w-3 text-cf-orange" aria-hidden />
  );
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={`px-4 py-3 ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
      >
        {label}
        <SortIcon active={active} dir={active ? sort!.dir : "asc"} />
      </button>
    </th>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "Todos",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <label className="block min-w-[7rem] flex-1 text-xs text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-cf-line bg-black/30 px-2.5 py-1.5 text-sm text-zinc-100"
      >
        <option value={FILTER_ALL}>{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AtlasRancherClustersView({ canAdmin }: Props) {
  const [clusters, setClusters] = useState<RancherCustomCluster[]>([]);
  const [source, setSource] = useState("");
  const [rancherUrl, setRancherUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [colFilters, setColFilters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>({
    key: "name",
    dir: "asc",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfgUrl, setCfgUrl] = useState("");
  const [cfgToken, setCfgToken] = useState("");
  const [cfgInsecure, setCfgInsecure] = useState(false);
  const [cfgCfId, setCfgCfId] = useState("");
  const [cfgCfSecret, setCfgCfSecret] = useState("");
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgMsg, setCfgMsg] = useState("");

  const storeOptions = useMemo(() => uniqueSorted(clusters.map((c) => c.store)), [clusters]);
  const applicationOptions = useMemo(
    () => uniqueSorted(clusters.map((c) => normalizeApplication(c.application))),
    [clusters]
  );
  const distroOptions = useMemo(() => {
    if (isPosliteApplication(colFilters.application)) {
      return [...POSLITE_DISTROS];
    }
    return uniqueSorted(clusters.map((c) => normalizeDistro(c.distro)));
  }, [clusters, colFilters.application]);
  const stateOptions = useMemo(
    () => uniqueSorted(clusters.map((c) => normalizeState(c.state))),
    [clusters]
  );
  const kubernetesOptions = useMemo(
    () => uniqueSorted(clusters.map((c) => c.kubernetesVersion)),
    [clusters]
  );

  useEffect(() => {
    if (!isPosliteApplication(colFilters.application)) return;
    if (!colFilters.distro) return;
    if (!isValidPosliteDistro(colFilters.distro)) {
      setColFilters((f) => ({ ...f, distro: FILTER_ALL }));
    }
  }, [colFilters.application, colFilters.distro]);

  const displayedClusters = useMemo(() => {
    let list = clusters.filter((c) => matchesColumnFilters(c, colFilters));
    if (sort) {
      list = sortClusters(list, sort.key, sort.dir);
    }
    return list;
  }, [clusters, colFilters, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key, dir: "asc" };
    });
  }

  function setColFilter<K extends keyof ColumnFilters>(field: K, value: string) {
    setColFilters((f) => {
      const next = { ...f, [field]: value };
      if (field === "application" && isPosliteApplication(value)) {
        if (next.distro && !isValidPosliteDistro(next.distro)) {
          next.distro = FILTER_ALL;
        }
      }
      return next;
    });
  }

  const loadClusters = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
      const list = (data.clusters ?? []).map((c) => ({
        ...c,
        application: normalizeApplication(c.application ?? c.labels?.application ?? ""),
        distro: normalizeDistro(c.distro ?? c.labels?.distro ?? ""),
        store: c.store ?? c.labels?.store ?? "",
        atlas: c.atlas ?? c.labels?.atlas ?? "",
        state: normalizeState(c.state),
      }));
      setClusters(list);
      setSource(data.source ?? "");
      setRancherUrl(data.rancherUrl ?? "");
      if (data.configured === false && data.message) {
        setError(data.message);
      }
    } catch (e) {
      setClusters([]);
      const msg = e instanceof Error ? e.message : "No se pudieron cargar los clusters.";
      if (/failed to fetch|networkerror/i.test(msg)) {
        setError(
          "No se pudo contactar el API (api-atlas-vpn.verkku.com). Suele ser 502 en el túnel o API sin desplegar la última versión. Comprueba que atlas-api esté en marcha y vuelve a desplegar."
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  useEffect(() => {
    if (!canAdmin || !settingsOpen) return;
    void (async () => {
      try {
        const s = await api<SettingsResponse>("/api/atlas-rancher/settings");
        setCfgUrl(s.url ?? "");
        setCfgToken(s.token ?? "");
        setCfgInsecure(Boolean(s.insecure_tls));
        setCfgCfId((s as { cf_access_client_id?: string }).cf_access_client_id ?? "");
        setCfgCfSecret("");
      } catch {
        /* ignore */
      }
    })();
  }, [canAdmin, settingsOpen]);

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    setCfgSaving(true);
    setCfgMsg("");
    try {
      await api("/api/atlas-rancher/settings", {
        method: "POST",
        body: JSON.stringify({
          url: cfgUrl.trim(),
          token: cfgToken.trim(),
          insecure_tls: cfgInsecure,
          cf_access_client_id: cfgCfId.trim(),
          cf_access_client_secret: cfgCfSecret.trim(),
        }),
      });
      setCfgMsg("Conexión guardada.");
      setSettingsOpen(false);
      await loadClusters();
    } catch (err) {
      setCfgMsg(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setCfgSaving(false);
    }
  }

  const hasActiveFilters = Object.values(colFilters).some((v) => v !== FILTER_ALL);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <motion.div layout className="flex items-center gap-3">
          <img
            src="/branding/atlas-rancher-header.svg"
            alt=""
            className="h-9 w-auto opacity-90"
            aria-hidden
          />
          <motion.div layout>
            <h1 className="text-lg font-semibold text-zinc-100">Custom clusters</h1>
            <p className="text-xs text-zinc-500">
              Clic en un encabezado para ordenar. Filtros en la barra superior de la tabla.
              {rancherUrl ? (
                <>
                  {" "}
                  <span className="text-zinc-600">{rancherUrl}</span>
                </>
              ) : null}
            </p>
          </motion.div>
        </motion.div>
        <div className="flex flex-wrap items-center gap-2">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => setColFilters(EMPTY_FILTERS)}
              className="rounded-lg border border-cf-line bg-cf-panel px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500"
            >
              Limpiar filtros
            </button>
          ) : null}
          {canAdmin ? (
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="rounded-lg border border-cf-line bg-cf-panel px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
            >
              {settingsOpen ? "Cerrar conexión" : "Conexión Rancher"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void loadClusters()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cf-orange/50 bg-cf-orange/10 px-3 py-1.5 text-xs font-medium text-cf-orange hover:bg-cf-orange/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar
          </button>
        </div>
      </div>

      {canAdmin && settingsOpen ? (
        <form
          onSubmit={(e) => void onSaveSettings(e)}
          className="rounded-xl border border-cf-line/80 bg-cf-panel/80 p-4 ring-1 ring-white/[0.03]"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Conexión API</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              URL de Rancher
              <input
                value={cfgUrl}
                onChange={(e) => setCfgUrl(e.target.value)}
                placeholder="https://rancher.ejemplo.com"
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/30 px-3 py-2 text-sm text-zinc-100"
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Token API (Bearer)
              <input
                value={cfgToken}
                onChange={(e) => setCfgToken(e.target.value)}
                type="password"
                placeholder="token…"
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/30 px-3 py-2 text-sm text-zinc-100"
                autoComplete="off"
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={cfgInsecure}
              onChange={(e) => setCfgInsecure(e.target.checked)}
              className="rounded border-cf-line"
            />
            Permitir TLS no verificado (certificado autofirmado)
          </label>
          <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Cloudflare (si Rancher está detrás de CF Access)
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400">
              CF-Access-Client-Id
              <input
                value={cfgCfId}
                onChange={(e) => setCfgCfId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/30 px-3 py-2 text-sm text-zinc-100"
                autoComplete="off"
              />
            </label>
            <label className="block text-xs text-zinc-400">
              CF-Access-Client-Secret
              <input
                value={cfgCfSecret}
                onChange={(e) => setCfgCfSecret(e.target.value)}
                type="password"
                placeholder="Dejar vacío para no cambiar"
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/30 px-3 py-2 text-sm text-zinc-100"
                autoComplete="off"
              />
            </label>
          </div>
          {cfgMsg ? <p className="mt-2 text-xs text-zinc-400">{cfgMsg}</p> : null}
          <button
            type="submit"
            disabled={cfgSaving}
            className="mt-3 rounded-lg bg-cf-orange px-4 py-2 text-xs font-medium text-black hover:bg-cf-orange/90 disabled:opacity-50"
          >
            {cfgSaving ? "Guardando…" : "Guardar"}
          </button>
        </form>
      ) : null}

      {error ? (
        <motion.div layout className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </motion.div>
      ) : null}

      <motion.div layout className="overflow-hidden rounded-xl border border-cf-line/70 bg-[#111418]/90 ring-1 ring-white/[0.03]">
        {loading && clusters.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando clusters…
          </div>
        ) : clusters.length === 0 && !error ? (
          <motion.div layout className="p-10 text-center text-sm text-zinc-500">
            <Server className="mx-auto mb-2 h-8 w-8 text-zinc-600" strokeWidth={1.25} />
            No hay Custom clusters visibles.
            {canAdmin ? " Configura la conexión a Rancher y pulsa Actualizar." : null}
          </motion.div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3 border-b border-cf-line/50 bg-black/25 px-3 py-3">
              <FilterSelect
                label="Tienda"
                value={colFilters.store}
                onChange={(v) => setColFilter("store", v)}
                options={storeOptions}
              />
              <FilterSelect
                label="Distribución"
                value={colFilters.distro}
                onChange={(v) => setColFilter("distro", v)}
                options={distroOptions}
              />
              <FilterSelect
                label="Aplicación"
                value={colFilters.application}
                onChange={(v) => setColFilter("application", v)}
                options={applicationOptions}
                allLabel="Todas"
              />
              <FilterSelect
                label="Estado"
                value={colFilters.state}
                onChange={(v) => setColFilter("state", v)}
                options={stateOptions}
              />
              <FilterSelect
                label="Kubernetes"
                value={colFilters.kubernetes}
                onChange={(v) => setColFilter("kubernetes", v)}
                options={kubernetesOptions}
              />
              <p className="ml-auto shrink-0 pb-1.5 text-xs tabular-nums text-zinc-500">
                {displayedClusters.length} / {clusters.length}
              </p>
            </div>
            {displayedClusters.length === 0 ? (
              <motion.div layout className="p-10 text-center text-sm text-zinc-500">
                Ningún cluster coincide con los filtros seleccionados.
              </motion.div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-cf-line/60 text-xs uppercase tracking-wide text-zinc-500">
                      <SortableTh label="Nombre" sortKey="name" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Tienda" sortKey="store" sort={sort} onSort={toggleSort} />
                      <SortableTh label="Distribución" sortKey="distro" sort={sort} onSort={toggleSort} />
                      <SortableTh
                        label="Aplicación"
                        sortKey="application"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <SortableTh label="Estado" sortKey="state" sort={sort} onSort={toggleSort} />
                      <SortableTh
                        label="Kubernetes"
                        sortKey="kubernetes"
                        sort={sort}
                        onSort={toggleSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {displayedClusters.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-cf-line/40 last:border-0 hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-zinc-100">{clusterDisplayName(c)}</span>
                          {c.displayName && c.displayName !== c.name ? (
                            <span className="mt-0.5 block text-xs text-zinc-600">{c.name}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{c.store || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.distro || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.application || "—"}</td>
                        <td className={`px-4 py-3 ${stateTone(c.state)}`}>{c.state || "—"}</td>
                        <td className="px-4 py-3 text-zinc-400">{c.kubernetesVersion || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {source && !loading ? (
          <p className="border-t border-cf-line/40 px-4 py-2 text-[11px] text-zinc-600">
            Fuente API: {source} · {displayedClusters.length} de {clusters.length} cluster
            {clusters.length !== 1 ? "s" : ""}
          </p>
        ) : null}
      </motion.div>
    </motion.div>
  );
}
