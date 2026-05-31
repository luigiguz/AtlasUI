import { FolderOpen, HardDrive, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, apiUrl, bearerHeaders } from "../apiClient";
import { AtlasLoadingSplash } from "./AtlasLoadingSplash";
import { AtlasModalShell } from "./AtlasModalFrame";
import {
  SshFileTransferPanel,
  type SftpEntry,
} from "./SshFileTransferPanel";
import type {
  PvcsResponse,
  RancherCustomCluster,
  RancherPersistentVolumeClaim,
  SftpStatResponse,
} from "../rancherTypes";

type Props = {
  cluster: RancherCustomCluster;
  canEdit: boolean;
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

function TextEditorModal({
  path,
  sessionId,
  onClose,
  onSaved,
}: {
  path: string;
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ path });
        const res = await api<{ text: string }>(
          `/api/sftp/session/${encodeURIComponent(sessionId)}/read-text?${q}`,
        );
        if (!cancelled) setText(res.text ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, sessionId]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const file = new File([blob], path.split("/").pop() || "file.txt", { type: "text/plain" });
      const q = new URLSearchParams({ path });
      const url = apiUrl(`/api/sftp/session/${encodeURIComponent(sessionId)}/upload?${q}`);
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(url, {
        method: "POST",
        headers: bearerHeaders(),
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
        throw new Error(
          (typeof data.detail === "string" ? data.detail : data.message) || res.statusText,
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AtlasModalShell
      onBackdropClick={() => {
        if (!saving) onClose();
      }}
      zIndexClass="z-[70]"
      panelClassName="flex max-h-[min(90vh,42rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.08]"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-cf-line/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-100">Editar archivo</h2>
          <p className="truncate font-mono text-[10px] text-zinc-500">{path}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 disabled:opacity-40"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-[min(60vh,28rem)] w-full resize-none rounded-lg border border-cf-line/60 bg-black/40 p-3 font-mono text-xs leading-relaxed text-zinc-200 outline-none focus:border-cf-orange/40"
          />
        )}
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-cf-line/60 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5 disabled:opacity-40"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving}
          className="rounded-lg bg-cf-orange/20 px-3 py-1.5 text-xs font-medium text-cf-orange ring-1 ring-cf-orange/40 hover:bg-cf-orange/30 disabled:opacity-40"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </AtlasModalShell>
  );
}

function PermissionsModal({
  entry,
  sessionId,
  onClose,
  onSaved,
}: {
  entry: SftpEntry;
  sessionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [modeOctal, setModeOctal] = useState("");
  const [uid, setUid] = useState("");
  const [gid, setGid] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ path: entry.path });
        const stat = await api<SftpStatResponse>(
          `/api/sftp/session/${encodeURIComponent(sessionId)}/stat?${q}`,
        );
        if (cancelled) return;
        setModeOctal(stat.mode_octal.replace(/^0o/i, "") || "0644");
        setUid(stat.uid != null ? String(stat.uid) : "0");
        setGid(stat.gid != null ? String(stat.gid) : "0");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.path, sessionId]);

  async function apply() {
    setSaving(true);
    setError("");
    const qPath = new URLSearchParams({ path: entry.path });
    try {
      await api(`/api/sftp/session/${encodeURIComponent(sessionId)}/chmod?${qPath}`, {
        method: "POST",
        body: JSON.stringify({ mode_octal: modeOctal.trim() }),
      });
      const uidNum = parseInt(uid, 10);
      const gidNum = parseInt(gid, 10);
      if (!Number.isNaN(uidNum) && !Number.isNaN(gidNum)) {
        await api(`/api/sftp/session/${encodeURIComponent(sessionId)}/chown?${qPath}`, {
          method: "POST",
          body: JSON.stringify({ uid: uidNum, gid: gidNum }),
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AtlasModalShell
      onBackdropClick={() => {
        if (!saving) onClose();
      }}
      zIndexClass="z-[70]"
      panelClassName="w-full max-w-md overflow-hidden rounded-xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.08]"
    >
      <div className="border-b border-cf-line/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">Permisos</h2>
        <p className="truncate font-mono text-[10px] text-zinc-500">{entry.path}</p>
      </div>
      <div className="space-y-3 px-4 py-4">
        {loading ? (
          <p className="text-xs text-zinc-500">Cargando metadatos…</p>
        ) : (
          <>
            <label className="block text-xs text-zinc-400">
              Modo octal (chmod)
              <input
                value={modeOctal}
                onChange={(e) => setModeOctal(e.target.value)}
                className="mt-1 w-full rounded-lg border border-cf-line/60 bg-black/30 px-2 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-cf-orange/40"
                placeholder="0755"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-zinc-400">
                UID (chown)
                <input
                  value={uid}
                  onChange={(e) => setUid(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-cf-line/60 bg-black/30 px-2 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-cf-orange/40"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                GID (chown)
                <input
                  value={gid}
                  onChange={(e) => setGid(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-cf-line/60 bg-black/30 px-2 py-1.5 font-mono text-sm text-zinc-200 outline-none focus:border-cf-orange/40"
                />
              </label>
            </div>
          </>
        )}
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-cf-line/60 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-white/5"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={loading || saving}
          className="rounded-lg bg-cf-orange/20 px-3 py-1.5 text-xs font-medium text-cf-orange ring-1 ring-cf-orange/40 hover:bg-cf-orange/30 disabled:opacity-40"
        >
          {saving ? "Aplicando…" : "Aplicar"}
        </button>
      </div>
    </AtlasModalShell>
  );
}

export function PvcStoragePanel({ cluster, canEdit }: Props) {
  const [pvcs, setPvcs] = useState<RancherPersistentVolumeClaim[]>([]);
  const [sshInfo, setSshInfo] = useState<PvcsResponse["ssh"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [explorePvc, setExplorePvc] = useState<RancherPersistentVolumeClaim | null>(null);
  const [sshPassword, setSshPassword] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSite, setSessionSite] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<SftpEntry | null>(null);
  const [permTarget, setPermTarget] = useState<SftpEntry | null>(null);
  const explorerKeyRef = useRef(0);

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

  const vpnClusterName = cluster.name || cluster.displayName || "—";

  const openExplorer = useCallback(
    (pvc: RancherPersistentVolumeClaim) => {
      if (!canEdit) return;
      if (!pvc.hostPath) {
        setError("No se pudo resolver la ruta en disco de este PVC.");
        return;
      }
      if (!sshInfo?.available || !sshInfo.site) {
        setExplorePvc(pvc);
        return;
      }
      setSessionId(null);
      setExplorePvc(pvc);
      setSessionSite(sshInfo.site);
      explorerKeyRef.current += 1;
    },
    [canEdit, sshInfo],
  );

  function closeExplorer() {
    if (sessionId) {
      void api(`/api/sftp/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(
        () => {},
      );
    }
    setSessionId(null);
    setSessionSite(null);
    setExplorePvc(null);
    setEditTarget(null);
    setPermTarget(null);
  }

  const explorerStartPath = explorePvc?.hostPath ?? null;

  const sshFallbackMessage = useMemo(() => {
    if (sshInfo?.available) return null;
    return (
      sshInfo?.message ??
      "No hay túnel SSH para esta tienda. Ve a Conexiones, activa el túnel SSH del equipo y vuelve aquí."
    );
  }, [sshInfo]);

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
            PVC local-path · cluster <span className="text-zinc-300">{vpnClusterName}</span>
            {sshInfo?.site && sshInfo.site !== vpnClusterName ? (
              <>
                {" "}
                → VPN <span className="text-zinc-300">{sshInfo.site}</span>
              </>
            ) : null}
            {sshInfo?.site ? (
              <>
                {" "}
                · SSH <span className="text-emerald-400">disponible</span>
              </>
            ) : (
              <>
                {" "}
                · SSH <span className="text-amber-400">no configurado</span>
              </>
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

      {sshFallbackMessage && !explorePvc ? (
        <div className="mx-4 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          <p className="font-medium">SFTP no disponible</p>
          <p className="mt-1 text-amber-200/80">{sshFallbackMessage}</p>
          <p className="mt-2 text-[11px] text-amber-200/60">
            Fase 4 — alternativa: usa un pod de depuración con volumen montado si no puedes abrir SSH
            en el nodo.
          </p>
        </div>
      ) : null}

      {canEdit && sshInfo?.available ? (
        <div className="shrink-0 border-b border-cf-line/30 px-4 py-2">
          <label className="flex max-w-md items-center gap-2 text-[11px] text-zinc-500">
            <span className="shrink-0">Contraseña SSH</span>
            <input
              type="password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
              placeholder="Opcional si ya hay sesión en caché"
              className="min-w-0 flex-1 rounded-lg border border-cf-line/60 bg-black/30 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-cf-orange/40"
              autoComplete="current-password"
            />
          </label>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {pvcs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-zinc-500">
            <HardDrive className="h-8 w-8 text-zinc-600" strokeWidth={1.25} />
            No hay PVC en el namespace de esta tienda.
          </div>
        ) : (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky top-0 bg-[#111418]/95 text-[10px] uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-cf-line/40">
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Clase</th>
                <th className="px-3 py-2 font-medium">Capacidad</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Ruta en nodo</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-cf-line/20 text-zinc-300">
              {pvcs.map((pvc) => (
                <tr key={pvc.name} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 font-medium text-zinc-100">{pvc.name}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-400">
                    {pvc.storageClassName || "—"}
                  </td>
                  <td className="px-3 py-2.5">{pvc.capacity || "—"}</td>
                  <td className={`px-3 py-2.5 ${phaseTone(pvc.phase)}`}>{pvc.phase || "—"}</td>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 font-mono text-[10px] text-zinc-500">
                    {pvc.hostPath || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canEdit && pvc.hostPath && sshInfo?.available ? (
                      <button
                        type="button"
                        onClick={() => openExplorer(pvc)}
                        className="inline-flex items-center gap-1 rounded-md bg-cf-orange/15 px-2 py-1 text-[10px] font-medium text-cf-orange ring-1 ring-cf-orange/30 hover:bg-cf-orange/25 disabled:opacity-50"
                      >
                        <FolderOpen className="h-3 w-3" />
                        Explorar
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {explorePvc && sessionSite && explorerStartPath ? (
        <div className="flex min-h-[min(50vh,28rem)] shrink-0 flex-col border-t border-cf-line/50">
          <div className="flex shrink-0 items-center justify-between border-b border-cf-line/40 bg-black/20 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-zinc-200">
                Explorador · {explorePvc.name}
              </p>
              <p className="truncate font-mono text-[10px] text-zinc-500">{explorerStartPath}</p>
            </div>
            <button
              type="button"
              onClick={closeExplorer}
              className="rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
              aria-label="Cerrar explorador"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <SshFileTransferPanel
            key={`${explorerKeyRef.current}-${explorePvc.name}`}
            site={sessionSite}
            sshReady
            connectWithoutReady
            variant="full"
            startPath={explorerStartPath}
            sessionPassword={sshPassword}
            storageTools={canEdit}
            onSessionReady={setSessionId}
            onEditFile={(entry) => setEditTarget(entry)}
            onPermissions={(entry) => setPermTarget(entry)}
          />
        </div>
      ) : null}

      {editTarget && sessionId ? (
        <TextEditorModal
          path={editTarget.path}
          sessionId={sessionId}
          onClose={() => setEditTarget(null)}
          onSaved={() => setEditTarget(null)}
        />
      ) : null}

      {permTarget && sessionId ? (
        <PermissionsModal
          entry={permTarget}
          sessionId={sessionId}
          onClose={() => setPermTarget(null)}
          onSaved={() => setPermTarget(null)}
        />
      ) : null}
    </div>
  );
}
