import { Filter, Plus, Search, Trash2, X } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type FilterOperator = "contains" | "equals" | "not_contains";

export type FilterRule<TField extends string = string> = {
  id: string;
  field: TField;
  operator: FilterOperator;
  value: string;
};

export type FilterFieldDef<TField extends string = string> = {
  key: TField;
  label: string;
  placeholder: string;
};

export const FILTER_OPERATORS: { key: FilterOperator; label: string }[] = [
  { key: "contains", label: "contiene" },
  { key: "equals", label: "es" },
  { key: "not_contains", label: "no contiene" },
];

export function newFilterRule<TField extends string>(field: TField): FilterRule<TField> {
  return {
    id: crypto.randomUUID(),
    field,
    operator: "contains",
    value: "",
  };
}

export function matchesQuickSearch(
  query: string,
  parts: (string | number | null | undefined)[]
): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return true;
  const haystack = parts
    .map((p) => (p == null ? "" : String(p)))
    .join(" ")
    .toLowerCase();
  return haystack.includes(t);
}

export function ruleMatchesValue(
  haystack: string,
  operator: FilterOperator,
  needle: string,
  equalsFn?: (a: string, b: string) => boolean
): boolean {
  const q = needle.trim();
  if (!q) return true;
  const h = haystack.toLowerCase();
  const n = q.toLowerCase();
  if (operator === "equals") {
    if (equalsFn) return equalsFn(haystack, q);
    return haystack.trim().toLowerCase() === n;
  }
  if (operator === "not_contains") return !h.includes(n);
  return h.includes(n);
}

export function matchesFilterRules<TField extends string>(
  rules: FilterRule<TField>[],
  getFieldValue: (field: TField) => string,
  equalsFn?: (field: TField, a: string, b: string) => boolean
): boolean {
  const active = rules.filter((r) => r.value.trim());
  if (!active.length) return true;
  return active.every((rule) => {
    const haystack = getFieldValue(rule.field);
    return ruleMatchesValue(
      haystack,
      rule.operator,
      rule.value,
      equalsFn ? (a, b) => equalsFn(rule.field, a, b) : undefined
    );
  });
}

const selectClass =
  "w-full min-w-0 rounded-lg border border-cf-line bg-black/40 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-cf-orange/50";

export function AtlasFilterSearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-xl border border-cf-line bg-cf-panel/90 py-2 pl-9 pr-9 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20"
        aria-label={ariaLabel}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
          aria-label="Borrar búsqueda"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function AtlasFieldFiltersPanel<TField extends string>({
  fields,
  rules,
  onChange,
  onApply,
  onClose,
  dialogLabel,
}: {
  fields: FilterFieldDef<TField>[];
  rules: FilterRule<TField>[];
  onChange: (rules: FilterRule<TField>[]) => void;
  onApply: () => void;
  onClose: () => void;
  dialogLabel: string;
}) {
  const defaultField = fields[0]?.key;

  function fieldPlaceholder(field: TField): string {
    return fields.find((f) => f.key === field)?.placeholder ?? "";
  }

  function updateRule(id: string, patch: Partial<FilterRule<TField>>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRule(id: string) {
    const next = rules.filter((r) => r.id !== id);
    onChange(next.length ? next : [newFilterRule(defaultField ?? ("" as TField))]);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onApply();
    }
  }

  return (
    <div
      role="dialog"
      aria-label={dialogLabel}
      className="absolute left-0 right-0 top-full z-30 mt-2 w-full max-w-xl rounded-xl border border-cf-line bg-[#111418] p-4 shadow-2xl ring-1 ring-white/10 sm:left-auto sm:right-0 sm:w-[min(36rem,calc(100vw-2rem))]"
      onKeyDown={onKeyDown}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Filtros</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
          aria-label="Cerrar filtros"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <select
              value={rule.field}
              onChange={(e) => updateRule(rule.id, { field: e.target.value as TField })}
              className={`${selectClass} sm:w-[7.5rem]`}
              aria-label="Campo"
            >
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={rule.operator}
              onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })}
              className={`${selectClass} sm:w-[8.5rem]`}
              aria-label="Operador"
            >
              {FILTER_OPERATORS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder={fieldPlaceholder(rule.field)}
              className="min-w-0 flex-1 rounded-lg border border-cf-line bg-black/40 px-2.5 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50"
              aria-label="Valor del filtro"
            />
            <button
              type="button"
              onClick={() => removeRule(rule.id)}
              className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-white/10 hover:text-zinc-300"
              aria-label="Eliminar filtro"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...rules, newFilterRule(defaultField ?? ("" as TField))])}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cf-orange hover:text-cf-orange/80"
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar filtro
      </button>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-cf-line/50 pt-3">
        <p className="text-[11px] text-zinc-600">Pulsa Intro para aplicar</p>
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-100 ring-1 ring-zinc-600 hover:bg-zinc-600"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

export function AtlasFiltersToolbarButton({
  open,
  activeRuleCount,
  onClick,
}: {
  open: boolean;
  activeRuleCount: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={
        open || activeRuleCount > 0
          ? "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-orange/45 bg-cf-orange/10 px-3.5 py-2 text-sm font-medium text-zinc-100 ring-1 ring-cf-orange/25"
          : "inline-flex shrink-0 items-center gap-2 rounded-xl border border-cf-line bg-cf-panel/90 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
      }
    >
      <Filter className="h-4 w-4 text-zinc-400" aria-hidden />
      Filtros
      {activeRuleCount > 0 ? (
        <span className="rounded-full bg-cf-orange/25 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-cf-orange">
          {activeRuleCount}
        </span>
      ) : null}
    </button>
  );
}
