import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api, apiUrl, bearerHeaders } from "../apiClient";
import { AtlasModalShell } from "./AtlasModalFrame";
import type { SftpEntry } from "./SshFileTransferPanel";

export type SftpStatResponse = {
  mode_octal: string;
  uid?: number | null;
  gid?: number | null;
};

export function SshTextEditorModal({
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

export function SshPermissionsModal({
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
