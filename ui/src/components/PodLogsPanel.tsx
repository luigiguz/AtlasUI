import { Loader2, Pause, Play, ScrollText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiUrl, bearerHeaders } from "../apiClient";
import type { RancherCustomCluster, RancherPod } from "../rancherTypes";

type PodLogsResponse = {
  ok: boolean;
  logs: string;
  pod: string;
  container?: string | null;
};

function pickPrimaryPod(pods: RancherPod[]): RancherPod | null {
  if (!pods.length) return null;
  const running = pods.find((p) => p.phase.toLowerCase() === "running");
  return running ?? pods[0];
}

function podLogsUrl(
  cluster: RancherCustomCluster,
  podName: string,
  opts: {
    container?: string;
    tailLines?: number;
    follow?: boolean;
    previous?: boolean;
  }
): string {
  const ns = encodeURIComponent(cluster.namespace);
  const nm = encodeURIComponent(cluster.name);
  const pod = encodeURIComponent(podName);
  const steve = encodeURIComponent(cluster.steveCollection || "provisioning.cattle.io.customclusters");
  const params = new URLSearchParams({ steve_collection: steve });
  if (opts.container) params.set("container", opts.container);
  if (opts.tailLines != null) params.set("tail_lines", String(opts.tailLines));
  if (opts.follow) params.set("follow", "true");
  if (opts.previous) params.set("previous", "true");
  return apiUrl(`/api/atlas-rancher/custom-clusters/${ns}/${nm}/pods/${pod}/logs?${params}`);
}

type Props = {
  cluster: RancherCustomCluster;
  serviceName: string;
  pods: RancherPod[];
  onClose: () => void;
};

export function PodLogsPanel({ cluster, serviceName, pods, onClose }: Props) {
  const primary = pickPrimaryPod(pods);
  const [podName, setPodName] = useState(primary?.name ?? "");
  const [container, setContainer] = useState("");
  const [previous, setPrevious] = useState(false);
  const [live, setLive] = useState(true);
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const activePod = pods.find((p) => p.name === podName) ?? primary;
  const containers = activePod?.containers ?? [];

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
  }, [logs, scrollToBottom]);

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
        const url = podLogsUrl(cluster, podName, {
          container: container || undefined,
          tailLines: 500,
          previous,
        });
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
        if (!cancelled) setLogs(data.logs || "");
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
  }, [cluster, podName, container, previous, live]);

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
        const url = podLogsUrl(cluster, podName, {
          container: container || undefined,
          tailLines: 500,
          follow: true,
          previous,
        });
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
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            setLogs((prev) => {
              const next = prev + dec.decode(value, { stream: true });
              if (next.length > 512_000) return next.slice(-400_000);
              return next;
            });
          }
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
  }, [live, cluster, podName, container, previous]);

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
        className="flex h-[min(85vh,42rem)] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-cf-line bg-[#0d1014] shadow-2xl ring-1 ring-white/[0.06] sm:rounded-2xl"
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
            onClick={() => setLive((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ring-1 ${
              live
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                : "text-zinc-400 ring-cf-line hover:bg-white/5"
            }`}
          >
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? "En vivo" : "Pausado"}
          </button>
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
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={previous}
              onChange={(e) => setPrevious(e.target.checked)}
              className="rounded border-cf-line accent-cf-orange"
            />
            Instancia anterior
          </label>
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
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-cf-orange" />
              Cargando logs…
            </div>
          ) : error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : logs ? (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-zinc-300">
              {logs}
            </pre>
          ) : (
            <p className="text-sm text-zinc-500">Sin salida de log todavía.</p>
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
