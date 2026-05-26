function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      __ATLAS_API_BASE__?: string;
      __ATLASVPN_API_BASE__?: string;
    };
    const runtime = w.__ATLAS_API_BASE__ ?? w.__ATLASVPN_API_BASE__;
    if (typeof runtime === "string" && runtime.trim()) return runtime.replace(/\/$/, "");
  }
  const v = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
  return v.replace(/\/$/, "");
}

/** Base pública del API (p. ej. https://api-atlas-vpn.verkku.com). UI: https://atlas-ui.verkku.com. Vacío = mismo origen. */
export const API_BASE = resolveApiBase();

const TOKEN_KEY = "atlas_access_token";
const REFRESH_KEY = "atlas_refresh_token";
const LEGACY_TOKEN_KEY = "atlasvpn_access_token";

/** sessionStorage no se comparte entre ventanas emergentes; localStorage sí (mismo origen). */
function migrateAccessTokenFromSessionStorage(): void {
  try {
    for (const key of [TOKEN_KEY, LEGACY_TOKEN_KEY]) {
      const legacy = sessionStorage.getItem(key);
      if (legacy) {
        localStorage.setItem(TOKEN_KEY, legacy);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(LEGACY_TOKEN_KEY);
        break;
      }
    }
    const legacyLocal = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyLocal && !localStorage.getItem(TOKEN_KEY)) {
      localStorage.setItem(TOKEN_KEY, legacyLocal);
    }
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function apiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

export function wsUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE) {
    const u = new URL(apiUrl(path));
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString();
  }
  if (typeof window !== "undefined") {
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${loc.host}${p}`;
  }
  return `ws://127.0.0.1:8765${p}`;
}

export function getAccessToken(): string | null {
  migrateAccessTokenFromSessionStorage();
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

export function setAccessToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function clearAuthTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

/** Renueva access_token usando refresh_token en BD. */
export async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const r = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = (await r.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (!r.ok || !data.access_token) return false;
    setAccessToken(data.access_token);
    if (data.refresh_token) setRefreshToken(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export function bearerHeaders(): Record<string, string> {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function mergeHeaders(init?: RequestInit): Headers {
  const h = new Headers(init?.headers as HeadersInit | undefined);
  if (!h.has("Content-Type") && init?.body != null && init.body !== "") {
    h.set("Content-Type", "application/json");
  }
  const t = getAccessToken();
  if (t) h.set("Authorization", `Bearer ${t}`);
  return h;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const cross = Boolean(API_BASE);
  const r = await fetch(apiUrl(path), {
    ...init,
    credentials: cross ? "omit" : "include",
    headers: mergeHeaders(init),
  });
  const data = (await r.json().catch(() => ({}))) as {
    message?: string;
    ok?: boolean;
    detail?: string | { msg: string }[];
  };
  if (r.status === 401) {
    const refreshed =
      path !== "/api/auth/refresh" &&
      path !== "/api/auth/login" &&
      (await refreshAccessToken());
    if (refreshed) {
      const retry = await fetch(apiUrl(path), {
        ...init,
        credentials: cross ? "omit" : "include",
        headers: mergeHeaders(init),
      });
      const retryData = (await retry.json().catch(() => ({}))) as {
        message?: string;
        detail?: string | { msg: string }[];
      };
      if (retry.ok) return retryData as T;
    }
    window.dispatchEvent(new CustomEvent("atlas-unauthorized"));
  }
  if (!r.ok) {
    let msg = data.message;
    if (!msg && typeof data.detail === "string") msg = data.detail;
    if (!msg && Array.isArray(data.detail) && data.detail[0] && typeof data.detail[0].msg === "string")
      msg = data.detail[0].msg;
    throw new Error(msg || r.statusText);
  }
  return data as T;
}
