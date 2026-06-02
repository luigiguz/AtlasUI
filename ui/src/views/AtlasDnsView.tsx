import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AtlasFilterSearchInput } from "../components/AtlasFieldFilters";
import { SITES_PAGE_SIZE, SitePaginationBar, type SiteRow } from "../components/AtlasSiteListUi";
import {
  filterTunnelGroups,
  groupSitesIntoTunnels,
  tunnelStatusLabel,
  tunnelStatusPillClass,
  type DnsTunnelGroup,
  type DnsTunnelStatus,
} from "../dnsTunnelModel";
import { AtlasDnsTunnelDetail } from "./AtlasDnsTunnelDetail";

type Props = {
  sites: SiteRow[];
  domainSuffix?: string;
};

const STATUS_FILTER_OPTIONS: { key: "all" | DnsTunnelStatus; label: string }[] = [
  { key: "all", label: "Todos los estados" },
  { key: "healthy", label: "Up" },
  { key: "degraded", label: "Down" },
  { key: "idle", label: "Down (sin túnel activo)" },
  { key: "empty", label: "Down (sin rutas DNS)" },
];

export function AtlasDnsView({ sites, domainSuffix }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DnsTunnelStatus>("all");
  const [listPage, setListPage] = useState(0);
  const [selectedTunnelKey, setSelectedTunnelKey] = useState<string | null>(null);

  const tunnels = useMemo(() => groupSitesIntoTunnels(sites), [sites]);

  const filtered = useMemo(
    () => filterTunnelGroups(tunnels, searchQuery, statusFilter),
    [tunnels, searchQuery, statusFilter]
  );

  const selectedTunnel = useMemo(
    () => tunnels.find((t) => t.key === selectedTunnelKey) ?? null,
    [tunnels, selectedTunnelKey]
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
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    if (selectedTunnelKey && !tunnels.some((t) => t.key === selectedTunnelKey)) {
      setSelectedTunnelKey(null);
    }
  }, [tunnels, selectedTunnelKey]);

  return (
    <motion.div
      key="dns"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="flex min-h-[calc(100dvh-9rem)] flex-col"
    >
      <AnimatePresence mode="wait">
        {selectedTunnel ? (
          <AtlasDnsTunnelDetail
            key={selectedTunnel.key}
            tunnel={selectedTunnel}
            domainSuffix={domainSuffix}
            onBack={() => setSelectedTunnelKey(null)}
          />
        ) : (
          <motion.div
            key="tunnel-list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm text-zinc-400">
                  Túneles Cloudflare sincronizados con Atlas VPN. Selecciona uno para ver rutas DNS y
                  conectividad por tienda.
                </p>
                {domainSuffix ? (
                  <p className="mt-1 text-[11px] text-zinc-600">Dominio: {domainSuffix}</p>
                ) : null}
              </div>
              <p className="shrink-0 text-xs tabular-nums text-zinc-500">
                {filtered.length} de {tunnels.length} túnel{tunnels.length !== 1 ? "es" : ""}
              </p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="min-w-0 flex-1">
                <AtlasFilterSearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Buscar túneles por nombre, sitio o URL…"
                  ariaLabel="Buscar túneles DNS"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | DnsTunnelStatus)}
                className="rounded-xl border border-cf-line bg-cf-panel/90 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20"
                aria-label="Filtrar por estado"
              >
                {STATUS_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-cf-line/70 bg-cf-panel/40">
              <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-cf-line/70 bg-cf-panel/95 backdrop-blur">
                    <tr className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-3">Nombre</th>
                      <th className="w-40 px-4 py-3">Estado</th>
                      <th className="w-28 px-4 py-3">Sitios</th>
                      <th className="w-36 px-4 py-3">Rutas</th>
                      <th className="w-12 px-4 py-3" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cf-line/50">
                    {tunnels.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-14 text-center text-sm text-zinc-500">
                          No hay sitios en tunnels.json. Sincroniza desde Cloudflare en la sección
                          Cloudflare.
                        </td>
                      </tr>
                    ) : null}
                    {tunnels.length > 0 && filtered.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-14 text-center text-sm text-zinc-500">
                          Ningún túnel coincide con la búsqueda o el filtro seleccionado.
                        </td>
                      </tr>
                    ) : null}
                    {pageSlice.map((tunnel) => (
                      <TunnelListRow
                        key={tunnel.key}
                        tunnel={tunnel}
                        onOpen={() => setSelectedTunnelKey(tunnel.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length > 0 ? (
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
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TunnelListRow({ tunnel, onOpen }: { tunnel: DnsTunnelGroup; onOpen: () => void }) {
  return (
    <tr
      className="cursor-pointer bg-cf-card/30 transition hover:bg-cf-card/60"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Abrir túnel ${tunnel.name}`}
    >
      <td className="px-4 py-3.5">
        <p className="font-medium text-zinc-100">{tunnel.name}</p>
        {tunnel.sites.length === 1 && tunnel.sites[0].name !== tunnel.name ? (
          <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{tunnel.sites[0].id}</p>
        ) : null}
      </td>
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex rounded-md px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${tunnelStatusPillClass(tunnel.status)}`}
        >
          {tunnelStatusLabel(tunnel.status)}
        </span>
      </td>
      <td className="px-4 py-3.5 tabular-nums text-zinc-300">{tunnel.sites.length}</td>
      <td className="px-4 py-3.5">
        <span className="inline-flex rounded-md border border-cf-line bg-cf-card/70 px-2.5 py-1 text-xs text-zinc-300">
          {tunnel.routeCount} aplicación{tunnel.routeCount !== 1 ? "es" : ""}
        </span>
      </td>
      <td className="px-4 py-3.5 text-right">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="inline-flex rounded-lg p-1.5 text-zinc-500 hover:bg-cf-panel hover:text-zinc-300"
          aria-label="Ver detalle"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}
