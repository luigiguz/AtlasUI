import type { ReactNode } from "react";

import { AtlasModalFrame } from "./AtlasModalFrame";

export type AtlasAlertDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  okLabel?: string;
  onClose: () => void;
};

/** Aviso Atlas (sustituto de `window.alert`). */
export function AtlasAlertDialog({
  open,
  title,
  message,
  okLabel = "Entendido",
  onClose,
}: AtlasAlertDialogProps) {
  return (
    <AtlasModalFrame
      open={open}
      onBackdropClick={onClose}
      panelClassName="w-full max-w-md rounded-2xl border border-cf-line bg-cf-panel shadow-2xl ring-1 ring-cf-line/40"
    >
      <div className="px-5 py-4" role="alertdialog" aria-modal="true">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black hover:brightness-110"
          >
            {okLabel}
          </button>
        </div>
      </div>
    </AtlasModalFrame>
  );
}
