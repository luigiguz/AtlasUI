import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  GitBranch,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Store,
  Trash2,
  Upload,
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
  type ReactNode,
} from "react";

import { api } from "../apiClient";
import { normalizeApplication, normalizeDistro } from "../rancherLabels";
import type { ClustersResponse, RancherCustomCluster } from "../rancherTypes";
import { AtlasAlertDialog } from "../components/AtlasAlertDialog";
import { AtlasConfirmDialog } from "../components/AtlasConfirmDialog";
import { AtlasLoadingSplash } from "../components/AtlasLoadingSplash";
import { pulseAtlasNotifications } from "../components/AtlasNotifications";
import { AtlasModalShell } from "../components/AtlasModalFrame";
import { PublishChangeSummary, STORE_FLEET_PUBLISH_SUCCESS } from "../storeRequestUi";
import { STORE_IMAGE_PULL_POLICIES } from "../storeTypes";
import type {
  StoreCreatePreview,
  StoreImagePullPolicy,
  StoreServiceToggle,
  StoreCreatePreviewResponse,
  StoreDetail,
  StoreGitDiscardMode,
  StoreGitStatusResponse,
  StoreSummary,
  StoreTemplateInfo,
  StoreTemplatesResponse,
  StoreWorkerGroup,
  StoreWorkerToggle,
  StoresListResponse,
} from "../storeTypes";

type StoresViewMode = "list" | "detail";

type Props = {
  canAdmin: boolean;
  canEdit: boolean;
  canApprove: boolean;
};

type SettingsResponse = {
  repo_url: string;
  branch: string;
  git_username: string;
  git_token: string;
  git_auth_configured: boolean;
  auto_pull: boolean;
  auto_push: boolean;
  configured: boolean;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-cf-line bg-cf-card px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cf-orange/50";

function distroLabel(d: string): string {
  if (d === "horustech") return "Horustech";
  if (d === "pam") return "PAM";
  return d || "—";
}

function applicationLabel(app: string): string {
  const trimmed = (app || "").trim();
  if (!trimmed) return "—";
  const low = trimmed.toLowerCase();
  if (low === "poslite") return "Poslite";
  if (low === "ierp") return "IERP";
  return trimmed;
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
  if (general.length) out.push({ id: "general", label: "Servicio de Estación", workers: general });
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

function disableAllIerpWorkers(detail: StoreDetail): StoreDetail {
  const groups = workerGroupsFromStation(detail.station).map((g) =>
    g.id === "ierp" ? { ...g, workers: g.workers.map((w) => ({ ...w, enabled: false })) } : g
  );
  return {
    ...detail,
    station: {
      ...detail.station,
      workerGroups: { groups },
      workers: flattenWorkerGroups(groups),
    },
  };
}

const tagInputClass =
  "w-28 min-w-0 rounded border border-cf-line bg-cf-card px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-cf-orange/50";

const CLUSTERS_CACHE_MS = 60_000;
const STORES_APPLICATION_KEY = "atlas-stores-selected-application";

function readStoredApplication(): string | null {
  try {
    const raw = localStorage.getItem(STORES_APPLICATION_KEY);
    if (!raw?.trim()) return null;
    const canon = normalizeApplication(raw) || null;
    if (canon === "IERP") {
      localStorage.removeItem(STORES_APPLICATION_KEY);
      return null;
    }
    return canon;
  } catch {
    return null;
  }
}

function rememberStoredApplication(app: string): void {
  try {
    const canon = normalizeApplication(app) || app.trim();
    if (canon) localStorage.setItem(STORES_APPLICATION_KEY, canon);
  } catch {
    /* ignore */
  }
}

function clearStoredApplication(): void {
  try {
    localStorage.removeItem(STORES_APPLICATION_KEY);
  } catch {
    /* ignore */
  }
}

function storeMatchesApplication(storeApp: string, selectedApp: string): boolean {
  const a = normalizeApplication(storeApp) || "Poslite";
  const b = normalizeApplication(selectedApp);
  return a.toLowerCase() === b.toLowerCase();
}

type StoreApplicationOption = {
  id: string;
  label: string;
  count: number;
};

type StoreFilterFieldKey = "id" | "distro" | "tag";
type StoreFilterOperator = "contains" | "equals" | "not_contains";

type StoreFilterRule = {
  id: string;
  field: StoreFilterFieldKey;
  operator: StoreFilterOperator;
  value: string;
};

const STORE_FILTER_FIELDS: { key: StoreFilterFieldKey; label: string; placeholder: string }[] = [
  { key: "id", label: "Tienda", placeholder: "código o carpeta" },
  { key: "distro", label: "Distribución", placeholder: "Horustech, PAM…" },
  { key: "tag", label: "Tag", placeholder: "stable, unstable…" },
];

const STORE_FILTER_OPERATORS: { key: StoreFilterOperator; label: string }[] = [
  { key: "contains", label: "contiene" },
  { key: "equals", label: "es" },
  { key: "not_contains", label: "no contiene" },
];

const storeFilterSelectClass =
  "w-full min-w-0 rounded-lg border border-cf-line bg-cf-card px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-cf-orange/50";

function newStoreFilterRule(field: StoreFilterFieldKey = "id"): StoreFilterRule {
  return {
    id: crypto.randomUUID(),
    field,
    operator: "contains",
    value: "",
  };
}

function storeFilterPlaceholder(field: StoreFilterFieldKey): string {
  return STORE_FILTER_FIELDS.find((f) => f.key === field)?.placeholder ?? "";
}

function matchesStoreSearchQuery(s: StoreSummary, query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return true;
  const haystack = [s.id, s.folderName, s.distro, distroLabel(s.distro), s.imageChannel]
    .join(" ")
    .toLowerCase();
  return haystack.includes(t);
}

function storeFieldValue(s: StoreSummary, field: StoreFilterFieldKey): string {
  switch (field) {
    case "id":
      return `${s.id} ${s.folderName}`;
    case "distro":
      return distroLabel(s.distro);
    case "tag":
      return s.imageChannel || "";
    default:
      return "";
  }
}

function storeCompareFieldValues(field: StoreFilterFieldKey, storeVal: string, ruleVal: string): boolean {
  if (field === "distro") {
    return normalizeDistro(storeVal) === normalizeDistro(ruleVal);
  }
  return storeVal.trim().localeCompare(ruleVal.trim(), "es", { sensitivity: "base" }) === 0;
}

function storeRuleMatches(s: StoreSummary, rule: StoreFilterRule): boolean {
  const needle = rule.value.trim();
  if (!needle) return true;
  const raw = storeFieldValue(s, rule.field);
  const haystack = raw.toLowerCase();
  const q = needle.toLowerCase();
  if (rule.operator === "equals") {
    return storeCompareFieldValues(rule.field, raw, needle);
  }
  if (rule.operator === "not_contains") {
    return !haystack.includes(q);
  }
  return haystack.includes(q);
}

function matchesStoreFilterRules(s: StoreSummary, rules: StoreFilterRule[]): boolean {
  const active = rules.filter((r) => r.value.trim());
  return active.every((r) => storeRuleMatches(s, r));
}

function StoreSearchInput({
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
        placeholder="Buscar por tienda, distribución, tag…"
        autoComplete="off"
        className="w-full rounded-xl border border-cf-line bg-cf-panel/90 py-2 pl-9 pr-9 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20"
        aria-label="Buscar tiendas"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-cf-card hover:text-zinc-300"
          aria-label="Borrar búsqueda"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function StoreFiltersPanel({
  rules,
  onChange,
  onApply,
  onClose,
}: {
  rules: StoreFilterRule[];
  onChange: (rules: StoreFilterRule[]) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  function updateRule(id: string, patch: Partial<StoreFilterRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRule(id: string) {
    const next = rules.filter((r) => r.id !== id);
    onChange(next.length ? next : [newStoreFilterRule()]);
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
      aria-label="Filtros de tiendas"
      className="absolute left-0 right-0 top-full z-30 mt-2 w-full max-w-xl rounded-xl border border-cf-line bg-cf-panel p-4 shadow-2xl ring-1 ring-cf-line/40 sm:left-auto sm:right-0 sm:w-[min(36rem,calc(100vw-2rem))]"
      onKeyDown={onKeyDown}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Filtros</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-cf-card hover:text-zinc-300"
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
                updateRule(rule.id, { field: e.target.value as StoreFilterFieldKey })
              }
              className={`${storeFilterSelectClass} sm:w-[7.5rem]`}
              aria-label="Campo"
            >
              {STORE_FILTER_FIELDS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={rule.operator}
              onChange={(e) =>
                updateRule(rule.id, { operator: e.target.value as StoreFilterOperator })
              }
              className={`${storeFilterSelectClass} sm:w-[8.5rem]`}
              aria-label="Operador"
            >
              {STORE_FILTER_OPERATORS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder={storeFilterPlaceholder(rule.field)}
              className="min-w-0 flex-1 rounded-lg border border-cf-line bg-cf-card px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50"
              aria-label="Valor del filtro"
            />
            <button
              type="button"
              onClick={() => removeRule(rule.id)}
              className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-cf-card hover:text-zinc-300"
              aria-label="Eliminar filtro"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...rules, newStoreFilterRule()])}
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

function StoresApplicationPicker({
  options,
  loading,
  onSelect,
}: {
  options: StoreApplicationOption[];
  loading: boolean;
  onSelect: (applicationId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-cf-line/70 bg-cf-panel">
      <div className="border-b border-cf-line/50 px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-zinc-100">Seleccione la aplicación que desea gestionar</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Cada aplicación agrupa sus tiendas en el repositorio Git y las etiquetas de equipo en Rancher.
        </p>
      </div>
      <div className="p-5 sm:p-6">
        {loading ? (
          <AtlasLoadingSplash message="Cargando aplicaciones…" minHeight="min-h-[200px]" />
        ) : options.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">No hay aplicaciones disponibles en el repositorio.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelect(opt.id)}
                className="atlas-metric-card group flex flex-col items-start gap-3 text-left"
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cf-orange/10 ring-1 ring-cf-orange/25 transition group-hover:bg-cf-orange/15">
                    <Layers className="h-5 w-5 text-cf-orange" aria-hidden />
                  </div>
                  <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[10px] font-medium tabular-nums text-zinc-400 ring-1 ring-cf-line/60">
                    {opt.count} tienda{opt.count !== 1 ? "s" : ""}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100 group-hover:text-white">{opt.label}</p>
                  <p className="mt-1 text-[11px] text-zinc-600 group-hover:text-zinc-500">
                    Ver y editar despliegues de esta aplicación
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-cf-orange opacity-80 transition group-hover:opacity-100">
                  Gestionar
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function gitChangeBadgeClass(status: string): string {
  if (status === "unmerged") return "bg-rose-950/60 text-rose-200 ring-rose-500/30";
  if (status === "deleted") return "bg-zinc-800 text-zinc-300 ring-zinc-600/40";
  if (status === "added") return "bg-emerald-950/50 text-emerald-200 ring-emerald-500/30";
  if (status === "untracked") return "bg-amber-950/40 text-amber-100 ring-amber-500/30";
  return "bg-sky-950/40 text-sky-200 ring-sky-500/30";
}

function cloneStoreDetail(d: StoreDetail): StoreDetail {
  return JSON.parse(JSON.stringify(d)) as StoreDetail;
}

function computeStoreChangeLines(baseline: StoreDetail, current: StoreDetail): string[] {
  const lines: string[] = [];
  if (baseline.id !== current.id) {
    lines.push(`Código tienda: ${baseline.id} → ${current.id}`);
  }
  if (Boolean(baseline.db?.pgadminEnabled) !== Boolean(current.db?.pgadminEnabled)) {
    lines.push(`PgAdmin: ${current.db?.pgadminEnabled ? "activado" : "desactivado"}`);
  }
  const basePolicy = baseline.station?.pullPolicy ?? "IfNotPresent";
  const curPolicy = current.station?.pullPolicy ?? "IfNotPresent";
  if (basePolicy !== curPolicy) {
    lines.push(`Pull policy: ${basePolicy} → ${curPolicy}`);
  }
  const baseConfig = (baseline.station?.config ?? {}) as Record<string, unknown>;
  const curConfig = (current.station?.config ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(baseConfig), ...Object.keys(curConfig)])) {
    const b = String(baseConfig[key] ?? "");
    const c = String(curConfig[key] ?? "");
    if (b !== c) lines.push(`Config ${key}: ${b || "—"} → ${c || "—"}`);
  }
  const baseSvc = new Map((baseline.station?.services ?? []).map((s) => [s.key, s]));
  for (const svc of current.station?.services ?? []) {
    const prev = baseSvc.get(svc.key);
    if (!prev) {
      lines.push(`Servicio ${svc.key}: nuevo (${svc.enabled ? "on" : "off"}, tag ${svc.tag || "—"})`);
      continue;
    }
    if (prev.enabled !== svc.enabled) {
      lines.push(`Servicio ${svc.key}: ${svc.enabled ? "activado" : "desactivado"}`);
    }
    if (prev.tag !== svc.tag) {
      lines.push(`Servicio ${svc.key} tag: ${prev.tag || "—"} → ${svc.tag || "—"}`);
    }
  }
  const baseWrk = new Map(
    flattenWorkerGroups(workerGroupsFromStation(baseline.station)).map((w) => [w.key, w])
  );
  for (const wrk of flattenWorkerGroups(workerGroupsFromStation(current.station))) {
    const prev = baseWrk.get(wrk.key);
    if (!prev) continue;
    const label = wrk.key.startsWith("ierp.") ? wrk.key.slice(5) : wrk.key;
    if (prev.enabled !== wrk.enabled) {
      lines.push(`Proceso ${label}: ${wrk.enabled ? "activado" : "desactivado"}`);
    }
    if (prev.tag !== wrk.tag) {
      lines.push(`Proceso ${label} tag: ${prev.tag || "—"} → ${wrk.tag || "—"}`);
    }
  }
  return lines;
}


export function AtlasStoresView({ canAdmin, canEdit, canApprove }: Props) {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [configured, setConfigured] = useState(false);
  const [message, setMessage] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<string | null>(() =>
    readStoredApplication()
  );
  const [viewMode, setViewMode] = useState<StoresViewMode>("list");
  const [serviceFilter, setServiceFilter] = useState("");
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [detailBaseline, setDetailBaseline] = useState<StoreDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [publishResultAlert, setPublishResultAlert] = useState<{ title: string; message: ReactNode } | null>(
    null
  );
  const [equipment, setEquipment] = useState<RancherCustomCluster | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [cfgUrl, setCfgUrl] = useState("");
  const [cfgBranch, setCfgBranch] = useState("main");
  const [cfgUsername, setCfgUsername] = useState("");
  const [cfgToken, setCfgToken] = useState("");
  const [cfgAuthConfigured, setCfgAuthConfigured] = useState(false);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [cfgTesting, setCfgTesting] = useState(false);
  const [cfgTestMsg, setCfgTestMsg] = useState("");

  const [newFolder, setNewFolder] = useState("");
  const [newStoreId, setNewStoreId] = useState("");
  const [newApplication, setNewApplication] = useState("Poslite");
  const [newDistro, setNewDistro] = useState<"horustech" | "pam">("horustech");
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

  const [gitStatus, setGitStatus] = useState<StoreGitStatusResponse | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState<StoreGitDiscardMode | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardMsg, setDiscardMsg] = useState("");
  const [publishMessage, setPublishMessage] = useState("Atlas: publicar cambios locales del caché");
  const [publishing, setPublishing] = useState(false);

  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [storeFiltersOpen, setStoreFiltersOpen] = useState(false);
  const storeFiltersPanelRef = useRef<HTMLDivElement>(null);
  const [storeAppliedRules, setStoreAppliedRules] = useState<StoreFilterRule[]>([]);
  const [storeDraftRules, setStoreDraftRules] = useState<StoreFilterRule[]>(() => [
    newStoreFilterRule(),
  ]);

  const clustersCacheRef = useRef<{ clusters: RancherCustomCluster[]; at: number } | null>(null);

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

  const publishChangeLines = useMemo(() => {
    if (!detail || !detailBaseline) return [];
    return computeStoreChangeLines(detailBaseline, detail);
  }, [detail, detailBaseline]);

  const detailHasChanges = publishChangeLines.length > 0;

  const loadGitStatus = useCallback(async () => {
    setGitStatusLoading(true);
    try {
      const data = await api<StoreGitStatusResponse>("/api/atlas-stores/git/status");
      if (data.configured !== false) {
        setConfigured(true);
        setGitStatus(data);
      } else {
        setGitStatus(null);
      }
    } catch {
      setGitStatus(null);
    } finally {
      setGitStatusLoading(false);
    }
  }, []);


  const loadStores = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<StoresListResponse>("/api/atlas-stores/stores");
      setStores(data.stores ?? []);
      setConfigured(data.configured !== false);
      setRepoUrl(data.repoUrl ?? "");
      setPendingFolders(data.pendingFolders ?? []);
      if (data.gitWarning) setError(data.gitWarning);
      else if (data.configured === false && data.message) setMessage(data.message);
      else setMessage("");
      if (data.configured !== false) {
        void loadGitStatus();
      }
    } catch (e) {
      setStores([]);
      setError(e instanceof Error ? e.message : "No se pudieron cargar las tiendas.");
      void loadGitStatus();
    } finally {
      setLoading(false);
    }
  }, [loadGitStatus]);

  const resolveEquipmentForStore = useCallback(async (storeId: string) => {
    setEquipmentLoading(true);
    try {
      const now = Date.now();
      let clusters: RancherCustomCluster[] = clustersCacheRef.current?.clusters ?? [];
      if (!clustersCacheRef.current || now - clustersCacheRef.current.at > CLUSTERS_CACHE_MS) {
        const data = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
        clusters = data.clusters ?? [];
        clustersCacheRef.current = { clusters, at: now };
      }
      const match = clusters.find((c) => (c.store || "").toLowerCase() === storeId.toLowerCase());
      setEquipment(match ?? null);
    } catch {
      setEquipment(null);
    } finally {
      setEquipmentLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (folder: string) => {
    setDetailLoading(true);
    setEquipmentLoading(true);
    setSaveMsg("");
    setSelectedFolder(folder);
    setViewMode("detail");
    setDetail(null);
    setDetailBaseline(null);
    setEquipment(null);
    setServiceFilter("");
    setPublishConfirmOpen(false);
    try {
      const r = await api<{ ok: boolean; store: StoreDetail }>(
        `/api/atlas-stores/stores/${encodeURIComponent(folder)}`
      );
      const loaded = cloneStoreDetail(r.store);
      setDetail(loaded);
      setDetailBaseline(cloneStoreDetail(loaded));
      void resolveEquipmentForStore(r.store.id || folder);
    } catch (e) {
      setDetail(null);
      setEquipmentLoading(false);
      setError(e instanceof Error ? e.message : "No se pudo cargar la tienda.");
      goBackToList();
    } finally {
      setDetailLoading(false);
    }
  }, [resolveEquipmentForStore]);

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
        setCfgUsername(s.git_username ?? "");
        setCfgAuthConfigured(Boolean(s.git_auth_configured));
        setCfgToken("");
        setCfgTestMsg("");
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
          git_username: cfgUsername.trim(),
          git_token: cfgToken.trim(),
          auto_pull: true,
          auto_push: true,
        }),
      });
      setCfgAuthConfigured(Boolean(cfgToken.trim()) || cfgAuthConfigured);
      setCfgToken("");
      setCfgTestMsg("");
      setSettingsOpen(false);
      await loadStores();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar conexión.");
    } finally {
      setCfgSaving(false);
    }
  }

  async function onTestGitConnection() {
    setCfgTesting(true);
    setCfgTestMsg("");
    setError("");
    try {
      if (cfgToken.trim() || cfgUsername.trim() || cfgUrl.trim() !== repoUrl) {
        await api("/api/atlas-stores/settings", {
          method: "POST",
          body: JSON.stringify({
            repo_url: cfgUrl.trim(),
            branch: cfgBranch.trim(),
            git_username: cfgUsername.trim(),
            git_token: cfgToken.trim(),
            auto_pull: true,
            auto_push: true,
          }),
        });
        if (cfgToken.trim()) setCfgAuthConfigured(true);
        setCfgToken("");
      }
      const r = await api<{ message: string }>("/api/atlas-stores/settings/test", { method: "POST" });
      setCfgTestMsg(r.message ?? "Conexión correcta.");
    } catch (e) {
      setCfgTestMsg("");
      setError(e instanceof Error ? e.message : "Error al probar la conexión Git.");
    } finally {
      setCfgTesting(false);
    }
  }

  async function onConfirmDiscard() {
    if (!discardConfirm) return;
    setDiscarding(true);
    setDiscardMsg("");
    try {
      const r = await api<StoreGitStatusResponse>("/api/atlas-stores/git/discard", {
        method: "POST",
        body: JSON.stringify({ mode: discardConfirm }),
      });
      setGitStatus(r);
      setSaveMsg(r.message ?? "Cambios descartados.");
      setDiscardConfirm(null);
      setError("");
      await loadStores();
    } catch (e) {
      setDiscardMsg(e instanceof Error ? e.message : "No se pudieron descartar los cambios.");
    } finally {
      setDiscarding(false);
    }
  }

  async function onPublishGitChanges() {
    setPublishing(true);
    setDiscardMsg("");
    try {
      const r = await api<StoreGitStatusResponse>("/api/atlas-stores/git/publish", {
        method: "POST",
        body: JSON.stringify({ commit_message: publishMessage.trim() }),
      });
      setGitStatus(r);
      setSaveMsg(r.message ?? "Cambios publicados.");
      setError("");
      await loadStores();
    } catch (e) {
      setDiscardMsg(e instanceof Error ? e.message : "No se pudieron publicar los cambios.");
    } finally {
      setPublishing(false);
    }
  }

  const gitErrorHint = useMemo(
    () => Boolean(error && /merge|conflicto|repositorio local|cach[eé] git|needs merge/i.test(error)),
    [error]
  );

  const showGitPanel = Boolean(
    configured || gitErrorHint || gitStatus?.blocked || gitStatus?.dirty
  ) && Boolean(gitStatusLoading || gitStatus?.blocked || gitStatus?.dirty || gitErrorHint);

  const discardConfirmCopy = useMemo(() => {
    if (discardConfirm === "remote") {
      return {
        title: "Usar versión remota",
        message: (
          <>
            Se descartarán todos los cambios locales del caché Git y se restaurará la rama{" "}
            <strong className="text-zinc-300">{gitStatus?.branch ?? "remota"}</strong> desde el servidor. Esta acción
            no se puede deshacer.
          </>
        ),
        confirmLabel: "Restaurar remoto",
      };
    }
    if (discardConfirm === "local") {
      return {
        title: "Descartar cambios locales",
        message:
          "Se eliminarán los cambios sin publicar en el caché Git de Atlas. Los commits ya publicados en el remoto no se tocan.",
        confirmLabel: "Descartar",
      };
    }
    return {
      title: "Abortar operación Git",
      message: "Se cancelará el merge, rebase o cherry-pick en curso. Puede que sigan quedando archivos modificados.",
      confirmLabel: "Abortar",
    };
  }, [discardConfirm, gitStatus?.branch]);

  async function executePublishDetail() {
    if (!detail || !selectedFolder || !canEdit) return;
    setSaving(true);
    try {
      const r = await api<{
        publishMessage?: string;
        message?: string;
        pendingApproval?: boolean;
        store?: StoreDetail;
      }>(`/api/atlas-stores/stores/${encodeURIComponent(selectedFolder)}`, {
        method: "PUT",
        body: JSON.stringify({
          id: detail.id,
          application: (detail.application || "").trim() || "Poslite",
          distro: detail.distro,
          db: detail.db,
          station: {
            stack: detail.station?.stack,
            config: detail.station?.config,
            pullPolicy: detail.station?.pullPolicy ?? "IfNotPresent",
            services: detail.station?.services,
            workers: flattenWorkerGroups(workerGroupsFromStation(detail.station)),
          },
          commit_message: `Atlas: configuración tienda ${detail.id}`,
        }),
      });
      setPublishConfirmOpen(false);
      if (r.pendingApproval) {
        setPublishResultAlert({
          title: "Solicitud enviada",
          message:
            r.message ??
            "Un administrador debe aprobar los cambios antes de que Fleet los aplique en el equipo.",
        });
        pulseAtlasNotifications();
        await loadStores();
        if (r.store) {
          setDetail(r.store);
          setDetailBaseline(cloneStoreDetail(r.store));
        }
        return;
      }
      const published = r.store ?? detail;
      setDetail(published);
      setDetailBaseline(cloneStoreDetail(published));
      setPublishResultAlert({
        title: STORE_FLEET_PUBLISH_SUCCESS.title,
        message: STORE_FLEET_PUBLISH_SUCCESS.message,
      });
      await loadStores();
    } catch (e) {
      setPublishConfirmOpen(false);
      setPublishResultAlert({
        title: "No se pudo publicar",
        message: e instanceof Error ? e.message : "Error al guardar la configuración.",
      });
    } finally {
      setSaving(false);
    }
  }

  function cancelPublishConfirm() {
    if (detailBaseline) setDetail(cloneStoreDetail(detailBaseline));
    setPublishConfirmOpen(false);
  }

  const resolveNewStoreId = useCallback(
    () => (newStoreId.trim() || newFolder.trim()).trim(),
    [newStoreId, newFolder]
  );

  const checkEquipmentForNewStore = useCallback(async (): Promise<RancherCustomCluster | null> => {
    const sid = resolveNewStoreId();
    const app = newApplication.trim();
    if (!sid) {
      setEquipmentCheck(null);
      setCreateError("");
      return null;
    }
    if (!app) {
      setEquipmentCheck(null);
      setCreateError("Indica la aplicación.");
      return null;
    }
    setEquipmentChecking(true);
    setCreateError("");
    try {
      const clusters = await api<ClustersResponse>("/api/atlas-rancher/custom-clusters");
      const want = newDistro.toLowerCase();
      const wantApp = app.toLowerCase();
      const match = (clusters.clusters ?? []).find((c) => {
        if ((c.store || "").trim().toLowerCase() !== sid.toLowerCase()) return false;
        if ((c.application || "").trim().toLowerCase() !== wantApp) return false;
        const d = (c.distro || "").trim().toLowerCase();
        return d === want;
      });
      if (!match) {
        const anyStore = (clusters.clusters ?? []).some(
          (c) => (c.store || "").trim().toLowerCase() === sid.toLowerCase()
        );
        const anyStoreApp = (clusters.clusters ?? []).some(
          (c) =>
            (c.store || "").trim().toLowerCase() === sid.toLowerCase() &&
            (c.application || "").trim().toLowerCase() === wantApp
        );
        setEquipmentCheck(null);
        setCreateError(
          anyStoreApp
            ? `Hay un equipo para «${sid}», pero con otra distribución. Ajusta etiquetas en Equipos o cambia la distribución aquí.`
            : anyStore
            ? `Hay equipo para «${sid}», pero bajo otra aplicación. Ajusta etiqueta application en Equipos o cambia la aplicación aquí.`
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
  }, [resolveNewStoreId, newApplication, newDistro]);

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
    const app = newApplication.trim();
    if (!sid) {
      setCreateError("Indica el código de tienda.");
      return;
    }
    if (!app) {
      setCreateError("Indica la aplicación.");
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
          application: app,
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
      const r = await api<{
        publishMessage?: string;
        message?: string;
        pendingApproval?: boolean;
        store?: StoreDetail;
      }>("/api/atlas-stores/stores", {
        method: "POST",
        body: JSON.stringify({
          folder_name: createPreview.folderName,
          store_id: sid,
          application: (createPreview.application || newApplication || "").trim() || "Poslite",
          distro: newDistro,
          image_channel: newChannel,
        }),
      });
      resetCreateModal();
      if (r.pendingApproval) {
        setSaveMsg(r.message ?? "Solicitud enviada para aprobación.");
        pulseAtlasNotifications();
        await loadStores();
        return;
      }
      setSaveMsg(
        "Tienda registrada. Fleet desplegará la configuración en Rancher; espera unos minutos hasta que el equipo sincronice."
      );
      await loadStores();
      if (r.store) await loadDetail(r.store.folderName);
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

  const applicationOptions = useMemo((): StoreApplicationOption[] => {
    const counts = new Map<string, number>();
    const bump = (raw: string) => {
      const id = normalizeApplication(raw) || raw.trim() || "Poslite";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    bump("Poslite");
    for (const s of stores) bump(s.application || "Poslite");
    return Array.from(counts.entries())
      .filter(([id]) => normalizeApplication(id) !== "IERP")
      .map(([id, count]) => ({ id, label: applicationLabel(id), count }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [stores]);

  const storesForSelectedApplication = useMemo(() => {
    if (!selectedApplication) return [];
    return sortedStores.filter((s) => storeMatchesApplication(s.application, selectedApplication));
  }, [sortedStores, selectedApplication]);

  const displayedStores = useMemo(() => {
    return storesForSelectedApplication.filter(
      (s) =>
        matchesStoreSearchQuery(s, storeSearchQuery) &&
        matchesStoreFilterRules(s, storeAppliedRules)
    );
  }, [storesForSelectedApplication, storeSearchQuery, storeAppliedRules]);

  const storeActiveRuleCount = useMemo(
    () => storeAppliedRules.filter((r) => r.value.trim()).length,
    [storeAppliedRules]
  );

  const hasActiveStoreFilters = storeSearchQuery.trim() !== "" || storeActiveRuleCount > 0;

  const knownApplications = useMemo(() => {
    const apps = new Set<string>();
    apps.add("Poslite");
    for (const s of stores) {
      const app = (s.application || "").trim();
      if (app && normalizeApplication(app) !== "IERP") apps.add(app);
    }
    if (detail?.application?.trim() && normalizeApplication(detail.application) !== "IERP") {
      apps.add(detail.application.trim());
    }
    if (newApplication.trim()) apps.add(newApplication.trim());
    return Array.from(apps).sort((a, b) => a.localeCompare(b, "es"));
  }, [stores, detail?.application, newApplication]);

  const workerGroups = useMemo(
    () => (detail?.station ? workerGroupsFromStation(detail.station) : []),
    [detail?.station]
  );

  const filterQ = serviceFilter.trim().toLowerCase();

  const filteredServices = useMemo(() => {
    const services = detail?.station?.services ?? [];
    if (!filterQ) return services;
    return services.filter((s) => s.key.toLowerCase().includes(filterQ));
  }, [detail?.station?.services, filterQ]);

  const filteredWorkerGroups = useMemo(() => {
    if (!filterQ) return workerGroups;
    return workerGroups
      .map((g) => ({
        ...g,
        workers: g.workers.filter(
          (w) =>
            w.key.toLowerCase().includes(filterQ) ||
            workerDisplayName(w.key, g.id).toLowerCase().includes(filterQ)
        ),
      }))
      .filter((g) => g.workers.length > 0);
  }, [workerGroups, filterQ]);

  const totalSoftwareCount = useMemo(() => {
    const svc = detail?.station?.services?.length ?? 0;
    const wrk = workerGroups.reduce((n, g) => n + g.workers.length, 0);
    return svc + wrk;
  }, [detail?.station?.services, workerGroups]);

  const filteredSoftwareCount =
    filteredServices.length + filteredWorkerGroups.reduce((n, g) => n + g.workers.length, 0);

  const hasSoftwareSections =
    (detail?.station?.services?.length ?? 0) > 0 || workerGroups.some((g) => g.workers.length > 0);

  function selectApplication(app: string) {
    const canon = normalizeApplication(app) || app.trim();
    if (!canon) return;
    setSelectedApplication(canon);
    rememberStoredApplication(canon);
    setNewApplication(canon);
  }

  function clearApplicationSelection() {
    setSelectedApplication(null);
    clearStoredApplication();
    setStoreSearchQuery("");
    setStoreAppliedRules([]);
    setStoreDraftRules([newStoreFilterRule()]);
    setStoreFiltersOpen(false);
  }

  function clearAllStoreFilters() {
    setStoreSearchQuery("");
    setStoreAppliedRules([]);
    setStoreDraftRules([newStoreFilterRule()]);
  }

  function openStoreFiltersPanel() {
    setStoreDraftRules(
      storeAppliedRules.filter((r) => r.value.trim()).length
        ? storeAppliedRules.map((r) => ({ ...r, id: crypto.randomUUID() }))
        : [newStoreFilterRule()]
    );
    setStoreFiltersOpen(true);
  }

  function applyStoreDraftFilters() {
    setStoreAppliedRules(storeDraftRules.filter((r) => r.value.trim()));
    setStoreFiltersOpen(false);
  }

  useEffect(() => {
    if (!storeFiltersOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        storeFiltersPanelRef.current &&
        !storeFiltersPanelRef.current.contains(e.target as Node)
      ) {
        setStoreFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStoreFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [storeFiltersOpen]);

  function goBackToList() {
    setViewMode("list");
    setSelectedFolder(null);
    setDetail(null);
    setDetailBaseline(null);
    setServiceFilter("");
    setEquipment(null);
    setEquipmentLoading(false);
    setPublishConfirmOpen(false);
  }

  function openStore(folder: string) {
    void loadDetail(folder);
  }

  function patchService(key: string, patch: Partial<StoreServiceToggle>) {
    if (!detail?.station) return;
    const services = detail.station.services.map((s) => (s.key === key ? { ...s, ...patch } : s));
    setDetail({ ...detail, station: { ...detail.station, services } });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      {viewMode === "list" ? (
        <>
      {!selectedApplication ? (
        <>
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Gestión de Tiendas</h1>
            <p className="text-xs text-zinc-500">
              Elige la aplicación cuyas tiendas y despliegues quieres configurar en Git y Rancher.
            </p>
          </div>
          <StoresApplicationPicker
            options={applicationOptions}
            loading={loading}
            onSelect={selectApplication}
          />
        </>
      ) : (
        <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearApplicationSelection}
              className="inline-flex items-center gap-1 rounded-lg border border-cf-line bg-cf-card px-2.5 py-1 text-[11px] text-zinc-400 hover:border-cf-orange/40 hover:text-zinc-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Cambiar aplicación
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cf-orange/10 px-2.5 py-0.5 text-[11px] font-medium text-cf-orange ring-1 ring-cf-orange/25">
              <Layers className="h-3 w-3" aria-hidden />
              {applicationLabel(selectedApplication)}
            </span>
          </div>
          <h1 className="text-lg font-semibold text-zinc-100">Gestión de Tiendas</h1>
          <p className="text-xs text-zinc-500">
            Tiendas de <span className="font-medium text-zinc-300">{applicationLabel(selectedApplication)}</span>.
            Al publicar, se actualiza el repositorio y el despliegue automático lo aplica en el equipo.
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Haz clic en una tienda para abrir su ficha y gestionar servicios, tags y despliegue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasActiveStoreFilters ? (
            <button
              type="button"
              onClick={clearAllStoreFilters}
              className="rounded-lg border border-cf-line bg-cf-panel px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500"
            >
              Limpiar filtros
            </button>
          ) : null}
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
              onClick={() => {
                setCreateStep("form");
                setCreatePreview(null);
                setCreateError("");
                setNewApplication(selectedApplication);
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
              Usuario Git (opcional)
              <input
                value={cfgUsername}
                onChange={(e) => setCfgUsername(e.target.value)}
                className={inputClass}
                placeholder="Azure DevOps: vacío o cualquier texto"
                autoComplete="username"
              />
            </label>
            <label className="block text-xs text-zinc-400 sm:col-span-2">
              Token / PAT
              <input
                type="password"
                value={cfgToken}
                onChange={(e) => setCfgToken(e.target.value)}
                className={inputClass}
                placeholder={cfgAuthConfigured ? "Dejar vacío para no cambiar el token guardado" : "Personal Access Token con lectura y escritura en el repo"}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`rounded-full px-2 py-0.5 ring-1 ${
                cfgAuthConfigured
                  ? "bg-emerald-950/50 text-emerald-200 ring-emerald-500/30"
                  : "bg-amber-950/40 text-amber-100 ring-amber-500/30"
              }`}
            >
              {cfgAuthConfigured ? "Token configurado" : "Sin token — no podrás publicar en repos privados"}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Atlas sincroniza el repositorio automáticamente al cargar Tiendas (como Rancher y Cloudflare). Al crear
            o guardar una tienda se publica en la rama configurada. Necesitas un{" "}
            <strong className="font-medium text-zinc-400">PAT</strong> con permiso de lectura/escritura en el repo.
            En <strong className="font-medium text-zinc-400">Azure DevOps</strong> créalo en User settings → Personal
            access tokens (Code: Read &amp; write). En GitHub usa un fine-grained token con acceso al repo.
          </p>
          {cfgTestMsg ? <p className="mt-2 text-xs text-emerald-300">{cfgTestMsg}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cfgTesting || !cfgUrl.trim()}
              onClick={() => void onTestGitConnection()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
            >
              {cfgTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Probar conexión Git
            </button>
            <button type="submit" disabled={cfgSaving} className="rounded-lg bg-cf-orange px-4 py-2 text-xs font-medium text-black disabled:opacity-50">
              {cfgSaving ? "Guardando…" : "Guardar conexión"}
            </button>
          </div>
        </form>
      ) : null}

      {error && !showGitPanel ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      {showGitPanel ? (
        <div
          className={`rounded-xl border px-4 py-3 ${
            gitStatus?.blocked || gitErrorHint
              ? "border-rose-500/35 bg-rose-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                {gitStatus?.blocked || gitErrorHint ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-300" aria-hidden />
                ) : (
                  <GitBranch className="h-4 w-4 shrink-0 text-amber-200" aria-hidden />
                )}
                Cambios pendientes en el repositorio
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                {gitStatus?.blocked || gitErrorHint
                  ? "El caché Git de Atlas quedó con conflictos (p. ej. tras sincronizar). Restaura la versión remota para volver a operar con normalidad."
                  : "Hay cambios locales sin publicar en el caché Git. Puedes publicarlos al remoto o descartarlos."}
              </p>
              {error && (gitStatus?.blocked || gitErrorHint) ? (
                <p className="mt-1 text-[11px] text-rose-200/80">{error}</p>
              ) : null}
              {gitStatus?.summary ? (
                <p className="mt-1 text-[11px] text-zinc-500">{gitStatus.summary}</p>
              ) : null}
            </div>
            {canApprove ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {gitStatus?.mergeInProgress || gitStatus?.rebaseInProgress || gitStatus?.cherryPickInProgress ? (
                  <button
                    type="button"
                    disabled={discarding || publishing}
                    onClick={() => setDiscardConfirm("abort")}
                    className="rounded-lg border border-cf-line bg-cf-panel px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Abortar operación
                  </button>
                ) : null}
                {!gitStatus?.blocked && !gitErrorHint && gitStatus?.canPublish ? (
                  <button
                    type="button"
                    disabled={discarding || publishing || !publishMessage.trim()}
                    onClick={() => void onPublishGitChanges()}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Publicar cambios
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={discarding || publishing}
                  onClick={() => setDiscardConfirm("local")}
                  className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Descartar
                </button>
                <button
                  type="button"
                  disabled={discarding || publishing}
                  onClick={() => setDiscardConfirm("remote")}
                  className="inline-flex items-center gap-1 rounded-lg bg-cf-orange px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-50"
                >
                  {discarding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Usar versión remota
                </button>
              </div>
            ) : null}
          </div>

          {!gitStatus?.blocked && !gitErrorHint && gitStatus?.canPublish && canApprove ? (
            <label className="mt-3 block text-xs text-zinc-400">
              Mensaje de commit
              <input
                value={publishMessage}
                onChange={(e) => setPublishMessage(e.target.value)}
                className={inputClass}
                placeholder="Atlas: publicar cambios locales del caché"
              />
            </label>
          ) : null}

          {gitStatusLoading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Leyendo estado Git…
            </div>
          ) : gitStatus?.changes?.length ? (
            <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-cf-line/50 bg-cf-card/80 p-2">
              {gitStatus.changes.map((c) => (
                <li key={`${c.status}:${c.path}`} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 ring-1 ${gitChangeBadgeClass(c.status)}`}
                  >
                    {c.label}
                  </span>
                  <code className="truncate font-mono text-zinc-300">{c.path}</code>
                </li>
              ))}
            </ul>
          ) : null}

          {discardMsg ? <p className="mt-2 text-xs text-emerald-300">{discardMsg}</p> : null}
        </div>
      ) : null}

      <AtlasConfirmDialog
        open={discardConfirm !== null}
        title={discardConfirmCopy.title}
        message={discardConfirmCopy.message}
        confirmLabel={discardConfirmCopy.confirmLabel}
        cancelLabel="Cancelar"
        variant="danger"
        busy={discarding}
        onConfirm={() => void onConfirmDiscard()}
        onCancel={() => setDiscardConfirm(null)}
      />

      {message && !configured ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{message}</div>
      ) : null}
      {saveMsg ? <p className="text-xs text-zinc-400">{saveMsg}</p> : null}

      {storesForSelectedApplication.length > 0 ? (
        <div ref={storeFiltersPanelRef} className="relative flex flex-wrap items-center gap-2">
          <StoreSearchInput value={storeSearchQuery} onChange={setStoreSearchQuery} />
          <button
            type="button"
            onClick={() =>
              storeFiltersOpen ? setStoreFiltersOpen(false) : openStoreFiltersPanel()
            }
            aria-expanded={storeFiltersOpen}
            aria-haspopup="dialog"
            className={
              storeFiltersOpen || storeActiveRuleCount > 0
                ? "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-orange/45 bg-cf-orange/10 px-3.5 py-2 text-sm font-medium text-zinc-100 ring-1 ring-cf-orange/25"
                : "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-line bg-cf-panel/90 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
            }
          >
            <Filter className="h-4 w-4 text-zinc-400" aria-hidden />
            Filtros
            {storeActiveRuleCount > 0 ? (
              <span className="rounded-full bg-cf-orange/25 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-cf-orange">
                {storeActiveRuleCount}
              </span>
            ) : null}
          </button>
          {storeFiltersOpen ? (
            <StoreFiltersPanel
              rules={storeDraftRules}
              onChange={setStoreDraftRules}
              onApply={applyStoreDraftFilters}
              onClose={() => setStoreFiltersOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-cf-line/70 bg-cf-panel ring-1 ring-cf-line/30">
          {loading ? (
            <AtlasLoadingSplash message="Cargando tiendas…" minHeight="min-h-[280px]" />
          ) : storesForSelectedApplication.length === 0 ? (
            <div className="p-10 text-center text-sm text-zinc-500">
              <Store className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
              {sortedStores.length === 0
                ? "No hay tiendas en el repositorio."
                : `No hay tiendas de ${applicationLabel(selectedApplication)} en el repositorio.`}
            </div>
          ) : (
            <>
              <p className="border-b border-cf-line/50 px-4 py-3 text-sm text-zinc-400">
                {displayedStores.length === storesForSelectedApplication.length ? (
                  <>
                    <span className="font-medium text-zinc-300">{storesForSelectedApplication.length}</span>{" "}
                    tienda{storesForSelectedApplication.length !== 1 ? "s" : ""}
                  </>
                ) : (
                  <>
                    <span className="font-medium text-zinc-300">{displayedStores.length}</span> de{" "}
                    {storesForSelectedApplication.length} tienda
                    {storesForSelectedApplication.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
              {displayedStores.length === 0 ? (
                <div className="p-10 text-center text-sm text-zinc-500">
                  Ninguna tienda coincide con la búsqueda o los filtros seleccionados.
                </div>
              ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/50 text-xs uppercase text-zinc-500">
                  <th className="px-4 py-3">Tienda</th>
                  <th className="px-4 py-3">Distribución</th>
                  <th className="px-4 py-3">Tag (versión)</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {displayedStores.map((s) => (
                  <tr
                    key={s.folderName}
                    onClick={() => openStore(s.folderName)}
                    className="group cursor-pointer border-b border-cf-line/30 transition-colors hover:bg-cf-orange/[0.04] hover:border-cf-orange/20"
                  >
                    <td className="px-4 py-3 font-medium text-zinc-200 group-hover:text-zinc-100">
                      {s.id}
                      {pendingFolders.includes(s.folderName) ? (
                        <span className="ml-2 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-normal text-sky-300 ring-1 ring-sky-500/25">
                          pendiente
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-[10px] font-normal text-zinc-600 group-hover:text-zinc-500 sm:hidden">
                        Toca para gestionar
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{distroLabel(s.distro)}</td>
                    <td className="px-4 py-3 text-zinc-500" title="Resumen; cada servicio puede tener otro tag en la ficha">
                      {s.imageChannel || "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell">
                      <span className="inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs text-zinc-500 transition-colors group-hover:border-cf-orange/30 group-hover:bg-cf-orange/10 group-hover:text-cf-orange">
                        Gestionar
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              )}
            </>
          )}
        </div>
        </>
      )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={goBackToList}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cf-line px-3 py-1.5 text-xs text-zinc-300 hover:bg-cf-card"
              >
                <ChevronLeft className="h-4 w-4" />
                {selectedApplication ? applicationLabel(selectedApplication) : "Tiendas"}
              </button>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-zinc-100">{detail?.id ?? selectedFolder}</h1>
                {detail ? (
                  <p className="truncate text-xs text-zinc-500">
                    {detail.folderName} · {applicationLabel(detail.application)} · {distroLabel(detail.distro)} · {detail.stacks.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
            {canEdit ? (
              <button
                type="button"
                onClick={() => setPublishConfirmOpen(true)}
                disabled={saving || detailLoading || !detail}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-cf-orange px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {canApprove ? "Publicar cambios" : "Enviar para aprobación"}
              </button>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-cf-line/70 bg-cf-panel">
          {detailLoading || !detail ? (
            <AtlasLoadingSplash message={`Cargando ficha de ${selectedFolder ?? "tienda"}…`} />
          ) : (
            <div className="flex flex-col gap-5 p-4 sm:p-6">
              <section>
                <h3 className="text-xs font-medium uppercase text-zinc-500">Equipo vinculado</h3>
                {equipmentLoading ? (
                  <p className="mt-1 inline-flex items-center gap-2 text-sm text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Buscando equipo en Rancher…
                  </p>
                ) : equipment ? (
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
                  Etiquetas requeridas: atlas=true, store={detail.id}, application={detail.application || "Poslite"}
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
                  <label className="text-xs text-zinc-500">
                    Aplicación
                    <input
                      value={detail.application || ""}
                      onChange={(e) => setDetail({ ...detail, application: e.target.value })}
                      className={inputClass}
                      list="atlas-store-applications"
                      placeholder="Ej. Poslite"
                      disabled={!canEdit}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-zinc-500">Tags y pull policy</p>
                    <p className="mt-0.5 text-[11px] text-zinc-600">
                      Cada servicio y proceso tiene su propio tag (p. ej.{" "}
                      <span className="text-zinc-400">stable</span>,{" "}
                      <span className="text-zinc-400">unstable</span>). Edítalos en las tablas de abajo. La pull
                      policy es la clave global{" "}
                      <span className="text-zinc-400">values.pullPolicy</span> del fleet.yaml (junto a{" "}
                      <span className="text-zinc-400">nameOverride</span>).
                    </p>
                    {canEdit ? (
                      <label className="mt-2 inline-block text-[11px] text-zinc-600">
                        Pull policy
                        <select
                          value={detail.station?.pullPolicy ?? "IfNotPresent"}
                          onChange={(e) =>
                            setDetail({
                              ...detail,
                              station: {
                                ...detail.station,
                                pullPolicy: e.target.value as StoreImagePullPolicy,
                              },
                            })
                          }
                          className={`${inputClass} mt-0.5 max-w-[12rem]`}
                        >
                          {STORE_IMAGE_PULL_POLICIES.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </label>
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
                </section>
              ) : null}

              {hasSoftwareSections ? (
                <>
                  <section>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-xs font-medium uppercase text-zinc-500">Software desplegado</h3>
                        <p className="mt-0.5 text-[11px] text-zinc-600">
                          Busca en procesos generales, iERP y servicio de estación.
                        </p>
                      </div>
                      <label className="relative block w-full sm:max-w-xs">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                          type="search"
                          value={serviceFilter}
                          onChange={(e) => setServiceFilter(e.target.value)}
                          placeholder="Buscar servicio o proceso…"
                          className="w-full rounded-lg border border-cf-line bg-cf-card py-1.5 pl-8 pr-3 text-xs text-zinc-100 outline-none focus:border-cf-orange/50"
                        />
                      </label>
                    </div>
                    {filterQ && filteredSoftwareCount === 0 ? (
                      <p className="mt-3 rounded-lg border border-cf-line/40 bg-cf-card/70 px-3 py-4 text-center text-xs text-zinc-500">
                        Ningún servicio o proceso coincide con «{serviceFilter.trim()}».
                      </p>
                    ) : null}
                    {filterQ && filteredSoftwareCount > 0 ? (
                      <p className="mt-2 text-[11px] text-zinc-600">
                        {filteredSoftwareCount} de {totalSoftwareCount} coincidencias
                      </p>
                    ) : null}
                  </section>

                  {detail.station?.services?.length &&
                  (!filterQ || filteredServices.length > 0) ? (
                    <section>
                      <h3 className="text-xs font-medium uppercase text-zinc-500">Procesos generales</h3>
                      <div className="mt-2 max-h-72 overflow-y-auto rounded border border-cf-line/40">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-cf-panel text-[10px] uppercase text-zinc-600">
                            <tr>
                              <th className="w-8 px-2 py-1.5" />
                              <th className="px-2 py-1.5">Servicio</th>
                              <th className="px-2 py-1.5">Tag (versión)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(filterQ ? filteredServices : detail.station.services).map((svc) => (
                              <tr key={svc.key} className="border-t border-cf-line/30">
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={svc.enabled}
                                    onChange={(e) => patchService(svc.key, { enabled: e.target.checked })}
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
                                    onChange={(e) => patchService(svc.key, { tag: e.target.value })}
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

                  {filteredWorkerGroups.map((group) => (
                    <section key={group.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-medium uppercase text-zinc-500">{group.label}</h3>
                          {group.id === "ierp" ? (
                            <p className="mt-0.5 text-[11px] text-zinc-600">
                              Integración iERP: cada fila es un proceso de sincronización.
                            </p>
                          ) : null}
                        </div>
                        {group.id === "ierp" && canEdit ? (
                          <button
                            type="button"
                            onClick={() => setDetail((d) => (d ? disableAllIerpWorkers(d) : d))}
                            className="rounded-lg border border-rose-500/30 bg-rose-950/20 px-2.5 py-1 text-[11px] text-rose-300 hover:border-rose-500/50"
                          >
                            Desactivar todo iERP
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 max-h-44 overflow-y-auto rounded border border-cf-line/40">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-cf-panel text-[10px] uppercase text-zinc-600">
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
                </>
              ) : null}

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
      )}
      <datalist id="atlas-store-applications">
        {knownApplications.map((app) => (
          <option key={app} value={app} />
        ))}
      </datalist>

      <AtlasConfirmDialog
        open={publishConfirmOpen}
        title={canApprove ? "Publicar cambios" : "Enviar para aprobación"}
        message={
          <>
            {detailHasChanges ? (
              <p>
                {canApprove
                  ? "Revisa el resumen antes de enviar la configuración a Fleet (Rancher)."
                  : "Revisa el resumen antes de enviar la solicitud. Un administrador deberá aprobarla para que Fleet aplique los cambios."}
              </p>
            ) : (
              <p className="text-amber-200/90">
                No hay cambios respecto a la versión cargada del servidor. Edita la ficha antes de publicar.
              </p>
            )}
            {detailHasChanges ? (
              <div className="mt-3">
                <PublishChangeSummary lines={publishChangeLines} />
              </div>
            ) : null}
            {detailHasChanges ? (
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Cancelar descarta los cambios locales y restaura la configuración cargada del servidor.
              </p>
            ) : null}
          </>
        }
        confirmLabel={canApprove ? "Confirmar y publicar" : "Enviar solicitud"}
        cancelLabel={detailHasChanges ? "Cancelar y descartar" : "Cerrar"}
        confirmDisabled={!detailHasChanges}
        busy={saving}
        onConfirm={() => void executePublishDetail()}
        onCancel={detailHasChanges ? cancelPublishConfirm : () => setPublishConfirmOpen(false)}
      />

      <AtlasAlertDialog
        open={publishResultAlert !== null}
        title={publishResultAlert?.title ?? ""}
        message={publishResultAlert?.message ?? ""}
        onClose={() => setPublishResultAlert(null)}
      />

      <AnimatePresence>
        {createOpen ? (
          <AtlasModalShell
            onBackdropClick={() => resetCreateModal()}
            zIndexClass="z-50"
            panelClassName={`w-full rounded-xl border border-cf-line bg-cf-panel p-5 shadow-2xl ring-1 ring-cf-line/40 ${createStep === "review" ? "max-w-2xl max-h-[90vh] overflow-y-auto" : "max-w-md"}`}
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
                    Aplicación
                    <input
                      value={newApplication}
                      onChange={(e) => setNewApplication(e.target.value)}
                      className={inputClass}
                      list="atlas-store-applications"
                      placeholder="Ej. Poslite"
                    />
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
                <section className="rounded-lg border border-cf-line/60 bg-cf-card/90 p-3">
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
                      <dt className="text-zinc-500">Aplicación</dt>
                      <dd className="text-zinc-200">{applicationLabel(createPreview.application || newApplication)}</dd>
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

                <section className="rounded-lg border border-cf-line/60 bg-cf-card/90 p-3">
                  <p className="font-medium text-zinc-300">Etiquetas del cluster (Fleet)</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(createPreview.clusterLabels).map(([k, v]) => (
                      <li key={k} className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                        {k}={v}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-cf-card/90 p-3">
                  <p className="font-medium text-zinc-300">Archivos que se subirán al repositorio</p>
                  <ul className="mt-2 space-y-2">
                    {createPreview.files.map((f) => (
                      <li key={f.path} className="rounded border border-cf-line/40 bg-cf-card/70 px-2 py-1.5">
                        <p className="font-mono text-[11px] text-zinc-200">{f.path}</p>
                        <p className="text-zinc-500">
                          Plantilla: {f.sourceTemplate} · chart {f.chart} {f.chartVersion}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-cf-card/90 p-3">
                  <p className="font-medium text-zinc-300">Base de datos</p>
                  <p className="mt-1 text-zinc-400">
                    DB {createPreview.db.database || "poslite"} ·{" "}
                    {createPreview.db.persistenceEnabled ? "persistencia on" : "sin persistencia"}
                  </p>
                </section>

                <section className="rounded-lg border border-cf-line/60 bg-cf-card/90 p-3">
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
                    className="flex-1 rounded-lg border border-cf-line py-2 text-xs text-zinc-300 hover:bg-cf-card"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    disabled={!createPreview.canPublish || createPublishing}
                    onClick={() => void onConfirmCreate()}
                    className="flex-1 rounded-lg bg-cf-orange py-2 text-xs font-medium text-black disabled:opacity-50"
                  >
                    {createPublishing
                      ? "Enviando…"
                      : canApprove
                        ? "Confirmar y publicar en Git"
                        : "Enviar solicitud de creación"}
                  </button>
                </div>
              </div>
            ) : null}
          </AtlasModalShell>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
