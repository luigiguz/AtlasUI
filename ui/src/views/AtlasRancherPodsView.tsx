import { AnimatePresence, motion } from "framer-motion";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
  RotateCw,
  ScrollText,
  Search,
  Server,
  Star,
  Store,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../apiClient";
import { PodLogsPanel } from "../components/PodLogsPanel";
import { normalizeApplication, normalizeDistro, normalizeState } from "../rancherLabels";
import {
  rememberTiendaForContainers,
  TIENDA_SELECTED_KEY,
} from "../rancherContainersNav";
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
const TIENDA_RECENT_KEY = "atlas-containers-tiendas-recientes";
const TIENDA_FAVORITES_KEY = "atlas-containers-tiendas-favoritas";
const TIENDA_SEARCH_MIN = 2;
const TIENDA_SUGGEST_MAX = 12;
const TIENDA_FAVORITES_MAX = 12;

function tiendaSearchText(c: RancherCustomCluster): string {
  return [clusterDisplayName(c), c.name, c.store, c.application, c.distro, c.state]
    .join(" ")
    .toLowerCase();
}

function readRecentTiendaIds(): string[] {
  try {
    const raw = localStorage.getItem(TIENDA_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readFavoriteTiendaIds(): string[] {
  try {
    const raw = localStorage.getItem(TIENDA_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeFavoriteTiendaIds(ids: string[]): void {
  try {
    localStorage.setItem(TIENDA_FAVORITES_KEY, JSON.stringify(ids.slice(0, TIENDA_FAVORITES_MAX)));
  } catch {
    /* ignore */
  }
}

function toggleFavoriteTiendaId(id: string, current: string[]): string[] {
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [id, ...current];
  const trimmed = next.slice(0, TIENDA_FAVORITES_MAX);
  writeFavoriteTiendaIds(trimmed);
  return trimmed;
}

type Props = {
  canAdmin: boolean;
  canEdit: boolean;
  /** Al venir desde Equipos: preseleccionar esta tienda. */
  focusTiendaId?: string | null;
  onFocusTiendaConsumed?: () => void;
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

function StatusPill({ phase }: { phase: string }) {
  const p = phase.toLowerCase();
  let cls = "bg-zinc-800/80 text-zinc-400 ring-zinc-700/50";
  if (p === "running") cls = "bg-emerald-500/15 text-emerald-400 ring-emerald-500/25";
  else if (p === "pending") cls = "bg-amber-500/15 text-amber-400 ring-amber-500/25";
  else if (p === "failed" || p === "unknown") cls = "bg-red-500/15 text-red-400 ring-red-500/25";
  const label = phase === "—" ? "—" : phase;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${cls}`}
    >
      {label}
    </span>
  );
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

function SpecTile({
  icon: Icon,
  label,
  value,
  mono,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "warn" | "ok";
}) {
  const valueCls =
    tone === "warn"
      ? "text-amber-400"
      : tone === "ok"
        ? "text-emerald-400"
        : "text-zinc-200";
  return (
    <div className="rounded-lg border border-cf-line/35 bg-white/[0.03] px-2.5 py-2 ring-1 ring-white/[0.03]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
        <Icon className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
        {label}
      </div>
      <p
        className={`mt-1 truncate text-xs font-medium ${mono ? "font-mono" : ""} ${valueCls}`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function ServiceExpandedDetails({
  deployment,
  pods,
  ready,
  replicas,
  node,
  ip,
  restarts,
  phase,
}: {
  deployment: RancherDeployment | null;
  pods: RancherPod[];
  ready: string;
  replicas: number;
  node: string;
  ip: string;
  restarts: number;
  phase: string;
}) {
  const imageFull =
    deployment?.image ||
    (deployment?.images?.length ? deployment.images.join(", ") : "");
  const imageTag = deployment?.imageTag || deploymentImageLabel(deployment);
  const showPods = pods.length > 1;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="overflow-hidden border-t border-cf-line/25 bg-gradient-to-b from-black/35 to-transparent"
    >
      <div className="space-y-2.5 px-3 py-3 pl-11">
        {imageFull ? (
          <div className="rounded-lg border border-cf-line/40 bg-black/30 px-3 py-2.5 ring-1 ring-white/[0.04]">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
              <Box className="h-3 w-3 text-zinc-500" aria-hidden />
              Imagen
              {imageTag && imageTag !== "—" ? (
                <span className="rounded bg-zinc-800/80 px-1.5 py-px font-mono normal-case text-zinc-400">
                  {imageTag}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-zinc-400" title={imageFull}>
              {imageFull}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SpecTile icon={Server} label="Nodo" value={node} />
          <SpecTile icon={Network} label="IP del pod" value={ip} mono />
          <SpecTile
            icon={Layers}
            label="Réplicas"
            value={replicas > 0 ? `${ready} listas` : ready}
            tone={phase.toLowerCase() === "running" ? "ok" : "default"}
          />
          <SpecTile
            icon={RotateCcw}
            label="Reinicios"
            value={restarts > 0 ? String(restarts) : "Ninguno"}
            tone={restarts > 0 ? "warn" : "default"}
          />
        </div>

        {showPods ? (
          <div className="rounded-lg border border-cf-line/35 bg-black/20 px-2.5 py-2">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
              Instancias ({pods.length})
            </p>
            <ul className="space-y-1">
              {pods.map((p) => (
                <li
                  key={p.name}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white/[0.02] px-2 py-1.5 text-[11px]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-300" title={p.name}>
                    {p.name}
                  </span>
                  <span className={`shrink-0 ${podPhaseTone(p.phase)}`}>{p.phase}</span>
                  {p.podIP ? (
                    <span className="shrink-0 font-mono text-zinc-500">{p.podIP}</span>
                  ) : null}
                  {p.node ? <span className="shrink-0 text-zinc-600">{p.node}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function TiendaPickerOption({
  tienda,
  active,
  isFavorite,
  onPick,
  onToggleFavorite,
}: {
  tienda: RancherCustomCluster;
  active: boolean;
  isFavorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <li role="option" aria-selected={active}>
      <div className={active ? "flex items-stretch bg-cf-orange/10" : "flex items-stretch"}>
        <button type="button" onClick={onPick} className="flex min-w-0 flex-1 flex-col px-3 py-2 text-left hover:bg-white/[0.04]">
          <span className="truncate text-sm text-zinc-200">{clusterDisplayName(tienda)}</span>
          <span className="mt-0.5 truncate text-[11px] text-zinc-600">
            {tienda.application || "—"} ·{" "}
            <span className={stateTone(tienda.state)}>{tienda.state}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className="flex shrink-0 items-center px-2.5 text-zinc-600 hover:text-amber-400"
          aria-label={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          title={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
        >
          <Star
            className={`h-3.5 w-3.5 ${isFavorite ? "fill-amber-400 text-amber-400" : ""}`}
            aria-hidden
          />
        </button>
      </div>
    </li>
  );
}

function TiendaPicker({
  tiendas,
  selectedId,
  onSelect,
}: {
  tiendas: RancherCustomCluster[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoriteTiendaIds());
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => tiendas.find((t) => t.id === selectedId) ?? null,
    [tiendas, selectedId]
  );

  const isSearching = query.trim().length >= TIENDA_SEARCH_MIN;

  const favoriteTiendas = useMemo(
    () =>
      favoriteIds
        .map((id) => tiendas.find((t) => t.id === id))
        .filter((t): t is RancherCustomCluster => t != null),
    [favoriteIds, tiendas]
  );

  const recentTiendas = useMemo(() => {
    if (isSearching) return [];
    return readRecentTiendaIds()
      .filter((id) => !favoriteIds.includes(id))
      .map((id) => tiendas.find((t) => t.id === id))
      .filter((t): t is RancherCustomCluster => t != null);
  }, [favoriteIds, tiendas, isSearching]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < TIENDA_SEARCH_MIN) return [];
    return tiendas.filter((t) => tiendaSearchText(t).includes(q)).slice(0, TIENDA_SUGGEST_MAX);
  }, [tiendas, query]);

  const showDropdown =
    open &&
    (isSearching || favoriteTiendas.length > 0 || recentTiendas.length > 0);

  useEffect(() => {
    const valid = new Set(tiendas.map((t) => t.id));
    setFavoriteIds((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (next.length !== prev.length) writeFavoriteTiendaIds(next);
      return next.length === prev.length ? prev : next;
    });
  }, [tiendas]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(id: string) {
    rememberTiendaForContainers(id);
    onSelect(id);
    setQuery("");
    setOpen(false);
  }

  function toggleFavorite(id: string) {
    setFavoriteIds((prev) => toggleFavoriteTiendaId(id, prev));
  }

  function openPicker() {
    setOpen(true);
    setQuery("");
  }

  const selectedIsFavorite = selected != null && favoriteIds.includes(selected.id);

  return (
    <div ref={rootRef} className="relative shrink-0 border-b border-cf-line/50 p-3">
      {!open && selected ? (
        <div className="flex items-center gap-1 rounded-lg border border-cf-line/60 bg-black/30 pr-1">
          <button
            type="button"
            onClick={openPicker}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-black/20"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cf-orange/10 ring-1 ring-cf-orange/25">
              <Store className="h-4 w-4 text-cf-orange" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-100">{clusterDisplayName(selected)}</p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                {selected.application || "—"} ·{" "}
                <span className={stateTone(selected.state)}>{selected.state}</span>
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => toggleFavorite(selected.id)}
            className="shrink-0 rounded-lg p-2.5 text-zinc-600 hover:bg-white/5 hover:text-amber-400"
            aria-label={selectedIsFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            title={selectedIsFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
          >
            <Star
              className={`h-4 w-4 ${selectedIsFavorite ? "fill-amber-400 text-amber-400" : ""}`}
              aria-hidden
            />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="Buscar tienda…"
            autoFocus={open}
            className="w-full rounded-lg border border-cf-line bg-black/40 py-2.5 pl-9 pr-8 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50"
          />
          {(query || open) && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                if (selected) setOpen(false);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              aria-label="Cerrar búsqueda"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {open && !isSearching && favoriteTiendas.length > 0 ? (
        <div className="mt-2.5">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">Favoritos</p>
          <div className="flex flex-wrap gap-1.5">
            {favoriteTiendas.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className={
                  t.id === selectedId
                    ? "inline-flex max-w-full items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 text-xs text-zinc-100"
                    : "inline-flex max-w-full items-center gap-1 rounded-full border border-cf-line/60 bg-black/30 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500/35 hover:bg-amber-500/10"
                }
              >
                <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                <span className="truncate">{clusterDisplayName(t)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showDropdown ? (
        <ul
          className="absolute left-3 right-3 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-cf-line/80 bg-[#151a21] py-1 shadow-xl shadow-black/50 ring-1 ring-white/[0.06]"
          role="listbox"
        >
          {isSearching ? (
            searchResults.map((t) => (
              <TiendaPickerOption
                key={t.id}
                tienda={t}
                active={t.id === selectedId}
                isFavorite={favoriteIds.includes(t.id)}
                onPick={() => pick(t.id)}
                onToggleFavorite={() => toggleFavorite(t.id)}
              />
            ))
          ) : (
            <>
              {favoriteTiendas.length > 0 ? (
                <>
                  <li className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                    Favoritos
                  </li>
                  {favoriteTiendas.map((t) => (
                    <TiendaPickerOption
                      key={t.id}
                      tienda={t}
                      active={t.id === selectedId}
                      isFavorite
                      onPick={() => pick(t.id)}
                      onToggleFavorite={() => toggleFavorite(t.id)}
                    />
                  ))}
                </>
              ) : null}
              {recentTiendas.length > 0 ? (
                <>
                  <li className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                    Recientes
                  </li>
                  {recentTiendas.map((t) => (
                    <TiendaPickerOption
                      key={t.id}
                      tienda={t}
                      active={t.id === selectedId}
                      isFavorite={favoriteIds.includes(t.id)}
                      onPick={() => pick(t.id)}
                      onToggleFavorite={() => toggleFavorite(t.id)}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </ul>
      ) : null}

      {open && isSearching && searchResults.length === 0 ? (
        <p className="absolute left-3 right-3 top-full z-30 mt-1 rounded-lg border border-cf-line/60 bg-[#151a21] px-3 py-3 text-center text-xs text-zinc-500 shadow-lg">
          No hay tiendas con ese nombre.
        </p>
      ) : null}

      {open && !isSearching && favoriteTiendas.length === 0 && recentTiendas.length === 0 ? (
        <p className="mt-2 text-[11px] text-zinc-600">
          Marca tiendas con la estrella o escribe al menos {TIENDA_SEARCH_MIN} letras para buscar.
        </p>
      ) : null}
    </div>
  );
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
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [logsTarget, setLogsTarget] = useState<{ serviceName: string; pods: RancherPod[] } | null>(
    null
  );

  const containerRows = useMemo(
    () => buildContainerRows(deployments, pods),
    [deployments, pods]
  );

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return containerRows;
    return containerRows.filter((r) => r.serviceName.toLowerCase().includes(q));
  }, [containerRows, filterQuery]);

  const rolloutRows = useMemo(
    () => filteredRows.filter((r): r is ContainerRow & { deployment: RancherDeployment } => r.deployment != null),
    [filteredRows]
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
    <div className="relative flex min-h-0 flex-1 flex-col">
      {error ? (
        <p className="shrink-0 border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">{error}</p>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-b border-cf-line/40 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <input
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Buscar servicio…"
            className="w-full rounded-lg border border-cf-line/60 bg-black/30 py-1.5 pl-8 pr-7 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cf-orange/40"
          />
          {filterQuery ? (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              aria-label="Borrar búsqueda"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        <span className="shrink-0 rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] tabular-nums text-zinc-500">
          {filteredRows.length}
        </span>
        <button
          type="button"
          onClick={() => void loadAll({ silent: true })}
          disabled={refreshing}
          className="shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-cf-orange disabled:opacity-50"
          aria-label="Actualizar lista"
          title="Actualizar"
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {canEdit && rolloutRows.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-cf-line/30 px-3 py-1.5">
          <input
            type="checkbox"
            checked={allRolloutSelected}
            ref={(el) => {
              if (el) el.indeterminate = someRolloutSelected && !allRolloutSelected;
            }}
            disabled={rolling}
            onChange={toggleSelectAll}
            className="h-3.5 w-3.5 rounded border-cf-line bg-black/40 accent-cf-orange"
            aria-label="Seleccionar todos"
          />
          <button
            type="button"
            disabled={rolling}
            onClick={toggleSelectAll}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            {allRolloutSelected ? "Quitar todos" : "Seleccionar todos"}
          </button>
        </div>
      ) : null}

      {containerRows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-500">No hay contenedores en este namespace.</p>
      ) : filteredRows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-zinc-500">Ningún servicio coincide con la búsqueda.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-16">
          <ul className="divide-y divide-cf-line/25">
            {filteredRows.map((row) => {
              const d = row.deployment;
              const phase = aggregatePodPhase(row.pods);
              const ready =
                d != null ? `${d.readyReplicas}/${d.replicas}` : row.pods[0]?.ready ?? "—";
              const replicas = d?.replicas ?? row.pods.length;
              const restarts = row.pods.reduce((n, p) => n + p.restarts, 0);
              const node = aggregatePodField(row.pods, (p) => p.node);
              const ip = aggregatePodField(row.pods, (p) => p.podIP);
              const imgTitle =
                d?.images?.length ? d.images.join("\n") : d?.image || row.pods.map((p) => p.name).join("\n");
              const canRollout = canEdit && d != null;
              const isSelected = selected.has(row.serviceName);
              const expanded = expandedService === row.serviceName;
              const imageLabel = deploymentImageLabel(d);

              return (
                <li
                  key={row.serviceName}
                  className={isSelected ? "bg-cf-orange/[0.04]" : undefined}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {canEdit ? (
                      <span className="w-4 shrink-0">
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
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedService((prev) => (prev === row.serviceName ? null : row.serviceName))
                      }
                      className="shrink-0 rounded p-0.5 text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
                      aria-expanded={expanded}
                      aria-label={expanded ? "Ocultar detalles" : "Ver detalles"}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200" title={row.serviceName}>
                        {row.serviceName}
                      </p>
                      <p className="truncate text-[11px] text-zinc-600" title={imgTitle}>
                        {imageLabel !== "—" ? (
                          <>
                            <span className="font-mono text-zinc-500">{imageLabel}</span>
                            <span className="text-zinc-700"> · </span>
                            <span className={podPhaseTone(phase)}>{ready}</span>
                          </>
                        ) : (
                          <span className={podPhaseTone(phase)}>{ready}</span>
                        )}
                      </p>
                    </div>
                    <StatusPill phase={phase} />
                    {row.pods.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLogsTarget({ serviceName: row.serviceName, pods: row.pods })
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-zinc-400 ring-1 ring-cf-line transition hover:bg-white/5 hover:text-zinc-200"
                        title="Ver logs en vivo"
                        aria-label={`Ver logs de ${row.serviceName}`}
                      >
                        <ScrollText className="h-3.5 w-3.5" />
                        Logs
                      </button>
                    ) : null}
                    {canRollout ? (
                      <button
                        type="button"
                        disabled={rolling}
                        onClick={() => openRolloutConfirm([d])}
                        className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-cf-orange/10 hover:text-cf-orange disabled:opacity-40"
                        aria-label={`Actualizar ${row.serviceName}`}
                        title="Actualizar imagen"
                      >
                        {rolling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <ServiceExpandedDetails
                        key={row.serviceName}
                        deployment={d}
                        pods={row.pods}
                        ready={ready}
                        replicas={replicas}
                        node={node}
                        ip={ip}
                        restarts={restarts}
                        phase={phase}
                      />
                    ) : null}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AnimatePresence>
        {logsTarget ? (
          <PodLogsPanel
            key={logsTarget.serviceName}
            cluster={cluster}
            serviceName={logsTarget.serviceName}
            pods={logsTarget.pods}
            onClose={() => setLogsTarget(null)}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {canEdit && selected.size > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3"
          >
            <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-cf-line/80 bg-[#1a1f26]/95 px-4 py-2 shadow-xl shadow-black/40 ring-1 ring-white/[0.06] backdrop-blur-md">
              <span className="text-xs text-zinc-400">
                {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
              </span>
              <button
                type="button"
                disabled={rolling}
                onClick={() => openRolloutConfirm(selectedDeployments())}
                className="inline-flex items-center gap-1.5 rounded-full bg-cf-orange px-3 py-1.5 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-60"
              >
                {rolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                Actualizar imagen
              </button>
              <button
                type="button"
                disabled={rolling}
                onClick={() => setSelected(new Set())}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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

export function AtlasRancherPodsView({
  canAdmin: _canAdmin,
  canEdit,
  focusTiendaId = null,
  onFocusTiendaConsumed,
}: Props) {
  const [clusters, setClusters] = useState<RancherCustomCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rancherConfigured, setRancherConfigured] = useState(false);
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
        try {
          const saved = localStorage.getItem(TIENDA_SELECTED_KEY);
          if (saved && list.some((c) => c.id === saved)) return saved;
        } catch {
          /* ignore */
        }
        return null;
      });
      if (data.configured === false && data.message) setError(data.message);
    } catch (e) {
      setClusters([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar las tiendas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClusters();
  }, [loadClusters]);

  useEffect(() => {
    if (!focusTiendaId || clusters.length === 0) return;
    if (clusters.some((c) => c.id === focusTiendaId)) {
      rememberTiendaForContainers(focusTiendaId);
      setSelectedId(focusTiendaId);
    }
    onFocusTiendaConsumed?.();
  }, [focusTiendaId, clusters, onFocusTiendaConsumed]);

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
            Servicios por equipo. Selecciona varios para actualizar imagen a la vez.
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
          Actualizar tiendas
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
          No hay tiendas disponibles.
        </div>
      ) : (
        <div className="flex min-h-[min(70vh,40rem)] flex-col overflow-hidden rounded-xl border border-cf-line/70 bg-[#111418]/90 ring-1 ring-white/[0.03]">
          <TiendaPicker
            tiendas={clusters}
            selectedId={selectedId}
            onSelect={(id) => {
              rememberTiendaForContainers(id);
              setSelectedId(id);
            }}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selectedCluster ? (
              !selectedCluster.application ? (
                <p className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
                  Esta tienda no tiene label <span className="text-zinc-300">application</span>; no se
                  pueden listar contenedores.
                </p>
              ) : (
                <ClusterContainersPanel key={selectedCluster.id} cluster={selectedCluster} canEdit={canEdit} />
              )
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center text-zinc-500">
                <Store className="h-9 w-9 text-zinc-600" strokeWidth={1.25} />
                <div>
                  <p className="text-sm text-zinc-400">Busca y elige una tienda</p>
                  <p className="mt-1 text-xs text-zinc-600">
                    Usa favoritos, recientes o escribe al menos 2 letras para buscar.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
