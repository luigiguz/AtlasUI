import { HardDrive, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import { api } from "../apiClient";
import {
  SshPermissionsModal,
  SshTextEditorModal,
} from "./SshStorageModals";
import {
  SshFileTransferPanel,
  type SftpEntry,
  type SshFileTransferPanelHandle,
} from "./SshFileTransferPanel";
import type { SshWebSession } from "../WebSshSessionsDock";

type VolumeContext = NonNullable<SshWebSession["volume"]>;

type Props = {
  site: string;
  sessionId: string;
  visible: boolean;
  volumeContext: VolumeContext;
  onClose: () => void;
  /** Terminal SSH para autenticación (misma UX que Conexiones). */
  renderAuthTerminal: (props: { visible: boolean; onAuthenticated: () => void }) => ReactNode;
};

type Phase = "checking" | "auth" | "explorer";

/** Panel del dock para editar un PVC: auth por terminal, luego explorador SFTP. */
export function PvcVolumeSessionPane({
  site,
  visible,
  volumeContext,
  onClose,
  renderAuthTerminal,
}: Props): ReactElement {
  const panelRef = useRef<SshFileTransferPanelHandle | null>(null);
  const explorerKeyRef = useRef(0);
  const [phase, setPhase] = useState<Phase>("checking");
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<SftpEntry | null>(null);
  const [permTarget, setPermTarget] = useState<SftpEntry | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setPhase("checking");
      try {
        const res = await api<{ session_id?: string }>(`/api/sftp/${encodeURIComponent(site)}/session`, {
          method: "POST",
          body: JSON.stringify({
            password: "",
            start_path: volumeContext.startPath,
          }),
        });
        const sid = res.session_id;
        if (sid) {
          await api(`/api/sftp/session/${encodeURIComponent(sid)}`, { method: "DELETE" }).catch(() => {});
        }
        if (!cancelled) {
          explorerKeyRef.current += 1;
          setPhase("explorer");
        }
      } catch {
        if (!cancelled) setPhase("auth");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, site, volumeContext.startPath]);

  const handleAuthenticated = () => {
    explorerKeyRef.current += 1;
    setPhase("explorer");
  };

  if (!visible) {
    return <div className="hidden" aria-hidden />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <HardDrive className="h-4 w-4 shrink-0 text-cf-orange" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-zinc-100">{volumeContext.pvcName}</p>
          {volumeContext.tunnelLabel ? (
            <p className="truncate text-[10px] text-zinc-500">{volumeContext.tunnelLabel}</p>
          ) : null}
        </div>
        <span className="hidden truncate font-mono text-[10px] text-emerald-400/90 sm:inline">{site}</span>
        <button
          type="button"
          title="Cerrar explorador del volumen"
          onClick={onClose}
          className="inline-flex items-center rounded-md bg-zinc-800 p-1.5 text-rose-200 ring-1 ring-zinc-600 hover:bg-rose-950/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {phase === "checking" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comprobando acceso SSH al volumen…
        </div>
      ) : null}

      {phase === "auth" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {renderAuthTerminal({ visible, onAuthenticated: handleAuthenticated })}
        </div>
      ) : null}

      {phase === "explorer" ? (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 flex flex-col">
            <SshFileTransferPanel
              key={`pvc-${explorerKeyRef.current}-${volumeContext.pvcName}`}
              ref={panelRef}
              site={site}
              sshReady={false}
              connectWithoutReady
              variant="full"
              startPath={volumeContext.startPath}
              storageTools
              onSessionReady={setSftpSessionId}
              onEditFile={(entry) => setEditTarget(entry)}
              onPermissions={(entry) => setPermTarget(entry)}
            />
          </div>
        </div>
      ) : null}

      {editTarget && sftpSessionId ? (
        <SshTextEditorModal
          path={editTarget.path}
          sessionId={sftpSessionId}
          onClose={() => setEditTarget(null)}
          onSaved={() => setEditTarget(null)}
        />
      ) : null}
      {permTarget && sftpSessionId ? (
        <SshPermissionsModal
          entry={permTarget}
          sessionId={sftpSessionId}
          onClose={() => setPermTarget(null)}
          onSaved={() => setPermTarget(null)}
        />
      ) : null}
    </div>
  );
}
