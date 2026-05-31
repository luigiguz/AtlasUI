/** Animaciones estándar para modales Atlas (framer-motion). */

export const atlasModalEase = [0.32, 0.72, 0, 1] as const;

export const atlasModalBackdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.22, ease: atlasModalEase },
} as const;

export const atlasModalPanelMotion = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 8 },
  transition: { type: "spring", damping: 28, stiffness: 360, mass: 0.85 },
} as const;

/** Panel tipo sheet (p. ej. logs en móvil). */
export const atlasModalSheetMotion = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 20 },
  transition: { type: "spring", damping: 32, stiffness: 380, mass: 0.9 },
} as const;
