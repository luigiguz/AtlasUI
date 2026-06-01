import { FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../apiClient";
import { AtlasLoadingSplash } from "./AtlasLoadingSplash";
import type { OpenPvcVolumeSessionOpts } from "../WebSshSessionsDock";
import type { PvcsResponse, RancherCustomCluster, RancherPersistentVolumeClaim } from "../rancherTypes";

type Props = {
  cluster: RancherCustomCluster;
  canEdit: boolean;
  onOpenVolumeTerminal?: (opts: OpenPvcVolumeSessionOpts) => void;
};

function clusterPvcsPath(cluster: RancherCustomCluster): string {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  const steve = encodeURIComponent(cluster.steveCollection || "provisioning.cattle.io.customclusters");
  const storeLabel = cluster.store ? `&store=${encodeURIComponent(cluster.store)}` : "";
  return `/api/atlas-rancher/custom-clusters/${ns}/${nm}/pvcs?steve_collection=${steve}${storeLabel}`;
}

function phaseTone(phase: string): string {
  const p = phase.toLowerCase();
  if (p === "bound") return "text-emerald-400";
  if (p === "pending") return "text-amber-400";
  if (p === "lost") return "text-red-400";
  return "text-zinc-400";
}

export function PvcStoragePanel({ cluster, canEdit, onOpenVolumeTerminal }: Props) {
  const [pvcs, setPvcs] = useState<RancherPersistentVolumeClaim[]>([]);
  const [sshInfo, setSshInfo] = useState<PvcsResponse["ssh"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadPvcs = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const res = await api<PvcsResponse>(clusterPvcsPath(cluster));
        setPvcs(res.pvcs ?? []);
        setSshInfo(res.ssh ?? null);
      } catch (e) {
        setPvcs([]);
        setSshInfo(null);
        setError(e instanceof Error ? e.message : "No se pudieron cargar los volúmenes.");
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [cluster],
  );

  useEffect(() => {
    void loadPvcs();
  }, [loadPvcs]);

  const vpnTunnelLabel = sshInfo?.tunnelName || sshInfo?.site || cluster.name || cluster.displayName || "—";
  const sshReady = Boolean(sshInfo?.available && sshInfo.site);

  const sshHint = useMemo(() => {
    if (sshReady) return "Túnel SSH activo — abre el explorador del volumen";
    if (sshInfo?.message) return sshInfo.message;
    return "Espera a que el túnel SSH del equipo esté activo (atlas-tunnels).";
  }, [sshReady, sshInfo?.message]);

  const openVolume = useCallback(
    (pvc: RancherPersistentVolumeClaim) => {
      if (!canEdit || !onOpenVolumeTerminal || !sshInfo?.site || !pvc.hostPath) return;
      onOpenVolumeTerminal({
        site: sshInfo.site,
        pvcName: pvc.name,
        startPath: pvc.hostPath,
        tunnelLabel: vpnTunnelLabel,
      });
    },
    [canEdit, onOpenVolumeTerminal, sshInfo?.site, vpnTunnelLabel],
  );

  if (loading) {
    return (
      <AtlasLoadingSplash
        className="min-h-0 flex-1"
        message="Cargando volúmenes…"
        minHeight="min-h-[min(50vh,24rem)]"
      />
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-cf-line/40 px-4 py-2.5">
        <div>
          <p className="text-sm font-medium text-zinc-200">Volúmenes persistentes</p>
          <p className="text-[11px] text-zinc-500">
            PVC local-path · túnel{" "}
            <span className="text-zinc-300">{vpnTunnelLabel}</span>
            {" · "}
            {sshReady ? (
              <span className="text-emerald-400">SSH disponible</span>
            ) : (
              <span className="text-amber-400">SSH no listo</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPvcs(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-lg border border-cf-line/60 px-2 py-1 text-[11px] text-zinc-400 hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {error ? (
        <p className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      {!sshReady ? (
        <div className="mx-4 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          <p className="font-medium">Explorador no disponible aún</p>
          <p className="mt-1 text-amber-200/80">{sshHint}</p>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {pvcs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-zinc-500">
            <HardDrive className="h-8 w-8 text-zinc-600" strokeWidth={1.25} />
            No hay PVC en el namespace de esta tienda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/60 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Nombre</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Clase</th>
                  <th className="px-4 py-3 font-medium">Capacidad</th>
                  {canEdit ? (
                    <th className="px-4 py-3 text-right font-medium">Acción</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pvcs.map((pvc) => {
                  const canOpen = Boolean(
                    canEdit && pvc.hostPath && sshReady && onOpenVolumeTerminal,
                  );
                  return (
                    <tr
                      key={pvc.name}
                      className="border-b border-cf-line/40 hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-zinc-100">{pvc.name}</span>
                      </td>
                      <td className={`px-4 py-3 ${phaseTone(pvc.phase)}`}>{pvc.phase || "—"}</td>
                      <td className="px-4 py-3 text-zinc-400">{pvc.storageClassName || "—"}</td>
                      <td className="px-4 py-3 tabular-nums text-zinc-400">{pvc.capacity || "—"}</td>
                      {canEdit ? (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={!canOpen}
                            title={
                              canOpen
                                ? "Abrir explorador del volumen"
                                : !pvc.hostPath
                                  ? "Sin ruta en el nodo"
                                  : sshHint
                            }
                            onClick={() => canOpen && openVolume(pvc)}
                            className={
                              canOpen
                                ? "inline-flex items-center gap-1.5 rounded-lg bg-cf-orange px-3 py-1.5 text-xs font-semibold text-black shadow-sm hover:bg-cf-orange/90"
                                : "inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg bg-zinc-800/80 px-3 py-1.5 text-xs font-medium text-zinc-500 ring-1 ring-zinc-700"
                            }
                          >
                            <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                            Abrir volumen
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
