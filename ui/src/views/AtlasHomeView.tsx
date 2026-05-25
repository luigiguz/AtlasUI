import { motion } from "framer-motion";
import { ArrowRight, Cloud, Shield, Store, Wifi } from "lucide-react";
import type { ReactNode } from "react";

import type { AtlasRouteId } from "../atlasNav";

type SiteRow = {
  id: string;
  name: string;
  sshStatus: string;
  dbStatus: string;
};

type Props = {
  sites: SiteRow[];
  canAdmin: boolean;
  syncMsg: string;
  syncOk: boolean;
  lastSyncAt: string | null;
  onNavigate: (route: AtlasRouteId) => void;
};

function countTunnels(sites: SiteRow[]) {
  let active = 0;
  let dead = 0;
  for (const s of sites) {
    if (s.sshStatus === "active") active++;
    if (s.dbStatus === "active") active++;
    if (s.sshStatus === "dead") dead++;
    if (s.dbStatus === "dead") dead++;
  }
  return { active, dead, siteCount: sites.length };
}

function DashCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      layout
      className={`rounded-xl border border-white/[0.08] bg-[#111418]/90 p-4 ring-1 ring-white/[0.03] ${className}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</p>
      {subtitle ? <p className="mt-0.5 text-[11px] text-zinc-600">{subtitle}</p> : null}
      <motion.div layout className="mt-3">
        {children}
      </motion.div>
    </motion.div>
  );
}

export function AtlasHomeView({ sites, canAdmin, syncMsg, syncOk, lastSyncAt, onNavigate }: Props) {
  const { active, dead, siteCount } = countTunnels(sites);

  return (
    <motion.div layout className="mx-auto max-w-6xl space-y-6">
      <p className="text-sm text-zinc-400">
        Panel central de la plataforma <span className="text-zinc-200">Atlas</span>. Desde aquí accedes a
        productos como <span className="text-zinc-200">Atlas VPN</span> (túneles SSH/BD) y, más adelante, otros
        módulos.
      </p>

      <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DashCard title="Sitios configurados" subtitle="tunnels.json">
          <p className="text-3xl font-semibold tabular-nums text-zinc-50">{siteCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Sincronizados desde Cloudflare Access</p>
        </DashCard>
        <DashCard title="Túneles activos" subtitle="SSH + BD">
          <p className="text-3xl font-semibold tabular-nums text-emerald-400">{active}</p>
          <p className="mt-1 text-xs text-zinc-500">Procesos cloudflared en ejecución</p>
        </DashCard>
        <DashCard title="Incidencias" subtitle="estado dead">
          <p className={`text-3xl font-semibold tabular-nums ${dead > 0 ? "text-rose-400" : "text-zinc-500"}`}>
            {dead}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Revisar en Conexiones</p>
        </DashCard>
      </motion.div>

      <motion.div layout className="grid gap-4 lg:grid-cols-2">
        <DashCard title="Atlas VPN" subtitle="Acceso remoto a tiendas">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-cf-orange" aria-hidden />
              Conexiones SSH/BD por sitio
            </li>
            <li className="flex items-center gap-2">
              <Store className="h-4 w-4 text-cf-orange" aria-hidden />
              Portales Poslite por tienda
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("conn")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cf-orange px-3 py-2 text-xs font-semibold text-black"
            >
              Conexiones
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate("poslite")}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
            >
              Poslite
            </button>
          </div>
        </DashCard>

        {canAdmin ? (
          <DashCard title="Cloudflare" subtitle="Sincronización de sitios">
            <motion.div layout className="flex items-start gap-3">
              <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm text-zinc-200">
                  {syncOk && syncMsg
                    ? `${syncMsg} · sincronización automática cada 15 s`
                    : "Configura credenciales en Ajustes; los túneles se sincronizan solos."}
                </p>
                {lastSyncAt ? <p className="mt-1 text-[11px] text-zinc-500">Última sync: {lastSyncAt}</p> : null}
                <button
                  type="button"
                  onClick={() => onNavigate("cf")}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-cf-orange hover:underline"
                >
                  Ir a Cloudflare
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          </DashCard>
        ) : (
          <DashCard title="Tu rol" subtitle="operador / visor">
            <p className="text-sm text-zinc-400">
              Usa el menú <strong className="font-medium text-zinc-200">Atlas VPN → Conexiones</strong> para
              iniciar túneles y abrir terminales web cuando el SSH esté activo.
            </p>
          </DashCard>
        )}
      </motion.div>

      <DashCard title="Próximos módulos" className="border-dashed border-zinc-700/80 bg-transparent">
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <Shield className="h-5 w-5 shrink-0" aria-hidden />
          <p>
            El menú lateral incluye secciones reservadas para futuros productos Atlas (por ejemplo Rancher u otros
            servicios). Se irán habilitando sin cambiar la estructura del shell.
          </p>
        </div>
      </DashCard>
    </motion.div>
  );
}
