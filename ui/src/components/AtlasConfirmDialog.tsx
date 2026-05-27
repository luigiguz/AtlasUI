import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export type AtlasConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  busy?: boolean;
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
  onConfirm,
  onCancel,
}: AtlasConfirmDialogProps) {
  const confirmClass =
    variant === "danger"
      ? "bg-rose-600/90 text-white hover:bg-rose-600"
      : "bg-cf-orange text-black hover:brightness-110";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={busy ? undefined : onCancel}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="atlas-confirm-title"
            aria-describedby="atlas-confirm-desc"
            className="w-full max-w-md rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06]"
          >
            <div className="px-5 py-4">
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
                  disabled={busy}
                  onClick={onConfirm}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${confirmClass}`}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
