import { ArrowDownToLine, ArrowUpToLine, XCircle } from "lucide-react";
import { useEffect, type ReactElement } from "react";

export type TransferDirection = "upload" | "download";

export type TransferStatus = "pending" | "active" | "done" | "error" | "cancelled";

export type TransferJob = {
  id: string;
  direction: TransferDirection;
  name: string;
  index: number;
  total: number;
  /** 0–100; -1 = indeterminado */
  progress: number;
  status: TransferStatus;
  error?: string;
};

type Props = {
  jobs: TransferJob[];
  onCancel: (id: string) => void;
  onDismiss: (id: string) => void;
};

function statusLabel(job: TransferJob): string {
  if (job.status === "done") return "Completado";
  if (job.status === "error") return "Error";
  if (job.status === "cancelled") return "Cancelado";
  if (job.status === "pending") return "En cola";
  return job.direction === "upload" ? "Subiendo" : "Descargando";
}

function TransferRow({
  job,
  onCancel,
  onDismiss,
}: {
  job: TransferJob;
  onCancel: () => void;
  onDismiss: () => void;
}): ReactElement {
  const active = job.status === "active" || job.status === "pending";
  const done = job.status === "done";
  const failed = job.status === "error" || job.status === "cancelled";
  const pct = job.progress >= 0 ? Math.min(100, Math.max(0, job.progress)) : -1;

  const Icon = job.direction === "upload" ? ArrowUpToLine : ArrowDownToLine;
  const iconClass =
    job.direction === "upload"
      ? "text-emerald-400"
      : "text-blue-400";

  return (
    <div className="border-b border-zinc-800/80 px-2 py-1.5 last:border-b-0">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} strokeWidth={2.2} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-[10px] text-zinc-200" title={job.name}>
          <span className="text-zinc-500">{statusLabel(job)}</span> {job.name}
        </p>
        <span className="shrink-0 font-mono text-[9px] text-zinc-600">
          [{job.index}/{job.total}]
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="relative h-[18px] min-w-0 flex-1 overflow-hidden rounded bg-zinc-800 ring-1 ring-zinc-700/90">
          {active && pct < 0 ? (
            <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded bg-cf-orange/70" />
          ) : (
            <div
              className={`flex h-full items-center justify-center text-[9px] font-semibold transition-[width] duration-200 ${
                done
                  ? "bg-emerald-600/90 text-white"
                  : failed
                    ? "bg-rose-600/80 text-white"
                    : "bg-cf-orange text-black"
              }`}
              style={{ width: `${active && pct < 0 ? 35 : Math.max(pct, done || failed ? 100 : 8)}%` }}
            >
              {active && pct < 0 ? null : (
                <span className="px-1">{done ? "✓" : failed ? "!" : `${pct}%`}</span>
              )}
            </div>
          )}
        </div>
        {active ? (
          <button
            type="button"
            title="Cancelar transferencia"
            onClick={onCancel}
            className="inline-flex shrink-0 items-center gap-0.5 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[9px] text-zinc-400 hover:border-rose-500/50 hover:bg-rose-950/40 hover:text-rose-300"
          >
            <XCircle className="h-3 w-3 text-rose-400" strokeWidth={2} />
            Cancelar
          </button>
        ) : (
          <button
            type="button"
            title="Quitar de la lista"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
      {job.error ? (
        <p className="mt-1 truncate text-[9px] text-rose-300" title={job.error}>
          {job.error}
        </p>
      ) : null}
    </div>
  );
}

/** Cola de transferencias SFTP (estilo MobaXterm, tema Atlas). */
export function SftpTransferQueue({ jobs, onCancel, onDismiss }: Props): ReactElement | null {
  useEffect(() => {
    const stale = jobs.filter(
      (j) => j.status === "done" || j.status === "error" || j.status === "cancelled",
    );
    if (!stale.length) return;
    const t = window.setTimeout(() => {
      for (const j of stale) onDismiss(j.id);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [jobs, onDismiss]);

  if (!jobs.length) return null;

  const headline = jobs.find((j) => j.status === "active" || j.status === "pending") ?? jobs[jobs.length - 1];
  const verb = headline.direction === "upload" ? "Subiendo" : "Descargando";

  return (
    <div className="shrink-0 border-t border-zinc-700 bg-[#111418] shadow-[0_-4px_12px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-zinc-800/90 px-2 py-1">
        <p className="truncate text-[10px] font-medium text-zinc-300">
          {verb}{" "}
          <span className="font-normal text-zinc-500">{headline.name}</span>
        </p>
        <span className="shrink-0 text-[9px] text-zinc-600">
          {jobs.filter((j) => j.status === "active" || j.status === "pending").length > 0
            ? `${jobs.filter((j) => j.status === "done").length}/${jobs.length} hechos`
            : `${jobs.length} en historial`}
        </span>
      </div>
      <div className="max-h-[min(140px,28vh)] overflow-y-auto">
        {jobs.map((job) => (
          <TransferRow
            key={job.id}
            job={job}
            onCancel={() => onCancel(job.id)}
            onDismiss={() => onDismiss(job.id)}
          />
        ))}
      </div>
    </div>
  );
}
