import { motion } from "framer-motion";
import { Loader2, Plus, RefreshCw, Save, Server, Store, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "../apiClient";
import type { ClustersResponse, RancherCustomCluster } from "../rancherTypes";
import type {
  StoreCreatePreview,
  StoreCreatePreviewResponse,
  StoreDetail,
  StoreSummary,
  StoreTemplateInfo,
  StoreTemplatesResponse,
  StoreWorkerGroup,
  StoreWorkerToggle,
  StoresListResponse,
} from "../storeTypes";

type Props = {
  canAdmin: boolean;
  canEdit: boolean;
};

type SettingsResponse = {
  repo_url: string;
  branch: string;
  git_token: string;
  auto_pull: boolean;
  auto_push: boolean;
  configured: boolean;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cf-orange/50";

function distroLabel(d: string): string {
  if (d === "horustech") return "Horustech";
  if (d === "pam") return "PAM";
  return d || "—";
}

function workerGroupsFromStation(station: StoreDetail["station"]): StoreWorkerGroup[] {
  const grouped = station.workerGroups?.groups;
  if (grouped?.length) return grouped;
  const flat = station.workers ?? [];
  const general: StoreWorkerToggle[] = [];
  const ierp: StoreWorkerToggle[] = [];
  for (const w of flat) {
    if (w.key === "ierp" || w.key.startsWith("ierp.")) ierp.push(w);
    else general.push(w);
  }
  const out: StoreWorkerGroup[] = [];
  if (general.length) out.push({ id: "general", label: "Procesos generales", workers: general });
  if (ierp.length) out.push({ id: "ierp", label: "iERP", workers: ierp });
  return out;
}

function flattenWorkerGroups(groups: StoreWorkerGroup[]): StoreWorkerToggle[] {
  return groups.flatMap((g) => g.workers);
}

function updateWorkerInGroups(
  groups: StoreWorkerGroup[],
  workerKey: string,
  patch: Partial<StoreWorkerToggle>
): StoreWorkerGroup[] {
  return groups.map((g) => ({
    ...g,
    workers: g.workers.map((w) => (w.key === workerKey ? { ...w, ...patch } : w)),
  }));
}

function workerDisplayName(key: string, groupId: string): string {
  if (groupId === "ierp" && key.startsWith("ierp.")) return key.slice(5);
  return key;
}

function applyTagToAllComponents(detail: StoreDetail, tag: string): StoreDetail {
  if (!detail.station) return { ...detail, imageChannel: tag };
  const groups = workerGroupsFromStation(detail.station).map((g) => ({
    ...g,
    workers: g.workers.map((w) => ({ ...w, tag })),
  }));
  return {
    ...detail,
    imageChannel: tag,
    station: {
      ...detail.station,
      services: (detail.station.services ?? []).map((s) => ({ ...s, tag })),
      workerGroups: { groups },
      workers: flattenWorkerGroups(groups),
    },
  };
}

const tagInputClass =
  "w-28 min-w-0 rounded border border-cf-line bg-black/50 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-cf-orange/50";

export function AtlasStoresView({ canAdmin, canEdit }: Props) {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [equipment, setEquipment] = useState<RancherCustomCluster | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const [cfgUrl, setCfgUrl] = useState("");
  const [cfgBranch, setCfgBranch] = useState("main");
  const [cfgToken, setCfgToken] = useState("");
  const [cfgAutoPull, setCfgAutoPull] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);

  const [newFolder, setNewFolder] = useState("");
  const [newStoreId, setNewStoreId] = useState("");
  const [newDistro, setNewDistro] = useState<"horustech" | "pam">("horustech");
  const [bulkTag, setBulkTag] = useState("stable");
  const [newChannel, setNewChannel] = useState("stable");
  const [createError, setCreateError] = useState("");
  const [equipmentCheck, setEquipmentCheck] = useState<RancherCustomCluster | null>(null);
  const [equipmentChecking, setEquipmentChecking] = useState(false);
  const [storeTemplates, setStoreTemplates] = useState<StoreTemplateInfo[]>([]);
  const [createStep, setCreateStep] = useState<"form" | "review">("form");
  const [createPreview, setCreatePreview] = useState<StoreCreatePreview | null>(null);
  const [createPreviewBranch, setCreatePreviewBranch] = useState("main");
  const [createCommitMessage, setCreateCommitMessage] = useState("");
  const [createPreviewLoading, setCreatePreviewLoading] = useState(false);
  const [createPublishing, setCreatePublishing] = useState(false);

  const createTemplateHint = useMemo(() => {
    const stack = newDistro === "pam" ? "pam" : "horustech";
    const tpl = storeTemplates.find((t) => t.distro === newDistro);
    const dbTpl = storeTemplates.find((t) => t.distro === "db");
    if (tpl && !tpl.available) {
      return `Falta la plantilla ${tpl.templatePath} en el repositorio. Sincroniza Git o revisa la rama.`;
    }
    const stationPath = tpl?.templatePath ?? `templates/poslite/${stack}/fleet.yaml`;
    let dbPath = dbTpl?.primaryTemplatePath ?? "templates/poslite/db/fleet.yaml";
    if (dbTpl?.source === "reference") {
      dbPath = `${dbTpl.templatePath} (referencia; falta ${dbTpl.primaryTemplatePath})`;
    } else if (dbTpl?.source === "builtin" || (dbTpl && !dbTpl.available)) {
      dbPath = "plantilla mínima integrada (sin db en el repo)";
    } else if (dbTpl?.available) {
      dbPath = dbTpl.templatePath;
    }
    return `Se copiará ${stationPath} y ${dbPath}, sustituyendo <id-tienda> y <tag-imagen> (${newChannel}).`;
  }, [newDistro, newChannel, storeTemplates]);

  const loadStores = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<StoresListResponse>("/api/atlas-stores/stores");
      setStores(data.stores ?? []);
      setConfigured(data.configured !== false);
      setRepoUrl(data.repoUrl ?? "");
      if (data.configured === false && data.message) setMessage(data.message);
      else setMessage("");
    } catch (e) {
      setStores([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar las tiendas.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (folder: string) => {
    setDetailLoading(true);
    setSaveMsg("");
    try {
      const r = await api<{ ok: boolean; store: StoreDetail }>(
        `/api/atlas-stores/stores/${encodeURIComponent(folder)}`
      );
      setDetail(r.store);
      setBulkTag(r.store.imageChannel && r.store.imageChannel !== "varios" ? r.store.imageChannel : "stable");
      setSelectedFolder(folder);

      try {
        const clusters = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
        const match = (clusters.clusters ?? []).find(
          (c) => (c.store || "").toLowerCase() === (r.store.id || "").toLowerCase()
        );
        setEquipment(match ?? null);
      } catch {
        setEquipment(null);
      }
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : "No se pudo cargar la tienda.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  useEffect(() => {
    if (!canAdmin || !settingsOpen) return;
    void (async () => {
      try {
        const s = await api<SettingsResponse>("/api/atlas-stores/settings");
        setCfgUrl(s.repo_url ?? "");
        setCfgBranch(s.branch ?? "main");
        setCfgAutoPull(Boolean(s.auto_pull));
        setCfgToken("");
      } catch {
        /* ignore */
      }
    })();
  }, [canAdmin, settingsOpen]);

  async function onSaveSettings(e: FormEvent) {
    e.preventDefault();
    setCfgSaving(true);
    try {
      await api("/api/atlas-stores/settings", {
        method: "POST",
        body: JSON.stringify({
          repo_url: cfgUrl.trim(),
          branch: cfgBranch.trim(),
          git_token: cfgToken.trim(),
          auto_pull: cfgAutoPull,
          auto_push: true,
        }),
      });
      setSettingsOpen(false);
      await loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar conexión.");
    } finally {
      setCfgSaving(false);
    }
  }

  async function onSync() {
    setSyncing(true);
    try {
      const r = await api<{ message: string }>("/api/atlas-stores/sync", { method: "POST" });
      setSaveMsg(r.message ?? "Repositorio actualizado.");
      await loadStores();
      if (selectedFolder) await loadDetail(selectedFolder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  async function onSaveDetail() {
    if (!detail || !selectedFolder || !canEdit) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const r = await api<{ publishMessage?: string; store: StoreDetail }>(
        `/api/atlas-stores/stores/${encodeURIComponent(selectedFolder)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            id: detail.id,
            distro: detail.distro,
            db: detail.db,
            station: {
              stack: detail.station?.stack,
              config: detail.station?.config,
              services: detail.station?.services,
              workers: flattenWorkerGroups(workerGroupsFromStation(detail.station)),
            },
            commit_message: `Atlas: configuración tienda ${detail.id}`,
          }),
        }
      );
      setDetail(r.store);
      setSaveMsg(r.publishMessage ?? "Cambios guardados.");
      await loadStores();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  const resolveNewStoreId = useCallback(
    () => (newStoreId.trim() || newFolder.trim()).trim(),
    [newStoreId, newFolder]
  );

  const checkEquipmentForNewStore = useCallback(async (): Promise<RancherCustomCluster | null> => {
    const sid = resolveNewStoreId();
    if (!sid) {
      setEquipmentCheck(null);
      setCreateError("");
      return null;
    }
    setEquipmentChecking(true);
    setCreateError("");
    try {
      const clusters = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
      const want = newDistro.toLowerCase();
      const match = (clusters.clusters ?? []).find((c) => {
        if ((c.store || "").trim().toLowerCase() !== sid.toLowerCase()) return false;
        const d = (c.distro || "").trim().toLowerCase();
        return d === want;
      });
      if (!match) {
        const anyStore = (clusters.clusters ?? []).some(
          (c) => (c.store || "").trim().toLowerCase() === sid.toLowerCase()
        );
        setEquipmentCheck(null);
        setCreateError(
          anyStore
            ? `Hay un equipo para «${sid}», pero con otra distribución. Ajusta etiquetas en Equipos o cambia la distribución aquí.`
            : `No hay equipo en Rancher con tienda «${sid}». Créalo primero en Equipos con etiqueta store.`
        );
        return null;
      }
      setEquipmentCheck(match);
      setCreateError("");
      return match;
    } catch {
      setEquipmentCheck(null);
      setCreateError("No se pudo verificar el equipo en Rancher.");
      return null;
    } finally {
      setEquipmentChecking(false);
    }
  }, [resolveNewStoreId, newDistro]);

  useEffect(() => {
    if (!createOpen) return;
    const t = window.setTimeout(() => void checkEquipmentForNewStore(), 400);
    return () => window.clearTimeout(t);
  }, [createOpen, checkEquipmentForNewStore]);

  useEffect(() => {
    if (!createOpen || !configured) return;
    void (async () => {
      try {
        const r = await api<StoreTemplatesResponse>("/api/atlas-stores/store-templates");
        setStoreTemplates(r.templates ?? []);
      } catch {
        setStoreTemplates([]);
      }
    })();
  }, [createOpen, configured]);

  function resetCreateModal() {
    setCreateOpen(false);
    setCreateStep("form");
    setCreatePreview(null);
    setCreateCommitMessage("");
    setCreateError("");
    setEquipmentCheck(null);
  }

  async function onReviewCreate(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const sid = resolveNewStoreId();
    if (!sid) {
      setCreateError("Indica el código de tienda.");
      return;
    }
    const eq = equipmentCheck ?? (await checkEquipmentForNewStore());
    if (!eq) return;
    setCreateError("");
    setCreatePreviewLoading(true);
    try {
      const r = await api<StoreCreatePreviewResponse>("/api/atlas-stores/stores/preview", {
        method: "POST",
        body: JSON.stringify({
          folder_name: newFolder.trim() || sid,
          store_id: sid,
          distro: newDistro,
          image_channel: newChannel,
        }),
      });
      setCreatePreview(r.preview);
      setCreatePreviewBranch(r.branch || "main");
      setCreateCommitMessage(r.suggestedCommitMessage ?? "");
      setCreateStep("review");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo generar el resumen.");
    } finally {
      setCreatePreviewLoading(false);
    }
  }

  async function onConfirmCreate() {
    if (!canEdit || !createPreview?.canPublish) return;
    const sid = createPreview.storeId;
    setCreatePublishing(true);
    setCreateError("");
    try {
      const r = await api<{ publishMessage?: string; store: StoreDetail }>("/api/atlas-stores/stores", {
        method: "POST",
        body: JSON.stringify({
          folder_name: createPreview.folderName,
          store_id: sid,
          distro: newDistro,
          image_channel: newChannel,
        }),
      });
      resetCreateModal();
      setSaveMsg(r.publishMessage ?? "Tienda creada.");
      await loadStores();
      await loadDetail(r.store.folderName);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo publicar la tienda.");
    } finally {
      setCreatePublishing(false);
    }
  }

  const sortedStores = useMemo(
    () => [...stores].sort((a, b) => a.id.localeCompare(b.id, "es")),
    [stores]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Gestión de Tiendas</h1>
          <p className="text-xs text-zinc-500">
            Configura qué software se despliega en cada tienda. Al publicar, se actualiza el repositorio y el
            despliegue automático lo aplica en el equipo.
          </p>
          {repoUrl ? <p className="mt-1 truncate text-[11px] text-zinc-600">{repoUrl}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdmin ? (
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="rounded-lg border border-cf-line bg-cf-panel px-3 py-1.5 text-xs text-zinc-300"
            >
              {settingsOpen ? "Cerrar conexión" : "Conexión repositorio"}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => void onSync()}
              disabled={syncing || !configured}
              className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-3 py-1.5 text-xs text-zinc-400 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sincronizar repo
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => {
                setCreateStep("form");
                setCreatePreview(null);
                setCreateError("");
                setCreateOpen(true);
              }}
              disabled={!configured}
              className="inline-flex items-center gap-1 rounded-lg bg-cf-orange/15 px-3 py-1.5 text-xs font-medium text-cf-orange disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Nueva tienda
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void loadStores()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-cf-orange/50 bg-cf-orange/10 px-3 py-1.5 text-xs text-cf-orange"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Actualizar
          </button>
        </div>
      </div>

      {canAdmin && settingsOpen ? (
        <form onSubmit={(e) => void onSaveSettings(e)} className="rounded-xl border border-cf-line/80 bg-cf-panel/80 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Repositorio atlas-stores</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-400 sm:col-span-2">
              URL Git
              <input
                value={cfgUrl}
                onChange={(e) => setCfgUrl(e.target.value)}
                className={inputClass}
                placeholder="https://aspconsulting.visualstudio.com/Atlas/_git/atlas-stores"
                required
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Rama
              <input value={cfgBranch} onChange={(e) => setCfgBranch(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs text-zinc-400">
              Token Git (opcional)
              <input type="password" value={cfgToken} onChange={(e) => setCfgToken(e.target.value)} className={inputClass} placeholder="Dejar vacío para no cambiar" />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={cfgAutoPull} onChange={(e) => setCfgAutoPull(e.target.checked)} />
            Actualizar al leer (pull)
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Al crear o guardar una tienda, Atlas hace commit y push a la rama configurada en el remoto (GitHub, Azure DevOps,
            etc.). El clon en el servidor API solo es un workspace temporal; la fuente de verdad es el repositorio Git.
          </p>
          <button type="submit" disabled={cfgSaving} className="mt-3 rounded-lg bg-cf-orange px-4 py-2 text-xs font-medium text-black disabled:opacity-50">
            {cfgSaving ? "Guardando…" : "Guardar conexión"}
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}
      {message && !configured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{message}</div>
      ) : null}
      {saveMsg ? <p className="text-xs text-zinc-400">{saveMsg}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="overflow-hidden rounded-xl border border-cf-line/70 bg-[#111418]/90">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando tiendas…
            </div>
          ) : sortedStores.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              <Store className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
              No hay tiendas en el repositorio.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/50 text-xs uppercase text-zinc-500">
                  <th className="px-4 py-3">Tienda</th>
                  <th className="px-4 py-3">Distribución</th>
                  <th className="px-4 py-3">Tag (versión)</th>
                </tr>
              </thead>
              <tbody>
                {sortedStores.map((s) => (
                  <tr
                    key={s.folderName}
                    onClick={() => void loadDetail(s.folderName)}
                    className={
                      selectedFolder === s.folderName
                        ? "cursor-pointer border-b border-cf-line/30 bg-cf-orange/10"
                        : "cursor-pointer border-b border-cf-line/30 hover:bg-white/[0.02]"
                    }
                  >
                    <td className="px-4 py-3 font-medium text-zinc-200">{s.id}</td>
                    <td className="px-4 py-3 text-zinc-400">{distroLabel(s.distro)}</td>
                    <td className="px-4 py-3 text-zinc-500" title="Resumen; cada servicio puede tener otro tag en la ficha">
                      {s.imageChannel || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="min-h-[20rem] rounded-xl border border-cf-line/70 bg-[#111418]/90 p-4">
          {!selectedFolder ? (
            <p className="py-12 text-center text-sm text-zinc-500">Selecciona una tienda para ver y editar su configuración.</p>
          ) : detailLoading || !detail ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando ficha…
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-zinc-100">{detail.id}</h2>
                  <p className="text-xs text-zinc-500">
                    Carpeta: {detail.folderName} · Stacks: {detail.stacks.join(", ")}
                  </p>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void onSaveDetail()}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-lg bg-cf-orange px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Publicar cambios
                  </button>
                ) : null}
              </div>

              <section>
                <h3 className="text-xs font-medium uppercase text-zinc-500">Equipo vinculado</h3>
                {equipment ? (
                  <p className="mt-1 text-sm text-zinc-300">
                    <Server className="mr-1 inline h-3.5 w-3.5" />
                    {equipment.displayName || equipment.name} —{" "}
                    <span className={equipment.state?.toLowerCase().includes("ready") ? "text-emerald-400" : "text-zinc-400"}>
                      {equipment.state}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-amber-400/90">
                    No hay equipo en Rancher con código de tienda «{detail.id}». Revisa etiquetas en Equipos.
                  </p>
                )}
                <p className="mt-1 text-[11px] text-zinc-600">
                  Etiquetas requeridas: atlas=true, store={detail.id}, application=poslite
                  {detail.distro ? `, distro=${detail.distro}` : ""}
                </p>
              </section>

              <section>
                <h3 className="text-xs font-medium uppercase text-zinc-500">General</h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="text-xs text-zinc-500">
                    Código de tienda
                    <input
                      value={detail.id}
                      onChange={(e) => setDetail({ ...detail, id: e.target.value })}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-zinc-500">Tag (versión) por componente</p>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      Cada servicio y proceso puede llevar un tag distinto (p. ej.{" "}
                      <span className="text-zinc-400">stable</span>,{" "}
                      <span className="text-zinc-400">unstable</span>,{" "}
                      <span className="text-zinc-400">v1.49.0-noble</span>). Edítalos abajo.
                    </p>
                    {canEdit ? (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-zinc-600">
                          Aplicar el mismo tag a todos
                          <input
                            value={bulkTag}
                            onChange={(e) => setBulkTag(e.target.value)}
                            className={`${inputClass} mt-0.5 max-w-[12rem]`}
                            placeholder="stable, unstable…"
                            list="atlas-store-tag-suggestions"
                          />
                          <datalist id="atlas-store-tag-suggestions">
                            <option value="stable" />
                            <option value="unstable" />
                          </datalist>
                        </label>
                        <button
                          type="button"
                          onClick={() => setDetail((d) => (d ? applyTagToAllComponents(d, bulkTag.trim()) : d))}
                          className="rounded-lg border border-cf-line px-2.5 py-1.5 text-[11px] text-zinc-300 hover:border-cf-orange/40"
                        >
                          Aplicar a todos
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              {detail.db ? (
                <section>
                  <h3 className="text-xs font-medium uppercase text-zinc-500">Base de datos</h3>
                  <label className="mt-2 flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={Boolean(detail.db.pgadminEnabled)}
                      onChange={(e) =>
                        setDetail({ ...detail, db: { ...detail.db, pgadminEnabled: e.target.checked } })
                      }
                      disabled={!canEdit}
                    />
                    PgAdmin activo
                  </label>
                  <label className="mt-2 block text-xs text-zinc-500">
                    Tamaño disco
                    <input
                      value={detail.db.size ?? ""}
                      onChange={(e) => setDetail({ ...detail, db: { ...detail.db, size: e.target.value } })}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </label>
                </section>
              ) : null}

              {detail.station?.services?.length ? (
                <section>
                  <h3 className="text-xs font-medium uppercase text-zinc-500">Servicios de estación</h3>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded border border-cf-line/40">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#111418] text-[10px] uppercase text-zinc-600">
                        <tr>
                          <th className="px-2 py-1.5 w-8" />
                          <th className="px-2 py-1.5">Servicio</th>
                          <th className="px-2 py-1.5">Tag (versión)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.station.services.map((svc) => (
                          <tr key={svc.key} className="border-t border-cf-line/30">
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={svc.enabled}
                                onChange={(e) => {
                                  const services = detail.station.services.map((s) =>
                                    s.key === svc.key ? { ...s, enabled: e.target.checked } : s
                                  );
                                  setDetail({ ...detail, station: { ...detail.station, services } });
                                }}
                                disabled={!canEdit}
                                aria-label={`Activar ${svc.key}`}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-zinc-300">
                              {svc.key}
                              {svc.hostPort != null ? (
                                <span className="text-zinc-600">:{svc.hostPort}</span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                value={svc.tag}
                                onChange={(e) => {
                                  const services = detail.station.services.map((s) =>
                                    s.key === svc.key ? { ...s, tag: e.target.value } : s
                                  );
                                  setDetail({ ...detail, station: { ...detail.station, services } });
                                }}
                                className={tagInputClass}
                                disabled={!canEdit}
                                placeholder="tag"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {workerGroupsFromStation(detail.station).map((group) => (
                <section key={group.id}>
                  <h3 className="text-xs font-medium uppercase text-zinc-500">{group.label}</h3>
                  {group.id === "ierp" ? (
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      Integración iERP: cada fila es un proceso de sincronización.
                    </p>
                  ) : null}
                  <div className="mt-2 max-h-44 overflow-y-auto rounded border border-cf-line/40">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-[#111418] text-[10px] uppercase text-zinc-600">
                        <tr>
                          <th className="w-8 px-2 py-1.5" />
                          <th className="px-2 py-1.5">Proceso</th>
                          <th className="px-2 py-1.5">Tag (versión)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.workers.map((wrk) => (
                          <tr key={wrk.key} className="border-t border-cf-line/30">
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={wrk.enabled}
                                onChange={(e) => {
                                  const groups = updateWorkerInGroups(
                                    workerGroupsFromStation(detail.station),
                                    wrk.key,
                                    { enabled: e.target.checked }
                                  );
                                  setDetail({
                                    ...detail,
                                    station: {
                                      ...detail.station,
                                      workerGroups: { groups },
                                      workers: flattenWorkerGroups(groups),
                                    },
                                  });
                                }}
                                disabled={!canEdit}
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono text-[11px] text-zinc-400">
                              {workerDisplayName(wrk.key, group.id)}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                value={wrk.tag}
                                onChange={(e) => {
                                  const groups = updateWorkerInGroups(
                                    workerGroupsFromStation(detail.station),
                                    wrk.key,
                                    { tag: e.target.value }
                                  );
                                  setDetail({
                                    ...detail,
                                    station: {
                                      ...detail.station,
                                      workerGroups: { groups },
                                      workers: flattenWorkerGroups(groups),
                                    },
                                  });
                                }}
                                className={tagInputClass}
                                disabled={!canEdit}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              {detail.station?.config && Object.keys(detail.station.config).length > 0 ? (
                <section>
                  <h3 className="text-xs font-medium uppercase text-zinc-500">Conexión on-prem</h3>
                  <div className="mt-2 grid gap-2">
                    {Object.entries(detail.station.config as Record<string, unknown>)
                      .filter(([, v]) => typeof v === "string" || typeof v === "number")
                      .map(([key, val]) => (
                        <label key={key} className="text-xs text-zinc-500">
                          {key}
                          <input
                            value={String(val ?? "")}
                            onChange={(e) =>
                              setDetail({
                                ...detail,
                                station: {
                                  ...detail.station,
                                  config: { ...detail.station.config, [key]: e.target.value },
                                },
                              })
                            }
                            className={inputClass}
                            disabled={!canEdit}
                          />
                        </label>
                      ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => resetCreateModal()}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full rounded-xl border border-cf-line bg-[#111418] p-5 ${createStep === "review" ? "max-w-2xl max-h-[90vh] overflow-y-auto" : "max-w-md"}`}
          >
            <div className="mb-4 flex justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">
                {createStep === "review" ? "Resumen antes de publicar" : "Nueva tienda"}
              </h2>
              <button type="button" onClick={() => resetCreateModal()} aria-label="Cerrar">
                <X className="h-4 w-4 text-zinc-500" />
              </button>
            </div>

            {createStep === "form" ? (
              <form onSubmit={(e) => void onReviewCreate(e)}>
                <div className="grid gap-3">
                  <label className="text-xs text-zinc-500">
                    Tienda (código / etiqueta store)
                    <input
                      value={newStoreId}
                      onChange={(e) => setNewStoreId(e.target.value)}
                      className={inputClass}
                      placeholder={newFolder.trim() || "ej. tratevesarpe"}
                      required={!newFolder.trim()}
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    Carpeta en repositorio (opcional si coincide con tienda)
                    <input
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                      className={inputClass}
                      placeholder="Igual que tienda si vacío"
                    />
                  </label>
                  <label className="text-xs text-zinc-500">
                    Distribución
                    <select
                      value={newDistro}
                      onChange={(e) => setNewDistro(e.target.value as "horustech" | "pam")}
                      className={inputClass}
                    >
                      <option value="horustech">Horustech</option>
                      <option value="pam">PAM</option>
                    </select>
                  </label>
                  <label className="text-xs text-zinc-500">
                    Tag (versión)
                    <select value={newChannel} onChange={(e) => setNewChannel(e.target.value)} className={inputClass}>
                      <option value="stable">stable</option>
                      <option value="unstable">unstable</option>
                    </select>
                  </label>
                  <p className="text-[11px] leading-relaxed text-zinc-500">{createTemplateHint}</p>
                </div>
                {equipmentChecking ? (
                  <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Comprobando equipo en Rancher…
                  </p>
                ) : equipmentCheck ? (
                  <p className="mt-3 text-xs text-emerald-400/90">
                    Equipo encontrado: {equipmentCheck.displayName || equipmentCheck.name} ({equipmentCheck.state})
                  </p>
                ) : createError ? (
                  <p className="mt-3 text-xs text-red-300">{createError}</p>
                ) : null}
                <button
                  type="submit"
                  disabled={!equipmentCheck || equipmentChecking || createPreviewLoading}
                  className="mt-4 w-full rounded-lg bg-cf-orange py-2 text-xs font-medium text-black disabled:opacity-50"
                >
                  {createPreviewLoading ? "Generando resumen…" : "Ver resumen"}
                </button>
              </form>
            ) : createPreview ? (
              <div className="space-y-4 text-xs">
                <section className="rounded-lg border border-cf-line/60 bg-black/30 p-3">
                  <p className="font-medium text-zinc-300">Identidad y Git</p>
                  <dl className="mt-2 grid gap-1 text-zinc-400 sm:grid-cols-2">
                    <div>
                      <dt className="text-zinc-500">Tienda (store)</dt>
                      <dd className="text-zinc-200">{createPreview.storeId}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Carpeta en repo</dt>
                      <dd className="text-zinc-200">{createPreview.folderName}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Distribución</dt>
                      <dd className="text-zinc-200">{distroLabel(createPreview.distro)}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Tag imágenes</dt>
                      <dd className="text-zinc-200">{createPreview.imageChannel}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-zinc-500">Rama Git</dt>
                      <dd className="text-zinc-200">{createPreviewBranch}</dd>
                    </div>
                    {createCommitMessage ? (
                      <div className="sm:col-span-2">
                        <dt className="text-zinc-500">Mensaje de commit</dt>
                        <dd className="font-mono text-[11px] text-zinc-200">{createCommitMessage}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-black/30 p-3">
                  <p className="font-medium text-zinc-300">Etiquetas del cluster (Fleet)</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(createPreview.clusterLabels).map(([k, v]) => (
                      <li key={k} className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {k}={v}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-black/30 p-3">
                  <p className="font-medium text-zinc-300">Archivos que se subirán al repositorio</p>
                  <ul className="mt-2 space-y-2">
                    {createPreview.files.map((f) => (
                      <li key={f.path} className="rounded border border-cf-line/40 bg-black/20 px-2 py-1.5">
                        <p className="font-mono text-[11px] text-zinc-200">{f.path}</p>
                        <p className="text-zinc-500">
                          Plantilla: {f.sourceTemplate} · chart {f.chart} {f.chartVersion}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-black/30 p-3">
                  <p className="font-medium text-zinc-300">Base de datos</p>
                  <p className="mt-1 text-zinc-400">
                    DB {createPreview.db.database || "poslite"} · {createPreview.db.size || "—"} ·{" "}
                    {createPreview.db.persistenceEnabled ? "persistencia on" : "sin persistencia"}
                  </p>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-black/30 p-3">
                  <p className="font-medium text-zinc-300">Estación ({distroLabel(createPreview.distro)})</p>
                  <p className="mt-1 text-zinc-400">
                    Servicios activos:{" "}
                    {(createPreview.station.services ?? []).filter((s) => s.enabled).length} /{" "}
                    {(createPreview.station.services ?? []).length}
                  </p>
                  <ul className="mt-2 max-h-32 overflow-y-auto space-y-0.5 text-zinc-500">
                    {(createPreview.station.services ?? []).map((s) => (
                      <li key={s.key}>
                        {s.enabled ? "✓" : "○"} {s.key} · tag {s.tag}
                        {s.hostPort != null ? ` · puerto ${s.hostPort}` : ""}
                      </li>
                    ))}
                  </ul>
                  {(createPreview.station.workerGroups?.groups ?? []).map((g) => (
                    <div key={g.id} className="mt-2">
                      <p className="text-zinc-500">{g.label}</p>
                      <ul className="mt-0.5 space-y-0.5 text-zinc-500">
                        {g.workers.map((w) => (
                          <li key={w.key}>
                            {w.enabled ? "✓" : "○"} {workerDisplayName(w.key, g.id)} · {w.tag}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>

                {createPreview.warnings.length > 0 ? (
                  <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="font-medium text-amber-200/90">Revisar antes de publicar</p>
                    <ul className="mt-2 space-y-1">
                      {createPreview.warnings.map((w) => (
                        <li
                          key={`${w.code}-${w.message}`}
                          className={w.level === "error" ? "text-red-300" : "text-amber-200/80"}
                        >
                          {w.level === "error" ? "Bloqueante: " : "Aviso: "}
                          {w.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  <p className="text-emerald-400/90">No hay avisos bloqueantes. Puedes publicar al repositorio remoto.</p>
                )}

                {createError ? <p className="text-red-300">{createError}</p> : null}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateStep("form");
                      setCreatePreview(null);
                      setCreateError("");
                    }}
                    className="flex-1 rounded-lg border border-cf-line py-2 text-xs text-zinc-300 hover:bg-white/5"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    disabled={!createPreview.canPublish || createPublishing}
                    onClick={() => void onConfirmCreate()}
                    className="flex-1 rounded-lg bg-cf-orange py-2 text-xs font-medium text-black disabled:opacity-50"
                  >
                    {createPublishing ? "Publicando…" : "Confirmar y publicar en Git"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
