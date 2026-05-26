import { AnimatePresence, motion } from "framer-motion";
import { Box, Loader2, RefreshCw, RotateCw, Search, Server, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../apiClient";
import { normalizeApplication, normalizeDistro, normalizeState } from "../rancherLabels";
import type {
  ClustersResponse,
  DeploymentRolloutResponse,
  DeploymentsResponse,
  PodsResponse,
  RancherCustomCluster,
  RancherDeployment,
  RancherPod,
} from "../rancherTypes";

const AUTO_REFRESH_MS = 15_000;

type Props = {
  canAdmin: boolean;
  canEdit: boolean;
};

type ClusterPanelTab = "workloads" | "pods";

function clusterDisplayName(c: RancherCustomCluster): string {
  return (c.displayName || c.name).trim();
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

function RolloutConfirmModal({
  deployment,
  clusterLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  deployment: RancherDeployment;
  clusterLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const targetReplicas = deployment.replicas > 0 ? deployment.replicas : 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <motion.div
      role="presentation"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rollout-confirm-title"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: "spring", damping: 28, stiffness: 360 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.08]"
      >
        <div className="border-b border-cf-line/60 bg-gradient-to-r from-cf-orange/10 via-transparent to-transparent px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cf-orange/15 ring-1 ring-cf-orange/30">
                <RotateCw className="h-5 w-5 text-cf-orange" aria-hidden />
              </div>
              <div>
                <h2 id="rollout-confirm-title" className="text-sm font-semibold text-zinc-100">
                  Actualizar imagen
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">{clusterLabel}</p>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 disabled:opacity-40"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-sm text-zinc-300">
            ¿Forzar la descarga de la imagen en el nodo para{" "}
            <span className="font-medium text-zinc-100">«{deployment.name}»</span>?
          </p>

          <div className="rounded-lg border border-cf-line/70 bg-black/30 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Proceso</p>
            <div className="mt-3 flex items-center justify-center gap-2 text-sm">
              <span className="rounded-md bg-zinc-800 px-2.5 py-1 tabular-nums text-zinc-200 ring-1 ring-zinc-700">
                0
              </span>
              <motion.span
                className="text-cf-orange"
                animate={{ x: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
                aria-hidden
              >
                →
              </motion.span>
              <span className="rounded-md bg-cf-orange/15 px-2.5 py-1 tabular-nums font-medium text-cf-orange ring-1 ring-cf-orange/40">
                {targetReplicas}
              </span>
            </div>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-500">
              Réplicas a 0, luego a {targetReplicas}. El pod nuevo hará pull según{" "}
              <span className="text-zinc-400">imagePullPolicy</span>.
            </p>
          </div>

          {deployment.image ? (
            <div className="rounded-lg border border-cf-line/50 bg-black/20 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-600">Imagen actual</p>
              <p className="mt-1 truncate font-mono text-[11px] text-zinc-400" title={deployment.image}>
                {deployment.image}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-cf-line/60 bg-black/20 px-5 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-lg border border-cf-line bg-zinc-900/80 py-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-cf-orange py-2.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Actualizando…
              </>
            ) : (
              <>
                <RotateCw className="h-3.5 w-3.5" />
                Confirmar
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function deploymentImageLabel(d: RancherDeployment): string {
  if (d.imageTag) return d.imageTag;
  if (d.image) {
    const tail = d.image.includes("@") ? d.image.split("@")[0] : d.image;
    return tail.split("/").pop() || d.image;
  }
  return "—";
}

function clusterRancherPaths(cluster: RancherCustomCluster) {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  const steve = encodeURIComponent(cluster.steveCollection || "provisioning.cattle.io.customclusters");
  const base = `/api/atlas-rancher/custom-clusters/${ns}/${nm}`;
  return {
    deployments: `${base}/deployments?steve_collection=${steve}`,
    pods: `${base}/pods?steve_collection=${steve}`,
  };
}

function ClusterWorkloadsTable({
  cluster,
  canEdit,
  onRolloutDone,
}: {
  cluster: RancherCustomCluster;
  canEdit: boolean;
  onRolloutDone: () => void;
}) {
  const [deployments, setDeployments] = useState<RancherDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rolling, setRolling] = useState<string | null>(null);
  const [rolloutMsg, setRolloutMsg] = useState("");
  const [confirmDeployment, setConfirmDeployment] = useState<RancherDeployment | null>(null);

  const loadDeployments = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const r = await api<DeploymentsResponse>(clusterRancherPaths(cluster).deployments);
        setDeployments(r.deployments ?? []);
      } catch (e) {
        setDeployments([]);
        setError(e instanceof Error ? e.message : "No se pudieron cargar los deployments.");
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [cluster]
  );

  useEffect(() => {
    void loadDeployments();
  }, [loadDeployments]);

  function openRolloutConfirm(dep: RancherDeployment) {
    if (!canEdit || rolling) return;
    setConfirmDeployment(dep);
  }

  async function executeRollout(dep: RancherDeployment) {
    const label = dep.name;
    setRolling(dep.name);
    setRolloutMsg("");
    setError("");
    try {
      const ns = encodeURIComponent(cluster.namespace);
      const nm = encodeURIComponent(cluster.name);
      const depName = encodeURIComponent(dep.name);
      const r = await api<DeploymentRolloutResponse>(
        `/api/atlas-rancher/custom-clusters/${ns}/${nm}/deployments/${depName}/rollout`,
        {
          method: "POST",
          body: JSON.stringify({
            steve_collection: cluster.steveCollection || "provisioning.cattle.io.customclusters",
          }),
        }
      );
      setRolloutMsg(
        `«${label}»: réplicas 0 → ${r.targetReplicas}. La imagen se volverá a descargar según imagePullPolicy.`
      );
      setConfirmDeployment(null);
      await loadDeployments({ silent: true });
      onRolloutDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el deployment.");
    } finally {
      setRolling(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando contenedores…
      </div>
    );
  }

  if (error && deployments.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <p className="text-sm text-red-300">{error}</p>
        <button type="button" onClick={() => void loadDeployments()} className="text-xs text-cf-orange hover:underline">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rolloutMsg ? <p className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/5 px-4 py-2 text-xs text-emerald-300">{rolloutMsg}</p> : null}
      {error ? <p className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">{error}</p> : null}
      <p className="shrink-0 border-b border-cf-line/40 px-4 py-2 text-[11px] text-zinc-500">
        Deployments en el namespace del cluster. Usa <span className="text-zinc-400">Actualizar imagen</span> para escalar
        0 → N y forzar pull (mismo procedimiento que en Rancher UI).
      </p>
      {deployments.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-500">No hay deployments en este namespace.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky top-0 bg-[#111418]">
              <tr className="border-b border-cf-line/50 text-[10px] uppercase tracking-wide text-zinc-600">
                <th className="px-4 py-2">Servicio</th>
                <th className="px-4 py-2">Imagen</th>
                <th className="px-4 py-2">Réplicas</th>
                <th className="px-4 py-2">Listas</th>
                {canEdit ? <th className="px-4 py-2">Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.name} className="border-b border-cf-line/30 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-zinc-200">{d.name}</td>
                  <td
                    className="max-w-[240px] truncate px-4 py-2.5 font-mono text-[11px] text-zinc-400"
                    title={d.images?.length ? d.images.join("\n") : d.image || undefined}
                  >
                    {deploymentImageLabel(d)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-zinc-400">{d.replicas}</td>
                  <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                    {d.readyReplicas}/{d.replicas}
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        disabled={rolling !== null}
                        onClick={() => openRolloutConfirm(d)}
                        className="inline-flex items-center gap-1 rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-1 text-[11px] font-medium text-cf-orange hover:bg-cf-orange/20 disabled:opacity-50"
                      >
                        {rolling === d.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="h-3 w-3" />
                        )}
                        Actualizar imagen
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-end border-t border-cf-line/40 px-4 py-2">
        <button
          type="button"
          onClick={() => void loadDeployments({ silent: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-cf-orange disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualizar lista
        </button>
      </div>

      <AnimatePresence>
        {confirmDeployment ? (
          <RolloutConfirmModal
            deployment={confirmDeployment}
            clusterLabel={clusterDisplayName(cluster)}
            busy={rolling === confirmDeployment.name}
            onCancel={() => {
              if (rolling !== confirmDeployment.name) setConfirmDeployment(null);
            }}
            onConfirm={() => void executeRollout(confirmDeployment)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ClusterPodsTable({
  cluster,
  refreshKey,
}: {
  cluster: RancherCustomCluster;
  refreshKey: number;
}) {
  const [pods, setPods] = useState<RancherPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [podNamespace, setPodNamespace] = useState(cluster.application || "");

  const loadPods = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const r = await api<PodsResponse>(clusterRancherPaths(cluster).pods);
        setPods(r.pods ?? []);
        setPodNamespace(r.podNamespace || r.application || cluster.application || "");
      } catch (e) {
        setPods([]);
        setError(e instanceof Error ? e.message : "No se pudieron cargar los pods.");
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [cluster.namespace, cluster.name, cluster.steveCollection, cluster.application]
  );

  useEffect(() => {
    void loadPods();
  }, [loadPods, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadPods({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadPods]);

  const podNs = podNamespace || cluster.application || "—";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando pods…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => void loadPods()}
          className="text-xs text-cf-orange hover:underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pods.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-500">
          No hay pods en el namespace <span className="text-zinc-300">{podNs}</span> (application).
        </p>
      ) : (
        <>
          <p className="border-b border-cf-line/40 px-4 py-2 text-xs text-zinc-500">
            {pods.length} pod{pods.length !== 1 ? "s" : ""}
            {refreshing ? <span className="text-zinc-600"> · sincronizando…</span> : null}
          </p>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="sticky top-0 bg-[#111418]">
                <tr className="border-b border-cf-line/50 text-[10px] uppercase tracking-wide text-zinc-600">
                  <th className="px-4 py-2">Pod</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Ready</th>
                  <th className="px-4 py-2">Nodo</th>
                  <th className="px-4 py-2">Reinicios</th>
                  <th className="px-4 py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {pods.map((p) => (
                  <tr key={p.name} className="border-b border-cf-line/30 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-zinc-200">{p.name}</td>
                    <td className={`px-4 py-2.5 ${podPhaseTone(p.phase)}`}>{p.phase}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{p.ready}</td>
                    <td className="px-4 py-2.5 text-zinc-500">{p.node || "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-400">{p.restarts}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">{p.podIP || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex shrink-0 items-center justify-between border-t border-cf-line/40 px-4 py-2 text-[11px] text-zinc-600">
        <span>Actualización automática cada {AUTO_REFRESH_MS / 1000}s</span>
        <button
          type="button"
          onClick={() => void loadPods({ silent: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-cf-orange disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualizar
        </button>
      </div>
    </div>
  );
}

function ClusterServicesPanel({
  cluster,
  canEdit,
}: {
  cluster: RancherCustomCluster;
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<ClusterPanelTab>("workloads");
  const [podsRefreshKey, setPodsRefreshKey] = useState(0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-cf-line/50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">{clusterDisplayName(cluster)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Namespace <span className="font-medium text-zinc-300">{cluster.application || "—"}</span>
            {cluster.store ? <span className="text-zinc-600"> · {cluster.store}</span> : null}
          </p>
        </div>
        <div className="flex rounded-lg border border-cf-line bg-black/30 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("workloads")}
            className={
              tab === "workloads"
                ? "rounded-md bg-cf-orange/20 px-2.5 py-1 font-medium text-cf-orange"
                : "px-2.5 py-1 text-zinc-500 hover:text-zinc-300"
            }
          >
            Contenedores
          </button>
          <button
            type="button"
            onClick={() => setTab("pods")}
            className={
              tab === "pods"
                ? "rounded-md bg-cf-orange/20 px-2.5 py-1 font-medium text-cf-orange"
                : "px-2.5 py-1 text-zinc-500 hover:text-zinc-300"
            }
          >
            Pods
          </button>
        </div>
      </div>
      {tab === "workloads" ? (
        <ClusterWorkloadsTable
          cluster={cluster}
          canEdit={canEdit}
          onRolloutDone={() => setPodsRefreshKey((k) => k + 1)}
        />
      ) : (
        <ClusterPodsTable cluster={cluster} refreshKey={podsRefreshKey} />
      )}
    </div>
  );
}

export function AtlasRancherPodsView({ canAdmin: _canAdmin, canEdit }: Props) {
  const [clusters, setClusters] = useState<RancherCustomCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rancherConfigured, setRancherConfigured] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        state: normalizeState(c.state),
        steveCollection: c.steveCollection,
      }));
      setClusters(list);
      setRancherConfigured(data.configured !== false);
      setSelectedId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      if (data.configured === false && data.message) setError(data.message);
    } catch (e) {
      setClusters([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar los clusters.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  const filteredClusters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clusters;
    return clusters.filter((c) => {
      const hay = [
        clusterDisplayName(c),
        c.name,
        c.store,
        c.application,
        c.distro,
        c.state,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [clusters, searchQuery]);

  const selectedCluster = useMemo(
    () => clusters.find((c) => c.id === selectedId) ?? null,
    [clusters, selectedId]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Servicios en ejecución</h1>
          <p className="text-xs text-zinc-500">
            Contenedores (deployments) y pods por equipo. Actualiza imágenes con escala 0 → N.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadClusters()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cf-orange/50 bg-cf-orange/10 px-3 py-1.5 text-xs font-medium text-cf-orange hover:bg-cf-orange/20 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar clusters
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading && clusters.length === 0 ? (
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando…
        </div>
      ) : !rancherConfigured ? (
        <div className="rounded-xl border border-cf-line/70 bg-[#111418]/90 p-10 text-center text-sm text-zinc-500">
          <Server className="mx-auto mb-2 h-8 w-8 text-zinc-600" strokeWidth={1.25} />
          Configura la conexión a Rancher en Custom clusters.
        </div>
      ) : clusters.length === 0 ? (
        <div className="rounded-xl border border-cf-line/70 bg-[#111418]/90 p-10 text-center text-sm text-zinc-500">
          No hay custom clusters.
        </div>
      ) : (
        <div className="flex min-h-[min(70vh,40rem)] flex-col gap-3 overflow-hidden rounded-xl border border-cf-line/70 bg-[#111418]/90 ring-1 ring-white/[0.03] lg:flex-row">
          <div className="flex w-full shrink-0 flex-col border-b border-cf-line/50 lg:w-72 lg:border-b-0 lg:border-r">
            <div className="relative border-b border-cf-line/50 p-3">
              <Search
                className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar cluster…"
                className="w-full rounded-lg border border-cf-line bg-black/40 py-2 pl-9 pr-8 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  aria-label="Borrar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <ul className="max-h-64 flex-1 overflow-y-auto lg:max-h-none">
              {filteredClusters.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={
                        active
                          ? "w-full border-l-2 border-cf-orange bg-cf-orange/10 px-3 py-2.5 text-left"
                          : "w-full border-l-2 border-transparent px-3 py-2.5 text-left hover:bg-white/[0.03]"
                      }
                    >
                      <span className="block truncate text-sm font-medium text-zinc-200">
                        {clusterDisplayName(c)}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
                        {c.application || "—"} · <span className={stateTone(c.state)}>{c.state}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selectedCluster ? (
              !selectedCluster.application ? (
                <p className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
                  Este cluster no tiene label <span className="text-zinc-300">application</span>; no se
                  pueden listar pods.
                </p>
              ) : (
                <ClusterServicesPanel key={selectedCluster.id} cluster={selectedCluster} canEdit={canEdit} />
              )
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-zinc-500">
                <Box className="h-8 w-8 text-zinc-600" />
                <p className="text-sm">Selecciona un cluster</p>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
