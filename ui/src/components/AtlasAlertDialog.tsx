import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";

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
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06]"
          >
            <div className="px-5 py-4">
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
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
