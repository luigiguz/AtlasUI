import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Globe,
  Lock,
} from "lucide-react";
import { useMemo, useState } from "react";

import { siteDisplayName } from "../components/AtlasSiteListUi";
import {
  dnsLinkHostname,
  dnsLinkLabel,
  type DnsTunnelGroup,
  tunnelStatusLabel,
  tunnelStatusPillClass,
} from "../dnsTunnelModel";

type DetailTab = "summary" | "routes";

type Props = {
  tunnel: DnsTunnelGroup;
  domainSuffix?: string;
  onBack: () => void;
};

function copyText(value: string) {
  void navigator.clipboard.writeText(value).catch(() => undefined);
}

function sshStatusLabel(status: string): string {
  if (status === "active") return "Activo";
  if (status === "dead") return "Caído";
  return "—";
}

function sshStatusClass(status: string): string {
  if (status === "active") return "text-emerald-400";
  if (status === "dead") return "text-rose-400";
  return "text-zinc-500";
}

function downHintsForTunnel(tunnel: DnsTunnelGroup): string[] {
  const hints: string[] = [];
  const withSsh = tunnel.sites.filter((s) => Boolean(s.ssh));
  const sshDead = withSsh.filter((s) => s.sshStatus === "dead");
  const sshActive = withSsh.filter((s) => s.sshStatus === "active");

  if (tunnel.routeCount === 0) {
    hints.push("No hay rutas DNS publicadas para este túnel.");
  }
  if (withSsh.length === 0) {
    hints.push("No hay conexión SSH configurada en los sitios de este túnel.");
  } else if (sshActive.length === 0) {
    hints.push("No hay ninguna conexión SSH activa; el túnel no está operativo.");
  }
  if (sshDead.length > 0) {
    hints.push(
      `Se detectaron ${sshDead.length} sitio${sshDead.length !== 1 ? "s" : ""} con SSH caído.`
    );
  }

  if (hints.length === 0 && tunnel.status !== "healthy") {
    hints.push(
      "El túnel aparece como Down por la última sincronización de estado; revisa Conexiones para validar SSH."
    );
  }
  return hints;
}

export function AtlasDnsTunnelDetail({ tunnel, domainSuffix, onBack }: Props) {
  const [tab, setTab] = useState<DetailTab>("summary");

  const primarySite = tunnel.sites[0];
  const uptimeHint =
    tunnel.sshActiveCount > 0
      ? `${tunnel.sshActiveCount} conexión${tunnel.sshActiveCount !== 1 ? "es" : ""} SSH activa${tunnel.sshActiveCount !== 1 ? "s" : ""}`
      : "Sin túnel SSH activo en este grupo";

  const routesBySite = useMemo(() => {
    return tunnel.sites.map((site) => ({
      site,
      links: site.posliteUrls ?? [],
    }));
  }, [tunnel.sites]);
  const downHints = useMemo(() => downHintsForTunnel(tunnel), [tunnel]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.2 }}
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cf-line bg-cf-panel/80 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Túneles
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-zinc-100">{tunnel.name}</h2>
          <p className="text-xs text-zinc-500">
            {tunnel.sites.length} sitio{tunnel.sites.length !== 1 ? "s" : ""} · {tunnel.routeCount} ruta
            {tunnel.routeCount !== 1 ? "s" : ""} DNS
          </p>
        </div>
        <span
          className={`inline-flex rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 ${tunnelStatusPillClass(tunnel.status)}`}
        >
          {tunnelStatusLabel(tunnel.status)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="inline-flex rounded-lg border border-cf-line bg-cf-panel/60 p-1">
            {(
              [
                ["summary", "Resumen"],
                ["routes", "Rutas"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  tab === key
                    ? "bg-cf-card text-zinc-100 ring-1 ring-cf-line"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {tab === "summary" ? (
              <motion.div
                key="summary"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-4"
              >
                <section className="rounded-xl border border-cf-line/70 bg-cf-panel/50 p-4">
                  <h3 className="text-sm font-medium text-zinc-200">Métricas</h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-[11px] text-zinc-500">Rutas DNS</dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
                        {tunnel.routeCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-zinc-500">Sitios</dt>
                      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
                        {tunnel.sites.length}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-zinc-500">Estado</dt>
                      <dd className="mt-1">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${tunnelStatusPillClass(tunnel.status)}`}
                        >
                          {tunnelStatusLabel(tunnel.status)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-zinc-500">Conectividad</dt>
                      <dd className="mt-0.5 text-sm text-zinc-300">{uptimeHint}</dd>
                    </div>
                  </dl>
                </section>

                {tunnel.status !== "healthy" ? (
                  <section className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                    <h3 className="text-sm font-medium text-rose-200">Diagnóstico de caída</h3>
                    <ul className="mt-2 space-y-1 text-xs text-rose-100/90">
                      {downHints.map((hint) => (
                        <li key={hint}>- {hint}</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[11px] text-rose-100/80">
                      Tip: si eres admin, valida SSH del sitio en <strong>Atlas VPN - Conexiones</strong> y revisa
                      logs del pod en <strong>Atlas Rancher - Contenedores</strong>.
                    </p>
                  </section>
                ) : null}

                <section className="rounded-xl border border-cf-line/70 bg-cf-panel/50">
                  <div className="flex items-center justify-between border-b border-cf-line/60 px-4 py-3">
                    <h3 className="text-sm font-medium text-zinc-200">Sitios del túnel</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-cf-line/50 text-[10px] uppercase tracking-wide text-zinc-500">
                          <th className="px-4 py-2 font-medium">Sitio</th>
                          <th className="px-4 py-2 font-medium">SSH</th>
                          <th className="px-4 py-2 font-medium">Base de datos</th>
                          <th className="px-4 py-2 font-medium">Rutas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cf-line/50">
                        {tunnel.sites.map((site) => (
                          <tr key={site.id} className="hover:bg-cf-card/40">
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-zinc-200">{siteDisplayName(site)}</p>
                              <p className="font-mono text-[10px] text-zinc-600">{site.id}</p>
                            </td>
                            <td className={`px-4 py-2.5 ${sshStatusClass(site.sshStatus)}`}>
                              {site.ssh ? sshStatusLabel(site.sshStatus) : "—"}
                            </td>
                            <td className={`px-4 py-2.5 ${sshStatusClass(site.dbStatus)}`}>
                              {site.db ? sshStatusLabel(site.dbStatus) : "—"}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-zinc-400">
                              {site.posliteUrls?.length ?? 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </motion.div>
            ) : (
              <motion.div
                key="routes"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-4"
              >
                <section className="rounded-xl border border-cf-line/70 bg-cf-panel/50 p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-zinc-200">Mapa de rutas</h3>
                    <span className="text-[11px] text-zinc-500">Sincronizado desde Cloudflare</span>
                  </div>
                  {tunnel.routeCount === 0 ? (
                    <p className="rounded-lg border border-dashed border-cf-line bg-cf-card/50 px-4 py-8 text-center text-sm text-zinc-500">
                      Este túnel no tiene rutas DNS publicadas en la última sincronización.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {routesBySite.map(({ site, links }) =>
                        links.length === 0 ? null : (
                          <div key={site.id} className="space-y-2">
                            {tunnel.sites.length > 1 ? (
                              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                                {siteDisplayName(site)}
                              </p>
                            ) : null}
                            {links.map((link) => {
                              const host = dnsLinkHostname(link.url);
                              const label = dnsLinkLabel(link);
                              return (
                                <div
                                  key={`${site.id}-${link.suffix ?? link.port ?? link.url}`}
                                  className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center"
                                >
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-cf-line bg-cf-card/70 px-3 py-2.5 text-sm text-zinc-200 hover:border-cf-orange/40 hover:text-cf-orange"
                                  >
                                    <Globe className="h-4 w-4 shrink-0 text-zinc-500" />
                                    <span className="truncate font-mono">{host}</span>
                                    <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
                                  </a>
                                  <div className="hidden h-px w-6 shrink-0 bg-cf-line sm:block" aria-hidden />
                                  <div className="flex shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-[11px] font-medium text-sky-200">
                                    Aplicación publicada
                                    <span className="ml-1.5 text-sky-300/80">· {label}</span>
                                  </div>
                                  <div className="hidden h-px w-6 shrink-0 bg-cf-line sm:block" aria-hidden />
                                  <div className="flex shrink-0 items-center gap-2 rounded-lg border border-cf-line bg-cf-card/80 px-3 py-2 text-xs text-zinc-300">
                                    <Lock className="h-3.5 w-3.5 text-zinc-500" />
                                    {tunnel.name}
                                  </div>
                                  <div className="flex shrink-0 gap-1.5 sm:ml-1">
                                    <button
                                      type="button"
                                      onClick={() => copyText(link.url)}
                                      className="rounded-lg border border-cf-line p-2 text-zinc-400 hover:bg-cf-card"
                                      title="Copiar URL"
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-cf-line/70 bg-cf-panel/50">
                  <div className="border-b border-cf-line/60 px-4 py-3">
                    <h3 className="text-sm font-medium text-zinc-200">Listado de rutas</h3>
                  </div>
                  <ul className="divide-y divide-cf-line/50">
                    {tunnel.routes.map((link) => (
                      <li
                        key={`${link.url}-${link.suffix ?? ""}-${link.port ?? ""}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-zinc-300">{dnsLinkHostname(link.url)}</p>
                          <p className="text-[11px] text-zinc-500">
                            {dnsLinkLabel(link)}
                            {link.port != null ? ` · puerto ${link.port}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => copyText(link.url)}
                            className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-2.5 py-1.5 text-[11px] text-zinc-300 hover:bg-cf-card"
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
                      </li>
                    ))}
                  </ul>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="w-full shrink-0 space-y-3 lg:w-72">
          <section className="rounded-xl border border-cf-line/70 bg-cf-panel/50 p-4">
            <h3 className="text-sm font-medium text-zinc-200">Detalles del túnel</h3>
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-zinc-500">Nombre</dt>
                <dd className="mt-0.5 font-medium text-zinc-200">{tunnel.name}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Identificador</dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <span className="truncate font-mono text-zinc-300">{tunnel.tunnelLabel}</span>
                  <button
                    type="button"
                    onClick={() => copyText(tunnel.tunnelLabel)}
                    className="rounded p-1 text-zinc-500 hover:bg-cf-card hover:text-zinc-300"
                    title="Copiar ID"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Tipo</dt>
                <dd className="mt-0.5 text-zinc-300">cloudflared · Atlas VPN</dd>
              </div>
              {domainSuffix ? (
                <div>
                  <dt className="text-zinc-500">Dominio</dt>
                  <dd className="mt-0.5 font-mono text-zinc-300">{domainSuffix}</dd>
                </div>
              ) : null}
              {primarySite?.ssh?.hostname ? (
                <div>
                  <dt className="text-zinc-500">Host SSH</dt>
                  <dd className="mt-0.5 font-mono text-zinc-300">{primarySite.ssh.hostname}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </aside>
      </div>
    </motion.div>
  );
}
