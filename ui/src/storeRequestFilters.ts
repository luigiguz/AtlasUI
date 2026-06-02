import {
  matchesQuickSearch,
  type FilterFieldDef,
  type FilterRule,
} from "./components/AtlasFieldFilters";
import { requestHistoryEventAt, requestStatusLabel } from "./storeRequestUi";
import type { StoreChangeRequest } from "./storeTypes";

export type StoreRequestFilterField =
  | "store"
  | "summary"
  | "requester"
  | "reviewer"
  | "id"
  | "kind"
  | "dateFrom"
  | "dateTo";

export const STORE_REQUEST_FILTER_FIELDS: FilterFieldDef<StoreRequestFilterField>[] = [
  { key: "store", label: "Tienda", placeholder: "aspdemos, carpeta…" },
  { key: "summary", label: "Resumen", placeholder: "texto del resumen" },
  { key: "requester", label: "Solicitante", placeholder: "usuario" },
  { key: "reviewer", label: "Revisado por", placeholder: "admin" },
  { key: "id", label: "ID", placeholder: "3" },
  { key: "kind", label: "Tipo", placeholder: "Nueva tienda, Actualización" },
  { key: "dateFrom", label: "Fecha desde", placeholder: "", inputType: "date" },
  { key: "dateTo", label: "Fecha hasta", placeholder: "", inputType: "date" },
];

function requestKindLabel(kind: StoreChangeRequest["kind"]): string {
  return kind === "create" ? "Nueva tienda" : "Actualización";
}

export function storeRequestFieldValue(
  req: StoreChangeRequest,
  field: StoreRequestFilterField
): string {
  switch (field) {
    case "store":
      return [req.storeId, req.folderName].filter(Boolean).join(" ");
    case "summary":
      return req.summary ?? "";
    case "requester":
      return req.createdByUsername ?? "";
    case "reviewer":
      return req.reviewedByUsername ?? "";
    case "id":
      return String(req.id);
    case "kind":
      return requestKindLabel(req.kind);
    case "dateFrom":
    case "dateTo":
      return requestHistoryEventAt(req) ?? req.createdAt ?? "";
    default:
      return "";
  }
}

function parseIsoDate(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function eventDateOnly(req: StoreChangeRequest): Date | null {
  const iso = requestHistoryEventAt(req) ?? req.createdAt;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function matchesStoreRequestSearch(req: StoreChangeRequest, query: string): boolean {
  return matchesQuickSearch(query, [
    req.id,
    req.storeId,
    req.folderName,
    req.summary,
    req.createdByUsername,
    req.reviewedByUsername,
    requestKindLabel(req.kind),
    requestStatusLabel(req.status, req.entryType),
    req.reviewNote,
  ]);
}

export function matchesStoreRequestRules(
  req: StoreChangeRequest,
  rules: FilterRule<StoreRequestFilterField>[]
): boolean {
  const eventDay = eventDateOnly(req);
  for (const rule of rules.filter((r) => r.value.trim())) {
    if (rule.field === "dateFrom" || rule.field === "dateTo") {
      const bound = parseIsoDate(rule.value);
      if (!bound || !eventDay) return false;
      const boundDay = new Date(bound.getFullYear(), bound.getMonth(), bound.getDate());
      if (rule.field === "dateFrom" && eventDay < boundDay) return false;
      if (rule.field === "dateTo" && eventDay > boundDay) return false;
      continue;
    }
    const haystack = storeRequestFieldValue(req, rule.field);
    const needle = rule.value.trim();
    if (rule.field === "id") {
      if (haystack.trim() !== needle) return false;
      continue;
    }
    if (rule.operator === "equals") {
      if (haystack.trim().toLowerCase() !== needle.toLowerCase()) return false;
      continue;
    }
    if (rule.operator === "not_contains") {
      if (haystack.toLowerCase().includes(needle.toLowerCase())) return false;
      continue;
    }
    if (!haystack.toLowerCase().includes(needle.toLowerCase())) return false;
  }
  return true;
}

export function filterStoreRequests(
  requests: StoreChangeRequest[],
  searchQuery: string,
  rules: FilterRule<StoreRequestFilterField>[]
): StoreChangeRequest[] {
  return requests.filter(
    (req) => matchesStoreRequestSearch(req, searchQuery) && matchesStoreRequestRules(req, rules)
  );
}
