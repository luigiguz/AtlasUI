import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  Eye,
  History,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../apiClient";
import { AtlasAlertDialog } from "../components/AtlasAlertDialog";
import { AtlasConfirmDialog } from "../components/AtlasConfirmDialog";
import { AtlasModalShell } from "../components/AtlasModalFrame";
import { AtlasPromptDialog } from "../components/AtlasPromptDialog";
import { pulseAtlasNotifications } from "../components/AtlasNotifications";
import {
  formatRequestWhen,
  PublishChangeSummary,
  requestStatusBadgeClass,
  requestStatusLabel,
  STORE_FLEET_PUBLISH_SUCCESS,
  type HistoryStatusFilter,
} from "../storeRequestUi";
import {
  STORE_REQUESTS_OPEN_EVENT,
  type StoreRequestsOpenDetail,
  type StoreRequestsPanelTab,
} from "../storeRequestsNav";
import type { StoreChangeRequest, StoreChangeRequestsResponse } from "../storeTypes";

type Props = {
  canEdit: boolean;
  canApprove: boolean;
};

export function AtlasStoreRequestsView({ canEdit, canApprove }: Props) {
  const [requestsPanelTab, setRequestsPanelTab] = useState<StoreRequestsPanelTab>("queue");
  const [changeRequests, setChangeRequests] = useState<StoreChangeRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [historyRequests, setHistoryRequests] = useState<StoreChangeRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historySearchDebounced, setHistorySearchDebounced] = useState("");
  const [approveConfirmId, setApproveConfirmId] = useState<number | null>(null);
  const [approveDetailLines, setApproveDetailLines] = useState<string[]>([]);
  const [approveDetailLoading, setApproveDetailLoading] = useState(false);
  const [rejectRequestId, setRejectRequestId] = useState<number | null>(null);
  const [requestDetailId, setRequestDetailId] = useState<number | null>(null);
  const [requestDetail, setRequestDetail] = useState<StoreChangeRequest | null>(null);
  const [requestDetailLoading, setRequestDetailLoading] = useState(false);
  const [requestActionBusy, setRequestActionBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [publishResultAlert, setPublishResultAlert] = useState<{ title: string; message: string } | null>(
    null
  );

  const loadChangeRequests = useCallback(async () => {
    if (!canEdit && !canApprove) return;
    setRequestsLoading(true);
    try {
      const data = await api<StoreChangeRequestsResponse>(
        "/api/atlas-stores/change-requests?status=pending&limit=50"
      );
      setChangeRequests(data.requests ?? []);
    } catch {
      setChangeRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, [canEdit, canApprove]);

  const loadHistoryRequests = useCallback(async () => {
    if (!canEdit && !canApprove) return;
    setHistoryLoading(true);
    try {
      const statusParam = historyStatusFilter === "all" ? "history" : historyStatusFilter;
      const params = new URLSearchParams({ status: statusParam, limit: "100" });
      if (historySearchDebounced.trim()) {
        params.set("folder", historySearchDebounced.trim());
      }
      const data = await api<StoreChangeRequestsResponse>(
        `/api/atlas-stores/change-requests?${params.toString()}`
      );
      setHistoryRequests(data.requests ?? []);
    } catch {
      setHistoryRequests([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [canEdit, canApprove, historyStatusFilter, historySearchDebounced]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadChangeRequests(), loadHistoryRequests()]);
    pulseAtlasNotifications();
  }, [loadChangeRequests, loadHistoryRequests]);

  useEffect(() => {
    void loadChangeRequests();
  }, [loadChangeRequests]);

  useEffect(() => {
    if (requestsPanelTab === "history") {
      void loadHistoryRequests();
    }
  }, [requestsPanelTab, loadHistoryRequests]);

  useEffect(() => {
    const t = window.setTimeout(() => setHistorySearchDebounced(historySearch), 300);
    return () => window.clearTimeout(t);
  }, [historySearch]);

  useEffect(() => {
    if (approveConfirmId === null) {
      setApproveDetailLines([]);
      setApproveDetailLoading(false);
      return;
    }
    let cancelled = false;
    setApproveDetailLoading(true);
    void (async () => {
      try {
        const r = await api<{ ok: boolean; request: StoreChangeRequest }>(
          `/api/atlas-stores/change-requests/${approveConfirmId}`
        );
        if (!cancelled) setApproveDetailLines(r.request.changeLines ?? []);
      } catch {
        if (!cancelled) setApproveDetailLines([]);
      } finally {
        if (!cancelled) setApproveDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [approveConfirmId]);

  const openRequestDetail = useCallback(async (requestId: number) => {
    setRequestDetailId(requestId);
    setRequestDetail(null);
    setRequestDetailLoading(true);
    try {
      const r = await api<{ ok: boolean; request: StoreChangeRequest }>(
        `/api/atlas-stores/change-requests/${requestId}`
      );
      setRequestDetail(r.request);
    } catch {
      setRequestDetailId(null);
      setStatusMsg("No se pudo cargar el detalle de la solicitud.");
    } finally {
      setRequestDetailLoading(false);
    }
  }, []);

  function closeRequestDetail() {
    setRequestDetailId(null);
    setRequestDetail(null);
  }

  useEffect(() => {
    const onFocus = (ev: Event) => {
      const detail = (ev as CustomEvent<StoreRequestsOpenDetail>).detail ?? {};
      if (detail.tab) setRequestsPanelTab(detail.tab);
      if (detail.requestId != null) {
        window.setTimeout(() => void openRequestDetail(detail.requestId!), 0);
      }
    };
    window.addEventListener(STORE_REQUESTS_OPEN_EVENT, onFocus);
    return () => window.removeEventListener(STORE_REQUESTS_OPEN_EVENT, onFocus);
  }, [openRequestDetail]);

  async function onApproveRequest(requestId: number) {
    setRequestActionBusy(true);
    try {
      await api(`/api/atlas-stores/change-requests/${requestId}/approve`, {
        method: "POST",
        body: JSON.stringify({ review_note: "" }),
      });
      setApproveConfirmId(null);
      setPublishResultAlert({
        title: STORE_FLEET_PUBLISH_SUCCESS.title,
        message: STORE_FLEET_PUBLISH_SUCCESS.message,
      });
      await refreshAll();
    } catch (e) {
      setApproveConfirmId(null);
      setPublishResultAlert({
        title: "No se pudo aprobar",
        message: e instanceof Error ? e.message : "Error al aprobar la solicitud.",
      });
    } finally {
      setRequestActionBusy(false);
    }
  }

  async function onRejectRequest(requestId: number, note: string) {
    setRequestActionBusy(true);
    try {
      await api(`/api/atlas-stores/change-requests/${requestId}/reject`, {
        method: "POST",
        body: JSON.stringify({ review_note: note }),
      });
      setStatusMsg("Solicitud rechazada.");
      setRejectRequestId(null);
      await refreshAll();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "No se pudo rechazar.");
    } finally {
      setRequestActionBusy(false);
    }
  }

  async function onCancelRequest(requestId: number) {
    setRequestActionBusy(true);
    try {
      await api(`/api/atlas-stores/change-requests/${requestId}`, { method: "DELETE" });
      setStatusMsg("Solicitud cancelada.");
      await refreshAll();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : "No se pudo cancelar.");
    } finally {
      setRequestActionBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Solicitudes de cambio</h1>
          <p className="text-xs text-zinc-500">
            {canApprove
              ? "Aprueba o rechaza cambios propuestos por operadores antes de que Fleet los aplique."
              : "Consulta el estado de tus solicitudes enviadas para aprobación."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={requestsLoading || historyLoading}
          className="inline-flex items-center gap-1 rounded-lg border border-cf-orange/50 bg-cf-orange/10 px-3 py-1.5 text-xs text-cf-orange disabled:opacity-50"
        >
          {requestsLoading || historyLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </button>
      </div>

      <div className="rounded-xl border border-cf-line/70 bg-[#111418]/90 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg bg-black/40 p-1 ring-1 ring-white/[0.06]">
            <button
              type="button"
              onClick={() => setRequestsPanelTab("queue")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                requestsPanelTab === "queue"
                  ? "bg-sky-500/20 text-sky-100 ring-1 ring-sky-500/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {canApprove ? "Cola pendiente" : "Mis pendientes"}
              {changeRequests.length > 0 ? (
                <span className="rounded-full bg-sky-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-sky-100">
                  {changeRequests.length}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setRequestsPanelTab("history")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                requestsPanelTab === "history"
                  ? "bg-cf-orange/15 text-cf-orange ring-1 ring-cf-orange/30"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <History className="h-3.5 w-3.5" aria-hidden />
              Historial
            </button>
          </div>
          {requestsPanelTab === "history" ? (
            <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar carpeta tienda…"
                className="w-full rounded-lg border border-cf-line bg-black/40 py-1.5 pl-8 pr-2 text-xs text-zinc-100 outline-none focus:border-cf-orange/50"
              />
            </div>
          ) : null}
        </div>

        {requestsPanelTab === "queue" ? (
          <>
            <p className="mt-3 text-xs text-zinc-500">
              {canApprove
                ? "Los operadores proponen cambios aquí. Aprueba para aplicar la configuración en Fleet (Rancher)."
                : "Tus cambios quedan en espera hasta que un administrador los apruebe."}
            </p>
            {requestsLoading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando solicitudes…
              </div>
            ) : changeRequests.length === 0 ? (
              <p className="mt-4 text-xs text-zinc-500">No hay solicitudes pendientes.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {changeRequests.map((req) => (
                  <li
                    key={req.id}
                    className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-black/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-200">
                        #{req.id} · {req.kind === "create" ? "Nueva tienda" : "Actualización"} · {req.storeId}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">{req.summary}</p>
                      <p className="mt-1 text-[11px] text-zinc-600">
                        {req.createdByUsername} · {formatRequestWhen(req.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={requestActionBusy}
                        onClick={() => void openRequestDetail(req.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-cf-line px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver detalle
                      </button>
                      {canApprove ? (
                        <>
                          <button
                            type="button"
                            disabled={requestActionBusy}
                            onClick={() => setApproveConfirmId(req.id)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aprobar
                          </button>
                          <button
                            type="button"
                            disabled={requestActionBusy}
                            onClick={() => setRejectRequestId(req.id)}
                            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={requestActionBusy}
                          onClick={() => void onCancelRequest(req.id)}
                          className="rounded-lg border border-cf-line px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-xs text-zinc-500">
              {canApprove
                ? "Historial de solicitudes de todas las tiendas. Solo lectura."
                : "Historial de tus solicitudes enviadas."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["all", "Todas"],
                  ["approved", "Aprobadas"],
                  ["rejected", "Rechazadas"],
                  ["cancelled", "Canceladas"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setHistoryStatusFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    historyStatusFilter === key
                      ? "bg-zinc-700 text-zinc-100"
                      : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {historyLoading ? (
              <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando historial…
              </div>
            ) : historyRequests.length === 0 ? (
              <p className="mt-4 text-xs text-zinc-500">No hay solicitudes en este filtro.</p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-white/[0.06]">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Tienda</th>
                      <th className="px-3 py-2 font-medium">Resumen</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      {canApprove ? <th className="px-3 py-2 font-medium">Solicitante</th> : null}
                      <th className="px-3 py-2 font-medium">Enviada</th>
                      <th className="px-3 py-2 font-medium">Revisada por</th>
                      <th className="px-3 py-2 font-medium">Fecha revisión</th>
                      <th className="px-3 py-2 font-medium text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {historyRequests.map((req) => (
                      <tr key={req.id} className="bg-black/20 hover:bg-black/30">
                        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">{req.id}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-200">{req.storeId}</td>
                        <td className="max-w-[14rem] truncate px-3 py-2.5 text-zinc-400" title={req.summary}>
                          {req.summary}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${requestStatusBadgeClass(req.status)}`}
                          >
                            {requestStatusLabel(req.status)}
                          </span>
                        </td>
                        {canApprove ? (
                          <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">{req.createdByUsername}</td>
                        ) : null}
                        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                          {formatRequestWhen(req.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">
                          {req.reviewedByUsername ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                          {formatRequestWhen(req.reviewedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => void openRequestDetail(req.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-cf-line px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
                          >
                            <Eye className="h-3 w-3" />
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {statusMsg ? <p className="text-xs text-zinc-400">{statusMsg}</p> : null}

      <AtlasConfirmDialog
        open={approveConfirmId !== null}
        title="Aprobar y publicar"
        message={
          <>
            <p>
              Se aplicará la configuración en el equipo vía Fleet (Rancher). La sincronización puede tardar unos
              minutos.
            </p>
            {approveDetailLoading ? (
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando detalle del cambio…
              </p>
            ) : approveDetailLines.length > 0 ? (
              <div className="mt-3">
                <PublishChangeSummary lines={approveDetailLines} />
              </div>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">No hay líneas de detalle disponibles para esta solicitud.</p>
            )}
          </>
        }
        confirmLabel="Aprobar y publicar"
        cancelLabel="Cancelar"
        busy={requestActionBusy}
        onConfirm={() => approveConfirmId !== null && void onApproveRequest(approveConfirmId)}
        onCancel={() => setApproveConfirmId(null)}
      />

      <AtlasPromptDialog
        open={rejectRequestId !== null}
        title="Rechazar solicitud"
        message="Indica el motivo para el operador."
        label="Motivo"
        confirmLabel="Rechazar"
        cancelLabel="Cancelar"
        onConfirm={(note) => rejectRequestId !== null && void onRejectRequest(rejectRequestId, note)}
        onCancel={() => setRejectRequestId(null)}
      />

      <AtlasAlertDialog
        open={publishResultAlert !== null}
        title={publishResultAlert?.title ?? ""}
        message={publishResultAlert?.message ?? ""}
        onClose={() => setPublishResultAlert(null)}
      />

      <AnimatePresence>
        {requestDetailId !== null ? (
          <AtlasModalShell
            onBackdropClick={requestDetailLoading ? undefined : closeRequestDetail}
            panelClassName="w-full max-w-lg rounded-2xl border border-cf-line bg-[#111418] p-5 shadow-2xl ring-1 ring-white/[0.06]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-100">Detalle de la solicitud</h2>
                {requestDetail ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    #{requestDetail.id} · {requestDetail.kind === "create" ? "Nueva tienda" : "Actualización"} ·{" "}
                    {requestDetail.storeId}
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={closeRequestDetail} aria-label="Cerrar" disabled={requestDetailLoading}>
                <X className="h-4 w-4 text-zinc-500" />
              </button>
            </div>
            {requestDetailLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin text-cf-orange" />
                Cargando detalle…
              </div>
            ) : requestDetail ? (
              <div className="space-y-4 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${requestStatusBadgeClass(requestDetail.status)}`}
                  >
                    {requestStatusLabel(requestDetail.status)}
                  </span>
                  <span className="text-zinc-500">
                    {requestDetail.kind === "create" ? "Nueva tienda" : "Actualización"} · {requestDetail.folderName}
                  </span>
                </div>
                <dl className="grid gap-2 rounded-lg border border-cf-line/50 bg-black/25 px-3 py-2.5 text-zinc-400">
                  <div>
                    <dt className="text-zinc-600">Resumen</dt>
                    <dd className="text-zinc-300">{requestDetail.summary}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-600">Solicitante</dt>
                    <dd className="text-zinc-300">
                      {requestDetail.createdByUsername} · {formatRequestWhen(requestDetail.createdAt)}
                    </dd>
                  </div>
                  {requestDetail.reviewedByUsername ? (
                    <div>
                      <dt className="text-zinc-600">Revisión</dt>
                      <dd className="text-zinc-300">
                        {requestDetail.reviewedByUsername} · {formatRequestWhen(requestDetail.reviewedAt)}
                      </dd>
                    </div>
                  ) : null}
                  {requestDetail.reviewNote ? (
                    <div>
                      <dt className="text-zinc-600">Motivo / nota</dt>
                      <dd className="text-zinc-300">{requestDetail.reviewNote}</dd>
                    </div>
                  ) : null}
                  {requestDetail.commitMessage ? (
                    <div>
                      <dt className="text-zinc-600">Mensaje Git</dt>
                      <dd className="font-mono text-[11px] text-zinc-300">{requestDetail.commitMessage}</dd>
                    </div>
                  ) : null}
                </dl>
                {(requestDetail.changeLines?.length ?? 0) > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                      Cambios propuestos
                    </p>
                    <PublishChangeSummary lines={requestDetail.changeLines ?? []} />
                  </div>
                ) : (
                  <p className="text-zinc-500">No hay detalle granular disponible para esta solicitud.</p>
                )}
                {canApprove && requestDetail.status === "pending" ? (
                  <div className="flex flex-wrap justify-end gap-2 border-t border-cf-line/40 pt-4">
                    <button
                      type="button"
                      disabled={requestActionBusy}
                      onClick={() => {
                        closeRequestDetail();
                        setRejectRequestId(requestDetail.id);
                      }}
                      className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                    <button
                      type="button"
                      disabled={requestActionBusy}
                      onClick={() => {
                        closeRequestDetail();
                        setApproveConfirmId(requestDetail.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Aprobar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </AtlasModalShell>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
