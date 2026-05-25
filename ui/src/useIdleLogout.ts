import { useEffect, useRef } from "react";

const LAST_ACTIVITY_KEY = "atlas-last-activity";
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 15_000;
const BUMP_THROTTLE_MS = 3_000;

declare global {
  interface Window {
    __ATLAS_IDLE_MS__?: number;
  }
}

export function idleSessionTimeoutMs(): number {
  const v = window.__ATLAS_IDLE_MS__;
  if (typeof v === "number" && Number.isFinite(v) && v >= 60_000) {
    return v;
  }
  return DEFAULT_IDLE_MS;
}

function readLastActivity(): number {
  try {
    const raw = sessionStorage.getItem(LAST_ACTIVITY_KEY);
    if (!raw) return Date.now();
    const n = Number(raw);
    return Number.isFinite(n) ? n : Date.now();
  } catch {
    return Date.now();
  }
}

function writeLastActivity(ts: number) {
  try {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

export function clearSessionActivity() {
  clearLastActivity();
}

function clearLastActivity() {
  try {
    sessionStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}

/** Llamar tras login correcto (no al restaurar sesión con /api/auth/status). */
export function touchSessionActivity() {
  writeLastActivity(Date.now());
}

/**
 * Cierra sesión en el cliente tras inactividad real (ratón/teclado).
 * No cuenta peticiones API (p. ej. polling de Rancher).
 */
export function useIdleLogout(enabled: boolean, onIdle: () => void) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const lastActivityRef = useRef(Date.now());
  const lastBumpRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      clearLastActivity();
      return;
    }

    const timeoutMs = idleSessionTimeoutMs();
    const stored = readLastActivity();
    const idleMs = Date.now() - stored;
    if (idleMs >= timeoutMs) {
      clearLastActivity();
      onIdleRef.current();
      return;
    }
    lastActivityRef.current = stored;
    writeLastActivity(stored);

    function bumpActivity() {
      const now = Date.now();
      if (now - lastBumpRef.current < BUMP_THROTTLE_MS) return;
      lastBumpRef.current = now;
      lastActivityRef.current = now;
      writeLastActivity(now);
    }

    const events: (keyof WindowEventMap)[] = [
      "mousedown",
      "keydown",
      "wheel",
      "touchstart",
      "click",
      "scroll",
    ];
    for (const ev of events) {
      window.addEventListener(ev, bumpActivity, { passive: true, capture: true });
    }

    const tick = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        clearLastActivity();
        onIdleRef.current();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const ev of events) {
        window.removeEventListener(ev, bumpActivity, true);
      }
      window.clearInterval(tick);
    };
  }, [enabled]);
}
