import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type FormEvent } from "react";

export type AtlasPromptDialogProps = {
  open: boolean;
  title: string;
  message?: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

/** Entrada de texto Atlas (sustituto de `window.prompt`). */
export function AtlasPromptDialog({
  open,
  title,
  message,
  label = "Nombre",
  defaultValue = "",
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: AtlasPromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={onCancel}
          role="presentation"
        >
          <motion.form
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06]"
          >
            <div className="px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
              {message ? (
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{message}</p>
              ) : null}
              <label className="mt-3 block text-xs font-medium text-zinc-500">{label}</label>
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20"
              />
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
                >
                  {cancelLabel}
                </button>
                <button
                  type="submit"
                  disabled={!value.trim()}
                  className="rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50"
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
