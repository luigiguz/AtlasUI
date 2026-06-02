import type { StoreChangeRequest } from "./storeTypes";

export const STORE_FLEET_PUBLISH_SUCCESS = {
  title: "Configuración enviada",
  message:
    "Fleet aplicará los cambios en Rancher en breve. Espera unos minutos hasta que el equipo sincronice; puedes revisar el progreso en Equipos o Contenedores.",
} as const;

export type HistoryStatusFilter = "all" | "approved" | "rejected" | "cancelled";

export function requestStatusLabel(
  status: StoreChangeRequest["status"],
  entryType?: StoreChangeRequest["entryType"]
): string {
  if (entryType === "direct" || status === "published") {
    return "Publicación directa";
  }
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

export function requestStatusBadgeClass(
  status: StoreChangeRequest["status"],
  entryType?: StoreChangeRequest["entryType"]
): string {
  if (entryType === "direct" || status === "published") {
    return "bg-violet-500/15 text-violet-200 ring-violet-500/30";
  }
  switch (status) {
    case "approved":
      return "atlas-pill-success";
    case "rejected":
      return "atlas-pill-danger";
    case "cancelled":
      return "atlas-pill-muted";
    default:
      return "atlas-pill-warning";
  }
}

export function requestHistoryEventAt(req: StoreChangeRequest): string | null | undefined {
  return req.reviewedAt ?? req.createdAt;
}

export function formatRequestWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-PA");
}

export function PublishChangeSummary({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-3">
      <ul className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-cf-line/50 bg-cf-card/80 px-3 py-2.5 text-xs text-zinc-300">
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
