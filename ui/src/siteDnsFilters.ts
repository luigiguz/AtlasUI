import {
  matchesFilterRules,
  matchesQuickSearch,
  type FilterFieldDef,
  type FilterRule,
} from "./components/AtlasFieldFilters";
import type { SiteRow } from "./components/AtlasSiteListUi";

export type SiteDnsFilterField = "name" | "id" | "url" | "suffix" | "port";

export const SITE_DNS_FILTER_FIELDS: FilterFieldDef<SiteDnsFilterField>[] = [
  { key: "name", label: "Sitio", placeholder: "nombre de tienda" },
  { key: "id", label: "ID", placeholder: "identificador" },
  { key: "url", label: "URL", placeholder: "https://…" },
  { key: "suffix", label: "Sufijo", placeholder: "poslite, admin…" },
  { key: "port", label: "Puerto", placeholder: "8080" },
];

function dnsFieldValue(site: SiteRow, field: SiteDnsFilterField): string {
  const urls = site.posliteUrls ?? [];
  switch (field) {
    case "name":
      return site.name;
    case "id":
      return site.id;
    case "url":
      return urls.map((u) => u.url).join(" ");
    case "suffix":
      return urls.map((u) => u.suffix ?? "").join(" ");
    case "port":
      return urls.map((u) => (u.port != null ? String(u.port) : "")).join(" ");
    default:
      return "";
  }
}

export function matchesSiteDnsSearch(site: SiteRow, query: string): boolean {
  const urls = site.posliteUrls ?? [];
  return matchesQuickSearch(query, [
    site.name,
    site.id,
    ...urls.map((u) => u.url),
    ...urls.map((u) => u.suffix),
    ...urls.map((u) => u.port),
  ]);
}

export function matchesSiteDnsRules(
  site: SiteRow,
  rules: FilterRule<SiteDnsFilterField>[]
): boolean {
  return matchesFilterRules(rules, (field) => dnsFieldValue(site, field), (field, a, b) => {
    if (field === "port" || field === "id") return a.trim() === b.trim();
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  });
}

export function filterSitesForDns(
  sites: SiteRow[],
  searchQuery: string,
  rules: FilterRule<SiteDnsFilterField>[]
): SiteRow[] {
  return sites.filter(
    (site) => matchesSiteDnsSearch(site, searchQuery) && matchesSiteDnsRules(site, rules)
  );
}

export function siteDnsRecordCount(site: SiteRow): number {
  return site.posliteUrls?.length ?? 0;
}
