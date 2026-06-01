import { FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
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
            {sshInfo?.site && sshInfo.site !== vpnTunnelLabel ? (
              <span className="font-mono text-[10px] text-zinc-600"> ({sshInfo.site})</span>
            ) : null}
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

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {pvcs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-zinc-500">
            <HardDrive className="h-8 w-8 text-zinc-600" strokeWidth={1.25} />
            No hay PVC en el namespace de esta tienda.
          </div>
        ) : (
          <div className="grid auto-rows-min gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pvcs.map((pvc) => {
              const canOpen = Boolean(canEdit && pvc.hostPath && sshReady && onOpenVolumeTerminal);
              return (
                <motion.div
                  key={pvc.name}
                  layout
                  className="flex flex-col overflow-hidden rounded-2xl border border-cf-line bg-cf-card/90 ring-1 ring-transparent hover:border-zinc-600 hover:bg-cf-card"
                >
                  <div className="flex items-start gap-3 p-4">
                    <div
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                        sshReady ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]" : "bg-zinc-600"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold tracking-tight text-zinc-100">{pvc.name}</p>
                      <p className={`mt-1 text-[11px] ${phaseTone(pvc.phase)}`}>{pvc.phase || "—"}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {pvc.storageClassName || "—"} · {pvc.capacity || "—"}
                      </p>
                      {pvc.hostPath ? (
                        <p
                          className="mt-2 truncate font-mono text-[10px] text-zinc-600"
                          title={pvc.hostPath}
                        >
                          {pvc.hostPath}
                        </p>
                      ) : (
                        <p className="mt-2 text-[10px] text-amber-400/90">Sin ruta en nodo</p>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-white/5 px-4 py-3">
                    {canEdit ? (
                      <motion.button
                        type="button"
                        whileHover={canOpen ? { scale: 1.02 } : undefined}
                        whileTap={canOpen ? { scale: 0.98 } : undefined}
                        disabled={!canOpen}
                        title={
                          canOpen
                            ? "Explorador del PVC a pantalla completa"
                            : !pvc.hostPath
                              ? "Falta ruta hostPath del PVC"
                              : sshHint
                        }
                        onClick={() => canOpen && openVolume(pvc)}
                        className={
                          canOpen
                            ? "flex w-full items-center justify-center gap-2 rounded-lg bg-cf-orange px-3 py-2 text-xs font-semibold text-black shadow-md sm:text-sm"
                            : "flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-zinc-800/80 px-3 py-2 text-xs font-medium text-zinc-500 ring-1 ring-zinc-700 sm:text-sm"
                        }
                      >
                        <FolderOpen className="h-4 w-4" />
                        Abrir volumen
                      </motion.button>
                    ) : (
                      <p className="text-center text-xs text-zinc-500">Solo lectura</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {canEdit && sshReady ? (
        <p className="shrink-0 border-t border-cf-line/40 px-4 py-2 text-[10px] text-zinc-600">
          El panel inferior pide la contraseña SSH en la terminal (como Conexiones) si hace falta; después abre
          el explorador SFTP del PVC a pantalla completa.
        </p>
      ) : null}
    </div>
  );
}
