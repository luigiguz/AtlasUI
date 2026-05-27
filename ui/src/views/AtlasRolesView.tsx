import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Pencil, Plus, Shield, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  hasAnyPermission,
  hasPermission,
  PERM_ROLES_LIST,
  PERM_ROLES_MANAGE,
  type AuthUser,
} from "../atlasAuth";
import { api } from "../apiClient";
import { AtlasAlertDialog } from "../components/AtlasAlertDialog";
import { AtlasConfirmDialog } from "../components/AtlasConfirmDialog";

type RoleRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
};

type PermGroup = {
  id: string;
  label: string;
  permissions: { id: string; label: string }[];
};

const inputClass =
  "mt-1 w-full rounded-lg border border-cf-line bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cf-orange/50 focus:ring-2 focus:ring-cf-orange/20";

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cf-line bg-[#111418] shadow-2xl ring-1 ring-white/[0.06]"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-cf-line/80 bg-[#111418] px-5 py-4">
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
        <div className="px-5 py-4">{children}</div>
      </motion.div>
    </motion.div>
  );
}

type Props = { me: AuthUser };

export function AtlasRolesView({ me }: Props) {
  const canView = hasAnyPermission(me, PERM_ROLES_LIST, PERM_ROLES_MANAGE);
  const canManage = hasPermission(me, PERM_ROLES_MANAGE);
  const readOnly = canView && !canManage;

  const [rows, setRows] = useState<RoleRow[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [editor, setEditor] = useState<RoleRow | "new" | null>(null);
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saveErr, setSaveErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RoleRow | null>(null);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setErr("");
    setLoading(true);
    try {
      const [rolesRes, catalogRes] = await Promise.all([
        api<{ roles: RoleRow[] }>("/api/auth/roles"),
        api<{ groups: PermGroup[] }>("/api/auth/permissions"),
      ]);
      setRows(rolesRes.roles);
      setGroups(catalogRes.groups);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openNew = () => {
    setEditorReadOnly(false);
    setEditor("new");
    setSlug("");
    setName("");
    setDescription("");
    setSelected(new Set());
    setSaveErr("");
  };

  const openEdit = (r: RoleRow, opts?: { readOnly?: boolean }) => {
    setEditorReadOnly(Boolean(opts?.readOnly) || r.is_system);
    setEditor(r);
    setSlug(r.slug);
    setName(r.name);
    setDescription(r.description);
    setSelected(new Set(r.permissions));
    setSaveErr("");
  };

  const togglePerm = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || !editor) return;
    setSaveErr("");
    const perms = [...selected];
    if (!perms.length) {
      setSaveErr("Selecciona al menos un permiso.");
      return;
    }
    if (editor !== "new" && editor.is_system) {
      setSaveErr("Los roles de sistema no se pueden editar.");
      return;
    }
    setBusy(true);
    try {
      if (editor === "new") {
        await api("/api/auth/roles", {
          method: "POST",
          body: JSON.stringify({
            slug: slug.trim().toLowerCase(),
            name: name.trim(),
            description: description.trim(),
            permissions: perms,
          }),
        });
      } else {
        const row = editor;
        await api(`/api/auth/roles/${encodeURIComponent(row.slug)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            permissions: perms,
          }),
        });
      }
      setEditor(null);
      await reload();
    } catch (ex) {
      setSaveErr(String(ex));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (r: RoleRow) => {
    if (!canManage || r.is_system) return;
    try {
      await api(`/api/auth/roles/${encodeURIComponent(r.slug)}`, { method: "DELETE" });
      await reload();
    } catch (ex) {
      setAlertMsg(String(ex));
    }
  };

  const permMatrix = useMemo(
    () =>
      groups.map((g) => (
        <div key={g.id} className="rounded-xl border border-cf-line/70 bg-black/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.label}</p>
          <ul className="mt-2 space-y-1.5">
            {g.permissions.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-cf-line bg-black/40 text-cf-orange focus:ring-cf-orange/30"
                    checked={selected.has(p.id)}
                    disabled={editorReadOnly || !canManage}
                    onChange={() => {
                      if (editorReadOnly || !canManage) return;
                      togglePerm(p.id);
                    }}
                  />
                  <span>
                    <span className="font-medium text-zinc-200">{p.label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-zinc-600">{p.id}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )),
    [groups, selected, canManage, editorReadOnly, editor]
  );

  return (
    <motion.div
      key="roles"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-5xl flex-col gap-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Administración</p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-100">Roles y permisos</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Los roles de sistema (Administrador, Operador, Solo lectura) son fijos: solo puedes
            consultarlos. Los roles que crees con «Nuevo rol» sí se pueden editar y eliminar.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-cf-orange px-4 text-sm font-semibold text-black hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Nuevo rol
          </button>
        ) : null}
      </div>

      {err ? <p className="text-sm text-rose-300">{err}</p> : null}

      {readOnly ? (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
          Tu cuenta puede <strong>ver</strong> roles pero no editarlos. Necesitas el permiso{" "}
          <span className="font-mono text-xs">atlas:roles:Manage</span> (incluido en el rol
          Administrador). Cierra sesión y vuelve a entrar tras un cambio de rol.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-cf-line bg-cf-card/90 ring-1 ring-white/[0.03]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin text-cf-orange" />
            Cargando roles…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="border-b border-cf-line/60 text-[11px] uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Rol</th>
                  <th className="px-4 py-3 font-medium">Permisos</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-cf-line/30 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-cf-orange/80" />
                        <div>
                          <p className="font-medium text-zinc-100">{r.name}</p>
                          <p className="font-mono text-xs text-zinc-500">{r.slug}</p>
                          {r.is_system ? (
                            <span className="mt-1 inline-block rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
                              Sistema
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {r.description ? (
                        <p className="mt-1 text-xs text-zinc-500">{r.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{r.permissions.length} permisos</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {r.is_system ? (
                          canView ? (
                            <button
                              type="button"
                              onClick={() => openEdit(r, { readOnly: true })}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-cf-line hover:bg-white/5"
                            >
                              Ver
                            </button>
                          ) : null
                        ) : canManage ? (
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-cf-line hover:bg-white/5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                        ) : canView ? (
                          <button
                            type="button"
                            onClick={() => openEdit(r, { readOnly: true })}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs ring-1 ring-cf-line hover:bg-white/5"
                          >
                            Ver
                          </button>
                        ) : null}
                        {canManage && !r.is_system ? (
                          <button
                            type="button"
                            onClick={() => setPendingDelete(r)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-rose-300 ring-1 ring-rose-500/25 hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editor ? (
          <Modal
            title={
              editor === "new"
                ? "Nuevo rol"
                : editorReadOnly || !canManage
                  ? `Ver — ${editor.name}`
                  : `Editar — ${editor.name}`
            }
            onClose={() => setEditor(null)}
          >
            <form className="space-y-4" onSubmit={(e) => void submit(e)}>
              {editor !== "new" && editor.is_system ? (
                <p className="rounded-lg border border-cf-line/80 bg-black/30 px-3 py-2 text-xs text-zinc-400">
                  Rol de sistema: no se puede modificar. Crea un rol nuevo si necesitas permisos
                  personalizados.
                </p>
              ) : editorReadOnly || (!canManage && editor !== "new") ? (
                <p className="rounded-lg border border-cf-line/80 bg-black/30 px-3 py-2 text-xs text-zinc-400">
                  Solo lectura. Para modificar permisos asigna{" "}
                  <span className="font-mono text-zinc-300">atlas:roles:Manage</span> a tu usuario.
                </p>
              ) : null}
              {saveErr ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {saveErr}
                </p>
              ) : null}
              {editor === "new" ? (
                <label className="block text-xs font-medium text-zinc-500">
                  Identificador (slug)
                  <input
                    className={`${inputClass} font-mono`}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="rancher-deployer"
                    pattern="[a-z][a-z0-9_-]{2,31}"
                    required
                  />
                </label>
              ) : null}
              <label className="block text-xs font-medium text-zinc-500">
                Nombre
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={editorReadOnly || !canManage}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-zinc-500">
                Descripción
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  readOnly={editorReadOnly || !canManage}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">{permMatrix}</div>
              <div className="flex justify-end gap-2 border-t border-cf-line/60 pt-4">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="rounded-lg px-4 py-2 text-sm ring-1 ring-cf-line hover:bg-white/5"
                >
                  {canManage && !editorReadOnly ? "Cancelar" : "Cerrar"}
                </button>
                {canManage && !editorReadOnly ? (
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-cf-orange px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Guardar
                  </button>
                ) : null}
              </div>
            </form>
          </Modal>
        ) : null}
      </AnimatePresence>

      <AtlasConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar rol"
        message={
          pendingDelete
            ? `¿Eliminar el rol «${pendingDelete.name}»? Los usuarios que lo tengan asignado perderán ese rol.`
            : ""
        }
        confirmLabel="Eliminar"
        variant="danger"
        onConfirm={() => {
          const r = pendingDelete;
          setPendingDelete(null);
          if (r) void doDelete(r);
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
