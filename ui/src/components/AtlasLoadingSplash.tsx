import { motion } from "framer-motion";
import { useState } from "react";

import { apiUrl } from "../apiClient";

const ATLAS_LOGO_FALLBACK = `/branding/${encodeURIComponent("Logo ATLAS - Sin Fondi.png")}`;

type Props = {
  message?: string;
  className?: string;
  minHeight?: string;
  /** Arranque de sesión / pantalla completa. */
  fullscreen?: boolean;
  /** Paneles secundarios (logs, etc.). */
  compact?: boolean;
};

function AtlasSplashLogo({ compact }: { compact?: boolean }) {
  const [src, setSrc] = useState(ATLAS_LOGO_FALLBACK);

  return (
    <motion.img
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
      src={src}
      alt="Atlas"
      onError={() => {
        const apiLogo = apiUrl("/api/logo");
        if (src !== apiLogo) setSrc(apiLogo);
      }}
      className={
        compact
          ? "h-11 w-auto max-w-[7rem] object-contain sm:h-12 sm:max-w-[8rem]"
          : "h-16 w-auto max-w-[10rem] object-contain sm:h-20 sm:max-w-[12rem]"
      }
    />
  );
}

/** Pantalla de carga centrada (logo Atlas + barra), estilo splash minimalista. */
export function AtlasLoadingSplash({
  message,
  className = "",
  minHeight,
  fullscreen = false,
  compact = false,
}: Props) {
  const height =
    minHeight ??
    (fullscreen
      ? "min-h-screen"
      : compact
        ? "min-h-[12rem]"
        : "min-h-[min(420px,58vh)]");
  const padding = fullscreen ? "py-20" : compact ? "py-10" : "py-14";
  const barWidth = compact ? "w-32 sm:w-36" : "w-44 sm:w-52";
  const barGap = compact ? "mt-5" : "mt-7";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`atlas-app-bg flex ${height} w-full flex-col items-center justify-center px-6 ${padding} ${className}`}
    >
      <AtlasSplashLogo compact={compact} />
      <div className={`${barGap} h-0.5 ${barWidth} overflow-hidden rounded-full bg-zinc-800/90`} aria-hidden>
        <motion.div
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-cf-orange to-transparent"
          initial={{ x: "-120%" }}
          animate={{ x: "340%" }}
          transition={{ duration: 1.25, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      {message ? (
        <p
          className={`mt-6 max-w-xs text-center leading-relaxed text-zinc-500 ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
