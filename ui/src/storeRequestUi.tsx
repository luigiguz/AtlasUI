import type { StoreChangeRequest } from "./storeTypes";

export const STORE_FLEET_PUBLISH_SUCCESS = {
  title: "Configuración enviada",
  message:
    "Fleet aplicará los cambios en Rancher en breve. Espera unos minutos hasta que el equipo sincronice; puedes revisar el progreso en Equipos o Contenedores.",
} as const;

export type HistoryStatusFilter = "all" | "approved" | "rejected" | "cancelled";

export function requestStatusLabel(status: StoreChangeRequest["status"]): string {
  switch (status) {
    case "approved":
      return "Aprobada";
    case "rejected":
      return "Rechazada";
    case "cancelled":
      return "Cancelada";
    default:
      return "Pendiente";
  }
}

export function requestStatusBadgeClass(status: StoreChangeRequest["status"]): string {
  switch (status) {
    case "approved":
      return "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30";
    case "rejected":
      return "bg-rose-500/15 text-rose-200 ring-rose-500/30";
    case "cancelled":
      return "bg-zinc-700/40 text-zinc-400 ring-zinc-600/40";
    default:
      return "bg-sky-500/15 text-sky-200 ring-sky-500/30";
  }
}

export function formatRequestWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-PA");
}

export function PublishChangeSummary({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-3">
      <ul className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-cf-line/50 bg-black/25 px-3 py-2.5 text-xs text-zinc-300">
        {lines.map((line) => (
          <li key={line} className="leading-relaxed">
            {line}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-zinc-500">{lines.length} cambio(s) respecto a la versión cargada.</p>
    </div>
  );
}
