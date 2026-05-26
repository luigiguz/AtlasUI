import { motion } from "framer-motion";
import {
  ArrowRight,
  Box,
  Cloud,
  GitBranch,
  Server,
  Shield,
  Store,
  Tags,
  Wifi,
} from "lucide-react";
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

function NavButton({
  label,
  route,
  primary,
  onNavigate,
}: {
  label: string;
  route: AtlasRouteId;
  primary?: boolean;
  onNavigate: (route: AtlasRouteId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(route)}
      className={
        primary
          ? "inline-flex items-center gap-1.5 rounded-lg bg-cf-orange px-3 py-2 text-xs font-semibold text-black"
          : "inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 ring-1 ring-zinc-600 hover:bg-zinc-700"
      }
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

export function AtlasHomeView({ sites, canAdmin, syncMsg, syncOk, lastSyncAt, onNavigate }: Props) {
  const { active, dead, siteCount } = countTunnels(sites);

  return (
    <motion.div layout className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border border-cf-line/70 bg-cf-panel/40 p-5 ring-1 ring-white/[0.03]">
        <h2 className="text-base font-semibold text-zinc-100">Bienvenido a Atlas</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Consola unificada de <span className="text-zinc-200">Verkku</span> para operar tiendas PosLite en el edge:
          acceso remoto con <span className="text-zinc-200">Atlas VPN</span> y despliegue GitOps con{" "}
          <span className="text-zinc-200">Atlas Rancher</span> (equipos Kubernetes, configuración en Git y estado de
          servicios).
        </p>
      </div>

      <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DashCard title="Sitios VPN" subtitle="tunnels.json">
          <p className="text-3xl font-semibold tabular-nums text-zinc-50">{siteCount}</p>
          <p className="mt-1 text-xs text-zinc-500">Sincronizados desde Cloudflare Access</p>
        </DashCard>
        <DashCard title="Túneles activos" subtitle="SSH + BD">
          <p className="text-3xl font-semibold tabular-nums text-emerald-400">{active}</p>
          <p className="mt-1 text-xs text-zinc-500">Procesos cloudflared en ejecución</p>
        </DashCard>
        <DashCard title="Incidencias VPN" subtitle="estado dead">
          <p className={`text-3xl font-semibold tabular-nums ${dead > 0 ? "text-rose-400" : "text-zinc-500"}`}>
            {dead}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Revisar en Conexiones</p>
        </DashCard>
      </motion.div>

      <motion.div layout className="grid gap-4 lg:grid-cols-2">
        <DashCard title="Atlas VPN" subtitle="Acceso remoto a sitios">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-center gap-2">
              <Wifi className="h-4 w-4 shrink-0 text-cf-orange" aria-hidden />
              Túneles SSH y base de datos por sitio
            </li>
            <li className="flex items-center gap-2">
              <Store className="h-4 w-4 shrink-0 text-cf-orange" aria-hidden />
              Portales Poslite cuando el túnel está activo
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <NavButton label="Conexiones" route="conn" primary onNavigate={onNavigate} />
            <NavButton label="Poslite" route="poslite" onNavigate={onNavigate} />
            {canAdmin ? <NavButton label="Cloudflare" route="cf" onNavigate={onNavigate} /> : null}
          </div>
        </DashCard>

        <DashCard title="Atlas Rancher" subtitle="GitOps PosLite en Kubernetes">
          <ul className="space-y-2 text-sm text-zinc-300">
            <li className="flex items-start gap-2">
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden />
              <span>
                <strong className="font-medium text-zinc-200">Equipos</strong> — clusters Rancher con etiquetas{" "}
                <code className="text-[11px] text-zinc-400">store</code>,{" "}
                <code className="text-[11px] text-zinc-400">distro</code>,{" "}
                <code className="text-[11px] text-zinc-400">application</code>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Store className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden />
              <span>
                <strong className="font-medium text-zinc-200">Tiendas</strong> — edición del repo{" "}
                <code className="text-[11px] text-zinc-400">atlas-stores</code>, plantillas Horustech/PAM/DB,
                resumen antes de publicar y commit con tu usuario
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Box className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden />
              <span>
                <strong className="font-medium text-zinc-200">Contenedores</strong> — servicios, estado y réplicas;
                <strong className="font-medium text-zinc-200"> actualizar imagen</strong> (escala 0 → N para forzar pull)
              </span>
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <NavButton label="Tiendas" route="rancher-stores" primary onNavigate={onNavigate} />
            <NavButton label="Equipos" route="rancher-clusters" onNavigate={onNavigate} />
            <NavButton label="Contenedores" route="rancher-pods" onNavigate={onNavigate} />
          </div>
        </DashCard>
      </motion.div>

      <DashCard title="Flujo: nueva tienda PosLite" subtitle="Atlas Rancher + repositorio Git">
        <ol className="space-y-3 text-sm text-zinc-300">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
              1
            </span>
            <span>
              Registra el <strong className="text-zinc-200">equipo</strong> en Rancher (menú Equipos) con etiqueta{" "}
              <code className="text-[11px]">store</code> y distribución <code className="text-[11px]">horustech</code> o{" "}
              <code className="text-[11px]">pam</code>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
              2
            </span>
            <span>
              En <strong className="text-zinc-200">Tiendas</strong>, configura la URL Git de{" "}
              <code className="text-[11px]">atlas-stores</code> (admin) y usa <strong className="text-zinc-200">Nueva tienda</strong>
              : elige plantilla, revisa el resumen y confirma la publicación al remoto.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
              3
            </span>
            <span>
              Completa IPs on-prem, URL iERP y servicios en la ficha; cada guardado genera commit{" "}
              <code className="text-[11px]">Atlas: … [usuario]</code> y push a la rama configurada.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
              4
            </span>
            <span>
              <strong className="text-zinc-200">Rancher Fleet</strong> reconcilia los{" "}
              <code className="text-[11px]">fleet.yaml</code> en el cluster. Supervisa el despliegue en{" "}
              <strong className="text-zinc-200">Contenedores</strong>.
            </span>
          </li>
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <Tags className="h-3.5 w-3.5" aria-hidden />
            Labels cluster
          </span>
          <span className="inline-flex items-center gap-1">
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            templates/poslite/
          </span>
          <span className="inline-flex items-center gap-1">
            <Shield className="h-3.5 w-3.5" aria-hidden />
            namespace poslite
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("rancher-stores")}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-cf-orange hover:underline"
        >
          Ir a Gestión de Tiendas
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </DashCard>

      {canAdmin ? (
        <DashCard title="Cloudflare" subtitle="Sincronización de sitios VPN">
          <div className="flex items-start gap-3">
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
          </div>
        </DashCard>
      ) : (
        <DashCard title="Tu rol" subtitle="operador / visor">
          <p className="text-sm leading-relaxed text-zinc-400">
            Puedes usar <strong className="font-medium text-zinc-200">Atlas VPN → Conexiones</strong> para túneles y{" "}
            <strong className="font-medium text-zinc-200">Atlas Rancher</strong> para consultar equipos, editar tiendas
            (si tienes permiso de operador) y ver servicios en ejecución. La conexión Git del repositorio la configura un
            administrador.
          </p>
        </DashCard>
      )}
    </motion.div>
  );
}
