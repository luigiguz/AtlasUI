"""Solicitudes de cambio en tiendas (flujo de aprobación nativo Atlas)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from atlas_core.db.models import StoreChangeRequest
from atlas_core.db.session import session_scope
from atlas_core.notifications import notify_approvers_new_store_request, notify_user
from atlas_stores.equipment import EquipmentNotFoundError, RancherNotConfiguredError, find_equipment_for_store
from atlas_stores.git_repo import StoresRepoError, git_commit_and_push, resolve_repo_root
from atlas_stores.settings_store import load_stores_settings
from atlas_stores.yaml_store import create_store, load_store, save_store

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_CANCELLED = "cancelled"

KIND_UPDATE = "update"
KIND_CREATE = "create"


class ChangeRequestError(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _user_id(user: dict[str, Any]) -> int:
    uid = user.get("id")
    if uid is None:
        raise ChangeRequestError("Sesión sin identificador de usuario.")
    return int(uid)


def _username(user: dict[str, Any]) -> str:
    return str(user.get("username") or "").strip() or "?"


def _summarize_update(folder_name: str, patch: dict[str, Any]) -> str:
    store_id = str(patch.get("id") or folder_name).strip()
    parts = [f"Actualizar tienda {store_id}"]
    channel = patch.get("image_channel") or patch.get("imageChannel")
    if channel:
        parts.append(f"canal {channel}")
    station = patch.get("station")
    if isinstance(station, dict):
        services = station.get("services")
        if isinstance(services, list):
            enabled = sum(1 for s in services if isinstance(s, dict) and s.get("enabled"))
            parts.append(f"{enabled} servicio(s) estación")
        workers = station.get("workers")
        if isinstance(workers, list) and workers:
            parts.append(f"{len(workers)} worker(s)")
    if patch.get("db"):
        parts.append("config. base de datos")
    return " · ".join(parts)


def _summarize_create(body: dict[str, Any]) -> str:
    store_id = str(body.get("store_id") or body.get("folder_name") or "").strip()
    distro = str(body.get("distro") or "").strip().lower()
    folder = str(body.get("folder_name") or store_id).strip()
    return f"Nueva tienda {store_id} ({distro or '?'}) en {folder}"


def _flatten_workers(station: dict[str, Any]) -> list[dict[str, Any]]:
    workers = station.get("workers")
    if isinstance(workers, list) and workers:
        return [w for w in workers if isinstance(w, dict)]
    grouped = station.get("workerGroups")
    if isinstance(grouped, dict):
        groups = grouped.get("groups")
        if isinstance(groups, list):
            flat: list[dict[str, Any]] = []
            for group in groups:
                if isinstance(group, dict):
                    items = group.get("workers")
                    if isinstance(items, list):
                        flat.extend(w for w in items if isinstance(w, dict))
            return flat
    return []


def _merge_store_with_patch(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    proposed = {**current}
    if patch.get("id"):
        proposed["id"] = patch["id"]
    if patch.get("distro"):
        proposed["distro"] = patch["distro"]
    if isinstance(patch.get("db"), dict):
        proposed["db"] = {**(current.get("db") or {}), **patch["db"]}
    station_patch = patch.get("station")
    if isinstance(station_patch, dict):
        station = dict(current.get("station") or {})
        for key in ("pullPolicy", "config", "stack"):
            if key in station_patch and station_patch[key] is not None:
                station[key] = station_patch[key]
        if isinstance(station_patch.get("services"), list):
            station["services"] = station_patch["services"]
        if isinstance(station_patch.get("workers"), list):
            station["workers"] = station_patch["workers"]
        proposed["station"] = station
    return proposed


def _compare_store_snapshots(baseline: dict[str, Any], proposed: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    if baseline.get("id") != proposed.get("id"):
        lines.append(f"Código tienda: {baseline.get('id')} → {proposed.get('id')}")
    base_db = baseline.get("db") or {}
    cur_db = proposed.get("db") or {}
    if bool(base_db.get("pgadminEnabled")) != bool(cur_db.get("pgadminEnabled")):
        lines.append(f"PgAdmin: {'activado' if cur_db.get('pgadminEnabled') else 'desactivado'}")
    base_station = baseline.get("station") or {}
    cur_station = proposed.get("station") or {}
    base_policy = base_station.get("pullPolicy") or "IfNotPresent"
    cur_policy = cur_station.get("pullPolicy") or "IfNotPresent"
    if base_policy != cur_policy:
        lines.append(f"Pull policy: {base_policy} → {cur_policy}")
    base_config = base_station.get("config") or {}
    cur_config = cur_station.get("config") or {}
    if isinstance(base_config, dict) and isinstance(cur_config, dict):
        for key in sorted(set(base_config.keys()) | set(cur_config.keys())):
            b = str(base_config.get(key) or "")
            c = str(cur_config.get(key) or "")
            if b != c:
                lines.append(f"Config {key}: {b or '—'} → {c or '—'}")
    base_svc = {s.get("key"): s for s in (base_station.get("services") or []) if isinstance(s, dict) and s.get("key")}
    for svc in cur_station.get("services") or []:
        if not isinstance(svc, dict):
            continue
        key = svc.get("key")
        if not key:
            continue
        prev = base_svc.get(key)
        if not prev:
            lines.append(
                f"Servicio {key}: nuevo ({'on' if svc.get('enabled') else 'off'}, tag {svc.get('tag') or '—'})"
            )
            continue
        if prev.get("enabled") != svc.get("enabled"):
            lines.append(f"Servicio {key}: {'activado' if svc.get('enabled') else 'desactivado'}")
        if prev.get("tag") != svc.get("tag"):
            lines.append(f"Servicio {key} tag: {prev.get('tag') or '—'} → {svc.get('tag') or '—'}")
    base_wrk = {w.get("key"): w for w in _flatten_workers(base_station) if w.get("key")}
    for wrk in _flatten_workers(cur_station):
        key = wrk.get("key")
        if not key:
            continue
        prev = base_wrk.get(key)
        if not prev:
            continue
        label = key[5:] if str(key).startswith("ierp.") else str(key)
        if prev.get("enabled") != wrk.get("enabled"):
            lines.append(f"Proceso {label}: {'activado' if wrk.get('enabled') else 'desactivado'}")
        if prev.get("tag") != wrk.get("tag"):
            lines.append(f"Proceso {label} tag: {prev.get('tag') or '—'} → {wrk.get('tag') or '—'}")
    return lines


def _create_request_lines(payload: dict[str, Any], store_id: str) -> list[str]:
    folder = str(payload.get("folder_name") or store_id).strip()
    distro = str(payload.get("distro") or "—").strip().lower() or "—"
    channel = str(payload.get("image_channel") or payload.get("imageChannel") or "stable").strip()
    return [
        f"Nueva tienda: {store_id}",
        f"Carpeta en repo: {folder}",
        f"Distribución: {distro}",
        f"Tag imágenes: {channel}",
    ]


def change_request_detail_lines(row: StoreChangeRequest) -> list[str]:
    payload = row.payload if isinstance(row.payload, dict) else {}
    if row.kind == KIND_CREATE:
        return _create_request_lines(payload, str(row.store_id))
    if row.kind != KIND_UPDATE:
        return []
    try:
        settings = load_stores_settings()
        root = resolve_repo_root(settings, pull=False)
        current = load_store(root, row.folder_name)
        proposed = _merge_store_with_patch(current, payload)
        return _compare_store_snapshots(current, proposed)
    except Exception:
        return []


def _row_dict(row: StoreChangeRequest, *, include_payload: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": int(row.id),
        "kind": row.kind,
        "folderName": row.folder_name,
        "storeId": row.store_id,
        "status": row.status,
        "summary": row.summary,
        "commitMessage": row.commit_message,
        "createdByUserId": int(row.created_by_user_id),
        "createdByUsername": row.created_by_username,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "reviewedByUsername": row.reviewed_by_username or None,
        "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "reviewNote": row.review_note or None,
    }
    if include_payload:
        out["payload"] = row.payload if isinstance(row.payload, dict) else {}
    return out


def _pending_for_folder(session, folder_name: str) -> StoreChangeRequest | None:
    return session.scalar(
        select(StoreChangeRequest).where(
            StoreChangeRequest.folder_name == folder_name.strip(),
            StoreChangeRequest.status == STATUS_PENDING,
        )
    )


def create_update_request(
    user: dict[str, Any],
    *,
    folder_name: str,
    patch: dict[str, Any],
    commit_message: str,
) -> dict[str, Any]:
    folder = folder_name.strip()
    if not folder:
        raise ChangeRequestError("Carpeta de tienda inválida.")
    summary = _summarize_update(folder, patch)
    with session_scope() as session:
        existing = _pending_for_folder(session, folder)
        if existing:
            raise ChangeRequestError(
                f"Ya hay una solicitud pendiente (#{existing.id}) para «{folder}» "
                f"de {existing.created_by_username}."
            )
        store_id = str(patch.get("id") or folder).strip()
        row = StoreChangeRequest(
            kind=KIND_UPDATE,
            folder_name=folder,
            store_id=store_id,
            status=STATUS_PENDING,
            payload=patch,
            commit_message=(commit_message or f"Atlas: actualizar tienda {store_id}").strip(),
            summary=summary,
            created_by_user_id=_user_id(user),
            created_by_username=_username(user),
        )
        session.add(row)
        session.flush()
        result = _row_dict(row)
    notify_approvers_new_store_request(
        request_id=int(result["id"]),
        summary=summary,
        folder_name=folder,
        creator_username=_username(user),
        exclude_user_id=_user_id(user),
        request_kind=KIND_UPDATE,
    )
    return result


def create_create_request(
    user: dict[str, Any],
    *,
    body: dict[str, Any],
    commit_message: str,
) -> dict[str, Any]:
    folder = str(body.get("folder_name") or "").strip()
    store_id = str(body.get("store_id") or folder).strip()
    if not store_id:
        raise ChangeRequestError("El código de tienda es obligatorio.")
    folder = folder or store_id
    summary = _summarize_create({**body, "folder_name": folder, "store_id": store_id})
    with session_scope() as session:
        existing = _pending_for_folder(session, folder)
        if existing:
            raise ChangeRequestError(
                f"Ya hay una solicitud pendiente (#{existing.id}) para «{folder}»."
            )
        row = StoreChangeRequest(
            kind=KIND_CREATE,
            folder_name=folder,
            store_id=store_id,
            status=STATUS_PENDING,
            payload=body,
            commit_message=(commit_message or f"Atlas: nueva tienda {store_id}").strip(),
            summary=summary,
            created_by_user_id=_user_id(user),
            created_by_username=_username(user),
        )
        session.add(row)
        session.flush()
        result = _row_dict(row)
    notify_approvers_new_store_request(
        request_id=int(result["id"]),
        summary=summary,
        folder_name=folder,
        creator_username=_username(user),
        exclude_user_id=_user_id(user),
        request_kind=KIND_CREATE,
    )
    return result


def list_change_requests(
    user: dict[str, Any],
    *,
    can_approve: bool,
    status: str | None = None,
    limit: int = 50,
    folder: str | None = None,
) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    st = (status or STATUS_PENDING).strip().lower()
    folder_q = (folder or "").strip()
    with session_scope() as session:
        q = select(StoreChangeRequest).order_by(StoreChangeRequest.created_at.desc()).limit(lim)
        if st == "history":
            q = q.where(StoreChangeRequest.status != STATUS_PENDING)
        elif st != "all":
            q = q.where(StoreChangeRequest.status == st)
        if folder_q:
            q = q.where(StoreChangeRequest.folder_name.ilike(f"%{folder_q}%"))
        if not can_approve:
            q = q.where(StoreChangeRequest.created_by_user_id == _user_id(user))
        rows = session.scalars(q).all()
        return [_row_dict(r) for r in rows]


def get_change_request(
    request_id: int,
    user: dict[str, Any],
    *,
    can_approve: bool,
) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row:
            raise ChangeRequestError("Solicitud no encontrada.")
        if not can_approve and int(row.created_by_user_id) != _user_id(user):
            raise ChangeRequestError("No tienes permiso para ver esta solicitud.")
        out = _row_dict(row, include_payload=True)
        out["changeLines"] = change_request_detail_lines(row)
        return out


def cancel_change_request(request_id: int, user: dict[str, Any]) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row:
            raise ChangeRequestError("Solicitud no encontrada.")
        if row.status != STATUS_PENDING:
            raise ChangeRequestError("Solo se pueden cancelar solicitudes pendientes.")
        if int(row.created_by_user_id) != _user_id(user):
            raise ChangeRequestError("Solo puedes cancelar tus propias solicitudes.")
        row.status = STATUS_CANCELLED
        row.reviewed_at = _utcnow()
        row.reviewed_by_username = _username(user)
        row.review_note = "Cancelada por el solicitante"
        return _row_dict(row)


def _commit_attribution_suffix(*, author: str, approver: str | None = None) -> str:
    """Sufijo Git: autor del cambio; si lo publica otro usuario, indica quién aprobó."""
    author = author.strip()
    if not author:
        return ""
    approver = (approver or "").strip()
    if approver and approver.lower() != author.lower():
        return f" [{author}, aprobado por {approver}]"
    return f" [{author}]"


def _apply_and_publish(
    *,
    kind: str,
    folder_name: str,
    store_id: str,
    payload: dict[str, Any],
    commit_message: str,
    actor_suffix: str,
) -> tuple[dict[str, Any], str]:
    settings = load_stores_settings()
    root = resolve_repo_root(settings, pull=False)
    msg_base = (commit_message or "Atlas: cambio en tienda").strip()

    if kind == KIND_CREATE:
        sid = str(payload.get("store_id") or store_id).strip()
        distro = str(payload.get("distro") or "").strip().lower()
        find_equipment_for_store(sid, distro=distro)
        store = create_store(
            root,
            folder_name=str(payload.get("folder_name") or folder_name).strip(),
            store_id=sid,
            distro=distro,
            image_channel=str(payload.get("image_channel") or "stable").strip() or "stable",
        )
    else:
        store = save_store(root, folder_name, payload)

    git_msg = git_commit_and_push(settings, message=f"{msg_base}{actor_suffix}")
    safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    return safe, git_msg


def approve_change_request(
    request_id: int,
    reviewer: dict[str, Any],
    *,
    review_note: str = "",
) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row:
            raise ChangeRequestError("Solicitud no encontrada.")
        if row.status != STATUS_PENDING:
            raise ChangeRequestError("La solicitud ya fue procesada.")
        kind = str(row.kind)
        folder_name = str(row.folder_name)
        store_id = str(row.store_id)
        payload = dict(row.payload) if isinstance(row.payload, dict) else {}
        commit_message = str(row.commit_message or "")
        created_by_username = str(row.created_by_username or "")

    reviewer_name = _username(reviewer)
    suffix = _commit_attribution_suffix(author=created_by_username, approver=reviewer_name)
    folder = folder_name.strip()
    git_suffix = f"{suffix} ({folder})" if folder else suffix

    try:
        store, git_msg = _apply_and_publish(
            kind=kind,
            folder_name=folder_name,
            store_id=store_id,
            payload=payload,
            commit_message=commit_message,
            actor_suffix=git_suffix,
        )
    except RancherNotConfiguredError as e:
        raise ChangeRequestError(str(e)) from e
    except EquipmentNotFoundError as e:
        raise ChangeRequestError(str(e)) from e
    except StoresRepoError as e:
        raise ChangeRequestError(str(e)) from e
    except FileExistsError as e:
        raise ChangeRequestError(str(e)) from e
    except FileNotFoundError as e:
        raise ChangeRequestError(str(e)) from e
    except ValueError as e:
        raise ChangeRequestError(str(e)) from e

    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row or row.status != STATUS_PENDING:
            raise ChangeRequestError("La solicitud ya fue procesada.")
        row.status = STATUS_APPROVED
        row.reviewed_at = _utcnow()
        row.reviewed_by_user_id = _user_id(reviewer)
        row.reviewed_by_username = _username(reviewer)
        row.review_note = (review_note or "").strip()[:512]
        result = _row_dict(row)
        result["store"] = store
        result["publishMessage"] = git_msg
        creator_id = int(row.created_by_user_id)
        summary = str(row.summary or row.folder_name)
        folder_name = str(row.folder_name)
        reviewer_name = _username(reviewer)

    notify_user(
        user_id=creator_id,
        kind="store_change_approved",
        severity="success",
        title="Solicitud de tienda aprobada",
        body=f"Tu solicitud para «{folder_name}» fue aprobada y publicada en Git.",
        route="rancher-store-requests",
        payload={
            "requestId": request_id,
            "folderName": folder_name,
            "summary": summary,
            "reviewedByUsername": reviewer_name,
            "requestKind": str(result.get("kind") or "update"),
        },
    )
    return result


def reject_change_request(
    request_id: int,
    reviewer: dict[str, Any],
    *,
    review_note: str = "",
) -> dict[str, Any]:
    note = (review_note or "").strip()
    if not note:
        raise ChangeRequestError("Indica un motivo al rechazar la solicitud.")
    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row:
            raise ChangeRequestError("Solicitud no encontrada.")
        if row.status != STATUS_PENDING:
            raise ChangeRequestError("La solicitud ya fue procesada.")
        row.status = STATUS_REJECTED
        row.reviewed_at = _utcnow()
        row.reviewed_by_user_id = _user_id(reviewer)
        row.reviewed_by_username = _username(reviewer)
        row.review_note = note[:512]
        result = _row_dict(row)
        creator_id = int(row.created_by_user_id)
        summary = str(row.summary or row.folder_name)
        folder_name = str(row.folder_name)
        req_kind = str(row.kind or "update")

    notify_user(
        user_id=creator_id,
        kind="store_change_rejected",
        severity="warning",
        title="Solicitud de tienda rechazada",
        body=f"Tu solicitud para «{folder_name}» fue rechazada.",
        route="rancher-store-requests",
        payload={
            "requestId": request_id,
            "folderName": folder_name,
            "summary": summary,
            "reviewedByUsername": _username(reviewer),
            "reviewNote": note,
            "requestKind": req_kind,
        },
    )
    return result


def pending_folder_names() -> set[str]:
    with session_scope() as session:
        rows = session.scalars(
            select(StoreChangeRequest.folder_name).where(
                StoreChangeRequest.status == STATUS_PENDING
            )
        ).all()
        return {str(r) for r in rows}
