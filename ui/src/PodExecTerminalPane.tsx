import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import { getAccessToken, wsUrl } from "./apiClient";
import type { OpenPodExecSessionOpts } from "./WebSshSessionsDock";

type Props = {
  sessionId: string;
  exec: OpenPodExecSessionOpts;
  visible: boolean;
  onClose: () => void;
};

function b64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function b64DecodeUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function PodExecTerminalPane({ sessionId, exec, visible, onClose }: Props): ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>("Conectando al contenedor…");

  const refit = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const ws = wsRef.current;
    const el = wrapRef.current;
    if (!term || !fit || !el || !visible) return;
    try {
      fit.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        const payload = b64EncodeUtf8(
          JSON.stringify({ Width: term.cols, Height: term.rows })
        );
        ws.send(`4${payload}`);
      }
    } catch {
      /* layout */
    }
  }, [visible]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setFatal("No hay token de sesión. Vuelve a iniciar sesión.");
      return;
    }

    const q = new URLSearchParams({
      token,
      cluster_ns: exec.clusterNamespace,
      cluster_name: exec.clusterName,
      steve_collection: exec.steveCollection,
      pod: exec.podName,
      container: exec.container,
      pod_namespace: exec.podK8sNamespace,
    });
    const ws = new WebSocket(`${wsUrl("/api/ws/rancher-pod-exec")}?${q.toString()}`);
    wsRef.current = ws;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 50_000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#0a0a0b",
        foreground: "#e4e4e7",
        cursor: "#fafafa",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    const el = wrapRef.current;
    if (!el) {
      ws.close();
      return;
    }
    term.open(el);

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`0${b64EncodeUtf8(data)}`);
      }
    });

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string" || !ev.data.length) return;
      const channel = ev.data[0];
      const payload = ev.data.slice(1);
      if (channel === "1" || channel === "2" || channel === "3") {
        term.write(b64DecodeUtf8(payload));
        setBanner(null);
        return;
      }
      try {
        const j = JSON.parse(ev.data) as { type?: string; message?: string };
        if (j.type === "error") {
          setFatal(j.message || "Error al abrir shell en el contenedor.");
          return;
        }
        if (j.type === "ready") {
          setBanner(null);
          refit();
        }
      } catch {
        /* rancher stream */
      }
    };

    ws.onerror = () => {
      setBanner((b) => b || "Error de red en la conexión al contenedor.");
    };

    ws.onclose = () => {
      setBanner((b) => b || "Sesión de contenedor cerrada.");
    };

    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    window.addEventListener("resize", refit);

    return () => {
      window.removeEventListener("resize", refit);
      ro.disconnect();
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
  }, [exec, sessionId, refit]);

  useEffect(() => {
    if (visible) {
      refit();
      termRef.current?.focus();
    }
  }, [visible, refit]);

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${visible ? "flex h-full" : "hidden"}`}
      aria-hidden={!visible}
    >
      {banner && !fatal ? (
        <div className="shrink-0 border-b border-zinc-800 px-2 py-1 text-[11px] text-zinc-400">
          {banner}
        </div>
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
      </div>
    </div>
  );
}
