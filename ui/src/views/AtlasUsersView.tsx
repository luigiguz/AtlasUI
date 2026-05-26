import { AnimatePresence, motion } from "framer-motion";
import {
  Eye,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { api } from "../apiClient";

type UserRole = "admin" | "operator" | "viewer";

type AuthUser = { username: string; role: UserRole };

type ListedUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  created_at: number;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20";

const ROLE_META: Record<
  UserRole,
  { label: string; hint: string; pill: string; icon: typeof Shield }
> = {
  admin: {
    label: "Administrador",
    hint: "Usuarios, credenciales Cloudflare y configuración global.",
    pill: "bg-cf-orange/15 text-cf-orange ring-cf-orange/35",
    icon: Shield,
  },
  operator: {
    label: "Operador",
    hint: "Túneles y operación; sin credenciales Cloudflare.",
    pill: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    icon: UserCog,
  },
  viewer: {
    label: "Solo lectura",
    hint: "Consulta de estado sin cambios.",
    pill: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/35",
    icon: Eye,
  },
};

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function displayName(u: ListedUser) {
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || u.username;
}

function initials(u: ListedUser) {
  const a = (u.first_name || u.username).charAt(0);
  const b = u.last_name?.charAt(0) ?? "";
  return (a + b).toUpperCase().slice(0, 2);
}

function RolePill({ role }: { role: string }) {
  const r = (role in ROLE_META ? role : "viewer") as UserRole;
  const meta = ROLE_META[r];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${meta.pill}`}
    >
      {meta.label}
    </span>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs font-medium text-zinc-500 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-user-modal-title"
        className={`w-full rounded-2xl border border-cf-line bg-[#111418] shadow-2xl shadow-black/50 ring-1 ring-white/[0.06] ${wide ? "max-w-lg" : "max-w-md"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-cf-line/80 px-5 py-4">
          <h2 id="atlas-user-modal-title" className="text-sm font-semibold text-zinc-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

type Props = { me: AuthUser };

export function AtlasUsersView({ me }: Props) {
  const [rows, setRows] = useState<ListedUser[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<ListedUser | null>(null);

  const [editRole, setEditRole] = useState<UserRole>("operator");
  const [editEmail, setEditEmail] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPw, setEditPw] = useState("");
  const [editErr, setEditErr] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [cuFirstName, setCuFirstName] = useState("");
  const [cuLastName, setCuLastName] = useState("");
  const [cuEmail, setCuEmail] = useState("");
  const [cuName, setCuName] = useState("");
  const [cuPw, setCuPw] = useState("");
  const [cuRole, setCuRole] = useState<UserRole>("operator");
  const [cuErr, setCuErr] = useState("");
  const [cuBusy, setCuBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr("");
    setLoading(true);
    try {
      const d = await api<{ users: ListedUser[] }>("/api/auth/users");
      setRows(d.users);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) => {
      const blob = [u.username, u.email, u.first_name, u.last_name, u.role].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query]);

  const counts = useMemo(() => {
    const c = { admin: 0, operator: 0, viewer: 0 };
    for (const u of rows) {
      if (u.role in c) c[u.role as UserRole]++;
    }
    return c;
  }, [rows]);

  const openEdit = (u: ListedUser) => {
    setEditUser(u);
    setEditRole((u.role as UserRole) || "operator");
    setEditEmail(u.email);
    setEditFirstName(u.first_name);
    setEditLastName(u.last_name);
    setEditPw("");
    setEditErr("");
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCuErr("");
  };

  const resetCreateForm = () => {
    setCuFirstName("");
    setCuLastName("");
    setCuEmail("");
    setCuName("");
    setCuPw("");
    setCuRole("operator");
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    if (editPw.trim() && editPw.trim().length < 12) {
      setEditErr("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    setEditErr("");
    setEditBusy(true);
    try {
      const body: {
        role: UserRole;
        email: string;
        first_name: string;
        last_name: string;
        password?: string;
      } = {
        role: editRole,
        email: editEmail.trim(),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
      };
      const p = editPw.trim();
      if (p) body.password = p;
      await api(`/api/auth/users/${encodeURIComponent(editUser.username)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setEditUser(null);
      await reload();
    } catch (ex) {
      setEditErr(String(ex));
    } finally {
      setEditBusy(false);
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCuErr("");
    if (cuPw.length < 12) {
      setCuErr("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    setCuBusy(true);
    try {
      await api("/api/auth/users", {
        method: "POST",
        body: JSON.stringify({
          username: cuName.trim(),
          email: cuEmail.trim(),
          first_name: cuFirstName.trim(),
          last_name: cuLastName.trim(),
          password: cuPw,
          role: cuRole,
        }),
      });
      resetCreateForm();
      closeCreate();
      await reload();
    } catch (ex) {
      setCuErr(String(ex));
    } finally {
      setCuBusy(false);
    }
  };

  const doDelete = async (u: ListedUser) => {
    if (!window.confirm(`¿Eliminar a «${displayName(u)}» (${u.username})? No se puede deshacer.`)) {
      return;
    }
    try {
      await api(`/api/auth/users/${encodeURIComponent(u.username)}`, { method: "DELETE" });
      if (editUser?.username === u.username) setEditUser(null);
      await reload();
    } catch (ex) {
      window.alert(String(ex));
    }
  };

  const roleSelect = (value: UserRole, onChange: (r: UserRole) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as UserRole)} className={inputClass}>
      {(Object.keys(ROLE_META) as UserRole[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_META[r].label} — {ROLE_META[r].hint}
        </option>
      ))}
    </select>
  );

  return (
    <motion.div
      key="users"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-5xl flex-col gap-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Administración</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Usuarios y roles</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Gestiona quién accede a Atlas y con qué permisos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCuErr("");
            setCreateOpen(true);
          }}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cf-orange px-4 text-sm font-semibold text-black transition hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(ROLE_META) as UserRole[]).map((r) => {
          const Icon = ROLE_META[r].icon;
          return (
            <div
              key={r}
              className="rounded-xl border border-cf-line/80 bg-cf-card/60 px-4 py-3 ring-1 ring-white/[0.03]"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${ROLE_META[r].pill}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-200">{ROLE_META[r].label}</p>
                  <p className="text-lg font-semibold tabular-nums text-zinc-100">{counts[r]}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-zinc-500">{ROLE_META[r].hint}</p>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-cf-line bg-cf-card/90 ring-1 ring-white/[0.03]">
        <div className="flex flex-col gap-3 border-b border-cf-line/80 bg-black/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Cuentas ({filtered.length})
          </p>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar nombre, correo o usuario…"
              className="w-full rounded-lg border border-cf-line bg-black/40 py-2 pl-9 pr-3 text-sm text-zinc-100 outline-none focus:border-cf-orange/50"
            />
          </div>
        </div>

        {loadErr ? (
          <p className="px-4 py-6 text-sm text-rose-300">{loadErr}</p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin text-cf-orange" />
            Cargando usuarios…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500">
            {query ? "Ningún usuario coincide con la búsqueda." : "No hay usuarios registrados."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/60 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Alta</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf = u.username === me.username;
                  return (
                    <tr
                      key={u.id}
                      className="border-b border-cf-line/30 transition hover:bg-white/[0.02] last:border-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-xs font-semibold text-zinc-200 ring-1 ring-white/10">
                            {initials(u)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-100">{displayName(u)}</p>
                            <p className="truncate font-mono text-xs text-zinc-500">{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-zinc-400">
                        {u.email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <RolePill role={u.role} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                        {fmtDate(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-300 ring-1 ring-cf-line transition hover:bg-white/5 hover:text-zinc-100"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => void doDelete(u)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-300/90 ring-1 ring-rose-500/25 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                            title={isSelf ? "No puedes eliminar tu propia cuenta" : "Eliminar"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {createOpen ? (
          <Modal title="Nuevo usuario" onClose={closeCreate} wide>
            <form className="space-y-4" onSubmit={(e) => void submitCreate(e)}>
              {cuErr ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {cuErr}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre">
                  <input
                    className={inputClass}
                    value={cuFirstName}
                    onChange={(e) => setCuFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </Field>
                <Field label="Apellido">
                  <input
                    className={inputClass}
                    value={cuLastName}
                    onChange={(e) => setCuLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </Field>
                <Field label="Correo electrónico" className="sm:col-span-2">
                  <input
                    type="email"
                    className={inputClass}
                    value={cuEmail}
                    onChange={(e) => setCuEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field label="Usuario (login)">
                  <input
                    className={`${inputClass} font-mono`}
                    value={cuName}
                    onChange={(e) => setCuName(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field label="Contraseña inicial (≥ 12)">
                  <input
                    type="password"
                    className={inputClass}
                    value={cuPw}
                    onChange={(e) => setCuPw(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
              </div>
              <Field label="Rol">{roleSelect(cuRole, setCuRole)}</Field>
              <div className="flex flex-wrap justify-end gap-2 border-t border-cf-line/60 pt-4">
                <button
                  type="button"
                  onClick={closeCreate}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 ring-1 ring-cf-line hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={cuBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {cuBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {cuBusy ? "Creando…" : "Crear usuario"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}

        {editUser ? (
          <Modal title={`Editar — ${editUser.username}`} onClose={() => setEditUser(null)} wide>
            <form className="space-y-4" onSubmit={(e) => void submitEdit(e)}>
              {editErr ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {editErr}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre">
                  <input
                    className={inputClass}
                    value={editFirstName}
                    onChange={(e) => setEditFirstName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Apellido">
                  <input
                    className={inputClass}
                    value={editLastName}
                    onChange={(e) => setEditLastName(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Correo" className="sm:col-span-2">
                  <input
                    type="email"
                    className={inputClass}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <Field label="Rol">{roleSelect(editRole, setEditRole)}</Field>
              <Field label="Nueva contraseña (opcional)">
                <input
                  type="password"
                  className={inputClass}
                  placeholder="Dejar vacío para no cambiar"
                  value={editPw}
                  onChange={(e) => setEditPw(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <div className="flex flex-wrap justify-end gap-2 border-t border-cf-line/60 pt-4">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 ring-1 ring-cf-line hover:bg-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {editBusy ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
