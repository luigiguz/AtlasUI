/** Labels Rancher normalizados (debe coincidir con backend/atlas_rancher/labels.py). */

export const POSLITE_APPLICATION = "Poslite";

export const POSLITE_DISTROS = ["Horustech", "Pam"] as const;

const DISTRO_CANONICAL: Record<string, string> = {
  pam: "Pam",
  horustech: "Horustech",
};

const APPLICATION_CANONICAL: Record<string, string> = {
  poslite: "Poslite",
};

export function normalizeDistro(raw: string): string {
  const low = raw.trim().toLowerCase();
  if (!low) return "";
  return DISTRO_CANONICAL[low] ?? low.charAt(0).toUpperCase() + low.slice(1);
}

export function normalizeApplication(raw: string): string {
  const low = raw.trim().toLowerCase();
  if (!low) return "";
  return APPLICATION_CANONICAL[low] ?? low.charAt(0).toUpperCase() + low.slice(1);
}

export function isPosliteApplication(app: string): boolean {
  return normalizeApplication(app) === POSLITE_APPLICATION;
}

export function isValidPosliteDistro(distro: string): boolean {
  const d = normalizeDistro(distro);
  return (POSLITE_DISTROS as readonly string[]).includes(d);
}

/** Estado visible en tabla y filtros (Ready, Disconnected, …). */
export function normalizeState(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  if (s.includes("ready") || s === "active") return "Ready";
  if (s.includes("disconnect")) return "Disconnected";
  if (s.includes("error") || s.includes("fail")) return "Error";
  if (s.includes("provision") || s.includes("pending") || s.includes("reconcil")) return "Provisioning";
  return raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1).toLowerCase();
}
