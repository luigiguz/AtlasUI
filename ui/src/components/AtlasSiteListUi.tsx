import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export type SiteRow = {
  id: string;
  name: string;
  ssh?: { hostname: string; local_port: number } | null;
  db?: { hostname: string; local_port: number } | null;
  sshStatus: string;
  dbStatus: string;
  posliteUrls?: { url: string; suffix?: string | null; port?: number | null }[];
};

/** Tarjetas por página en Conexiones y DNS. */
export const SITES_PAGE_SIZE = 12;

export const siteListVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.045, delayChildren: 0.06 },
  },
};

export const siteRowVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 420, damping: 28 },
  },
};

export function filterSitesByNameQuery(sites: SiteRow[], query: string): SiteRow[] {
  const t = query.trim().toLowerCase();
  if (!t) return sites;
  return sites.filter((s) => s.name.toLowerCase().includes(t) || s.id.toLowerCase().includes(t));
}

export function SitePaginationBar({
  page,
  setPage,
  totalItems,
  pageSize,
}: {
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalItems: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = totalItems === 0 ? 0 : safePage * pageSize + 1;
  const end = Math.min(totalItems, (safePage + 1) * pageSize);
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-cf-line/60 bg-black/15 px-2 py-2 sm:px-3">
      <p className="text-[11px] tabular-nums text-zinc-500">
        {totalItems === 0 ? "Sin resultados" : `${start}–${end} de ${totalItems}`}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setPage((p) => {
              const sp = Math.min(Math.max(0, p), totalPages - 1);
              return Math.max(0, sp - 1);
            })
          }
          disabled={safePage <= 0}
          className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
          Anterior
        </button>
        <span className="min-w-[6.5rem] text-center text-[11px] text-zinc-400">
          Página {safePage + 1} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() =>
            setPage((p) => {
              const sp = Math.min(Math.max(0, p), totalPages - 1);
              return Math.min(totalPages - 1, sp + 1);
            })
          }
          disabled={safePage >= totalPages - 1}
          className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700 disabled:pointer-events-none disabled:opacity-35"
        >
          Siguiente
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function SiteSearchInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full min-w-0 max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Buscar por nombre…"}
        autoComplete="off"
        className="w-full rounded-xl border border-cf-line bg-cf-panel py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/25"
      />
    </div>
  );
}
