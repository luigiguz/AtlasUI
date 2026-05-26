import {
  ChevronUp,
  Download,
  Loader2,
  Pause,
  Play,
  ScrollText,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiUrl, bearerHeaders } from "../apiClient";
import type { RancherCustomCluster, RancherPod } from "../rancherTypes";

type PodLogsResponse = {
  ok: boolean;
  logs: string;
  pod: string;
  container?: string | null;
};

type LogRangeId = "500" | "1000" | "30m" | "1h" | "24h" | "all";

type LogRangeOption = {
  id: LogRangeId;
  label: string;
  tailLines?: number;
  sinceSeconds?: number;
};

const LOG_RANGES: LogRangeOption[] = [
  { id: "500", label: "500 líneas", tailLines: 500 },
  { id: "1000", label: "1000 líneas", tailLines: 1000 },
  { id: "30m", label: "30 minutos", sinceSeconds: 1800 },
  { id: "1h", label: "1 hora", sinceSeconds: 3600 },
  { id: "24h", label: "24 horas", sinceSeconds: 86400 },
  { id: "all", label: "Todo", tailLines: 5000 },
];

const PREFS_KEY = "atlas-pod-logs-prefs";

type LogPrefs = {
  rangeId: LogRangeId;
  wrapLines: boolean;
  showTimestamps: boolean;
};

function loadLogPrefs(): LogPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { rangeId: "24h", wrapLines: true, showTimestamps: true };
    const p = JSON.parse(raw) as Partial<LogPrefs>;
    const rangeId = LOG_RANGES.some((r) => r.id === p.rangeId) ? (p.rangeId as LogRangeId) : "24h";
    return {
      rangeId,
      wrapLines: p.wrapLines !== false,
      showTimestamps: p.showTimestamps !== false,
    };
  } catch {
    return { rangeId: "24h", wrapLines: true, showTimestamps: true };
  }
}

function saveLogPrefs(prefs: LogPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

function pickPrimaryPod(pods: RancherPod[]): RancherPod | null {
  if (!pods.length) return null;
  const running = pods.find((p) => p.phase.toLowerCase() === "running");
  return running ?? pods[0];
}

function logsLookLikeHtml(text: string): boolean {
  const head = text.slice(0, 1200).trimStart().toLowerCase();
  return (
    head.startsWith("<!") ||
    head.startsWith("<html") ||
    (head.includes("if you are reading this") && head.includes("application/json"))
  );
}

function rangeById(id: LogRangeId): LogRangeOption {
  return LOG_RANGES.find((r) => r.id === id) ?? LOG_RANGES[4];
}

function podLogsUrl(
  cluster: RancherCustomCluster,
  podName: string,
  opts: {
    podNamespace?: string;
    container?: string;
    range: LogRangeOption;
    follow?: boolean;
    previous?: boolean;
    timestamps?: boolean;
  }
): string {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  const pod = encodeURIComponent(podName);
  const steve = encodeURIComponent(cluster.steveCollection || "provisioning.cattle.io.customclusters");
  const params = new URLSearchParams({ steve_collection: steve });
  if (opts.podNamespace) params.set("pod_namespace", opts.podNamespace);
  if (opts.container) params.set("container", opts.container);
  if (opts.range.sinceSeconds) params.set("since_seconds", String(opts.range.sinceSeconds));
  else if (opts.range.tailLines) params.set("tail_lines", String(opts.range.tailLines));
  if (opts.follow) params.set("follow", "true");
  if (opts.previous) params.set("previous", "true");
  if (opts.timestamps === false) params.set("timestamps", "false");
  return apiUrl(`/api/atlas-rancher/custom-clusters/${ns}/${nm}/pods/${pod}/logs?${params}`);
}

function filterLogText(text: string, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  return text
    .split("\n")
    .filter((line) => line.toLowerCase().includes(q))
    .join("\n");
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").slice(0, 80);
}

type Props = {
  cluster: RancherCustomCluster;
  serviceName: string;
  pods: RancherPod[];
  onClose: () => void;
};

export function PodLogsPanel({ cluster, serviceName, pods, onClose }: Props) {
  const initialPrefs = useMemo(() => loadLogPrefs(), []);
  const primary = pickPrimaryPod(pods);
  const [podName, setPodName] = useState(primary?.name ?? "");
  const [container, setContainer] = useState("");
  const [previous, setPrevious] = useState(false);
  const [live, setLive] = useState(true);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rangeId, setRangeId] = useState<LogRangeId>(initialPrefs.rangeId);
  const [wrapLines, setWrapLines] = useState(initialPrefs.wrapLines);
  const [showTimestamps, setShowTimestamps] = useState(initialPrefs.showTimestamps);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const logRange = rangeById(rangeId);
  const activePod = pods.find((p) => p.name === podName) ?? primary;
  const podK8sNs =
    (activePod?.k8sNamespace || activePod?.namespace || "").trim() || undefined;
  const containers = activePod?.containers ?? [];

  const logQueryOpts = useMemo(
    () => ({
      podNamespace: podK8sNs,
      container: container || undefined,
      range: logRange,
      previous,
      timestamps: showTimestamps,
    }),
    [podK8sNs, container, logRange, previous, showTimestamps]
  );

  const displayedLogs = useMemo(() => filterLogText(logs, filter), [logs, filter]);

  useEffect(() => {
    saveLogPrefs({ rangeId, wrapLines, showTimestamps });
  }, [rangeId, wrapLines, showTimestamps]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [settingsOpen]);

  useEffect(() => {
    if (containers.length === 1) setContainer(containers[0]);
    else if (containers.length > 1 && !containers.includes(container)) setContainer(containers[0]);
    else if (!containers.length) setContainer("");
  }, [podName, containers, container]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [displayedLogs, scrollToBottom]);

  const handleClear = () => {
    setLogs("");
    setError("");
    stickBottomRef.current = true;
  };

  const handleDownload = () => {
    const body = displayedLogs || logs;
    if (!body.trim()) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = safeFilenamePart(`${serviceName}-${podName}-${container || "pod"}`);
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${stamp}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (live || !podName) {
      if (!podName) {
        setError("No hay pods en ejecución para este servicio.");
        setLoading(false);
      }
      return;
    }

    let cancelled = false;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    async function loadSnapshot() {
      setLoading(true);
      setError("");
      try {
        const url = podLogsUrl(cluster, podName, { ...logQueryOpts });
        const res = await fetch(url, {
          headers: { ...bearerHeaders(), Accept: "application/json" },
          signal: ac.signal,
        });
        if (!res.ok) {
          const body = await res.text();
          let detail = body;
          try {
            const j = JSON.parse(body) as { detail?: string };
            if (j.detail) detail = j.detail;
          } catch {
            /* plain text */
          }
          throw new Error(detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as PodLogsResponse;
        const body = data.logs || "";
        if (!cancelled) {
          if (logsLookLikeHtml(body)) {
            setLogs("");
            setError(
              "Rancher devolvió HTML en lugar del log. Reconstruye atlas-api con el último código o revisa el namespace del pod."
            );
          } else {
            setLogs(body);
          }
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setLogs("");
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [cluster, podName, live, logQueryOpts]);

  useEffect(() => {
    if (!live || !podName) return;

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;

    let cancelled = false;
    setLoading(true);
    setError("");
    setLogs("");

    async function stream() {
      try {
        const url = podLogsUrl(cluster, podName, { ...logQueryOpts, follow: true });
        const res = await fetch(url, {
          headers: bearerHeaders(),
          signal: ac.signal,
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `HTTP ${res.status}`);
        }
        if (!cancelled) setLoading(false);
        const reader = res.body?.getReader();
        if (!reader) return;
        const dec = new TextDecoder();
        let buf = "";
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          buf += dec.decode(value, { stream: true });
          if (buf.length > 1500 && logsLookLikeHtml(buf.slice(0, 1500))) {
            throw new Error(
              "Rancher devolvió HTML en lugar del log. Reconstruye atlas-api con el último código."
            );
          }
          const trimmed = buf.length > 512_000 ? buf.slice(-400_000) : buf;
          if (!cancelled) setLogs(trimmed);
        }
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : String(e));
        setLive(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void stream();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [live, cluster, podName, logQueryOpts]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,44rem)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-cf-line bg-[#0d1014] shadow-2xl ring-1 ring-white/[0.06] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pod-logs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-cf-line/80 px-4 py-3">
          <ScrollText className="h-4 w-4 shrink-0 text-cf-orange" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="pod-logs-title" className="truncate text-sm font-semibold text-zinc-100">
              Logs — {serviceName}
            </h2>
            <p className="truncate text-[11px] text-zinc-500">{clusterDisplayName(cluster)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-cf-line/40 bg-black/30 px-4 py-2">
          {pods.length > 1 ? (
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              Pod
              <select
                value={podName}
                onChange={(e) => setPodName(e.target.value)}
                className="rounded border border-cf-line bg-black/40 px-2 py-1 text-xs text-zinc-200"
              >
                {pods.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.phase})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="font-mono text-[11px] text-zinc-500">{podName}</span>
          )}
          {containers.length > 1 ? (
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              Contenedor
              <select
                value={container}
                onChange={(e) => setContainer(e.target.value)}
                className="rounded border border-cf-line bg-black/40 px-2 py-1 text-xs text-zinc-200"
              >
                {containers.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : containers.length === 1 ? (
            <span className="text-[11px] text-zinc-600">· {containers[0]}</span>
          ) : null}
          <span className="ml-auto text-[10px] text-zinc-600">{logRange.label}</span>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto bg-[#070809] p-3"
          onScroll={() => {
            const el = scrollRef.current;
            if (!el) return;
            stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {loading && !logs ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-cf-orange" />
              Cargando logs…
            </div>
          ) : error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : displayedLogs ? (
            <pre
              className={`font-mono text-[11px] leading-relaxed text-zinc-300 ${
                wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto"
              }`}
            >
              {displayedLogs}
            </pre>
          ) : filter.trim() && logs ? (
            <p className="text-sm text-zinc-500">Ninguna línea coincide con el filtro.</p>
          ) : (
            <p className="text-sm text-zinc-500">Sin salida de log todavía.</p>
          )}
        </div>

        <div className="relative shrink-0 border-t border-cf-line/80 bg-[#0a0c0f] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
                live
                  ? "bg-cf-orange/20 text-cf-orange ring-cf-orange/40"
                  : "text-zinc-300 ring-cf-line hover:bg-white/5"
              }`}
            >
              {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              Seguir
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-cf-line hover:bg-white/5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!logs.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-300 ring-1 ring-cf-line hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar
            </button>

            <label className="ml-auto flex min-w-[8rem] max-w-[14rem] flex-1 items-center gap-1.5 rounded-lg bg-black/40 px-2 py-1 ring-1 ring-cf-line/60 sm:max-w-xs">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar…"
                className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </label>

            <div ref={settingsRef} className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ring-1 transition-colors ${
                  settingsOpen
                    ? "bg-white/10 text-zinc-100 ring-cf-line"
                    : "text-zinc-400 ring-cf-line hover:bg-white/5"
                }`}
                aria-expanded={settingsOpen}
                aria-haspopup="true"
                aria-label="Ajustes de logs"
              >
                <Settings className="h-3.5 w-3.5" />
                <ChevronUp
                  className={`h-3 w-3 transition-transform ${settingsOpen ? "" : "rotate-180"}`}
                />
              </button>

              {settingsOpen ? (
                <div
                  className="absolute bottom-full right-0 z-10 mb-2 w-64 rounded-xl border border-cf-line bg-[#111418] p-3 shadow-xl ring-1 ring-white/[0.06]"
                  role="menu"
                >
                  <label className="mb-3 block text-[11px] text-zinc-500">
                    Mostrar últimas
                    <select
                      value={rangeId}
                      onChange={(e) => setRangeId(e.target.value as LogRangeId)}
                      className="mt-1 w-full rounded-lg border border-cf-line bg-black/50 px-2 py-1.5 text-xs text-zinc-100"
                    >
                      {LOG_RANGES.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={wrapLines}
                      onChange={(e) => setWrapLines(e.target.checked)}
                      className="rounded border-cf-line accent-cf-orange"
                    />
                    Ajustar líneas
                  </label>
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={showTimestamps}
                      onChange={(e) => setShowTimestamps(e.target.checked)}
                      className="rounded border-cf-line accent-cf-orange"
                    />
                    Mostrar marcas de tiempo
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={previous}
                      onChange={(e) => setPrevious(e.target.checked)}
                      className="rounded border-cf-line accent-cf-orange"
                    />
                    Instancia anterior del contenedor
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          {live ? (
            <p className="mt-1.5 text-[10px] text-emerald-500/80">Conectado — recibiendo líneas nuevas</p>
          ) : (
            <p className="mt-1.5 text-[10px] text-zinc-600">En pausa — pulsa Seguir para actualizar en vivo</p>
          )}
        </div>
      </div>
    </div>
  );
}

function clusterDisplayName(c: RancherCustomCluster): string {
  return (c.displayName || c.name).trim();
}

export { pickPrimaryPod };
