import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  FilePlus,
  FolderPlus,
  FolderUp,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { api, apiUrl, bearerHeaders, getAccessToken } from "../apiClient";
import { SftpTransferQueue, type TransferJob } from "./SftpTransferQueue";

type SftpEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number | null;
  mtime?: number | null;
};

type ListResponse = {
  path: string;
  parent: string | null;
  entries: SftpEntry[];
};

type Props = {
  site: string;
  /** La terminal web ya autenticó SSH (contraseña en caché del servidor). */
  sshReady: boolean;
  /** Ventana espejo: intentar SFTP aunque falte el aviso ssh-ready (p. ej. popout tardío). */
  connectWithoutReady?: boolean;
  variant?: "sidebar" | "full";
};

export type SshFileTransferPanelHandle = {
  uploadFiles: (files: FileList) => void;
};

function dragHasFiles(dt: DataTransfer): boolean {
  return [...dt.items].some((i) => i.kind === "file");
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function MobaFolderIcon({ hidden }: { hidden?: boolean }): ReactElement {
  const fill = hidden ? "#78716c" : "#eab308";
  const stroke = hidden ? "#57534e" : "#ca8a04";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path
        d="M1.5 4.5h4.2l1.3 1.5h7.5v7.5H1.5V4.5z"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.6"
      />
      <path d="M1.5 4.5h4.2l1.3 1.5H1.5z" fill={hidden ? "#a68458" : "#ffe566"} />
    </svg>
  );
}

function MobaFileIcon({ hidden, ext }: { hidden?: boolean; ext?: string }): ReactElement {
  const body = hidden ? "#52525b" : "#a1a1aa";
  const fold = hidden ? "#3f3f46" : "#71717a";
  const accent =
    ext === "json"
      ? "#4a90d9"
      : ext === "txt" || ext === "log"
        ? "#6b8e6b"
        : ext === "sh"
          ? "#8b7355"
          : "#888";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path d="M3 1.5h5l2 2v9.5H3V1.5z" fill={body} stroke="#666" strokeWidth="0.4" />
      <path d="M8 1.5v2.5h2.5L8 1.5z" fill={fold} stroke="#666" strokeWidth="0.3" />
      {!hidden && ext ? (
        <rect x="4" y="9" width="7" height="2.5" rx="0.3" fill={accent} opacity="0.85" />
      ) : null}
    </svg>
  );
}

function MobaParentIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0" aria-hidden>
      <path d="M2 3h5l1.5 1.8H14v8.2H2V3z" fill="#d8d8d8" stroke="#888" strokeWidth="0.5" />
      <path d="M6 8.5 4 6.5h4L6 8.5z" fill="#4a7fc1" />
    </svg>
  );
}

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function ToolbarBtn({
  title,
  onClick,
  disabled,
  children,
  className = "",
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[22px] w-[24px] items-center justify-center rounded-sm border border-transparent text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function SftpDropOverlay({ active, label }: { active: boolean; label: string }): ReactElement | null {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-cf-orange/10 ring-2 ring-inset ring-cf-orange/55 backdrop-blur-[1px]">
      <p className="rounded-lg border border-cf-orange/40 bg-[#111418]/95 px-3 py-2 text-center text-[11px] font-medium text-cf-orange shadow-lg">
        {label}
      </p>
    </div>
  );
}

export const SshFileTransferPanel = forwardRef<SshFileTransferPanelHandle, Props>(
  function SshFileTransferPanel(
    { site, sshReady, connectWithoutReady = false, variant = "sidebar" },
    ref,
  ) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [cwd, setCwd] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [selected, setSelected] = useState<SftpEntry | "parent" | null>(null);
  const [pathDropOpen, setPathDropOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const connectInFlightRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const cancelTransferRef = useRef<Map<string, () => void>>(new Map());
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileDragDepthRef = useRef(0);

  const transferBusy = transfers.some((t) => t.status === "active" || t.status === "pending");

  const patchTransfer = useCallback((id: string, patch: Partial<TransferJob>) => {
    setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const dismissTransfer = useCallback((id: string) => {
    cancelTransferRef.current.delete(id);
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const cancelTransfer = useCallback(
    (id: string) => {
      cancelTransferRef.current.get(id)?.();
      patchTransfer(id, { status: "cancelled", progress: 0 });
    },
    [patchTransfer],
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const disconnect = useCallback(async (sid?: string | null) => {
    const id = sid ?? sessionIdRef.current;
    if (id) {
      try {
        await api(`/api/sftp/session/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    }
    if (!sid || sid === sessionIdRef.current) {
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (id) {
        void api(`/api/sftp/session/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [site]);

  const pushHistory = useCallback((path: string) => {
    setPathHistory((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)];
      return next.slice(0, 24);
    });
  }, []);

  const applyListing = useCallback(
    (data: ListResponse) => {
      setCwd(data.path);
      setPathInput(data.path);
      pushHistory(data.path);
      setEntries(data.entries);
      setSelected(null);
    },
    [pushHistory],
  );

  const loadDir = useCallback(
    async (sid: string, path: string, retryOnStale = true) => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ path });
        const data = await api<ListResponse>(
          `/api/sftp/session/${encodeURIComponent(sid)}/list?${q}`,
        );
        applyListing(data);
      } catch (e) {
        const msg = String(e);
        if (retryOnStale && /caducada|inexistente/i.test(msg)) {
          sessionIdRef.current = null;
          setSessionId(null);
          setError("");
          setLoading(false);
          return;
        }
        setError(msg.replace(/^Error:\s*/i, ""));
      } finally {
        setLoading(false);
      }
    },
    [applyListing],
  );

  const connect = useCallback(async () => {
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;
    setConnecting(true);
    setError("");
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await api<{
        session_id?: string;
        home?: string;
        listing?: ListResponse;
      }>(`/api/sftp/${encodeURIComponent(site)}/session`, {
        method: "POST",
        body: JSON.stringify({ password: "" }),
        signal: ctrl.signal,
      });
      const sid = res.session_id;
      if (!sid) throw new Error("Respuesta SFTP inválida del servidor.");
      sessionIdRef.current = sid;
      setSessionId(sid);
      if (res.listing && Array.isArray(res.listing.entries)) {
        applyListing(res.listing);
      } else {
        await loadDir(sid, res.home || "/", false);
      }
    } catch (e) {
      const msg =
        e instanceof DOMException && e.name === "AbortError"
          ? "Tiempo de espera al conectar SFTP (45 s). ¿Está desplegada la última versión de atlas-api?"
          : String(e);
      setError(msg.replace(/^Error:\s*/i, ""));
      setSessionId(null);
    } finally {
      window.clearTimeout(timer);
      connectInFlightRef.current = false;
      setConnecting(false);
    }
  }, [site, loadDir, applyListing]);

  const mayConnect = sshReady || connectWithoutReady;

  useEffect(() => {
    if (!mayConnect || sessionId) return;
    void connect();
  }, [mayConnect, sessionId, connect]);

  const refresh = () => {
    if (sessionId) void loadDir(sessionId, cwd);
  };

  const parentPath = useMemo(() => {
    if (cwd === "/") return "/";
    return cwd.replace(/\/+$/, "").replace(/\/[^/]+$/, "") || "/";
  }, [cwd]);

  const goUp = () => {
    if (!sessionId || cwd === "/") return;
    void loadDir(sessionId, parentPath);
  };

  const navigateTo = (path: string) => {
    if (!sessionId) return;
    void loadDir(sessionId, path);
    setPathDropOpen(false);
  };

  const openEntry = (ent: SftpEntry) => {
    if (!sessionId || !ent.is_dir) return;
    void loadDir(sessionId, ent.path);
  };

  const selectedEntry = selected && selected !== "parent" ? selected : null;

  const downloadFile = async (ent: SftpEntry, index = 1, total = 1) => {
    if (!sessionId || ent.is_dir) return;
    setError("");
    const id = crypto.randomUUID();
    setTransfers((prev) => [
      ...prev,
      {
        id,
        direction: "download",
        name: ent.name,
        index,
        total,
        progress: 0,
        status: "active",
      },
    ]);
    const ac = new AbortController();
    cancelTransferRef.current.set(id, () => ac.abort());
    try {
      const q = new URLSearchParams({ path: ent.path });
      const res = await fetch(
        apiUrl(`/api/sftp/session/${encodeURIComponent(sessionId)}/download?${q}`),
        { headers: bearerHeaders(), signal: ac.signal },
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const totalBytes = Number(res.headers.get("content-length")) || 0;
      const body = res.body;
      let blob: Blob;
      if (body && totalBytes > 0) {
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            patchTransfer(id, {
              progress: Math.min(99, Math.round((100 * loaded) / totalBytes)),
            });
          }
        }
        blob = new Blob(chunks);
      } else {
        patchTransfer(id, { progress: -1 });
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ent.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      patchTransfer(id, { status: "done", progress: 100 });
    } catch (e) {
      if (ac.signal.aborted) {
        patchTransfer(id, { status: "cancelled", progress: 0 });
      } else {
        const msg = String(e).replace(/^Error:\s*/i, "");
        patchTransfer(id, { status: "error", progress: 0, error: msg });
        setError(msg);
      }
    } finally {
      cancelTransferRef.current.delete(id);
    }
  };

  const downloadSelected = () => {
    if (selectedEntry && !selectedEntry.is_dir) void downloadFile(selectedEntry);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!sessionId || !files?.length) return;
    setError("");
    const list = Array.from(files);
    const total = list.length;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const id = crypto.randomUUID();
      const remotePath =
        cwd === "/" ? `/${file.name}` : `${cwd.replace(/\/$/, "")}/${file.name}`;
      const q = new URLSearchParams({ path: remotePath });
      const url = apiUrl(`/api/sftp/session/${encodeURIComponent(sessionId)}/upload?${q}`);

      setTransfers((prev) => [
        ...prev,
        {
          id,
          direction: "upload",
          name: file.name,
          index: i + 1,
          total,
          progress: 0,
          status: "active",
        },
      ]);

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          cancelTransferRef.current.set(id, () => xhr.abort());

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              patchTransfer(id, {
                progress: Math.min(99, Math.round((100 * ev.loaded) / ev.total)),
              });
            } else {
              patchTransfer(id, { progress: -1 });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              patchTransfer(id, { status: "done", progress: 100 });
              resolve();
            } else {
              reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Error de red al subir el archivo."));
          xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

          xhr.open("POST", url);
          const token = getAccessToken();
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          const form = new FormData();
          form.append("file", file);
          xhr.send(form);
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          patchTransfer(id, { status: "cancelled", progress: 0 });
        } else {
          const msg = String(e).replace(/^Error:\s*/i, "");
          patchTransfer(id, { status: "error", progress: 0, error: msg });
          setError(msg);
          break;
        }
      } finally {
        cancelTransferRef.current.delete(id);
      }
    }
    refresh();
  };

  const handleIncomingFiles = useCallback(
    async (files: FileList) => {
      if (!files.length) return;
      if (sessionIdRef.current) {
        await uploadFiles(files);
        return;
      }
      if (!mayConnect) {
        setError("Espera a que la terminal SSH esté lista (prompt visible).");
        return;
      }
      await connect();
      if (sessionIdRef.current) await uploadFiles(files);
    },
    [uploadFiles, connect, mayConnect],
  );

  useImperativeHandle(
    ref,
    () => ({
      uploadFiles: (files: FileList) => {
        void handleIncomingFiles(files);
      },
    }),
    [handleIncomingFiles],
  );

  const onFileDragEnter = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current += 1;
    setFileDragOver(true);
  };

  const onFileDragLeave = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragOver(false);
  };

  const onFileDragOver = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = sessionIdRef.current || mayConnect ? "copy" : "none";
  };

  const onFileDrop = (e: DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current = 0;
    setFileDragOver(false);
    void handleIncomingFiles(e.dataTransfer.files);
  };

  const deleteSelected = async () => {
    if (!sessionId) return;
    if (selected === "parent") return;
    const ent = selectedEntry;
    if (!ent) return;
    const label = ent.is_dir ? "carpeta" : "archivo";
    if (!window.confirm(`¿Eliminar ${label} «${ent.name}»?`)) return;
    setError("");
    try {
      const q = new URLSearchParams({ path: ent.path });
      await api(`/api/sftp/session/${encodeURIComponent(sessionId)}/entry?${q}`, {
        method: "DELETE",
      });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const mkdir = async () => {
    if (!sessionId) return;
    const name = window.prompt("Nombre de la nueva carpeta:");
    if (!name?.trim()) return;
    const base = cwd === "/" ? "" : cwd.replace(/\/$/, "");
    const remote = `${base}/${name.trim()}`.replace(/\/+/g, "/") || `/${name.trim()}`;
    try {
      const q = new URLSearchParams({ path: remote });
      await api(`/api/sftp/session/${encodeURIComponent(sessionId)}/mkdir?${q}`, {
        method: "POST",
      });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const onPathKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && sessionId) navigateTo(pathInput);
  };

  const sortedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }),
    [entries],
  );

  if (!sessionId) {
    return (
      <div
        className={`relative flex min-h-0 flex-1 flex-col bg-[#0a0a0b] text-zinc-300 ${
          variant === "sidebar" ? "p-3" : "items-center justify-center p-6"
        }`}
        onDragEnter={onFileDragEnter}
        onDragLeave={onFileDragLeave}
        onDragOver={onFileDragOver}
        onDrop={onFileDrop}
      >
        <SftpDropOverlay
          active={fileDragOver}
          label={
            mayConnect
              ? "Suelta para subir por SFTP"
              : "Conecta la terminal antes de subir archivos"
          }
        />
        <p className="text-[11px] font-medium text-zinc-400">SFTP · {site}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          {mayConnect
            ? connecting
              ? "Conectando SFTP al túnel (misma contraseña que la terminal)…"
              : "Pulsa reintentar si no se abrió solo."
            : connectWithoutReady
              ? "Sincronizando con el panel principal… Si la terminal ya tiene prompt, pulsa Reintentar."
              : "Escribe la contraseña SSH en la terminal (si la pide). El explorador reutiliza esa sesión."}
        </p>
        {error ? (
          <p className="mt-2 rounded border border-rose-500/40 bg-rose-950/50 px-2 py-1 text-[10px] text-rose-200">
            {error}
          </p>
        ) : null}
        {mayConnect ? (
          <button
            type="button"
            disabled={connecting}
            onClick={() => void connect()}
            className="mt-3 self-start rounded-md bg-cf-orange/20 px-3 py-1.5 text-xs font-medium text-cf-orange ring-1 ring-cf-orange/40 hover:bg-cf-orange/30 disabled:opacity-50"
          >
            {connecting ? "Conectando…" : "Reintentar SFTP"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0a0b] text-zinc-200"
      onDragEnter={onFileDragEnter}
      onDragLeave={onFileDragLeave}
      onDragOver={onFileDragOver}
      onDrop={onFileDrop}
    >
      <SftpDropOverlay active={fileDragOver} label="Suelta para subir a esta carpeta" />
      <div className="flex shrink-0 items-center gap-0 border-b border-zinc-800 bg-zinc-900/90 px-0.5 py-0.5">
        <ToolbarBtn title="Carpeta superior" onClick={goUp} disabled={cwd === "/" || loading}>
          <FolderUp className="h-3.5 w-3.5 text-[#2d6a2d]" strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn
          title="Descargar archivo seleccionado"
          onClick={downloadSelected}
          disabled={!selectedEntry || selectedEntry.is_dir}
        >
          <ArrowDownToLine className="h-3.5 w-3.5 text-[#2563eb]" strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn
          title="Subir archivos"
          onClick={() => uploadRef.current?.click()}
          disabled={transferBusy}
        >
          <ArrowUpToLine className="h-3.5 w-3.5 text-[#16a34a]" strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn title="Actualizar" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 text-[#16a34a] ${loading ? "animate-spin" : ""}`} strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn title="Nueva carpeta" onClick={() => void mkdir()} disabled={transferBusy}>
          <FolderPlus className="h-3.5 w-3.5 text-[#ca8a04]" strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn title="Nuevo archivo (subir vacío)" onClick={() => uploadRef.current?.click()} disabled>
          <FilePlus className="h-3.5 w-3.5 text-[#6b7280]" strokeWidth={2.2} />
        </ToolbarBtn>
        <ToolbarBtn title="Eliminar" onClick={() => void deleteSelected()} disabled={!selectedEntry}>
          <Trash2 className="h-3.5 w-3.5 text-[#dc2626]" strokeWidth={2.2} />
        </ToolbarBtn>
        <div className="ml-auto pr-1">
          <button
            type="button"
            title="Desconectar SFTP"
            onClick={() => {
              void disconnect();
              setEntries([]);
            }}
            className="text-[9px] text-zinc-500 underline hover:text-zinc-300"
          >
            Cerrar SFTP
          </button>
        </div>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => void uploadFiles(e.target.files)} />
      </div>

      {/* Ruta */}
      <div className="relative shrink-0 border-b border-zinc-800 bg-black/40">
        <div className="flex items-stretch">
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={onPathKey}
            className="min-w-0 flex-1 border-0 bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 outline-none"
            spellCheck={false}
          />
          <button
            type="button"
            title="Historial de rutas"
            onClick={() => setPathDropOpen((v) => !v)}
            className="flex w-5 shrink-0 items-center justify-center border-l border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
          >
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          </button>
        </div>
        {pathDropOpen && pathHistory.length > 0 ? (
          <ul className="absolute left-0 right-0 top-full z-20 max-h-40 overflow-auto border border-zinc-700 bg-zinc-900 shadow-lg">
            {pathHistory.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="block w-full truncate px-2 py-0.5 text-left font-mono text-[11px] text-zinc-300 hover:bg-cf-orange/20 hover:text-cf-orange"
                  onClick={() => navigateTo(p)}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? (
        <p className="shrink-0 bg-rose-950/40 px-1.5 py-0.5 text-[10px] text-rose-200">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-[#070809]">
        <div className="sticky top-0 flex border-b border-zinc-800 bg-zinc-900/80 text-[11px] font-semibold text-zinc-400">
          <span className="flex items-center gap-0.5 px-1.5 py-0.5">
            <span className="text-cf-orange">▲</span> Name
          </span>
        </div>
        {loading && !entries.length ? (
          <div className="flex items-center justify-center gap-1 py-6 text-[11px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cf-orange" />
            Cargando…
          </div>
        ) : (
          <ul className="text-[11px]">
            {cwd !== "/" ? (
              <li>
                <button
                  type="button"
                  className={`flex w-full items-center gap-1 px-1 py-px text-left ${
                    selected === "parent"
                      ? "bg-cf-orange/25 text-zinc-100"
                      : "hover:bg-white/[0.04]"
                  }`}
                  onClick={() => setSelected("parent")}
                  onDoubleClick={goUp}
                >
                  <MobaParentIcon />
                  <span className="truncate">..</span>
                </button>
              </li>
            ) : null}
            {sortedEntries.map((ent) => {
              const hidden = isHiddenName(ent.name);
              const ext = fileExt(ent.name);
              const isSel = selectedEntry?.path === ent.path;
              return (
                <li key={ent.path}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-1 px-1 py-px text-left ${
                      isSel ? "bg-cf-orange/25 text-zinc-100" : "hover:bg-white/[0.04]"
                    } ${hidden && !isSel ? "text-zinc-500" : "text-zinc-200"}`}
                    onClick={() => setSelected(ent)}
                    onDoubleClick={() => {
                      if (ent.is_dir) openEntry(ent);
                      else void downloadFile(ent);
                    }}
                  >
                    {ent.is_dir ? (
                      <MobaFolderIcon hidden={hidden} />
                    ) : (
                      <MobaFileIcon hidden={hidden} ext={ext} />
                    )}
                    <span className="truncate">{ent.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && cwd === "/" && !entries.length ? (
          <p className="py-4 text-center text-[11px] text-zinc-600">Vacío</p>
        ) : null}
      </div>

      <SftpTransferQueue
        jobs={transfers}
        onCancel={cancelTransfer}
        onDismiss={dismissTransfer}
      />
    </div>
  );
  },
);
