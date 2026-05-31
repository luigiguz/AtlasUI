import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Copy, ExternalLink, Globe } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  siteListVariants,
  siteRowVariants,
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
  tone: "ok" | "empty" | "idle";
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

function dnsRailClass(tone: "ok" | "empty" | "idle"): string {
  if (tone === "ok") {
    return "bg-gradient-to-b from-sky-400 to-sky-600 shadow-[inset_-1px_0_0_rgba(0,0,0,0.2)]";
  }
  if (tone === "empty") {
    return "bg-zinc-600/90";
  }
  return "bg-zinc-600/90";
}

function dnsDotClass(tone: "ok" | "empty" | "idle"): string {
  if (tone === "ok") {
    return "bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.65)]";
  }
  return "bg-zinc-500";
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
          <motion.div
            variants={siteListVariants}
            initial="hidden"
            animate="show"
            className="grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto p-2 pb-1 sm:grid-cols-2 sm:p-3 lg:grid-cols-3 [scrollbar-gutter:stable]"
          >
            {sites.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-cf-line bg-cf-panel/50 p-10 text-center text-zinc-500">
                No hay sitios en tunnels.json. Sincroniza desde Cloudflare o crea plantilla.
              </div>
            )}
            {sites.length > 0 && filtered.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-cf-line bg-cf-panel/50 p-10 text-center text-zinc-500">
                Ningún sitio coincide con la búsqueda o los filtros seleccionados.
              </div>
            )}
            {pageSlice.map((s) => {
              const open = expandedId === s.id;
              const dns = siteDnsSummary(s);
              const urls = s.posliteUrls ?? [];
              return (
                <motion.div
                  key={s.id}
                  variants={siteRowVariants}
                  layout
                  className={
                    open
                      ? "group flex flex-row overflow-hidden rounded-2xl border border-cf-orange bg-cf-orange/10 shadow-lg shadow-cf-orange/10 ring-1 ring-cf-orange/40"
                      : "group flex flex-row overflow-hidden rounded-2xl border border-cf-line bg-cf-card/90 ring-1 ring-transparent hover:border-zinc-600 hover:bg-cf-card"
                  }
                  aria-label={`${s.name}: ${dns.hint}`}
                >
                  <div
                    className={`w-2 shrink-0 self-stretch ${dnsRailClass(dns.tone)}`}
                    title={dns.hint}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 p-4 text-left"
                      onClick={() => setExpandedId(open ? null : s.id)}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div
                          className="flex shrink-0 flex-col items-center gap-1 border-r border-white/10 pr-3 pt-0.5"
                          title={dns.hint}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${dnsDotClass(dns.tone)}`} aria-hidden />
                          <span
                            className={`text-[9px] font-bold uppercase leading-none tracking-tight ${
                              dns.tone === "ok" ? "text-sky-300" : "text-zinc-500"
                            }`}
                          >
                            {dns.label}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold tracking-tight">{s.name}</span>
                          <p className="mt-1 text-[11px] text-zinc-500">
                            Pulsa para {open ? "ocultar" : "mostrar"} registros DNS
                          </p>
                        </div>
                      </div>
                      <ChevronDown
                        className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform duration-200 ${
                          open ? "rotate-180 text-cf-orange" : ""
                        }`}
                      />
                    </button>
                    <div className="border-t border-white/5 px-4 pb-3 pt-0">
                      <div className="flex items-center gap-2 text-xs">
                        <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                        <span className="text-zinc-500">Registros</span>
                        <span className="font-medium text-zinc-300">{urls.length}</span>
                      </div>
                      {urls.length > 0 ? (
                        <p className="mt-2 truncate font-mono text-[11px] text-zinc-500">
                          {urls
                            .slice(0, 2)
                            .map((l) => l.url)
                            .join(" · ")}
                          {urls.length > 2 ? ` · +${urls.length - 2}` : ""}
                        </p>
                      ) : (
                        <p className="mt-2 text-[11px] text-zinc-600">Sin URLs Poslite configuradas</p>
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {open ? (
                        <motion.div
                          key={`dns-panel-${s.id}`}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="overflow-hidden border-t border-cf-line/80 bg-black/25"
                        >
                          <div className="flex flex-col gap-2 p-3">
                            {urls.length === 0 ? (
                              <p className="text-center text-xs text-zinc-500">
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
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
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
