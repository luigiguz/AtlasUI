import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  atlasModalBackdropMotion,
  atlasModalPanelMotion,
  atlasModalSheetMotion,
} from "../atlasModalMotion";

type Layout = "center" | "sheet";

type ShellProps = {
  onBackdropClick?: () => void;
  children: ReactNode;
  zIndexClass?: string;
  panelClassName?: string;
  layout?: Layout;
  backdropClassName?: string;
};

/** Modal montado/desmontado (usar dentro de `AnimatePresence`). */
export function AtlasModalShell({
  onBackdropClick,
  children,
  zIndexClass = "z-[150]",
  panelClassName = "",
  layout = "center",
  backdropClassName = "",
}: ShellProps) {
  const align =
    layout === "sheet"
      ? "flex items-end justify-center p-0 sm:items-center sm:p-4"
      : "flex items-center justify-center p-4";
  const panelMotion = layout === "sheet" ? atlasModalSheetMotion : atlasModalPanelMotion;

  return (
    <motion.div
      {...atlasModalBackdropMotion}
      className={`fixed inset-0 ${zIndexClass} ${align} bg-black/70 backdrop-blur-sm ${backdropClassName}`}
      onClick={onBackdropClick}
      role="presentation"
    >
      <motion.div {...panelMotion} onClick={(e) => e.stopPropagation()} className={panelClassName}>
        {children}
      </motion.div>
    </motion.div>
  );
}

type FrameProps = ShellProps & {
  open: boolean;
};

/** Modal controlado por prop `open` (incluye `AnimatePresence`). Montado en `document.body`. */
export function AtlasModalFrame({ open, ...shell }: FrameProps) {
  const node = (
    <AnimatePresence>
      {open ? <AtlasModalShell key="atlas-modal" {...shell} /> : null}
    </AnimatePresence>
  );
  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
