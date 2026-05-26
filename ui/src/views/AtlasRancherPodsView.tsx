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

type ContainerRow = {
  serviceName: string;
  deployment: RancherDeployment | null;
  pods: RancherPod[];
};

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
  deployments,
  clusterLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  deployments: RancherDeployment[];
  clusterLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = deployments.length;
  const single = count === 1 ? deployments[0] : null;
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

        <div className="px-5 py-4">
          {single ? (
            <p className="text-sm text-zinc-300">
              Se actualizará la imagen de{" "}
              <span className="font-medium text-zinc-100">{single.name}</span>.
            </p>
          ) : (
            <>
              <p className="text-sm text-zinc-300">
                Se actualizará la imagen de{" "}
                <span className="font-medium text-zinc-100">{count} servicios</span>.
              </p>
              <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-cf-line/50 bg-black/20 px-3 py-2 text-xs text-zinc-400">
                {deployments.map((d) => (
                  <li key={d.name} className="truncate">
                    {d.name}
                  </li>
                ))}
              </ul>
            </>
          )}
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

function deploymentImageLabel(d: RancherDeployment | null): string {
  if (d?.imageTag) return d.imageTag;
  if (d?.image) {
    const tail = d.image.includes("@") ? d.image.split("@")[0] : d.image;
    return tail.split("/").pop() || d.image;
  }
  return "—";
}

function podBelongsToService(podName: string, serviceName: string): boolean {
  return podName === serviceName || podName.startsWith(`${serviceName}-`);
}

function inferServiceFromPodName(podName: string): string {
  const parts = podName.split("-");
  if (parts.length >= 3) return parts.slice(0, -2).join("-");
  return podName;
}

function buildContainerRows(deployments: RancherDeployment[], pods: RancherPod[]): ContainerRow[] {
  const usedPods = new Set<string>();
  const rows: ContainerRow[] = deployments.map((d) => {
    const matched = pods.filter((p) => podBelongsToService(p.name, d.name));
    matched.forEach((p) => usedPods.add(p.name));
    return { serviceName: d.name, deployment: d, pods: matched };
  });

  for (const p of pods) {
    if (usedPods.has(p.name)) continue;
    const serviceName = inferServiceFromPodName(p.name);
    const existing = rows.find((r) => r.serviceName === serviceName);
    if (existing) {
      existing.pods.push(p);
      usedPods.add(p.name);
    } else {
      usedPods.add(p.name);
      rows.push({ serviceName, deployment: null, pods: [p] });
    }
  }

  return rows.sort((a, b) => a.serviceName.localeCompare(b.serviceName, "es"));
}

function aggregatePodPhase(pods: RancherPod[]): string {
  if (!pods.length) return "—";
  const phases = pods.map((p) => p.phase.toLowerCase());
  if (phases.every((x) => x === "running")) return "Running";
  if (phases.some((x) => x === "failed")) return "Failed";
  if (phases.some((x) => x === "pending")) return "Pending";
  return pods[0].phase;
}

function aggregatePodField(pods: RancherPod[], pick: (p: RancherPod) => string): string {
  const values = [...new Set(pods.map(pick).filter(Boolean))];
  if (!values.length) return "—";
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
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

function ClusterContainersPanel({
  cluster,
  canEdit,
}: {
  cluster: RancherCustomCluster;
  canEdit: boolean;
}) {
  const [deployments, setDeployments] = useState<RancherDeployment[]>([]);
  const [pods, setPods] = useState<RancherPod[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rolling, setRolling] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmDeployments, setConfirmDeployments] = useState<RancherDeployment[] | null>(null);

  const containerRows = useMemo(
    () => buildContainerRows(deployments, pods),
    [deployments, pods]
  );

  const rolloutRows = useMemo(
    () => containerRows.filter((r): r is ContainerRow & { deployment: RancherDeployment } => r.deployment != null),
    [containerRows]
  );

  const allRolloutSelected =
    rolloutRows.length > 0 && rolloutRows.every((r) => selected.has(r.serviceName));
  const someRolloutSelected = rolloutRows.some((r) => selected.has(r.serviceName));

  useEffect(() => {
    const valid = new Set(rolloutRows.map((r) => r.serviceName));
    setSelected((prev) => {
      const next = new Set([...prev].filter((n) => valid.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [rolloutRows]);

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      const paths = clusterRancherPaths(cluster);
      try {
        const [depRes, podRes] = await Promise.all([
          api<DeploymentsResponse>(paths.deployments),
          api<PodsResponse>(paths.pods),
        ]);
        setDeployments(depRes.deployments ?? []);
        setPods(podRes.pods ?? []);
      } catch (e) {
        setDeployments([]);
        setPods([]);
        setError(e instanceof Error ? e.message : "No se pudieron cargar los contenedores.");
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [cluster]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadAll({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadAll]);

  function toggleRow(serviceName: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(serviceName)) next.delete(serviceName);
      else next.add(serviceName);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allRolloutSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rolloutRows.map((r) => r.serviceName)));
    }
  }

  function openRolloutConfirm(deps: RancherDeployment[]) {
    if (!canEdit || rolling || !deps.length) return;
    setConfirmDeployments(deps);
  }

  function selectedDeployments(): RancherDeployment[] {
    return rolloutRows.filter((r) => selected.has(r.serviceName)).map((r) => r.deployment);
  }

  async function executeRollouts(deps: RancherDeployment[]) {
    if (!deps.length) return;
    setRolling(true);
    setError("");
    const ns = encodeURIComponent(cluster.namespace);
    const nm = encodeURIComponent(cluster.name);
    const steve = cluster.steveCollection || "provisioning.cattle.io.customclusters";
    const failed: string[] = [];

    for (const dep of deps) {
      try {
        const depName = encodeURIComponent(dep.name);
        await api<DeploymentRolloutResponse>(
          `/api/atlas-rancher/custom-clusters/${ns}/${nm}/deployments/${depName}/rollout`,
          {
            method: "POST",
            body: JSON.stringify({ steve_collection: steve }),
          }
        );
      } catch {
        failed.push(dep.name);
      }
    }

    setConfirmDeployments(null);
    setSelected(new Set());
    await loadAll({ silent: true });

    if (failed.length === deps.length) {
      setError("No se pudo actualizar ningún servicio.");
    } else if (failed.length > 0) {
      setError(`No se pudo actualizar: ${failed.join(", ")}.`);
    }

    setRolling(false);
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 p-12 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando contenedores…
      </div>
    );
  }

  if (error && containerRows.length === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="shrink-0 border-b border-cf-line/50 px-4 py-3">
          <p className="text-sm font-medium text-zinc-200">{clusterDisplayName(cluster)}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Contenedores · namespace{" "}
            <span className="font-medium text-zinc-300">{cluster.application || "—"}</span>
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
          <p className="text-sm text-red-300">{error}</p>
          <button type="button" onClick={() => void loadAll()} className="text-xs text-cf-orange hover:underline">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-cf-line/50 px-4 py-3">
        <p className="text-sm font-medium text-zinc-200">{clusterDisplayName(cluster)}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Contenedores · namespace <span className="font-medium text-zinc-300">{cluster.application || "—"}</span>
          {cluster.store ? <span className="text-zinc-600"> · {cluster.store}</span> : null}
        </p>
      </div>

      {error ? (
        <p className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-cf-line/40 px-4 py-2 text-[11px] text-zinc-500">
        <span>
          {containerRows.length} servicio{containerRows.length !== 1 ? "s" : ""}
          {pods.length ? ` · ${pods.length} pod${pods.length !== 1 ? "s" : ""} en ejecución` : ""}
          {refreshing ? <span className="text-zinc-600"> · sincronizando…</span> : null}
        </span>
        {canEdit && selected.size > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">
              {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              disabled={rolling}
              onClick={() => openRolloutConfirm(selectedDeployments())}
              className="inline-flex items-center gap-1 rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-1 text-[11px] font-medium text-cf-orange hover:bg-cf-orange/20 disabled:opacity-50"
            >
              {rolling ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
              Actualizar imagen
            </button>
            <button
              type="button"
              disabled={rolling}
              onClick={() => setSelected(new Set())}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            >
              Quitar
            </button>
          </div>
        ) : null}
      </div>

      {containerRows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-500">No hay contenedores en este namespace.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#111418]">
              <tr className="border-b border-cf-line/50 text-[10px] uppercase tracking-wide text-zinc-600">
                {canEdit ? (
                  <th className="w-10 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={allRolloutSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someRolloutSelected && !allRolloutSelected;
                      }}
                      disabled={rolling || rolloutRows.length === 0}
                      onChange={toggleSelectAll}
                      className="h-3.5 w-3.5 rounded border-cf-line bg-black/40 accent-cf-orange"
                      aria-label="Seleccionar todos"
                    />
                  </th>
                ) : null}
                <th className="px-4 py-2">Servicio</th>
                <th className="px-4 py-2">Imagen</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Ready</th>
                <th className="px-4 py-2">Réplicas</th>
                <th className="px-4 py-2">Nodo</th>
                <th className="px-4 py-2">Reinicios</th>
                <th className="px-4 py-2">IP</th>
                {canEdit ? <th className="px-4 py-2">Acción</th> : null}
              </tr>
            </thead>
            <tbody>
              {containerRows.map((row) => {
                const d = row.deployment;
                const phase = aggregatePodPhase(row.pods);
                const ready =
                  d != null
                    ? `${d.readyReplicas}/${d.replicas}`
                    : row.pods[0]?.ready ?? "—";
                const replicas = d?.replicas ?? row.pods.length;
                const restarts = row.pods.reduce((n, p) => n + p.restarts, 0);
                const node = aggregatePodField(row.pods, (p) => p.node);
                const ip = aggregatePodField(row.pods, (p) => p.podIP);
                const imgTitle =
                  d?.images?.length ? d.images.join("\n") : d?.image || row.pods.map((p) => p.name).join("\n");
                const canRollout = canEdit && d != null;
                const isSelected = selected.has(row.serviceName);

                return (
                  <tr
                    key={row.serviceName}
                    className={
                      isSelected
                        ? "border-b border-cf-line/30 bg-cf-orange/[0.04] last:border-0"
                        : "border-b border-cf-line/30 last:border-0"
                    }
                  >
                    {canEdit ? (
                      <td className="px-2 py-2.5">
                        {canRollout ? (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={rolling}
                            onChange={() => toggleRow(row.serviceName)}
                            className="h-3.5 w-3.5 rounded border-cf-line bg-black/40 accent-cf-orange"
                            aria-label={`Seleccionar ${row.serviceName}`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5 font-medium text-zinc-200">{row.serviceName}</td>
                    <td
                      className="max-w-[200px] truncate px-4 py-2.5 font-mono text-[11px] text-zinc-400"
                      title={imgTitle}
                    >
                      {deploymentImageLabel(d)}
                    </td>
                    <td className={`px-4 py-2.5 ${podPhaseTone(phase)}`}>{phase}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{ready}</td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-400">{replicas}</td>
                    <td className="max-w-[120px] truncate px-4 py-2.5 text-zinc-500" title={node}>
                      {node}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-zinc-400">{restarts || "—"}</td>
                    <td
                      className="max-w-[120px] truncate px-4 py-2.5 font-mono text-[11px] text-zinc-500"
                      title={ip}
                    >
                      {ip}
                    </td>
                    {canEdit ? (
                      <td className="px-4 py-2.5">
                        {canRollout ? (
                          <button
                            type="button"
                            disabled={rolling}
                            onClick={() => openRolloutConfirm([d])}
                            className="inline-flex items-center gap-1 rounded border border-cf-orange/40 bg-cf-orange/10 px-2 py-1 text-[11px] font-medium text-cf-orange hover:bg-cf-orange/20 disabled:opacity-50"
                          >
                            {rolling ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                            Actualizar
                          </button>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between border-t border-cf-line/40 px-4 py-2 text-[11px] text-zinc-600">
        <span>Actualización automática cada {AUTO_REFRESH_MS / 1000}s</span>
        <button
          type="button"
          onClick={() => void loadAll({ silent: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-cf-orange disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualizar
        </button>
      </div>

      <AnimatePresence>
        {confirmDeployments?.length ? (
          <RolloutConfirmModal
            deployments={confirmDeployments}
            clusterLabel={clusterDisplayName(cluster)}
            busy={rolling}
            onCancel={() => {
              if (!rolling) setConfirmDeployments(null);
            }}
            onConfirm={() => void executeRollouts(confirmDeployments)}
          />
        ) : null}
      </AnimatePresence>
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
          <h1 className="text-lg font-semibold text-zinc-100">Contenedores</h1>
          <p className="text-xs text-zinc-500">
            Servicios del namespace por equipo: estado, réplicas y actualización de imagen.
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
                <ClusterContainersPanel key={selectedCluster.id} cluster={selectedCluster} canEdit={canEdit} />
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
