"""Solicitudes de cambio en tiendas (flujo de aprobación nativo Atlas)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from atlas_core.db.models import StoreChangeRequest
from atlas_core.db.session import session_scope
from atlas_stores.equipment import EquipmentNotFoundError, RancherNotConfiguredError, find_equipment_for_store
from atlas_stores.git_repo import StoresRepoError, git_commit_and_push, resolve_repo_root
from atlas_stores.settings_store import load_stores_settings
from atlas_stores.yaml_store import create_store, save_store

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
        return _row_dict(row)


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
        return _row_dict(row)


def list_change_requests(
    user: dict[str, Any],
    *,
    can_approve: bool,
    status: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    st = (status or STATUS_PENDING).strip().lower()
    with session_scope() as session:
        q = select(StoreChangeRequest).order_by(StoreChangeRequest.created_at.desc()).limit(lim)
        if st != "all":
            q = q.where(StoreChangeRequest.status == st)
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
        return _row_dict(row, include_payload=True)


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


def _apply_and_publish(
    row: StoreChangeRequest,
    *,
    actor_suffix: str,
) -> tuple[dict[str, Any], str]:
    settings = load_stores_settings()
    root = resolve_repo_root(settings, pull=False)
    payload = row.payload if isinstance(row.payload, dict) else {}
    msg_base = (row.commit_message or "Atlas: cambio en tienda").strip()

    if row.kind == KIND_CREATE:
        store_id = str(payload.get("store_id") or row.store_id).strip()
        distro = str(payload.get("distro") or "").strip().lower()
        find_equipment_for_store(store_id, distro=distro)
        store = create_store(
            root,
            folder_name=str(payload.get("folder_name") or row.folder_name).strip(),
            store_id=store_id,
            distro=distro,
            image_channel=str(payload.get("image_channel") or "stable").strip() or "stable",
        )
    else:
        store = save_store(root, row.folder_name, payload)

    git_msg = git_commit_and_push(settings, message=f"{msg_base}{actor_suffix}")
    safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    return safe, git_msg


def approve_change_request(
    request_id: int,
    reviewer: dict[str, Any],
    *,
    review_note: str = "",
    actor_suffix: str = "",
) -> dict[str, Any]:
    with session_scope() as session:
        row = session.get(StoreChangeRequest, request_id)
        if not row:
            raise ChangeRequestError("Solicitud no encontrada.")
        if row.status != STATUS_PENDING:
            raise ChangeRequestError("La solicitud ya fue procesada.")

    try:
        store, git_msg = _apply_and_publish(row, actor_suffix=actor_suffix)
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
        return _row_dict(row)


def pending_folder_names() -> set[str]:
    with session_scope() as session:
        rows = session.scalars(
            select(StoreChangeRequest.folder_name).where(
                StoreChangeRequest.status == STATUS_PENDING
            )
        ).all()
        return {str(r) for r in rows}
