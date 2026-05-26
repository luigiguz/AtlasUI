import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeft,
  PanelLeftClose,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  buildAtlasNav,
  flattenNavRoutes,
  routeMeta,
  type AtlasNavEntry,
  type AtlasNavGroup,
  type AtlasNavLeaf,
  type AtlasRouteId,
} from "../atlasNav";
import { apiUrl } from "../apiClient";

const SIDEBAR_COLLAPSED_KEY = "atlas.sidebarCollapsed";
const SIDEBAR_WIDTH_EXPANDED = 248;
const SIDEBAR_WIDTH_COLLAPSED = 56;
const sidebarMotion = { duration: 0.28, ease: [0.32, 0.72, 0, 1] as const };
const sidebarContentMotion = { duration: 0.18, ease: "easeOut" as const };

type AuthUser = { username: string; role: "admin" | "operator" | "viewer" };

type Props = {
  route: AtlasRouteId;
  onNavigate: (r: AtlasRouteId) => void;
  user: AuthUser;
  canAdmin: boolean;
  onLogout: () => void;
  children: ReactNode;
};

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Marca Atlas en la barra lateral (logo ancho desde /api/logo; recorte del icono al contraer). */
function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const [logoOk, setLogoOk] = useState(true);

  if (!logoOk) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-md bg-cf-orange/15 font-bold text-cf-orange ${
          collapsed ? "h-10 w-10 text-base" : "h-11 w-11 text-lg"
        }`}
        aria-hidden
      >
        A
      </span>
    );
  }

  if (collapsed) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
        <img
          src={apiUrl("/api/logo")}
          alt="Atlas"
          onError={() => setLogoOk(false)}
          className="max-h-full max-w-full object-contain object-center opacity-95"
        />
      </div>
    );
  }

  return (
    <img
      src={apiUrl("/api/logo")}
      alt="Atlas"
      onError={() => setLogoOk(false)}
      className="h-11 w-auto max-w-[11rem] shrink-0 object-contain object-left opacity-95"
    />
  );
}

function NavLeafButton({
  item,
  active,
  onPick,
  indent,
  collapsed,
}: {
  item: AtlasNavLeaf;
  active: boolean;
  onPick: () => void;
  indent?: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const disabled = item.comingSoon;
  const title = disabled ? `${item.label} (próximamente)` : item.label;
  return (
    <button
      type="button"
      disabled={disabled}
      title={collapsed ? title : undefined}
      onClick={onPick}
      className={
        disabled
          ? collapsed
            ? "flex w-full cursor-not-allowed items-center justify-center rounded-lg p-2 text-zinc-600"
            : "flex w-full cursor-not-allowed items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-600"
          : active
            ? collapsed
              ? "flex w-full items-center justify-center rounded-lg bg-white/[0.08] p-2 text-zinc-100 ring-1 ring-white/10"
              : "flex w-full items-center gap-2 rounded-lg bg-white/[0.08] px-2.5 py-2 text-left text-sm font-medium text-zinc-100 ring-1 ring-white/10"
            : collapsed
              ? "flex w-full items-center justify-center rounded-lg p-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
              : `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 ${
                  indent ? "pl-8" : ""
                }`
      }
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span
            key="label"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={sidebarContentMotion}
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
          >
            <span className="truncate">{item.label}</span>
            {disabled ? (
              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-500">Pronto</span>
            ) : null}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
}

function NavGroupBlock({
  group,
  route,
  onNavigate,
  open,
  onToggle,
  collapsed,
  onExpandSidebar,
}: {
  group: AtlasNavGroup;
  route: AtlasRouteId;
  onNavigate: (r: AtlasRouteId) => void;
  open: boolean;
  onToggle: () => void;
  collapsed: boolean;
  onExpandSidebar: () => void;
}) {
  const Icon = group.icon;
  const childActive = group.children.some((c) => !c.comingSoon && c.route === route);

  const handleGroupClick = () => {
    if (collapsed) {
      onExpandSidebar();
      if (!open) onToggle();
      return;
    }
    onToggle();
  };

  if (collapsed) {
    return (
      <button
        type="button"
        title={group.label}
        onClick={handleGroupClick}
        className={
          childActive
            ? "flex w-full items-center justify-center rounded-lg bg-white/[0.08] p-2 text-zinc-100 ring-1 ring-white/10"
            : "flex w-full items-center justify-center rounded-lg p-2 text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
        }
      >
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
      </button>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={handleGroupClick}
        className={
          childActive
            ? "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-zinc-100"
            : "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.04]"
        }
      >
        <Icon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden pl-1"
          >
            <motion.div layout className="ml-3 space-y-0.5 border-l border-white/[0.06] pl-1">
              {group.children.map((child) => (
                <NavLeafButton
                  key={child.id}
                  item={child}
                  indent
                  collapsed={false}
                  active={!child.comingSoon && child.route === route}
                  onPick={() => {
                    if (!child.comingSoon) onNavigate(child.route);
                  }}
                />
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SidebarNav({
  entries,
  route,
  onNavigate,
  groupOpen,
  setGroupOpen,
  collapsed,
  onExpandSidebar,
}: {
  entries: AtlasNavEntry[];
  route: AtlasRouteId;
  onNavigate: (r: AtlasRouteId) => void;
  groupOpen: Record<string, boolean>;
  setGroupOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  collapsed: boolean;
  onExpandSidebar: () => void;
}) {
  return (
    <nav className={`flex flex-col gap-0.5 ${collapsed ? "p-1.5" : "p-2"}`} aria-label="Navegación Atlas">
      {entries.map((entry) => {
        if (entry.kind === "leaf") {
          return (
            <NavLeafButton
              key={entry.id}
              item={entry}
              collapsed={collapsed}
              active={!entry.comingSoon && entry.route === route}
              onPick={() => {
                if (!entry.comingSoon) onNavigate(entry.route);
              }}
            />
          );
        }
        return (
          <NavGroupBlock
            key={entry.id}
            group={entry}
            route={route}
            onNavigate={onNavigate}
            collapsed={collapsed}
            onExpandSidebar={onExpandSidebar}
            open={groupOpen[entry.id] ?? entry.defaultOpen ?? false}
            onToggle={() => setGroupOpen((o) => ({ ...o, [entry.id]: !(o[entry.id] ?? entry.defaultOpen) }))}
          />
        );
      })}
    </nav>
  );
}

function SidebarQuickSearch({
  collapsed,
  value,
  onChange,
  inputRef,
  onExpandSidebar,
}: {
  collapsed: boolean;
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onExpandSidebar: () => void;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {collapsed ? (
        <motion.div
          key="search-collapsed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={sidebarContentMotion}
          className="flex shrink-0 justify-center px-1.5 py-2"
        >
          <button
            type="button"
            title="Búsqueda rápida (Ctrl+K)"
            onClick={() => {
              onExpandSidebar();
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 ring-1 ring-white/[0.06] hover:bg-white/[0.04] hover:text-zinc-300"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="search-expanded"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={sidebarContentMotion}
          className="shrink-0 px-2 py-2"
        >
      <label className="sr-only" htmlFor="atlas-nav-search">
        Búsqueda rápida
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" aria-hidden />
        <input
          id="atlas-nav-search"
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Búsqueda rápida…"
          className="w-full rounded-lg border border-white/[0.06] bg-black/30 py-2 pl-8 pr-[4.25rem] text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-cf-orange/40 focus:ring-1 focus:ring-cf-orange/30"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-white/10 bg-zinc-900/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
          Ctrl K
        </kbd>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AtlasShell({ route, onNavigate, user, canAdmin, onLogout, children }: Props): ReactNode {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [navQuery, setNavQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const meta = routeMeta(route);
  const navEntries = useMemo(() => buildAtlasNav(canAdmin), [canAdmin]);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() => ({
    "atlas-vpn": true,
    "atlas-admin": true,
    "coming-soon": false,
  }));

  const expandSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      if (sidebarCollapsed) expandSidebar();
      requestAnimationFrame(() => searchRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarCollapsed, expandSidebar]);

  const filteredEntries = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    if (!q) return navEntries;
    const leaves = flattenNavRoutes(navEntries).filter(
      (l) => l.label.toLowerCase().includes(q) || l.id.toLowerCase().includes(q),
    );
    const routeSet = new Set(leaves.map((l) => l.route));
    const out: AtlasNavEntry[] = [];
    for (const e of navEntries) {
      if (e.kind === "leaf") {
        if (e.label.toLowerCase().includes(q)) out.push(e);
        continue;
      }
      const kids = e.children.filter((c) => c.label.toLowerCase().includes(q) || routeSet.has(c.route));
      if (kids.length > 0 || e.label.toLowerCase().includes(q)) {
        out.push({ ...e, children: kids.length > 0 ? kids : e.children });
      }
    }
    return out;
  }, [navEntries, navQuery]);

  /** En el drawer móvil siempre expandido; en desktop respeta la preferencia guardada. */
  const sidebarCollapsedEffective = sidebarCollapsed && !mobileOpen;

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col bg-[#0d0f12]">
      <motion.div
        layout
        transition={sidebarMotion}
        className={`flex w-full shrink-0 items-center border-b border-white/[0.06] ${
          sidebarCollapsedEffective ? "justify-center px-2 py-3.5" : "gap-3 px-3 py-3.5"
        }`}
      >
        <SidebarBrand collapsed={sidebarCollapsedEffective} />
        <AnimatePresence initial={false}>
          {!sidebarCollapsedEffective ? (
            <motion.div
              key="sidebar-user"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={sidebarContentMotion}
              className="min-w-0 flex-1 overflow-hidden"
            >
              <p className="truncate text-sm font-medium text-zinc-100" title={user.username}>
                {user.username}
              </p>
              <p className="truncate text-[10px] capitalize text-zinc-500">{user.role}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      <SidebarQuickSearch
        collapsed={sidebarCollapsedEffective}
        value={navQuery}
        onChange={setNavQuery}
        inputRef={searchRef}
        onExpandSidebar={expandSidebar}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarNav
          entries={filteredEntries}
          route={route}
          collapsed={sidebarCollapsedEffective}
          onExpandSidebar={expandSidebar}
          onNavigate={(r) => {
            onNavigate(r);
            setMobileOpen(false);
          }}
          groupOpen={groupOpen}
          setGroupOpen={setGroupOpen}
        />
      </div>

      <div className="flex shrink-0 justify-start border-t border-white/[0.06] p-2">
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsedEffective ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-label={sidebarCollapsedEffective ? "Expandir barra lateral" : "Contraer barra lateral"}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 ring-1 ring-white/[0.06] hover:bg-white/[0.04] hover:text-zinc-300"
        >
          {sidebarCollapsedEffective ? (
            <PanelLeft className="h-4 w-4" aria-hidden />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <motion.div className="flex h-dvh min-h-0 overflow-hidden bg-[#0b0d10] text-zinc-100">
      <motion.aside
        className="hidden min-h-0 shrink-0 self-stretch overflow-hidden border-r border-white/[0.06] bg-[#0d0f12] md:flex md:flex-col"
        initial={false}
        animate={{ width: sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
        transition={sidebarMotion}
      >
        {sidebar}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              aria-label="Cerrar menú"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 36 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,88vw)] flex-col border-r border-white/[0.06] shadow-2xl md:hidden"
            >
              {sidebar}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/[0.06] bg-[#0d0f12]/95 px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            className="inline-flex rounded-lg p-2 text-zinc-400 ring-1 ring-white/10 hover:bg-white/5 md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <nav className="mb-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500" aria-label="Ruta">
              {meta.breadcrumb.map((part, i) => (
                <span key={`${part}-${i}`} className="inline-flex items-center gap-1">
                  {i > 0 ? <ChevronRight className="h-3 w-3 opacity-50" aria-hidden /> : null}
                  <span className={i === meta.breadcrumb.length - 1 ? "text-zinc-400" : ""}>{part}</span>
                </span>
              ))}
            </nav>
            <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-50 sm:text-xl">{meta.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-xs sm:block">
              <p className="font-medium text-zinc-200">{user.username}</p>
              <p className="font-mono text-[10px] uppercase text-zinc-500">{user.role}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800/80 px-3 py-2 text-sm text-zinc-300 ring-1 ring-white/10 hover:bg-zinc-700"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </header>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </motion.div>
  );
}
