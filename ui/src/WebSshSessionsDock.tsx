import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createPortal, flushSync } from "react-dom";
import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUp,
  Cpu,
  Copy,
  ExternalLink,
  GripHorizontal,
  GripVertical,
  HardDrive,
  MemoryStick,
  Minus,
  Monitor,
  PanelBottomOpen,
  Plus,
  Server,
  Terminal as TerminalIcon,
  User,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";

import { getAccessToken, wsUrl } from "./apiClient";

export type SshWebSession = { id: string; site: string; minimized: boolean; poppedOut?: boolean };

export type SshWebPopoutParams = { site: string; dockSessionId: string | null };

/** Popout con `dockSession` = espejo del terminal del dock (misma sesión SSH). Sin él = terminal propio en la ventana. */
export function parseSshWebPopoutParams(search: string): SshWebPopoutParams | null {
  try {
    const q = search.startsWith("?") ? search.slice(1) : search;
    const p = new URLSearchParams(q);
    if (p.get("sshPopout") !== "1") return null;
    const site = p.get("site")?.trim();
    if (!site) return null;
    const dockSessionId = p.get("dockSession")?.trim() || null;
    return { site, dockSessionId };
  } catch {
    return null;
  }
}

export function parseSshWebPopoutSite(search: string): string | null {
  return parseSshWebPopoutParams(search)?.site ?? null;
}

export function buildSshWebPopoutUrl(site: string, dockSessionId?: string | null): string {
  const u = new URL(window.location.origin + window.location.pathname);
  u.searchParams.set("sshPopout", "1");
  u.searchParams.set("site", site);
  if (dockSessionId) u.searchParams.set("dockSession", dockSessionId);
  return u.href;
}

export function sshRelayChannelName(sessionId: string): string {
  return `atlas-ssh-relay-${sessionId}`;
}

/** Consola del navegador: `localStorage.setItem('atlas_ssh_debug','1')` y recargar; en desarrollo también está activo. */
function sshTerminalWebDebug(): boolean {
  try {
    return (
      Boolean(import.meta.env.DEV) ||
      globalThis.localStorage?.getItem("atlas_ssh_debug") === "1" ||
      globalThis.localStorage?.getItem("atlasvpn_ssh_debug") === "1"
    );
  } catch {
    return Boolean(import.meta.env.DEV);
  }
}

export type SshHostDiskStat = { mount: string; pct: number };

/** Métricas del host remoto (Linux) enviadas por el WebSocket; `net_*` aparece tras el segundo muestreo. */
export type SshHostStatsPayload = {
  hostname?: string;
  cpu_pct?: number;
  load1?: number;
  mem_total_kb?: number | null;
  mem_avail_kb?: number | null;
  uptime_text?: string;
  user?: string;
  disks?: SshHostDiskStat[];
  net_down_mbps?: number;
  net_up_mbps?: number;
};

function SshHostStatusBar({
  stats,
  siteFallback,
}: {
  stats: SshHostStatsPayload | null;
  siteFallback: string;
}): ReactElement {
  const histRef = useRef<number[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    const c = stats?.cpu_pct;
    if (typeof c === "number" && !Number.isNaN(c)) {
      histRef.current = [...histRef.current.slice(-19), c];
      tick((x) => x + 1);
    }
  }, [stats?.cpu_pct]);

  const n0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
  const n2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const host = (stats?.hostname || siteFallback || "").trim() || siteFallback || "—";
  const cpu = stats && typeof stats.cpu_pct === "number" && !Number.isNaN(stats.cpu_pct) ? stats.cpu_pct : null;
  const cpuColor =
    cpu == null ? "text-zinc-500" : cpu >= 85 ? "text-red-400" : cpu >= 55 ? "text-amber-300" : "text-emerald-400";

  let memLine: string | null = null;
  const mtk = stats?.mem_total_kb;
  const mak = stats?.mem_avail_kb;
  if (typeof mtk === "number" && mtk > 0 && typeof mak === "number" && mak >= 0) {
    const usedGb = (mtk - mak) / (1024 * 1024);
    const totGb = mtk / (1024 * 1024);
    memLine = `${n2.format(usedGb)} GB / ${n2.format(totGb)} GB`;
  }

  const up = stats?.net_up_mbps;
  const dn = stats?.net_down_mbps;
  const upStr = typeof up === "number" && !Number.isNaN(up) ? `${n2.format(up)} Mb/s` : "—";
  const dnStr = typeof dn === "number" && !Number.isNaN(dn) ? `${n2.format(dn)} Mb/s` : "—";

  const upTime = (stats?.uptime_text || "").trim();
  const user = (stats?.user || "").trim();

  const disks = stats && Array.isArray(stats.disks) ? stats.disks : [];
  const diskStr =
    disks.length > 0
      ? disks.map((d) => `${d.mount}: ${n0.format(d.pct)}%`).join(" · ")
      : null;

  const hist = histRef.current;
  const sparkW = 44;
  const sparkH = 12;
  let sparkPts = "";
  if (hist.length >= 2) {
    const n = hist.length;
    sparkPts = hist
      .map((v, i) => {
        const x = (i / (n - 1)) * sparkW;
        const y = sparkH - (Math.max(0, Math.min(100, v)) / 100) * sparkH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const sep = <span className="text-zinc-600" aria-hidden>|</span>;
  const pending = !stats;

  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-t px-2 py-1 font-mono text-[10px] ${
        pending
          ? "border-amber-900/50 bg-zinc-950/95 text-zinc-500"
          : "border-zinc-800 bg-zinc-950/95 text-zinc-300"
      }`}
      title={
        pending
          ? "Esperando métricas del servidor Linux (python3/python en el host remoto). Si no cambia, despliega API actualizada o revisa que el host tenga Python."
          : "Métricas del servidor Linux (vía SSH, cada pocos segundos)"
      }
    >
      {pending ? (
        <span className="mr-1 text-amber-500/90">●</span>
      ) : null}
      <span className="inline-flex items-center gap-1 text-zinc-200">
        <Server className="h-3 w-3 shrink-0 text-red-500" aria-hidden />
        <span className="max-w-[10rem] truncate">{host}</span>
      </span>
      {sep}
      <span className="inline-flex items-center gap-1">
        <Cpu className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
        <span className={cpuColor}>{cpu != null ? `${n0.format(cpu)}%` : "—"}</span>
        {sparkPts ? (
          <svg width={sparkW} height={sparkH} className="shrink-0 text-emerald-500/80" aria-hidden>
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              points={sparkPts}
            />
          </svg>
        ) : null}
      </span>
      {sep}
      <span className="inline-flex items-center gap-1 text-amber-300/95">
        <MemoryStick className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
        {memLine ?? "—"}
      </span>
      {sep}
      <span className="inline-flex items-center gap-1 text-cyan-300/90">
        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
        {upStr}
      </span>
      {sep}
      <span className="inline-flex items-center gap-1 text-blue-300/90">
        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
        {dnStr}
      </span>
      {sep}
      <span className="inline-flex items-center gap-1 text-zinc-400">
        <Monitor className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
        {upTime || "—"}
      </span>
      {sep}
      <span className="inline-flex items-center gap-1 text-zinc-400">
        <User className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
        {user || "—"}
      </span>
      {sep}
      <span className="inline-flex min-w-0 items-center gap-1 text-zinc-400">
        <HardDrive className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden />
        <span className="truncate">{diskStr ?? "—"}</span>
      </span>
      {pending ? (
        <>
          {sep}
          <span className="text-[9px] text-amber-600/90">Métricas del servidor…</span>
        </>
      ) : null}
    </div>
  );
}

/** `postMessage` desde la ventana emergente hacia `window.opener` para reintegrar el terminal en el dock. */
export const SSH_WEB_REATTACH_MESSAGE_TYPE = "atlas-ssh-reattach" as const;

export type SshWebReattachPayload = {
  type: typeof SSH_WEB_REATTACH_MESSAGE_TYPE;
  site: string;
  /** Si viene del espejo relay, reabre la pestaña en el dock sin nuevo WebSocket. */
  dockSessionId?: string;
};

type DockProps = {
  sessions: SshWebSession[];
  activeId: string | null;
  setSessions: Dispatch<SetStateAction<SshWebSession[]>>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
};

type PaneProps = {
  site: string;
  sessionId: string;
  visible: boolean;
  onClose: () => void;
  onSshSessionEnd?: () => void;
  /** En ventana emergente se oculta minimizar y se adaptan textos. */
  chrome?: "dock" | "popout";
  /** Solo `chrome === "popout"`: vuelve a integrar en el dock de la ventana principal. */
  onReattachToDock?: () => void;
  /** La sesión SSH vive en otra ventana; este panel solo refleja I/O por BroadcastChannel. */
  relayPoppedOut?: boolean;
  /** El espejo en la ventana emergente se cerró sin reintegrar: vuelve a mostrar la pestaña en el dock. */
  onRelayMirrorClosed?: () => void;
};

function SshSessionPane({
  site,
  sessionId,
  visible,
  onClose,
  onSshSessionEnd,
  chrome = "dock",
  onReattachToDock,
  relayPoppedOut = false,
  onRelayMirrorClosed,
}: PaneProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const relayBcRef = useRef<BroadcastChannel | null>(null);
  const relayPoppedOutRef = useRef(relayPoppedOut);
  relayPoppedOutRef.current = relayPoppedOut;
  const visibleRef = useRef(visible);
  visibleRef.current = visible || relayPoppedOut;

  const [cmd, setCmd] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [hostStats, setHostStats] = useState<SshHostStatsPayload | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);
  const sshEndedRef = useRef(false);
  const onSshEndRef = useRef(onSshSessionEnd);
  onSshEndRef.current = onSshSessionEnd;
  const onRelayMirrorClosedRef = useRef(onRelayMirrorClosed);
  onRelayMirrorClosedRef.current = onRelayMirrorClosed;

  const refit = useCallback(() => {
    if (relayPoppedOutRef.current) return;
    const t = termRef.current;
    const fit = fitRef.current;
    const el = wrapRef.current;
    if (!t || !fit || !el || !visibleRef.current) return;
    try {
      fit.fit();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }));
      }
    } catch {
      /* layout aún sin medidas */
    }
  }, []);

  useEffect(() => {
    if (!visible || relayPoppedOut) return;
    const id = requestAnimationFrame(() => {
      refit();
      termRef.current?.scrollToBottom();
    });
    return () => cancelAnimationFrame(id);
  }, [visible, relayPoppedOut, refit]);

  useEffect(() => {
    if (!visible) setCtxMenu(null);
  }, [visible]);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismissMouse = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-ssh-ctx-menu]")) return;
      setCtxMenu(null);
    };
    const dismissScroll = () => setCtxMenu(null);
    window.addEventListener("mousedown", dismissMouse, true);
    window.addEventListener("scroll", dismissScroll, true);
    return () => {
      window.removeEventListener("mousedown", dismissMouse, true);
      window.removeEventListener("scroll", dismissScroll, true);
    };
  }, [ctxMenu]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setFatal("No hay token de sesión. Vuelve a iniciar sesión.");
      return;
    }

    const q = new URLSearchParams({ site, token });
    const ws = new WebSocket(`${wsUrl("/api/ws/ssh-terminal")}?${q.toString()}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 50_000,
      windowsMode: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0b",
        foreground: "#e4e4e7",
        cursor: "#fafafa",
        black: "#18181b",
        brightBlack: "#52525b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#fafafa",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    const enc = new TextEncoder();
    const dec = new TextDecoder("utf-8", { fatal: false });

    let scrollRaf = 0;
    const scrollBottom = () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        term.scrollToBottom();
      });
    };

    const pasteFromClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && ws.readyState === WebSocket.OPEN) term.paste(text);
      } catch {
        setBanner("No se pudo leer el portapapeles (permiso del navegador).");
      }
    };

    const copySelection = async () => {
      const s = term.getSelection();
      if (!s) return;
      try {
        await navigator.clipboard.writeText(s);
        setBanner("Selección copiada.");
      } catch {
        setBanner("No se pudo copiar al portapapeles.");
      }
    };

    sshEndedRef.current = false;
    setHostStats(null);

    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.type !== "keydown") return true;
      const mod = ev.ctrlKey || ev.metaKey;
      const key = ev.key;
      /* Ctrl/Cmd+C con selección → copiar; sin selección → Ctrl+C al shell (SIGINT) */
      if (mod && (key === "c" || key === "C")) {
        if (term.hasSelection()) {
          void copySelection();
          return false;
        }
        return true;
      }
      /* Ctrl/Cmd+V → pegar desde el portapapeles */
      if (mod && (key === "v" || key === "V")) {
        void pasteFromClipboard();
        return false;
      }
      if (ev.shiftKey && ev.key === "Insert") {
        void pasteFromClipboard();
        return false;
      }
      return true;
    });

    const el = wrapRef.current;
    if (!el) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
      setFatal("No se pudo inicializar el contenedor del terminal.");
      return;
    }

    term.open(el);
    const termEl = term.element;
    if (!termEl) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
      setFatal("No se pudo crear la superficie del terminal.");
      return;
    }
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain");
      if (text && ws.readyState === WebSocket.OPEN) term.paste(text);
    };
    termEl.addEventListener("paste", onPaste);

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const pad = 8;
      const mw = 168;
      const mh = 80;
      let x = Math.min(e.clientX, window.innerWidth - mw - pad);
      let y = Math.min(e.clientY, window.innerHeight - mh - pad);
      x = Math.max(pad, x);
      y = Math.max(pad, y);
      setCtxMenu({
        x,
        y,
        canCopy: term.getSelection().length > 0,
      });
    };
    termEl.addEventListener("contextmenu", onContextMenu);

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current) return;
      refit();
    });
    ro.observe(el);

    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d));
    });

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const j = JSON.parse(ev.data) as { type?: string; message?: string; command?: string };
          if (j.type === "ssh_exit") {
            sshEndedRef.current = true;
            setCtxMenu(null);
            try {
              relayBcRef.current?.postMessage({ t: "exit" });
            } catch {
              /* ignore */
            }
            onSshEndRef.current?.();
            return;
          }
          if (j.type === "error") {
            const msg = j.message || "Error del servidor";
            setFatal(msg);
            try {
              relayBcRef.current?.postMessage({ t: "fatal", message: msg });
            } catch {
              /* ignore */
            }
            return;
          }
          if (j.type === "auth_hint" && j.message) {
            setBanner(j.message);
            try {
              relayBcRef.current?.postMessage({ t: "auth_hint", message: j.message });
            } catch {
              /* ignore */
            }
          }
          if (j.type === "ready" && j.command) {
            setCmd(j.command);
            try {
              relayBcRef.current?.postMessage({ t: "cmd", command: j.command });
            } catch {
              /* ignore */
            }
          }
          if (j.type === "host_stats") {
            const st = (j as { stats?: unknown }).stats;
            if (st && typeof st === "object") {
              if (sshTerminalWebDebug()) {
                console.debug("[AtlasVPN SSH] host_stats", { site, stats: st });
              }
              setHostStats(st as SshHostStatsPayload);
              try {
                relayBcRef.current?.postMessage({ t: "host_stats", stats: st });
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          /* ignore */
        }
        return;
      }
      if (ev.data instanceof ArrayBuffer) {
        const txt = dec.decode(new Uint8Array(ev.data));
        term.write(txt);
        scrollBottom();
        try {
          const ch = relayBcRef.current;
          if (ch && ev.data.byteLength > 0) {
            ch.postMessage({ t: "out", buf: ev.data.slice(0) });
          }
        } catch {
          /* ignore */
        }
      }
    };

    ws.onerror = () => {
      if (!sshEndedRef.current) setBanner("Error de red en el WebSocket.");
    };
    ws.onclose = () => {
      if (sshEndedRef.current) return;
      setBanner((b) => b || "Conexión cerrada.");
    };

    const onWinResize = () => refit();
    window.addEventListener("resize", onWinResize);
    refit();

    return () => {
      window.removeEventListener("resize", onWinResize);
      ro.disconnect();
      termEl.removeEventListener("paste", onPaste);
      termEl.removeEventListener("contextmenu", onContextMenu);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [site, sessionId]);

  useEffect(() => {
    if (!relayPoppedOut) {
      try {
        relayBcRef.current?.close();
      } catch {
        /* ignore */
      }
      relayBcRef.current = null;
      return;
    }

    let cancelled = false;
    let raf = 0;
    let bc: BroadcastChannel | null = null;
    const encRelay = new TextEncoder();

    const onBc = (ev: MessageEvent) => {
      const ws = wsRef.current;
      if (!ws) return;
      const m = ev.data as { t?: string; d?: string; cols?: number; rows?: number } | null;
      if (!m || typeof m !== "object") return;
      if (m.t === "relay-ready") return;
      if (m.t === "mirror-bye") {
        onRelayMirrorClosedRef.current?.();
        return;
      }
      if (m.t === "in" && typeof m.d === "string" && ws.readyState === WebSocket.OPEN) {
        ws.send(encRelay.encode(m.d));
      }
      if (
        m.t === "resize" &&
        typeof m.cols === "number" &&
        typeof m.rows === "number" &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(JSON.stringify({ type: "resize", cols: m.cols, rows: m.rows }));
      }
    };

    const step = () => {
      if (cancelled) return;
      const ws = wsRef.current;
      if (!ws) {
        raf = requestAnimationFrame(step);
        return;
      }
      if (ws.readyState === WebSocket.CONNECTING) {
        raf = requestAnimationFrame(step);
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        return;
      }
      bc = new BroadcastChannel(sshRelayChannelName(sessionId));
      relayBcRef.current = bc;
      bc.addEventListener("message", onBc);
      try {
        bc.postMessage({ t: "relay-ready" });
      } catch {
        /* ignore */
      }
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (bc) {
        bc.removeEventListener("message", onBc);
        try {
          bc.close();
        } catch {
          /* ignore */
        }
      }
      if (relayBcRef.current === bc) relayBcRef.current = null;
    };
  }, [relayPoppedOut, sessionId]);

  useEffect(() => {
    if (visible && !relayPoppedOut) termRef.current?.focus();
  }, [visible, relayPoppedOut]);

  const copyCmd = async () => {
    if (!cmd || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setBanner("Comando copiado al portapapeles.");
    } catch {
      setBanner("No se pudo copiar (permisos del navegador).");
    }
  };

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${visible || relayPoppedOut ? "flex" : "hidden"}`}
      aria-hidden={!visible && !relayPoppedOut}
    >
      {chrome !== "dock" ? (
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TerminalIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
            <span className="truncate font-mono text-xs text-emerald-300">{site}</span>
            {chrome === "popout" ? (
              <span
                className="hidden shrink-0 text-[10px] text-zinc-500 sm:inline"
                title="Usa el borde de la ventana para moverla a otro monitor"
              >
                · Ventana independiente
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {cmd ? (
              <button
                type="button"
                onClick={() => void copyCmd()}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
              >
                <Copy className="h-3 w-3" />
                Comando
              </button>
            ) : null}
            {chrome === "popout" && onReattachToDock ? (
              <button
                type="button"
                title="Volver a integrar en el panel inferior de la ventana principal"
                onClick={onReattachToDock}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 hover:text-cf-orange"
              >
                <PanelBottomOpen className="h-3 w-3 shrink-0" aria-hidden />
                <span className="hidden sm:inline">Al panel</span>
              </button>
            ) : null}
            <button
              type="button"
              title={chrome === "popout" ? "Cerrar ventana y sesión SSH" : "Cerrar sesión SSH"}
              onClick={onClose}
              className="inline-flex items-center rounded-md bg-zinc-800 p-1.5 text-rose-200 ring-1 ring-zinc-600 hover:bg-rose-950/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>
      ) : null}
      {banner && !fatal ? (
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">{banner}</div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
        {fatal ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0a0a0b]/95 px-3">
            <p className="max-w-sm text-center text-sm text-rose-100">{fatal}</p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-600"
            >
              Cerrar
            </button>
          </div>
        ) : null}
        <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden" />
        {!fatal ? <SshHostStatusBar stats={hostStats} siteFallback={site} /> : null}
      </div>
      {!fatal && chrome !== "dock" ? (
        <p className="shrink-0 border-t border-zinc-800 px-2 py-1 text-[10px] leading-snug text-zinc-500">
          Copiar/pegar: clic derecho en el terminal · <kbd className="rounded bg-zinc-800 px-0.5">Ctrl+C</kbd> con texto
          seleccionado · <kbd className="rounded bg-zinc-800 px-0.5">Ctrl+V</kbd> /{" "}
          <kbd className="rounded bg-zinc-800 px-0.5">Shift+Insert</kbd>. Sin selección,{" "}
          <kbd className="rounded bg-zinc-800 px-0.5">Ctrl+C</kbd> envía interrumpir al servidor.
        </p>
      ) : null}
      {ctxMenu
        ? createPortal(
            <div
              role="menu"
              data-ssh-ctx-menu
              className="fixed z-[9999] min-w-[10.5rem] overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 py-1 text-sm shadow-2xl ring-1 ring-black/50"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              <button
                type="button"
                disabled={!ctxMenu.canCopy}
                className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={async () => {
                  const t = termRef.current;
                  const sel = t?.getSelection() ?? "";
                  if (!sel) return;
                  try {
                    await navigator.clipboard.writeText(sel);
                    setBanner("Selección copiada.");
                  } catch {
                    setBanner("No se pudo copiar.");
                  }
                  setCtxMenu(null);
                  t?.focus();
                }}
              >
                Copiar
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    const t = termRef.current;
                    const ws = wsRef.current;
                    if (text && ws && ws.readyState === WebSocket.OPEN) t?.paste(text);
                  } catch {
                    setBanner("No se pudo leer el portapapeles.");
                  }
                  setCtxMenu(null);
                  termRef.current?.focus();
                }}
              >
                Pegar
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type RelayMirrorProps = {
  site: string;
  dockSessionId: string;
  onReattachToDock: () => void;
};

/** Terminal en ventana emergente conectado al mismo WebSocket que el dock vía BroadcastChannel. */
export function SshRelayMirrorPane({ site, dockSessionId, onReattachToDock }: RelayMirrorProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const [cmd, setCmd] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [hostStats, setHostStats] = useState<SshHostStatsPayload | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);

  useEffect(() => {
    setBanner("Conectando con el panel principal…");
  }, [dockSessionId]);

  const notifyMirrorBye = useCallback(() => {
    try {
      const ch = new BroadcastChannel(sshRelayChannelName(dockSessionId));
      ch.postMessage({ t: "mirror-bye" });
      ch.close();
    } catch {
      /* ignore */
    }
  }, [dockSessionId]);

  /* No enviar mirror-bye en cleanup de React: StrictMode desmonta dos veces y rompe el relay en el padre. */
  useEffect(() => {
    const onHide = () => {
      notifyMirrorBye();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [notifyMirrorBye]);

  useEffect(() => {
    const bc = new BroadcastChannel(sshRelayChannelName(dockSessionId));
    bcRef.current = bc;
    const dec = new TextDecoder("utf-8", { fatal: false });

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 50_000,
      windowsMode: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0b",
        foreground: "#e4e4e7",
        cursor: "#fafafa",
        black: "#18181b",
        brightBlack: "#52525b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#fafafa",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    const el = wrapRef.current;
    if (!el) {
      term.dispose();
      bc.close();
      return;
    }
    term.open(el);
    const termEl = term.element;
    if (!termEl) {
      term.dispose();
      bc.close();
      return;
    }

    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.type !== "keydown") return true;
      const mod = ev.ctrlKey || ev.metaKey;
      const key = ev.key;
      if (mod && (key === "c" || key === "C")) {
        if (term.hasSelection()) {
          const sel = term.getSelection();
          if (sel) void navigator.clipboard.writeText(sel).then(() => setBanner("Selección copiada."));
          return false;
        }
        return true;
      }
      if (mod && (key === "v" || key === "V")) {
        void navigator.clipboard.readText().then((text) => {
          if (text) {
            try {
              bc.postMessage({ t: "in", d: text });
            } catch {
              setBanner("No se pudo enviar pegado.");
            }
          }
        });
        return false;
      }
      if (ev.shiftKey && ev.key === "Insert") {
        void navigator.clipboard.readText().then((text) => {
          if (text) {
            try {
              bc.postMessage({ t: "in", d: text });
            } catch {
              setBanner("No se pudo enviar pegado.");
            }
          }
        });
        return false;
      }
      return true;
    });

    term.onData((d) => {
      try {
        bc.postMessage({ t: "in", d });
      } catch {
        /* ignore */
      }
    });

    const onBc = (ev: MessageEvent) => {
      const m = ev.data as {
        t?: string;
        buf?: ArrayBuffer;
        message?: string;
        command?: string;
        stats?: unknown;
      } | null;
      if (!m || typeof m !== "object") return;
      if (m.t === "relay-ready") {
        setBanner(null);
        return;
      }
      if (m.t === "out" && m.buf instanceof ArrayBuffer) {
        term.write(dec.decode(new Uint8Array(m.buf)));
        term.scrollToBottom();
        return;
      }
      if (m.t === "host_stats" && m.stats && typeof m.stats === "object") {
        if (sshTerminalWebDebug()) {
          console.debug("[AtlasVPN SSH] host_stats (relay)", { site, stats: m.stats });
        }
        setHostStats(m.stats as SshHostStatsPayload);
        return;
      }
      if (m.t === "cmd" && typeof m.command === "string") setCmd(m.command);
      if (m.t === "auth_hint" && typeof m.message === "string") setBanner(m.message);
      if (m.t === "fatal" && typeof m.message === "string") {
        setFatal(m.message);
        return;
      }
      if (m.t === "exit") {
        setBanner("Sesión SSH finalizada.");
        return;
      }
      if (m.t === "owner-close") {
        setBanner("Cerrado desde el panel principal.");
        setTimeout(() => window.close(), 0);
      }
    };
    bc.addEventListener("message", onBc);

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        try {
          bc.postMessage({ t: "in", d: text });
        } catch {
          setBanner("No se pudo pegar.");
        }
      }
    };
    termEl.addEventListener("paste", onPaste);

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const pad = 8;
      const mw = 168;
      const mh = 80;
      let x = Math.min(e.clientX, window.innerWidth - mw - pad);
      let y = Math.min(e.clientY, window.innerHeight - mh - pad);
      x = Math.max(pad, x);
      y = Math.max(pad, y);
      setCtxMenu({ x, y, canCopy: term.getSelection().length > 0 });
    };
    termEl.addEventListener("contextmenu", onContextMenu);

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current) return;
      try {
        fit.fit();
        bc.postMessage({ t: "resize", cols: term.cols, rows: term.rows });
      } catch {
        /* layout */
      }
    });
    ro.observe(el);
    requestAnimationFrame(() => {
      try {
        fit.fit();
        bc.postMessage({ t: "resize", cols: term.cols, rows: term.rows });
      } catch {
        /* layout */
      }
    });

    return () => {
      ro.disconnect();
      termEl.removeEventListener("paste", onPaste);
      termEl.removeEventListener("contextmenu", onContextMenu);
      bc.removeEventListener("message", onBc);
      try {
        bc.close();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      bcRef.current = null;
    };
  }, [dockSessionId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const dismissMouse = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-ssh-ctx-menu]")) return;
      setCtxMenu(null);
    };
    window.addEventListener("mousedown", dismissMouse, true);
    return () => window.removeEventListener("mousedown", dismissMouse, true);
  }, [ctxMenu]);

  const copyCmd = async () => {
    if (!cmd || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setBanner("Comando copiado al portapapeles.");
    } catch {
      setBanner("No se pudo copiar.");
    }
  };

  const handleClose = () => {
    notifyMirrorBye();
    window.close();
  };

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#070708]">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TerminalIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <span className="truncate font-mono text-xs text-emerald-300">{site}</span>
          <span className="hidden shrink-0 text-[10px] text-zinc-500 sm:inline" title="Misma sesión SSH que en el panel">
            · Espejo (misma sesión)
          </span>
        </div>
        <div className="flex items-center gap-1">
          {cmd ? (
            <button
              type="button"
              onClick={() => void copyCmd()}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
            >
              <Copy className="h-3 w-3" />
              Comando
            </button>
          ) : null}
          <button
            type="button"
            title="Volver a integrar en el panel inferior de la ventana principal"
            onClick={onReattachToDock}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 hover:text-cf-orange"
          >
            <PanelBottomOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Al panel</span>
          </button>
          <button
            type="button"
            title="Cerrar ventana (la sesión sigue en el panel)"
            onClick={handleClose}
            className="inline-flex items-center rounded-md bg-zinc-800 p-1.5 text-rose-200 ring-1 ring-zinc-600 hover:bg-rose-950/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      {banner && !fatal ? (
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">{banner}</div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-1">
        {fatal ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0a0a0b]/95 px-3">
            <p className="max-w-sm text-center text-sm text-rose-100">{fatal}</p>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-600"
            >
              Cerrar
            </button>
          </div>
        ) : null}
        <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden" />
        {!fatal ? <SshHostStatusBar stats={hostStats} siteFallback={site} /> : null}
      </div>
      {!fatal ? (
        <p className="shrink-0 border-t border-zinc-800 px-2 py-1 text-[10px] leading-snug text-zinc-500">
          Misma sesión SSH que en el panel principal. Copiar/pegar: clic derecho o{" "}
          <kbd className="rounded bg-zinc-800 px-0.5">Ctrl+V</kbd>.
        </p>
      ) : null}
      {ctxMenu
        ? createPortal(
            <div
              role="menu"
              data-ssh-ctx-menu
              className="fixed z-[9999] min-w-[10.5rem] overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 py-1 text-sm shadow-2xl ring-1 ring-black/50"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
            >
              <button
                type="button"
                disabled={!ctxMenu.canCopy}
                className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={async () => {
                  const t = termRef.current;
                  const sel = t?.getSelection() ?? "";
                  if (!sel) return;
                  try {
                    await navigator.clipboard.writeText(sel);
                    setBanner("Selección copiada.");
                  } catch {
                    setBanner("No se pudo copiar.");
                  }
                  setCtxMenu(null);
                  t?.focus();
                }}
              >
                Copiar
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-zinc-200 hover:bg-zinc-800"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text && bcRef.current) bcRef.current.postMessage({ t: "in", d: text });
                  } catch {
                    setBanner("No se pudo leer el portapapeles.");
                  }
                  setCtxMenu(null);
                  termRef.current?.focus();
                }}
              >
                Pegar
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Vista mínima para `?sshPopout=1&site=…` (ventana nueva / otro monitor). */
export function SshWebPopoutApp({ site, dockSessionId }: { site: string; dockSessionId: string | null }): ReactElement {
  const [standaloneSessionId] = useState(() => crypto.randomUUID());
  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const handleReattachToDock = useCallback(() => {
    const o = window.opener as Window | null;
    if (!o || o.closed) {
      window.alert(
        "No hay ventana principal asociada (p. ej. abriste esta URL en una pestaña suelta). Cierra esta ventana y abre el terminal desde la app con «ventana nueva», o usa el botón cerrar.",
      );
      return;
    }
    try {
      const payload: SshWebReattachPayload = {
        type: SSH_WEB_REATTACH_MESSAGE_TYPE,
        site,
        ...(dockSessionId ? { dockSessionId } : {}),
      };
      o.postMessage(payload, window.location.origin);
    } catch {
      window.alert("No se pudo notificar a la ventana principal. Revisa que siga abierta.");
      return;
    }
    try {
      o.focus();
    } catch {
      /* otro origen / política del navegador */
    }
    setTimeout(() => {
      window.close();
    }, 0);
  }, [site, dockSessionId]);

  if (dockSessionId) {
    return (
      <SshRelayMirrorPane
        site={site}
        dockSessionId={dockSessionId}
        onReattachToDock={handleReattachToDock}
      />
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#070708]">
      <SshSessionPane
        site={site}
        sessionId={standaloneSessionId}
        visible
        chrome="popout"
        onClose={handleClose}
        onSshSessionEnd={handleClose}
        onReattachToDock={handleReattachToDock}
      />
    </div>
  );
}

export function WebSshSessionsDock({
  sessions,
  activeId,
  setSessions,
  setActiveId,
}: DockProps): ReactElement {
  const allMinimized = sessions.length > 0 && sessions.every((s) => s.minimized);
  const [dockMaximized, setDockMaximized] = useState(false);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const defaultDockHeight = useCallback(
    () =>
      typeof window === "undefined"
        ? 420
        : Math.max(280, Math.min(Math.round(window.innerHeight * 0.58), 580)),
    [],
  );
  const [dockHeightPx, setDockHeightPx] = useState(defaultDockHeight);
  const [isDockResizing, setIsDockResizing] = useState(false);
  const dockResizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const moveTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setSessions((prev) => {
      const i = prev.findIndex((s) => s.id === fromId);
      const j = prev.findIndex((s) => s.id === toId);
      if (i < 0 || j < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item);
      return next;
    });
  }, [setSessions]);

  useEffect(() => {
    if (!isDockResizing || !dockResizeRef.current) return;
    const onMove = (ev: PointerEvent) => {
      const r = dockResizeRef.current;
      if (!r) return;
      const maxH = Math.min(Math.round(window.innerHeight * 0.92), window.innerHeight - 48);
      const dy = r.startY - ev.clientY;
      setDockHeightPx(Math.max(280, Math.min(maxH, r.startH + dy)));
    };
    const onUp = () => {
      dockResizeRef.current = null;
      setIsDockResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDockResizing]);

  useEffect(() => {
    if (dockMaximized) {
      setIsDockResizing(false);
      dockResizeRef.current = null;
    }
  }, [dockMaximized]);

  useEffect(() => {
    const onWin = () => {
      setDockHeightPx((h) =>
        Math.max(280, Math.min(h, Math.min(Math.round(window.innerHeight * 0.92), window.innerHeight - 48))),
      );
    };
    window.addEventListener("resize", onWin);
    return () => window.removeEventListener("resize", onWin);
  }, []);

  useEffect(() => {
    if (!dockMaximized || allMinimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDockMaximized(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [dockMaximized, allMinimized]);

  const closeSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const victim = prev.find((s) => s.id === id);
        if (victim?.poppedOut) {
          try {
            const ch = new BroadcastChannel(sshRelayChannelName(id));
            ch.postMessage({ t: "owner-close" });
            ch.close();
          } catch {
            /* ignore */
          }
        }
        const next = prev.filter((s) => s.id !== id);
        queueMicrotask(() => {
          setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur));
        });
        return next;
      });
    },
    [setSessions, setActiveId]
  );

  const popOutSession = useCallback(
    (id: string) => {
      const sess = sessions.find((x) => x.id === id);
      if (!sess || sess.poppedOut) return;
      const url = buildSshWebPopoutUrl(sess.site, sess.id);
      const w = Math.min(1200, window.screen.availWidth - 48);
      const h = Math.min(820, window.screen.availHeight - 48);
      const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2));
      const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2));
      /* Sin noopener: la emergente conserva `window.opener` para reintegrar al dock vía postMessage. */
      const feat = `width=${w},height=${h},left=${left},top=${top}`;
      /* Primero `poppedOut`: el popout debe montar el espejo cuando el padre ya escucha BroadcastChannel. */
      flushSync(() => {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, poppedOut: true } : s)));
      });
      const win = window.open(url, `atlas-ssh-${sess.id}`, feat);
      if (!win) {
        flushSync(() => {
          setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, poppedOut: false } : s)));
        });
        window.alert(
          "El navegador bloqueó la ventana emergente. Permite ventanas para este origen e inténtalo de nuevo.",
        );
      }
    },
    [sessions, setSessions],
  );

  const activateTab = useCallback(
    (id: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, minimized: false } : s)));
      setActiveId(id);
    },
    [setSessions, setActiveId]
  );

  const restoreAll = useCallback(() => {
    setDockMaximized(false);
    setSessions((prev) => prev.map((s) => ({ ...s, minimized: false })));
  }, [setSessions]);

  const expandDock = useCallback(() => {
    setDockMaximized(true);
    setSessions((prev) => prev.map((s) => ({ ...s, minimized: false })));
  }, [setSessions]);

  const collapseDock = useCallback(() => {
    setDockMaximized(false);
    setSessions((prev) => prev.map((s) => ({ ...s, minimized: true })));
  }, [setSessions]);

  if (sessions.length === 0) {
    return <></>;
  }

  const minimizedSessions = useMemo(() => sessions.filter((s) => s.minimized), [sessions]);

  let dockShellClass = "";
  let dockShellStyle: CSSProperties | undefined;
  if (!allMinimized && dockMaximized) {
    dockShellClass =
      "fixed inset-0 z-[95] min-h-0 max-h-none h-dvh border border-cf-line bg-[#070708]/98 shadow-2xl backdrop-blur-md";
  } else if (!allMinimized && !dockMaximized) {
    dockShellClass =
      "fixed inset-x-0 bottom-0 z-[85] min-h-0 border-t border-cf-line bg-[#070708]/98 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md";
    dockShellStyle = {
      height: dockHeightPx,
      maxHeight: "min(92vh, calc(100dvh - 24px))",
      minHeight: 280,
      left: 0,
      right: 0,
      bottom: 0,
      width: "auto",
    };
  }

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className={`pointer-events-auto flex min-h-0 flex-col ${
        allMinimized
          ? "fixed inset-x-0 bottom-0 z-[92] border-t-2 border-cf-orange/60 bg-zinc-950/98 pb-3 shadow-[0_-8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md"
          : dockShellClass
      } ${
        !allMinimized && !dockMaximized && isDockResizing
          ? "z-[96] -translate-y-0.5 shadow-[0_-20px_48px_rgba(0,0,0,0.55)] ring-1 ring-cf-orange/30 transition-[transform,box-shadow] duration-150 ease-out"
          : "transition-[transform,box-shadow] duration-150 ease-out"
      }`}
      style={allMinimized || dockMaximized ? undefined : dockShellStyle}
    >
      {!allMinimized ? (
        <>
          <div
            className={`flex shrink-0 items-stretch border-b border-zinc-800 bg-zinc-900/90 ${
              !dockMaximized && isDockResizing ? "ring-1 ring-inset ring-cf-orange/35" : ""
            }`}
          >
            {!dockMaximized ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Arrastra para ajustar la altura del terminal"
                title="Arrastra para cambiar la altura del panel"
                className="group flex w-9 shrink-0 cursor-ns-resize select-none items-center justify-center border-r border-zinc-700/80 bg-zinc-800/90 hover:bg-zinc-700/90"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  dockResizeRef.current = { startY: e.clientY, startH: dockHeightPx };
                  setIsDockResizing(true);
                }}
              >
                <GripHorizontal
                  className="pointer-events-none h-4 w-5 text-zinc-500 group-hover:text-cf-orange"
                  strokeWidth={2}
                  aria-hidden
                />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1">
            {sessions.map((s) => {
              const active = s.id === activeId;
              return (
                <div
                  key={s.id}
                  className={`flex shrink-0 items-center gap-0.5 rounded-lg ring-1 ${
                    active ? "bg-cf-orange/20 ring-cf-orange/50" : "bg-zinc-800/80 ring-zinc-600"
                  } ${dragOverTabId === s.id && dragTabId && dragTabId !== s.id ? "ring-2 ring-cf-orange ring-offset-1 ring-offset-zinc-950" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragTabId && dragTabId !== s.id) setDragOverTabId(s.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from =
                      e.dataTransfer.getData("application/x-atlas-tab") ||
                      e.dataTransfer.getData("application/x-atlasvpn-tab") ||
                      e.dataTransfer.getData("text/plain");
                    if (from) moveTab(from, s.id);
                    setDragTabId(null);
                    setDragOverTabId(null);
                  }}
                >
                  <span
                    title="Arrastrar para reordenar pestañas"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/x-atlas-tab", s.id);
                      e.dataTransfer.setData("text/plain", s.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragTabId(s.id);
                    }}
                    onDragEnd={() => {
                      setDragTabId(null);
                      setDragOverTabId(null);
                    }}
                    className={`cursor-grab rounded px-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 active:cursor-grabbing ${
                      dragTabId === s.id ? "opacity-60" : ""
                    }`}
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!s.poppedOut) activateTab(s.id);
                    }}
                    title={s.poppedOut ? "Sesión abierta en ventana emergente" : undefined}
                    className={`max-w-[10rem] truncate px-2 py-1.5 text-left text-xs font-medium ${
                      active ? "text-cf-orange" : "text-zinc-300"
                    } ${s.poppedOut ? "opacity-60" : ""}`}
                  >
                    {s.site}
                    {s.poppedOut ? " · ↗" : s.minimized ? " · ○" : ""}
                  </button>
                  <button
                    type="button"
                    title={s.poppedOut ? "Ya está en ventana emergente" : "Abrir en ventana nueva (otro monitor)"}
                    disabled={Boolean(s.poppedOut)}
                    onClick={() => popOutSession(s.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-cf-orange disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    title="Cerrar sesión"
                    onClick={() => closeSession(s.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-rose-950/60 hover:text-rose-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 self-stretch border-l border-zinc-700/80 px-1.5 py-1">
              <button
                type="button"
                title="Maximizar panel (pantalla completa, Esc para salir)"
                onClick={() => expandDock()}
                className="inline-flex items-center justify-center rounded-md bg-zinc-800 p-1.5 text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 hover:text-cf-orange"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                title="Minimizar panel (barra inferior)"
                onClick={() => collapseDock()}
                className="inline-flex items-center justify-center rounded-md bg-zinc-800 p-1.5 text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
          {minimizedSessions.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-800/90 bg-zinc-950/90 px-2 py-1.5">
              <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Minimizadas
              </span>
              {minimizedSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={`Abrir ${s.site}`}
                  onClick={() => activateTab(s.id)}
                  className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-cf-orange/15 px-2.5 py-1 text-xs font-medium text-cf-orange ring-1 ring-cf-orange/45 hover:bg-cf-orange/25"
                >
                  <ChevronsUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{s.site}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex w-full flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <PanelBottomOpen className="h-5 w-5 shrink-0 text-cf-orange" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100">Terminal web en segundo plano</p>
              <p className="truncate text-[11px] text-zinc-500">
                {sessions.length} sesión{sessions.length === 1 ? "" : "es"} minimizada
                {sessions.length === 1 ? "" : "s"} — pulsa un sitio para abrirlo o «Todas» para el panel completo.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => activateTab(s.id)}
                className="inline-flex max-w-[10rem] items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-700 hover:ring-cf-orange/50"
              >
                <ChevronsUp className="h-3.5 w-3.5 shrink-0 text-cf-orange" aria-hidden />
                <span className="truncate">{s.site}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={restoreAll}
              className="rounded-lg bg-cf-orange px-3 py-1.5 text-xs font-semibold text-black shadow-md hover:brightness-110"
            >
              Mostrar todas
            </button>
          </div>
        </div>
      )}

      <div
        className={
          allMinimized
            ? "pointer-events-none fixed -left-[10000px] top-0 z-0 h-[400px] w-[min(900px,100vw)] overflow-hidden opacity-0"
            : "relative min-h-0 flex-1 overflow-hidden"
        }
      >
        {sessions.map((s) => {
          const holdWsOffscreen = Boolean(s.poppedOut);
          const paneVisible = !allMinimized && s.id === activeId && !s.minimized && !s.poppedOut;
          return (
            <div
              key={s.id}
              className={
                holdWsOffscreen
                  ? "pointer-events-none fixed -left-[10000px] top-0 z-0 flex min-h-0 h-[480px] w-[min(960px,100vw)] flex-col overflow-hidden opacity-0"
                  : `absolute inset-0 flex min-h-0 flex-col ${paneVisible ? "z-10" : "z-0"}`
              }
              style={{ display: holdWsOffscreen || paneVisible ? "flex" : "none" }}
            >
              <SshSessionPane
                site={s.site}
                sessionId={s.id}
                visible={paneVisible || holdWsOffscreen}
                relayPoppedOut={holdWsOffscreen}
                onRelayMirrorClosed={() => {
                  setSessions((prev) => prev.map((x) => (x.id === s.id ? { ...x, poppedOut: false } : x)));
                }}
                onClose={() => closeSession(s.id)}
                onSshSessionEnd={() => closeSession(s.id)}
              />
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
