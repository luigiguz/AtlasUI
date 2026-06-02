import { siteDisplayName, type SiteRow } from "./components/AtlasSiteListUi";

export type DnsTunnelStatus = "healthy" | "degraded" | "idle" | "empty";

export type DnsTunnelGroup = {
  key: string;
  name: string;
  tunnelLabel: string;
  sites: SiteRow[];
  routes: NonNullable<SiteRow["posliteUrls"]>;
  routeCount: number;
  status: DnsTunnelStatus;
  sshActiveCount: number;
};

export function tunnelStatusLabel(status: DnsTunnelStatus): string {
  switch (status) {
    case "healthy":
      return "Buen estado";
    case "degraded":
      return "Con incidencias";
    case "empty":
      return "Sin rutas DNS";
    default:
      return "En espera";
  }
}

export function tunnelStatusPillClass(status: DnsTunnelStatus): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/15 text-emerald-200 ring-emerald-500/35";
    case "degraded":
      return "bg-rose-500/15 text-rose-200 ring-rose-500/35";
    case "empty":
      return "bg-zinc-700/40 text-zinc-400 ring-zinc-600/40";
    default:
      return "bg-amber-500/15 text-amber-200 ring-amber-500/35";
  }
}

function tunnelStatusForSites(sites: SiteRow[], routeCount: number): DnsTunnelStatus {
  if (routeCount === 0) return "empty";
  let hasSsh = false;
  let anyDead = false;
  let anyActive = false;
  for (const s of sites) {
    if (!s.ssh) continue;
    hasSsh = true;
    if (s.sshStatus === "dead") anyDead = true;
    if (s.sshStatus === "active") anyActive = true;
  }
  if (anyDead) return "degraded";
  if (hasSsh && !anyActive) return "idle";
  return "healthy";
}

export function groupSitesIntoTunnels(sites: SiteRow[]): DnsTunnelGroup[] {
  const map = new Map<string, SiteRow[]>();
  for (const site of sites) {
    const key = (site.tunnelName || site.id).trim() || site.id;
    const bucket = map.get(key) ?? [];
    bucket.push(site);
    map.set(key, bucket);
  }

  const groups: DnsTunnelGroup[] = [];
  for (const [key, siteList] of map) {
    const sortedSites = [...siteList].sort((a, b) => siteDisplayName(a).localeCompare(siteDisplayName(b)));
    const routes = sortedSites.flatMap((s) => s.posliteUrls ?? []);
    const routeCount = routes.length;
    const sshActiveCount = sortedSites.filter((s) => s.ssh && s.sshStatus === "active").length;
    const primary = sortedSites[0];
    groups.push({
      key,
      name: (primary.tunnelName || siteDisplayName(primary)).trim() || key,
      tunnelLabel: key,
      sites: sortedSites,
      routes,
      routeCount,
      status: tunnelStatusForSites(sortedSites, routeCount),
      sshActiveCount,
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function filterTunnelGroups(
  groups: DnsTunnelGroup[],
  query: string,
  statusFilter: "all" | DnsTunnelStatus
): DnsTunnelGroup[] {
  const q = query.trim().toLowerCase();
  return groups.filter((g) => {
    if (statusFilter !== "all" && g.status !== statusFilter) return false;
    if (!q) return true;
    const haystack = [
      g.name,
      g.tunnelLabel,
      ...g.sites.map((s) => s.id),
      ...g.sites.map((s) => s.name),
      ...g.routes.map((r) => r.url),
      ...g.routes.map((r) => r.suffix),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function dnsLinkLabel(link: {
  url: string;
  suffix?: string | null;
  port?: number | null;
}): string {
  if (link.suffix && String(link.suffix).trim()) {
    return String(link.suffix).trim();
  }
  if (link.port != null) return `:${link.port}`;
  try {
    return new URL(link.url).hostname;
  } catch {
    return "DNS";
  }
}

export function dnsLinkHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
