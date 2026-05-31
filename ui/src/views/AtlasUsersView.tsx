import { AnimatePresence, motion } from "framer-motion";
import {
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import type { AtlasRoleRef, AuthUser } from "../atlasAuth";
import { api } from "../apiClient";
import { AtlasAlertDialog } from "../components/AtlasAlertDialog";
import { AtlasConfirmDialog } from "../components/AtlasConfirmDialog";
import { AtlasLoadingSplash } from "../components/AtlasLoadingSplash";
import { AtlasModalShell } from "../components/AtlasModalFrame";

type ListedUser = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  email_notifications_enabled?: boolean;
  role: string;
  roles: AtlasRoleRef[];
  created_at: number;
};

type RoleOption = {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
};

const inputClass =
  "mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20";

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

function RolePills({ roles }: { roles: AtlasRoleRef[] }) {
  if (!roles.length) {
    return <span className="text-xs text-zinc-500">Sin roles</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => (
        <span
          key={r.id}
          className="inline-flex rounded-full bg-zinc-700/50 px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-600/40"
          title={r.slug}
        >
          {r.name}
        </span>
      ))}
    </div>
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
    <AtlasModalShell
      onBackdropClick={onClose}
      zIndexClass="z-50"
      panelClassName={`w-full rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06] ${wide ? "max-w-lg" : "max-w-md"}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-cf-line/80 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-5 py-4" role="dialog" aria-modal="true">
        {children}
      </div>
    </AtlasModalShell>
  );
}

function RolePicker({
  options,
  selected,
  onChange,
}: {
  options: RoleOption[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
}) {
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-cf-line/70 bg-black/25 p-3">
      {options.map((r) => (
        <label
          key={r.id}
          className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-1 hover:bg-white/[0.03]"
        >
          <input
            type="checkbox"
            className="mt-1 rounded border-cf-line text-cf-orange focus:ring-cf-orange/30"
            checked={selected.has(r.id)}
            onChange={() => toggle(r.id)}
          />
          <span className="min-w-0">
            <span className="text-sm font-medium text-zinc-200">{r.name}</span>
            {r.is_system ? (
              <span className="ml-2 text-[10px] uppercase text-zinc-500">sistema</span>
            ) : null}
            <span className="mt-0.5 block text-xs text-zinc-500">{r.description || r.slug}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

type Props = { me: AuthUser };

export function AtlasUsersView({ me }: Props) {
  const [rows, setRows] = useState<ListedUser[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ListedUser | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<ListedUser | null>(null);

  const [editRoleIds, setEditRoleIds] = useState<Set<number>>(new Set());
  const [editEmail, setEditEmail] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmailNotifications, setEditEmailNotifications] = useState(true);
  const [editPw, setEditPw] = useState("");
  const [editErr, setEditErr] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [cuFirstName, setCuFirstName] = useState("");
  const [cuLastName, setCuLastName] = useState("");
  const [cuEmail, setCuEmail] = useState("");
  const [cuName, setCuName] = useState("");
  const [cuPw, setCuPw] = useState("");
  const [cuRoleIds, setCuRoleIds] = useState<Set<number>>(new Set());
  const [cuErr, setCuErr] = useState("");
  const [cuBusy, setCuBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr("");
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api<{ users: ListedUser[] }>("/api/auth/users"),
        api<{ roles: RoleOption[] }>("/api/auth/roles"),
      ]);
      setRows(usersRes.users);
      setRoleOptions(rolesRes.roles);
      const op = rolesRes.roles.find((r) => r.slug === "operator");
      if (op) setCuRoleIds(new Set([op.id]));
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
      const roleNames = u.roles.map((r) => r.name).join(" ");
      const blob = [u.username, u.email, u.first_name, u.last_name, roleNames].join(" ").toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query]);

  const roleCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const u of rows) {
      for (const r of u.roles) {
        c.set(r.slug, (c.get(r.slug) ?? 0) + 1);
      }
    }
    return c;
  }, [rows]);

  const openEdit = (u: ListedUser) => {
    setEditUser(u);
    setEditRoleIds(new Set(u.roles.map((r) => r.id)));
    setEditEmail(u.email);
    setEditFirstName(u.first_name);
    setEditLastName(u.last_name);
    setEditEmailNotifications(u.email_notifications_enabled !== false);
    setEditPw("");
    setEditErr("");
  };

  const submitEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    if (!editRoleIds.size) {
      setEditErr("Asigna al menos un rol.");
      return;
    }
    if (editPw.trim() && editPw.trim().length < 12) {
      setEditErr("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    setEditErr("");
    setEditBusy(true);
    try {
      const body: Record<string, unknown> = {
        role_ids: [...editRoleIds],
        email: editEmail.trim(),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim(),
        email_notifications: editEmailNotifications,
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
    if (!cuRoleIds.size) {
      setCuErr("Asigna al menos un rol.");
      return;
    }
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
          role_ids: [...cuRoleIds],
        }),
      });
      setCreateOpen(false);
      await reload();
    } catch (ex) {
      setCuErr(String(ex));
    } finally {
      setCuBusy(false);
    }
  };

  const doDelete = async (u: ListedUser) => {
    try {
      await api(`/api/auth/users/${encodeURIComponent(u.username)}`, { method: "DELETE" });
      if (editUser?.username === u.username) setEditUser(null);
      await reload();
    } catch (ex) {
      setAlertMsg(String(ex));
    }
  };

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
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Usuarios</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Cuentas de acceso y asignación de uno o varios roles.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-cf-orange px-4 text-sm font-semibold text-black hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      {roleOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {roleOptions.map((r) => (
            <span
              key={r.id}
              className="rounded-lg border border-cf-line/60 bg-cf-card/50 px-3 py-1.5 text-xs text-zinc-400"
            >
              <span className="font-medium text-zinc-300">{r.name}</span>
              <span className="ml-2 tabular-nums text-zinc-500">{roleCounts.get(r.slug) ?? 0}</span>
            </span>
          ))}
        </div>
      ) : null}

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
              placeholder="Buscar…"
              className="w-full rounded-lg border border-cf-line bg-black/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-cf-orange/50"
            />
          </div>
        </div>

        {loadErr ? (
          <p className="px-4 py-6 text-sm text-rose-300">{loadErr}</p>
        ) : loading ? (
          <AtlasLoadingSplash message="Cargando usuarios…" minHeight="min-h-[280px]" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/60 text-[11px] uppercase text-zinc-500">
                  <th className="px-4 py-3 font-medium">Usuario</th>
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Roles</th>
                  <th className="px-4 py-3 font-medium">Alta</th>
                  <th className="px-4 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const isSelf = u.username === me.username;
                  return (
                    <tr key={u.id} className="border-b border-cf-line/30 hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold">
                            {initials(u)}
                          </span>
                          <div>
                            <p className="font-medium text-zinc-100">{displayName(u)}</p>
                            <p className="font-mono text-xs text-zinc-500">{u.username}</p>
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-zinc-400">{u.email || "—"}</td>
                      <td className="px-4 py-3">
                        <RolePills roles={u.roles} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-500">
                        {fmtDate(u.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-cf-line hover:bg-white/5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => setPendingDelete(u)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-rose-300 ring-1 ring-rose-500/25 disabled:opacity-40"
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
          <Modal title="Nuevo usuario" onClose={() => setCreateOpen(false)} wide>
            <form className="space-y-4" onSubmit={(e) => void submitCreate(e)}>
              {cuErr ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {cuErr}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre">
                  <input className={inputClass} value={cuFirstName} onChange={(e) => setCuFirstName(e.target.value)} required />
                </Field>
                <Field label="Apellido">
                  <input className={inputClass} value={cuLastName} onChange={(e) => setCuLastName(e.target.value)} required />
                </Field>
                <Field label="Correo" className="sm:col-span-2">
                  <input type="email" className={inputClass} value={cuEmail} onChange={(e) => setCuEmail(e.target.value)} required />
                </Field>
                <Field label="Usuario">
                  <input className={`${inputClass} font-mono`} value={cuName} onChange={(e) => setCuName(e.target.value)} required />
                </Field>
                <Field label="Contraseña (≥ 12)">
                  <input type="password" className={inputClass} value={cuPw} onChange={(e) => setCuPw(e.target.value)} required />
                </Field>
              </div>
              <Field label="Roles">
                <RolePicker options={roleOptions} selected={cuRoleIds} onChange={setCuRoleIds} />
              </Field>
              <div className="flex justify-end gap-2 border-t border-cf-line/60 pt-4">
                <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg px-4 py-2 text-sm ring-1 ring-cf-line">
                  Cancelar
                </button>
                <button type="submit" disabled={cuBusy} className="rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                  {cuBusy ? "Creando…" : "Crear"}
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
                  <input className={inputClass} value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} required />
                </Field>
                <Field label="Apellido">
                  <input className={inputClass} value={editLastName} onChange={(e) => setEditLastName(e.target.value)} required />
                </Field>
                <Field label="Correo" className="sm:col-span-2">
                  <input type="email" className={inputClass} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
                </Field>
              </div>
              <Field label="Roles">
                <RolePicker options={roleOptions} selected={editRoleIds} onChange={setEditRoleIds} />
              </Field>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={editEmailNotifications}
                  onChange={(e) => setEditEmailNotifications(e.target.checked)}
                  className="mt-0.5 rounded border-cf-line"
                />
                <span>
                  Recibir notificaciones por correo
                  <span className="mt-0.5 block text-xs text-zinc-500">
                    Requiere correo válido y SMTP configurado en el servidor.
                  </span>
                </span>
              </label>
              <Field label="Nueva contraseña (opcional)">
                <input type="password" className={inputClass} value={editPw} onChange={(e) => setEditPw(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2 border-t border-cf-line/60 pt-4">
                <button type="button" onClick={() => setEditUser(null)} className="rounded-lg px-4 py-2 text-sm ring-1 ring-cf-line">
                  Cancelar
                </button>
                <button type="submit" disabled={editBusy} className="rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
                  {editBusy ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          </Modal>
        ) : null}
      </AnimatePresence>

      <AtlasConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar usuario"
        message={
          pendingDelete
            ? `¿Eliminar a «${displayName(pendingDelete)}» (${pendingDelete.username})? Esta acción no se puede deshacer.`
            : ""
        }
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => {
          const u = pendingDelete;
          setPendingDelete(null);
          if (u) void doDelete(u);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <AtlasAlertDialog
        open={alertMsg !== null}
        title="No se pudo eliminar"
        message={alertMsg ?? ""}
        onClose={() => setAlertMsg(null)}
      />
    </motion.div>
  );
}
