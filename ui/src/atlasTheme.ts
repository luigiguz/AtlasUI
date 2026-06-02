import { useCallback, useSyncExternalStore } from "react";

export type AtlasTheme = "dark" | "light";

const ATLAS_THEME_KEY = "atlas.theme";
/** Clave legacy por si existía en navegadores antiguos. */
const LEGACY_THEME_KEYS = ["atlasvpn.theme"] as const;

function preferredTheme(): AtlasTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function readStoredAtlasTheme(): AtlasTheme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ATLAS_THEME_KEY);
    if (raw === "light" || raw === "dark") return raw;
    for (const legacyKey of LEGACY_THEME_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy === "light" || legacy === "dark") {
        localStorage.setItem(ATLAS_THEME_KEY, legacy);
        localStorage.removeItem(legacyKey);
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function applyAtlasTheme(theme: AtlasTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

export function persistAtlasTheme(theme: AtlasTheme): void {
  try {
    localStorage.setItem(ATLAS_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function resolveInitialTheme(): AtlasTheme {
  return readStoredAtlasTheme() ?? preferredTheme();
}

let currentTheme: AtlasTheme = resolveInitialTheme();
const listeners = new Set<() => void>();

function notifyThemeListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getAtlasTheme(): AtlasTheme {
  return currentTheme;
}

export function setAtlasTheme(theme: AtlasTheme): void {
  if (theme === currentTheme) {
    applyAtlasTheme(theme);
    persistAtlasTheme(theme);
    return;
  }
  currentTheme = theme;
  applyAtlasTheme(theme);
  persistAtlasTheme(theme);
  notifyThemeListeners();
}

export function toggleAtlasTheme(): AtlasTheme {
  const next: AtlasTheme = currentTheme === "dark" ? "light" : "dark";
  setAtlasTheme(next);
  return next;
}

export function subscribeAtlasTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Antes del primer render de React (y tras F5). */
export function bootstrapAtlasTheme(): void {
  currentTheme = resolveInitialTheme();
  applyAtlasTheme(currentTheme);
  persistAtlasTheme(currentTheme);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key != null && event.key !== ATLAS_THEME_KEY) return;
    const stored = readStoredAtlasTheme();
    if (!stored || stored === currentTheme) return;
    currentTheme = stored;
    applyAtlasTheme(stored);
    notifyThemeListeners();
  });
}

export function useAtlasTheme() {
  const theme = useSyncExternalStore(
    subscribeAtlasTheme,
    getAtlasTheme,
    () => "dark" as AtlasTheme
  );

  const setTheme = useCallback((next: AtlasTheme) => {
    setAtlasTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    toggleAtlasTheme();
  }, []);

  return { theme, setTheme, toggleTheme };
}
