import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, ExternalLink, Globe } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import {
  AtlasFieldFiltersPanel,
  AtlasFilterSearchInput,
  AtlasFiltersToolbarButton,
  newFilterRule,
  type FilterRule,
} from "../components/AtlasFieldFilters";
import {
  SITES_PAGE_SIZE,
  SitePaginationBar,
  siteDisplayName,
  type SiteRow,
} from "../components/AtlasSiteListUi";
import {
  filterSitesForDns,
  SITE_DNS_FILTER_FIELDS,
  siteDnsRecordCount,
  type SiteDnsFilterField,
} from "../siteDnsFilters";

type Props = {
  sites: SiteRow[];
  domainSuffix?: string;
};

function siteDnsSummary(site: SiteRow): {
  tone: "ok" | "empty";
  label: string;
  hint: string;
} {
  const count = siteDnsRecordCount(site);
  if (count === 0) {
    return { tone: "empty", label: "—", hint: "Sin registros DNS publicados" };
  }
  return {
    tone: "ok",
    label: String(count),
    hint: `${count} registro${count !== 1 ? "s" : ""} DNS`,
  };
}

function dnsStatusPillClass(tone: "ok" | "empty"): string {
  if (tone === "ok") {
    return "bg-sky-500/20 text-sky-200 ring-sky-500/35";
  }
  return "bg-zinc-700/40 text-zinc-400 ring-zinc-600/40";
}

function dnsLinkLabel(link: { url: string; suffix?: string | null; port?: number | null }): string {
  if (link.suffix && String(link.suffix).trim()) {
    return String(link.suffix).trim();
  }
  if (link.port != null) return `:${link.port}`;
  try {
    const u = new URL(link.url);
    return u.hostname;
  } catch {
    return "DNS";
  }
}

function sitePreviewLink(site: SiteRow): string {
  const first = site.posliteUrls?.[0];
  if (!first) return "Sin URLs Poslite";
  return dnsLinkLabel(first);
}

function SiteDnsFiltersBar({
  searchQuery,
  onSearchChange,
  appliedRules,
  draftRules,
  onDraftChange,
  filtersOpen,
  onFiltersOpenChange,
  onApply,
  onClear,
}: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  appliedRules: FilterRule<SiteDnsFilterField>[];
  draftRules: FilterRule<SiteDnsFilterField>[];
  onDraftChange: (rules: FilterRule<SiteDnsFilterField>[]) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRuleCount = appliedRules.filter((r) => r.value.trim()).length;
  const hasActiveFilters = searchQuery.trim() !== "" || activeRuleCount > 0;

  function openFiltersPanel() {
    onDraftChange(
      activeRuleCount > 0
        ? appliedRules.map((r) => ({ ...r, id: crypto.randomUUID() }))
        : [newFilterRule<SiteDnsFilterField>("name")]
    );
    onFiltersOpenChange(true);
  }

  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onFiltersOpenChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFiltersOpenChange(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen, onFiltersOpenChange]);

  return (
    <div className="flex flex-col gap-2">
      <div ref={panelRef} className="relative flex flex-wrap items-center gap-2">
        <AtlasFilterSearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Buscar por sitio, URL, sufijo o puerto…"
          ariaLabel="Buscar registros DNS"
        />
        <AtlasFiltersToolbarButton
          open={filtersOpen}
          activeRuleCount={activeRuleCount}
          onClick={() => (filtersOpen ? onFiltersOpenChange(false) : openFiltersPanel())}
        />
        {filtersOpen ? (
          <AtlasFieldFiltersPanel
            fields={SITE_DNS_FILTER_FIELDS}
            rules={draftRules}
            onChange={onDraftChange}
            onApply={onApply}
            onClose={() => onFiltersOpenChange(false)}
            dialogLabel="Filtros DNS"
          />
        ) : null}
      </div>
      {hasActiveFilters ? (
        <button
          type="button"
          onClick={onClear}
          className="self-start rounded-lg border border-cf-line bg-cf-panel px-2.5 py-1 text-[11px] text-zinc-400 hover:border-zinc-500"
        >
          Limpiar filtros
        </button>
      ) : null}
    </div>
  );
}

export function AtlasDnsView({ sites, domainSuffix }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [listPage, setListPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [appliedRules, setAppliedRules] = useState<FilterRule<SiteDnsFilterField>[]>([]);
  const [draftRules, setDraftRules] = useState<FilterRule<SiteDnsFilterField>[]>(() => [
    newFilterRule<SiteDnsFilterField>("name"),
  ]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(
    () => filterSitesForDns(sites, searchQuery, appliedRules),
    [sites, searchQuery, appliedRules]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / SITES_PAGE_SIZE));
  const pageSafe = Math.min(listPage, totalPages - 1);
  const pageSlice = useMemo(
    () => filtered.slice(pageSafe * SITES_PAGE_SIZE, (pageSafe + 1) * SITES_PAGE_SIZE),
    [filtered, pageSafe]
  );

  useEffect(() => {
    setListPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);

  useEffect(() => {
    setListPage(0);
  }, [searchQuery, appliedRules]);

  function clearFilters() {
    setSearchQuery("");
    setAppliedRules([]);
    setDraftRules([newFilterRule<SiteDnsFilterField>("name")]);
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  }

  return (
    <motion.div
      key="dns"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex min-h-[calc(100dvh-9rem)] flex-col gap-3"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1">
            <SiteDnsFiltersBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              appliedRules={appliedRules}
              draftRules={draftRules}
              onDraftChange={setDraftRules}
              filtersOpen={filtersOpen}
              onFiltersOpenChange={setFiltersOpen}
              onApply={() => {
                setAppliedRules(draftRules.filter((r) => r.value.trim()));
                setFiltersOpen(false);
              }}
              onClear={clearFilters}
            />
          </div>
          <p className="shrink-0 pt-1 text-xs tabular-nums text-zinc-500">
            {filtered.length} de {sites.length} sitio{sites.length !== 1 ? "s" : ""}
            {domainSuffix ? (
              <span className="mt-0.5 block text-[11px] text-zinc-600">· {domainSuffix}</span>
            ) : null}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cf-line/60 bg-black/[0.12]">
          <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#0f1317]/95 backdrop-blur">
                <tr className="border-b border-cf-line/70 text-[10px] uppercase tracking-wide text-zinc-500">
                  <th className="w-12 px-3 py-2 font-medium">Detalle</th>
                  <th className="px-3 py-2 font-medium">Sitio</th>
                  <th className="w-32 px-3 py-2 font-medium">Registros</th>
                  <th className="w-44 px-3 py-2 font-medium">Estado DNS</th>
                  <th className="px-3 py-2 font-medium">Vista rápida</th>
                  <th className="w-40 px-3 py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {sites.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                      No hay sitios en tunnels.json. Sincroniza desde Cloudflare o crea plantilla.
                    </td>
                  </tr>
                ) : null}
                {sites.length > 0 && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                      Ningún sitio coincide con la búsqueda o los filtros seleccionados.
                    </td>
                  </tr>
                ) : null}
                {pageSlice.map((s) => {
                  const open = expandedId === s.id;
                  const dns = siteDnsSummary(s);
                  const urls = s.posliteUrls ?? [];
                  const firstUrl = urls[0]?.url;
                  return (
                    <Fragment key={s.id}>
                      <tr
                        className={`transition ${open ? "bg-cf-orange/5" : "bg-black/15 hover:bg-black/25"}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 align-top">
                          <button
                            type="button"
                            className="inline-flex items-center rounded-md border border-cf-line bg-black/30 p-1.5 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                            onClick={() => setExpandedId(open ? null : s.id)}
                            aria-label={open ? "Ocultar detalle DNS" : "Mostrar detalle DNS"}
                          >
                            <ChevronDown
                              className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180 text-cf-orange" : ""}`}
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <p className="font-medium text-zinc-200">{siteDisplayName(s)}</p>
                          {s.tunnelName && s.tunnelName !== s.name ? (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{s.name}</p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 align-top">
                          <span className="text-sm font-semibold text-zinc-100">{urls.length}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 align-top">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${dnsStatusPillClass(dns.tone)}`}
                          >
                            {dns.hint}
                          </span>
                        </td>
                        <td className="max-w-[22rem] px-3 py-2.5 align-top">
                          <p className="truncate text-zinc-400" title={firstUrl ?? sitePreviewLink(s)}>
                            {firstUrl ?? sitePreviewLink(s)}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex justify-end gap-2">
                            {firstUrl ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void copyUrl(firstUrl)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                >
                                  <Copy className="h-3 w-3" />
                                  Copiar
                                </button>
                                <a
                                  href={firstUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-lg bg-cf-orange px-2.5 py-1.5 text-[11px] font-semibold text-black hover:bg-cf-orange/90"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  Abrir
                                </a>
                              </>
                            ) : (
                              <span className="text-[11px] text-zinc-600">Sin acción</span>
                            )}
                          </div>
                        </td>
                      </tr>
                      <tr className={open ? "bg-black/25" : "hidden"}>
                        <td colSpan={6} className="p-0">
                          <AnimatePresence initial={false}>
                            {open ? (
                              <motion.div
                                key={`dns-panel-${s.id}`}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                className="overflow-hidden border-t border-cf-line/60 bg-black/30"
                              >
                                <div className="flex items-center gap-2 px-4 pt-3 text-[11px] text-zinc-500">
                                  <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  Detalle de registros DNS
                                </div>
                                <div className="grid gap-2 p-3 sm:grid-cols-2">
                                  {urls.length === 0 ? (
                                    <p className="col-span-full rounded-lg border border-white/[0.06] bg-black/30 p-3 text-center text-xs text-zinc-500">
                                      Este sitio no tiene registros DNS en la última sincronización.
                                    </p>
                                  ) : (
                                    urls.map((link) => {
                                      const label = dnsLinkLabel(link);
                                      return (
                                        <div
                                          key={`${s.id}-${link.suffix ?? link.port ?? link.url}`}
                                          className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-black/30 p-3"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-xs font-medium text-zinc-200">{label}</span>
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                type="button"
                                                onClick={() => void copyUrl(link.url)}
                                                className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                                              >
                                                <Copy className="h-3 w-3" />
                                                Copiar
                                              </button>
                                              <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 rounded-lg bg-cf-orange px-2.5 py-1.5 text-[11px] font-semibold text-black hover:bg-cf-orange/90"
                                              >
                                                <ExternalLink className="h-3 w-3" />
                                                Abrir
                                              </a>
                                            </div>
                                          </div>
                                          <p className="break-all font-mono text-[11px] text-zinc-500">{link.url}</p>
                                          {link.port != null ? (
                                            <p className="text-[10px] text-zinc-600">Puerto local: {link.port}</p>
                                          ) : null}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sites.length > 0 ? (
            <SitePaginationBar
              page={listPage}
              setPage={setListPage}
              totalItems={filtered.length}
              pageSize={SITES_PAGE_SIZE}
            />
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}
