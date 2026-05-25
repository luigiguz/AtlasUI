import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  Filter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

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
  steveCollection?: string;
  managementClusterId?: string;
};

export type RancherPod = {
  name: string;
  namespace: string;
  phase: string;
  node: string;
  ready: string;
  restarts: number;
  podIP: string;
  createdAt?: string | null;
};

type PodsResponse = {
  ok: boolean;
  source: string;
  managementClusterId: string;
  application: string;
  podNamespace: string;
  count: number;
  pods: RancherPod[];
};

type LabelsPatchResponse = {
  ok: boolean;
  cluster: RancherCustomCluster;
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
  canEditLabels?: boolean;
};

/** Actualización automática de la lista (estados en Rancher). */
const AUTO_REFRESH_INTERVAL_MS = 15_000;

type SortKey = "name" | "store" | "distro" | "application" | "state" | "kubernetes";
type SortDir = "asc" | "desc";

type FilterFieldKey = SortKey;
type FilterOperator = "contains" | "equals" | "not_contains";

type FilterRule = {
  id: string;
  field: FilterFieldKey;
  operator: FilterOperator;
  value: string;
};

const FILTER_FIELDS: { key: FilterFieldKey; label: string; placeholder: string }[] = [
  { key: "name", label: "Nombre", placeholder: "nombre del cluster" },
  { key: "store", label: "Tienda", placeholder: "nombre de tienda" },
  { key: "distro", label: "Distribución", placeholder: "Pam, Horustech…" },
  { key: "application", label: "Aplicación", placeholder: "Poslite, …" },
  { key: "state", label: "Estado", placeholder: "Ready, Disconnected…" },
  { key: "kubernetes", label: "Kubernetes", placeholder: "v1.28.5+rke2r1" },
];

const FILTER_OPERATORS: { key: FilterOperator; label: string }[] = [
  { key: "contains", label: "contiene" },
  { key: "equals", label: "es" },
  { key: "not_contains", label: "no contiene" },
];

function newFilterRule(field: FilterFieldKey = "name"): FilterRule {
  return {
    id: crypto.randomUUID(),
    field,
    operator: "contains",
    value: "",
  };
}

function fieldPlaceholder(field: FilterFieldKey): string {
  return FILTER_FIELDS.find((f) => f.key === field)?.placeholder ?? "";
}

function podPhaseTone(phase: string): string {
  const p = phase.toLowerCase();
  if (p === "running") return "text-emerald-400";
  if (p === "pending") return "text-amber-400";
  if (p === "failed" || p === "unknown") return "text-red-400";
  if (p === "succeeded" || p === "completed") return "text-zinc-400";
  return "text-zinc-400";
}

function stateTone(state: string): string {
  const s = state.toLowerCase();
  if (s.includes("ready") || s === "active") return "text-emerald-400";
  if (s.includes("disconnect")) return "text-zinc-400";
  if (s.includes("error") || s.includes("fail")) return "text-red-400";
  if (s.includes("provision") || s.includes("pending") || s.includes("reconcil")) return "text-amber-400";
  return "text-zinc-400";
}

function clusterDisplayName(c: RancherCustomCluster): string {
  return (c.displayName || c.name).trim();
}

function matchesSearchQuery(c: RancherCustomCluster, query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return true;
  const haystack = [
    clusterDisplayName(c),
    c.name,
    c.store,
    c.distro,
    c.application,
    c.state,
    c.kubernetesVersion,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(t);
}

function clusterFieldValue(c: RancherCustomCluster, field: FilterFieldKey): string {
  switch (field) {
    case "name":
      return clusterDisplayName(c);
    case "store":
      return c.store || "";
    case "distro":
      return normalizeDistro(c.distro);
    case "application":
      return normalizeApplication(c.application);
    case "state":
      return normalizeState(c.state);
    case "kubernetes":
      return (c.kubernetesVersion || "").trim();
    default:
      return "";
  }
}

function compareFieldValues(field: FilterFieldKey, clusterVal: string, ruleVal: string): boolean {
  const a = clusterVal.trim();
  const b = ruleVal.trim();
  if (field === "application") {
    return normalizeApplication(a) === normalizeApplication(b);
  }
  if (field === "distro") {
    return normalizeDistro(a) === normalizeDistro(b);
  }
  if (field === "state") {
    return normalizeState(a) === normalizeState(b);
  }
  return a.localeCompare(b, "es", { sensitivity: "base" }) === 0;
}

function ruleMatchesCluster(c: RancherCustomCluster, rule: FilterRule): boolean {
  const needle = rule.value.trim();
  if (!needle) return true;

  const haystack = clusterFieldValue(c, rule.field).toLowerCase();
  const q = needle.toLowerCase();

  if (rule.operator === "equals") {
    return compareFieldValues(rule.field, clusterFieldValue(c, rule.field), needle);
  }
  if (rule.operator === "not_contains") {
    return !haystack.includes(q);
  }
  return haystack.includes(q);
}

function matchesFilterRules(c: RancherCustomCluster, rules: FilterRule[]): boolean {
  const active = rules.filter((r) => r.value.trim());
  if (active.length === 0) return true;
  if (!active.every((r) => ruleMatchesCluster(c, r))) return false;

  const appNorm = normalizeApplication(
    active.find((r) => r.field === "application")?.value || c.application
  );
  if (isPosliteApplication(appNorm) && !isValidPosliteDistro(c.distro)) {
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

function ClusterSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar por nombre, tienda, distro…"
        autoComplete="off"
        className="w-full rounded-xl border border-cf-line bg-cf-panel/90 py-2 pl-9 pr-9 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20"
        aria-label="Buscar clusters"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
          aria-label="Borrar búsqueda"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const selectClass =
  "w-full min-w-0 rounded-lg border border-cf-line bg-black/40 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-cf-orange/50";

function ClusterFiltersPanel({
  rules,
  onChange,
  onApply,
  onClose,
}: {
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  function updateRule(id: string, patch: Partial<FilterRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRule(id: string) {
    const next = rules.filter((r) => r.id !== id);
    onChange(next.length ? next : [newFilterRule()]);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onApply();
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Filtros de clusters"
      className="absolute left-0 right-0 top-full z-30 mt-2 w-full max-w-xl rounded-xl border border-cf-line bg-[#111418] p-4 shadow-2xl ring-1 ring-white/10 sm:left-auto sm:right-0 sm:w-[min(36rem,calc(100vw-2rem))]"
      onKeyDown={onKeyDown}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Filtros</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
          aria-label="Cerrar filtros"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <select
              value={rule.field}
              onChange={(e) =>
                updateRule(rule.id, { field: e.target.value as FilterFieldKey })
              }
              className={`${selectClass} sm:w-[7.5rem]`}
              aria-label="Campo"
            >
              {FILTER_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={rule.operator}
              onChange={(e) =>
                updateRule(rule.id, { operator: e.target.value as FilterOperator })
              }
              className={`${selectClass} sm:w-[8.5rem]`}
              aria-label="Operador"
            >
              {FILTER_OPERATORS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder={fieldPlaceholder(rule.field)}
              className="min-w-0 flex-1 rounded-lg border border-cf-line bg-black/40 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50"
              aria-label="Valor del filtro"
            />
            <button
              type="button"
              onClick={() => removeRule(rule.id)}
              className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
              aria-label="Eliminar filtro"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...rules, newFilterRule()])}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cf-orange hover:text-cf-orange/80"
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar filtro
      </button>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-cf-line/50 pt-3">
        <p className="text-[11px] text-zinc-600">Pulsa Intro para aplicar</p>
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-600"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

function ClusterLabelsModal({
  cluster,
  onClose,
  onSaved,
}: {
  cluster: RancherCustomCluster;
  onClose: () => void;
  onSaved: (updated: RancherCustomCluster) => void;
}) {
  const [store, setStore] = useState(cluster.store);
  const [application, setApplication] = useState(cluster.application);
  const [distro, setDistro] = useState(cluster.distro);
  const [atlas, setAtlas] = useState(cluster.atlas);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const posliteInvalid =
    isPosliteApplication(application) &&
    Boolean(distro.trim()) &&
    !isValidPosliteDistro(distro);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (posliteInvalid) {
      setErr(`Poslite solo permite distribución ${POSLITE_DISTROS.join(" u ")}.`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const ns = encodeURIComponent(cluster.namespace);
      const nm = encodeURIComponent(cluster.name);
      const r = await api<LabelsPatchResponse>(
        `/api/atlas-rancher/custom-clusters/${ns}/${nm}/labels`,
        {
          method: "PATCH",
          body: JSON.stringify({
            store: store.trim(),
            application: application.trim(),
            distro: distro.trim(),
            atlas: atlas.trim(),
            steve_collection: cluster.steveCollection || "provisioning.cattle.io.customclusters",
          }),
        }
      );
      onSaved(r.cluster);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "No se pudieron guardar los labels.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-labelledby="edit-labels-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-md rounded-xl border border-cf-line bg-[#111418] p-5 shadow-2xl ring-1 ring-white/10"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="edit-labels-title" className="text-sm font-semibold text-zinc-100">
              Editar labels
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">{clusterDisplayName(cluster)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-white/10"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3">
          {(
            [
              ["Tienda", store, setStore, "store"],
              ["Aplicación", application, setApplication, "application"],
              ["Distribución", distro, setDistro, "distro"],
              ["Atlas", atlas, setAtlas, "atlas"],
            ] as const
          ).map(([label, value, setValue, key]) => (
            <label key={key} className="block text-xs text-zinc-500">
              {label}
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cf-orange/50"
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        {posliteInvalid ? (
          <p className="mt-2 text-xs text-amber-400/90">
            Poslite solo permite {POSLITE_DISTROS.join(" u ")}.
          </p>
        ) : null}
        {err ? <p className="mt-2 text-xs text-red-300">{err}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-cf-line px-3 py-2 text-xs text-zinc-400 hover:border-zinc-500"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || posliteInvalid}
            className="rounded-lg bg-cf-orange px-4 py-2 text-xs font-medium text-black hover:bg-cf-orange/90 disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}

const PODS_AUTO_REFRESH_MS = 15_000;

function ClusterPodsModal({
  cluster,
  onClose,
}: {
  cluster: RancherCustomCluster;
  onClose: () => void;
}) {
  const [pods, setPods] = useState<RancherPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [podNamespace, setPodNamespace] = useState(cluster.application || "");

  const loadPods = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");
      try {
        const ns = encodeURIComponent(cluster.namespace);
        const nm = encodeURIComponent(cluster.name);
        const steve = encodeURIComponent(
          cluster.steveCollection || "provisioning.cattle.io.customclusters"
        );
        const r = await api<PodsResponse>(
          `/api/atlas-rancher/custom-clusters/${ns}/${nm}/pods?steve_collection=${steve}`
        );
        setPods(r.pods ?? []);
        setPodNamespace(r.podNamespace || r.application || cluster.application || "");
      } catch (e) {
        setPods([]);
        setError(e instanceof Error ? e.message : "No se pudieron cargar los pods.");
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [cluster.namespace, cluster.name, cluster.steveCollection, cluster.application]
  );

  useEffect(() => {
    void loadPods();
  }, [loadPods]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadPods({ silent: true });
    }, PODS_AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadPods]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const podNs = podNamespace || cluster.application || "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="pods-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(90vh,48rem)] w-full max-w-4xl flex-col rounded-xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-cf-line/50 px-5 py-4">
          <div className="min-w-0">
            <h2 id="pods-modal-title" className="text-sm font-semibold text-zinc-100">
              Gestión de pods
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {clusterDisplayName(cluster)}
              {cluster.store ? (
                <span className="text-zinc-600"> · {cluster.store}</span>
              ) : null}
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Namespace <span className="font-medium text-zinc-400">{podNs}</span>
              {cluster.managementClusterId ? (
                <span> · {cluster.managementClusterId}</span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void loadPods({ silent: true })}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-xs text-zinc-400 hover:border-cf-orange/40 hover:text-cf-orange disabled:opacity-50"
            >
              {loading || refreshing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Actualizar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando pods…
            </div>
          ) : error ? (
            <div className="space-y-2 px-5 py-8">
              <p className="text-sm text-red-300">{error}</p>
              <button
                type="button"
                onClick={() => void loadPods()}
                className="text-xs text-cf-orange hover:underline"
              >
                Reintentar
              </button>
            </div>
          ) : pods.length === 0 ? (
            <p className="px-5 py-8 text-sm text-zinc-500">
              No hay pods en el namespace <span className="text-zinc-300">{podNs}</span>{" "}
              (application).
            </p>
          ) : (
            <>
              <p className="border-b border-cf-line/40 px-5 py-2 text-xs text-zinc-500">
                {pods.length} pod{pods.length !== 1 ? "s" : ""}
                {refreshing ? (
                  <span className="text-zinc-600"> · sincronizando…</span>
                ) : null}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-cf-line/50 text-[10px] uppercase tracking-wide text-zinc-600">
                      <th className="px-5 py-2">Pod</th>
                      <th className="px-5 py-2">Estado</th>
                      <th className="px-5 py-2">Ready</th>
                      <th className="px-5 py-2">Nodo</th>
                      <th className="px-5 py-2">Reinicios</th>
                      <th className="px-5 py-2">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pods.map((p) => (
                      <tr key={p.name} className="border-b border-cf-line/30 last:border-0">
                        <td className="px-5 py-2.5 font-medium text-zinc-200">{p.name}</td>
                        <td className={`px-5 py-2.5 ${podPhaseTone(p.phase)}`}>{p.phase}</td>
                        <td className="px-5 py-2.5 text-zinc-400">{p.ready}</td>
                        <td className="px-5 py-2.5 text-zinc-500">{p.node || "—"}</td>
                        <td className="px-5 py-2.5 tabular-nums text-zinc-400">{p.restarts}</td>
                        <td className="px-5 py-2.5 font-mono text-[11px] text-zinc-500">
                          {p.podIP || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-cf-line/50 px-5 py-3">
          <p className="text-[11px] text-zinc-600">
            Actualización automática cada {PODS_AUTO_REFRESH_MS / 1000}s mientras el modal está abierto.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AtlasRancherClustersView({ canAdmin, canEditLabels = false }: Props) {
  const [clusters, setClusters] = useState<RancherCustomCluster[]>([]);
  const [source, setSource] = useState("");
  const [rancherUrl, setRancherUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rancherConfigured, setRancherConfigured] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [, setRefreshClock] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersPanelRef = useRef<HTMLDivElement>(null);
  const [appliedRules, setAppliedRules] = useState<FilterRule[]>([]);
  const [draftRules, setDraftRules] = useState<FilterRule[]>(() => [newFilterRule()]);
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
  const [editingCluster, setEditingCluster] = useState<RancherCustomCluster | null>(null);
  const [podsCluster, setPodsCluster] = useState<RancherCustomCluster | null>(null);

  function mergeClusterUpdate(updated: RancherCustomCluster) {
    setClusters((list) =>
      list.map((c) =>
        c.id === updated.id || (c.namespace === updated.namespace && c.name === updated.name)
          ? { ...updated, steveCollection: updated.steveCollection ?? c.steveCollection }
          : c
      )
    );
  }

  const displayedClusters = useMemo(() => {
    let list = clusters.filter(
      (c) => matchesSearchQuery(c, searchQuery) && matchesFilterRules(c, appliedRules)
    );
    if (sort) {
      list = sortClusters(list, sort.key, sort.dir);
    }
    return list;
  }, [clusters, searchQuery, appliedRules, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { key, dir: "asc" };
    });
  }

  const loadClusters = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setError("");
    }
    try {
      const data = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
      const list = (data.clusters ?? []).map((c) => ({
        ...c,
        application: normalizeApplication(c.application ?? c.labels?.application ?? ""),
        distro: normalizeDistro(c.distro ?? c.labels?.distro ?? ""),
        store: c.store ?? c.labels?.store ?? "",
        atlas: c.atlas ?? c.labels?.atlas ?? "",
        state: normalizeState(c.state),
        steveCollection: c.steveCollection,
        managementClusterId: c.managementClusterId,
      }));
      setClusters(list);
      setSource(data.source ?? "");
      setRancherUrl(data.rancherUrl ?? "");
      const configured = data.configured !== false;
      setRancherConfigured(configured);
      setLastRefreshedAt(Date.now());
      if (!silent && data.configured === false && data.message) {
        setError(data.message);
      } else if (!silent) {
        setError("");
      }
    } catch (e) {
      if (!silent) {
        setClusters([]);
        const msg = e instanceof Error ? e.message : "No se pudieron cargar los clusters.";
        if (/failed to fetch|networkerror/i.test(msg)) {
          setError(
            "No se pudo contactar el API (api-atlas-vpn.verkku.com). Suele ser 502 en el túnel o API sin desplegar la última versión. Comprueba que atlas-api esté en marcha y vuelve a desplegar."
          );
        } else {
          setError(msg);
        }
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  useEffect(() => {
    if (!rancherConfigured) return;

    const id = window.setInterval(() => {
      if (document.hidden || editingCluster || podsCluster) return;
      void loadClusters({ silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [rancherConfigured, editingCluster, podsCluster, loadClusters]);

  useEffect(() => {
    if (!lastRefreshedAt) return;
    const id = window.setInterval(() => setRefreshClock((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [lastRefreshedAt]);

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

  const activeRuleCount = useMemo(
    () => appliedRules.filter((r) => r.value.trim()).length,
    [appliedRules]
  );

  const hasActiveFilters = searchQuery.trim() !== "" || activeRuleCount > 0;

  function clearAllFilters() {
    setSearchQuery("");
    setAppliedRules([]);
    setDraftRules([newFilterRule()]);
  }

  function openFiltersPanel() {
    setDraftRules(
      appliedRules.filter((r) => r.value.trim()).length
        ? appliedRules.map((r) => ({ ...r, id: crypto.randomUUID() }))
        : [newFilterRule()]
    );
    setFiltersOpen(true);
  }

  function applyDraftFilters() {
    setAppliedRules(draftRules.filter((r) => r.value.trim()));
    setFiltersOpen(false);
  }

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (filtersPanelRef.current && !filtersPanelRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <motion.div layout>
          <h1 className="text-lg font-semibold text-zinc-100">Custom clusters</h1>
          <p className="text-xs text-zinc-500">
            Busca por texto o filtros. Abre <span className="text-zinc-400">Pods</span> en un cluster para gestionarlos.
            {rancherUrl ? (
              <>
                {" "}
                <span className="text-zinc-600">{rancherUrl}</span>
              </>
            ) : null}
          </p>
        </motion.div>
        <div className="flex flex-wrap items-center gap-2">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearAllFilters}
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
            {loading || refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Actualizar
          </button>
          {lastRefreshedAt && rancherConfigured ? (
            <span className="text-[11px] tabular-nums text-zinc-600">
              {refreshing ? "Sincronizando…" : `Hace ${Math.max(0, Math.round((Date.now() - lastRefreshedAt) / 1000))}s`}
            </span>
          ) : null}
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

      <div className="flex flex-col gap-3">
        {clusters.length > 0 ? (
          <div ref={filtersPanelRef} className="relative flex flex-wrap items-center gap-2">
            <ClusterSearchInput value={searchQuery} onChange={setSearchQuery} />
            <button
              type="button"
              onClick={() => (filtersOpen ? setFiltersOpen(false) : openFiltersPanel())}
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
              className={
                filtersOpen || activeRuleCount > 0
                  ? "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-orange/45 bg-cf-orange/10 px-3.5 py-2 text-sm font-medium text-zinc-100 ring-1 ring-cf-orange/25"
                  : "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-line bg-cf-panel/90 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
              }
            >
              <Filter className="h-4 w-4 text-zinc-400" aria-hidden />
              Filtros
              {activeRuleCount > 0 ? (
                <span className="rounded-full bg-cf-orange/25 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-cf-orange">
                  {activeRuleCount}
                </span>
              ) : null}
            </button>

            {filtersOpen ? (
              <ClusterFiltersPanel
                rules={draftRules}
                onChange={setDraftRules}
                onApply={applyDraftFilters}
                onClose={() => setFiltersOpen(false)}
              />
            ) : null}
          </div>
        ) : null}

        <motion.div
          layout
          className="overflow-hidden rounded-xl border border-cf-line/70 bg-[#111418]/90 ring-1 ring-white/[0.03]"
        >
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
              <p className="border-b border-cf-line/50 px-4 py-3 text-sm text-zinc-400">
                {displayedClusters.length === clusters.length ? (
                  <>
                    <span className="font-medium text-zinc-300">{clusters.length}</span> cluster
                    {clusters.length !== 1 ? "s" : ""}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-zinc-300">{displayedClusters.length}</span> de{" "}
                    {clusters.length} cluster{clusters.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
              {displayedClusters.length === 0 ? (
                <motion.div layout className="p-10 text-center text-sm text-zinc-500">
                  Ningún cluster coincide con la búsqueda o los filtros seleccionados.
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
                        <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Pods
                        </th>
                        {canEditLabels ? (
                          <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                            Labels
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedClusters.map((c) => (
                            <tr
                              key={c.id}
                              className="border-b border-cf-line/40 hover:bg-white/[0.02]"
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
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => setPodsCluster(c)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-xs text-zinc-400 hover:border-cf-orange/40 hover:text-cf-orange"
                                  title="Gestionar pods"
                                >
                                  <Box className="h-3.5 w-3.5" />
                                  Pods
                                </button>
                              </td>
                              {canEditLabels ? (
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() => setEditingCluster(c)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-xs text-zinc-400 hover:border-cf-orange/40 hover:text-cf-orange"
                                    title="Editar labels"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Editar
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {source && !loading && clusters.length > 0 ? (
            <p className="border-t border-cf-line/40 px-4 py-2 text-[11px] text-zinc-600">
              Fuente API: {source}
            </p>
          ) : null}
        </motion.div>
      </div>
      {editingCluster ? (
        <ClusterLabelsModal
          cluster={editingCluster}
          onClose={() => setEditingCluster(null)}
          onSaved={mergeClusterUpdate}
        />
      ) : null}
      {podsCluster ? (
        <ClusterPodsModal cluster={podsCluster} onClose={() => setPodsCluster(null)} />
      ) : null}
    </motion.div>
  );
}
