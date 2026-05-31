import {
  matchesFilterRules,
  matchesQuickSearch,
  type FilterFieldDef,
  type FilterRule,
} from "./components/AtlasFieldFilters";
import { requestStatusLabel } from "./storeRequestUi";
import type { StoreChangeRequest } from "./storeTypes";

export type StoreRequestFilterField =
  | "store"
  | "summary"
  | "requester"
  | "reviewer"
  | "id"
  | "kind";

export const STORE_REQUEST_FILTER_FIELDS: FilterFieldDef<StoreRequestFilterField>[] = [
  { key: "store", label: "Tienda", placeholder: "aspdemos, carpeta…" },
  { key: "summary", label: "Resumen", placeholder: "texto del resumen" },
  { key: "requester", label: "Solicitante", placeholder: "usuario" },
  { key: "reviewer", label: "Revisado por", placeholder: "admin" },
  { key: "id", label: "ID", placeholder: "3" },
  { key: "kind", label: "Tipo", placeholder: "Nueva tienda, Actualización" },
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
    default:
      return "";
  }
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
    requestStatusLabel(req.status),
    req.reviewNote,
  ]);
}

export function matchesStoreRequestRules(
  req: StoreChangeRequest,
  rules: FilterRule<StoreRequestFilterField>[]
): boolean {
  return matchesFilterRules(rules, (field) => storeRequestFieldValue(req, field), (field, a, b) => {
    if (field === "id") return a.trim() === b.trim();
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  });
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
