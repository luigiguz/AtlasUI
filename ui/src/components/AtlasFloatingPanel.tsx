import { AnimatePresence, motion } from "framer-motion";
import { GripHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { atlasModalBackdropMotion, atlasModalEase } from "../atlasModalMotion";

const MIN_W = 420;
const MIN_H = 280;
const DEFAULT_W = 720;
const DEFAULT_H = 520;
const VIEWPORT_PAD = 12;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function centeredBox(w: number, h: number) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const width = Math.min(w, vw - VIEWPORT_PAD * 2);
  const height = Math.min(h, vh - VIEWPORT_PAD * 2);
  return {
    width,
    height,
    x: Math.max(VIEWPORT_PAD, (vw - width) / 2),
    y: Math.max(VIEWPORT_PAD, (vh - height) / 2),
  };
}

type Props = {
  children: ReactNode;
  header: ReactNode;
  footer?: ReactNode;
  onBackdropClick?: () => void;
  zIndexClass?: string;
  defaultWidth?: number;
  defaultHeight?: number;
};

export function AtlasFloatingPanel({
  children,
  header,
  footer,
  onBackdropClick,
  zIndexClass = "z-[200]",
  defaultWidth = DEFAULT_W,
  defaultHeight = DEFAULT_H,
}: Props) {
  const [box, setBox] = useState(() => centeredBox(defaultWidth, defaultHeight));
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originW: number;
    originH: number;
  } | null>(null);

  const reclamp = useCallback((next: { x: number; y: number; width: number; height: number }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = clamp(next.width, MIN_W, vw - VIEWPORT_PAD * 2);
    const height = clamp(next.height, MIN_H, vh - VIEWPORT_PAD * 2);
    const x = clamp(next.x, VIEWPORT_PAD, vw - width - VIEWPORT_PAD);
    const y = clamp(next.y, VIEWPORT_PAD, vh - height - VIEWPORT_PAD);
    setBox({ x, y, width, height });
  }, []);

  useEffect(() => {
    const onResize = () => setBox((b) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = clamp(b.width, MIN_W, vw - VIEWPORT_PAD * 2);
      const height = clamp(b.height, MIN_H, vh - VIEWPORT_PAD * 2);
      const x = clamp(b.x, VIEWPORT_PAD, vw - width - VIEWPORT_PAD);
      const y = clamp(b.y, VIEWPORT_PAD, vh - height - VIEWPORT_PAD);
      return { x, y, width, height };
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onDragPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: box.x,
      originY: box.y,
    };
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originW: box.width,
      originH: box.height,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      const d = dragRef.current;
      reclamp({
        ...box,
        x: d.originX + (e.clientX - d.startX),
        y: d.originY + (e.clientY - d.startY),
      });
    }
    if (resizeRef.current?.pointerId === e.pointerId) {
      const r = resizeRef.current;
      reclamp({
        x: box.x,
        y: box.y,
        width: r.originW + (e.clientX - r.startX),
        height: r.originH + (e.clientY - r.startY),
      });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
    if (resizeRef.current?.pointerId === e.pointerId) resizeRef.current = null;
  };

  const node = (
    <AnimatePresence>
      <motion.div
        key="atlas-floating-panel"
        {...atlasModalBackdropMotion}
        className={`fixed inset-0 ${zIndexClass} bg-black/60 backdrop-blur-[2px]`}
        onClick={onBackdropClick}
        role="presentation"
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: atlasModalEase }}
          className="fixed flex flex-col overflow-hidden rounded-xl border border-cf-line bg-cf-panel shadow-2xl ring-1 ring-white/[0.08]"
          style={{
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="flex shrink-0 cursor-grab select-none flex-col border-b border-cf-line/60 active:cursor-grabbing"
            onPointerDown={onDragPointerDown}
          >
            <div className="flex items-center justify-center py-1 text-zinc-600">
              <GripHorizontal className="h-3.5 w-3.5" aria-hidden />
            </div>
            {header}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
          {footer ? (
            <div className="shrink-0 border-t border-cf-line/60">{footer}</div>
          ) : null}
          <div
            role="presentation"
            title="Redimensionar"
            onPointerDown={onResizePointerDown}
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize"
            style={{
              background:
                "linear-gradient(135deg, transparent 50%, rgba(244,129,32,0.45) 50%, rgba(244,129,32,0.75) 100%)",
            }}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  if (typeof document === "undefined") return node;
  return createPortal(node, document.body);
}
