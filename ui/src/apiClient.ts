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
