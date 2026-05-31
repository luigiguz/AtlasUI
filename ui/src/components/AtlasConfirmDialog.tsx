import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { AtlasModalFrame } from "./AtlasModalFrame";

export type AtlasConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmación Atlas (sustituto de `window.confirm`). */
export function AtlasConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "default",
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: AtlasConfirmDialogProps) {
  const confirmClass =
    variant === "danger"
      ? "bg-rose-600/90 text-white hover:bg-rose-600"
      : "bg-cf-orange text-black hover:brightness-110";

  return (
    <AtlasModalFrame
      open={open}
      onBackdropClick={busy ? undefined : onCancel}
      panelClassName="w-full max-w-md rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06]"
    >
      <div className="px-5 py-4" role="alertdialog" aria-modal="true" aria-labelledby="atlas-confirm-title" aria-describedby="atlas-confirm-desc">
        <h2 id="atlas-confirm-title" className="text-sm font-semibold text-zinc-100">
          {title}
        </h2>
        <div id="atlas-confirm-desc" className="mt-2 text-sm leading-relaxed text-zinc-400">
          {message}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${confirmClass}`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </AtlasModalFrame>
  );
}
