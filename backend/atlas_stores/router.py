"""Router FastAPI — Gestión de Tiendas (atlas-stores)."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from atlas_core.permissions import (
    PERM_STORES_APPROVE,
    PERM_STORES_CONFIGURE,
    PERM_STORES_READ,
    PERM_STORES_WRITE,
    has_permission,
)
from atlas_core.web_auth import require_permission
from atlas_stores.change_requests import (
    ChangeRequestError,
    approve_change_request,
    cancel_change_request,
    create_create_request,
    create_update_request,
    get_change_request,
    list_change_requests,
    pending_folder_names,
    reject_change_request,
)
from atlas_stores.direct_publishes import (
    DirectPublishError,
    KIND_CREATE,
    KIND_UPDATE,
    get_direct_publish,
    record_direct_publish,
    summarize_direct_create,
    summarize_direct_update,
)
from atlas_stores.equipment import (
    EquipmentNotFoundError,
    RancherNotConfiguredError,
    find_equipment_for_store,
)
from atlas_stores.git_repo import (
    StoresRepoError,
    git_commit_and_push,
    git_discard_changes,
    git_pull,
    git_test_connection,
    git_working_status,
    resolve_repo_root,
)
from atlas_stores.settings_store import load_stores_settings, save_stores_settings
from atlas_stores.templates import StoreTemplateError, list_store_templates
from atlas_stores.yaml_store import create_store, list_stores, load_store, preview_create_store, save_store

router = APIRouter(prefix="/api/atlas-stores", tags=["atlas-stores"])
log = logging.getLogger(__name__)

# Git (publicar, descartar): admin y operador (Write). Conexión repo: solo Configure.
def _stores_repo_root(
    settings: dict[str, str | bool],
    user: dict[str, Any],
    *,
    pull: bool | None = None,
):
    del user  # permisos no condicionan el pull; solo la configuración auto_pull
    if pull is None:
        pull = bool(settings.get("auto_pull", True))
    return resolve_repo_root(settings, pull=pull)


def _commit_actor_suffix(user: dict[str, Any]) -> str:
    """Sufijo con usuario Atlas que publica (sesión JWT)."""
    name = str(user.get("username") or "").strip()
    return f" [{name}]" if name else ""


def _can_publish_stores(user: dict[str, Any]) -> bool:
    return has_permission(user, PERM_STORES_APPROVE)


def _create_store_commit_message(
    *,
    store_id: str,
    folder_name: str,
    user: dict[str, Any],
) -> str:
    folder = folder_name.strip() or store_id
    return f"Atlas: nueva tienda {store_id}{_commit_actor_suffix(user)} ({folder})"


def _save_store_commit_message(
    *,
    base: str,
    folder_name: str,
    user: dict[str, Any],
) -> str:
    return f"{base.strip()}{_commit_actor_suffix(user)} ({folder_name})"


class StoresSettingsBody(BaseModel):
    repo_url: str = ""
    branch: str = "main"
    git_username: str = ""
    git_token: str = ""
    auto_pull: bool = True
    auto_push: bool = False


class CreateStoreBody(BaseModel):
    folder_name: str
    store_id: str = ""
    application: str = "Poslite"
    distro: str = Field(description="horustech o pam")
    image_channel: str = "stable"


class SaveStoreBody(BaseModel):
    id: str | None = None
    application: str | None = None
    distro: str | None = None
    image_channel: str | None = None
    db: dict[str, Any] | None = None
    station: dict[str, Any] | None = None
    commit_message: str = "Atlas: actualizar configuración de tienda"


class GitDiscardBody(BaseModel):
    mode: Literal["abort", "local", "remote"] = "local"


class GitPublishBody(BaseModel):
    commit_message: str = "Atlas: publicar cambios locales del caché"


class ReviewChangeBody(BaseModel):
    review_note: str = ""


@router.get("/health")
def stores_health() -> dict[str, str]:
    return {"module": "atlas-stores", "status": "ok"}


@router.get("/settings")
def get_stores_settings(
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_CONFIGURE)),
) -> dict[str, Any]:
    s = load_stores_settings()
    configured = bool(s.get("repo_url"))
    return {
        "repo_url": s.get("repo_url", ""),
        "branch": s.get("branch", "main"),
        "git_username": s.get("git_username", ""),
        "git_token": "***" if s.get("git_token") else "",
        "git_auth_configured": bool(s.get("git_token")),
        "auto_pull": s.get("auto_pull", True),
        "auto_push": s.get("auto_push", False),
        "configured": configured,
    }


@router.post("/settings")
def post_stores_settings(
    body: StoresSettingsBody,
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_CONFIGURE)),
) -> dict[str, bool]:
    if not body.repo_url.strip():
        raise HTTPException(400, "La URL Git del repositorio atlas-stores es obligatoria.")
    save_stores_settings(
        repo_url=body.repo_url,
        branch=body.branch,
        git_username=body.git_username,
        git_token=body.git_token,
        auto_pull=body.auto_pull,
        auto_push=body.auto_push,
    )
    return {"ok": True}


@router.post("/settings/test")
def post_stores_settings_test(
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_CONFIGURE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not str(settings.get("repo_url") or "").strip():
        raise HTTPException(400, "Configura la URL Git del repositorio antes de probar la conexión.")
    try:
        msg = git_test_connection(settings)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores git test failed")
        raise HTTPException(status_code=500, detail="Error al probar la conexión Git.") from e
    return {"ok": True, "message": msg}


@router.post("/sync")
def post_stores_sync(
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_CONFIGURE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        msg = git_pull(settings)
        root = resolve_repo_root(settings, pull=False)
        count = len(list_stores(root))
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores sync failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True, "message": msg, "storeCount": count}


@router.get("/git/status")
def get_stores_git_status(
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not str(settings.get("repo_url") or "").strip():
        return {"ok": True, "configured": False, "dirty": False, "blocked": False, "changes": []}
    try:
        status = git_working_status(settings)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores git status failed")
        raise HTTPException(status_code=500, detail="No se pudo leer el estado Git.") from e
    return {"ok": True, "configured": True, **status}


@router.post("/git/discard")
def post_stores_git_discard(
    body: GitDiscardBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_APPROVE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not str(settings.get("repo_url") or "").strip():
        raise HTTPException(400, "Configura el repositorio Git antes de descartar cambios.")
    try:
        msg = git_discard_changes(settings, mode=body.mode)
        status = git_working_status(settings)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores git discard failed")
        raise HTTPException(status_code=500, detail="No se pudieron descartar los cambios.") from e
    return {"ok": True, "message": msg, **status}


@router.post("/git/publish")
def post_stores_git_publish(
    body: GitPublishBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_APPROVE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not str(settings.get("repo_url") or "").strip():
        raise HTTPException(400, "Configura el repositorio Git antes de publicar.")
    try:
        status = git_working_status(settings)
        if status.get("blocked"):
            raise StoresRepoError(
                "Hay conflictos sin resolver. Restaura la versión remota o descarta los cambios antes de publicar."
            )
        if not status.get("dirty"):
            raise StoresRepoError("No hay cambios locales pendientes de publicar.")
        base = (body.commit_message or "Atlas: publicar cambios locales").strip()
        msg = git_commit_and_push(settings, message=f"{base}{_commit_actor_suffix(user)}")
        status = git_working_status(settings)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores git publish failed")
        raise HTTPException(status_code=500, detail="No se pudieron publicar los cambios.") from e
    return {"ok": True, "message": msg, **status}


@router.get("/stores")
def get_stores(
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not settings.get("repo_url"):
        return {
            "ok": True,
            "configured": False,
            "stores": [],
            "message": "Configura el repositorio atlas-stores (Gestión de Tiendas → Conexión repositorio).",
        }
    git_warning: str | None = None
    try:
        root = _stores_repo_root(settings, user)
    except StoresRepoError as e:
        git_warning = str(e)
        try:
            root = resolve_repo_root(settings, pull=False)
        except StoresRepoError:
            raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        stores = list_stores(root)
        git_state: dict[str, Any] | None = None
        try:
            git_state = git_working_status(settings)
        except StoresRepoError:
            git_state = None
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("list stores failed")
        raise HTTPException(status_code=500, detail="No se pudo leer el repositorio de tiendas.") from e
    out: dict[str, Any] = {
        "ok": True,
        "configured": True,
        "repoUrl": settings.get("repo_url", ""),
        "branch": settings.get("branch", "main"),
        "count": len(stores),
        "stores": stores,
    }
    if git_warning:
        out["gitWarning"] = git_warning
    if git_state and (git_state.get("dirty") or git_state.get("blocked")):
        out["gitBlocked"] = bool(git_state.get("blocked"))
        out["gitSummary"] = git_state.get("summary")
    pending = pending_folder_names()
    if pending:
        out["pendingFolders"] = sorted(pending)
    if has_permission(user, PERM_STORES_APPROVE):
        out["pendingApprovalCount"] = len(pending)
    return out


@router.post("/stores/preview")
def post_store_create_preview(
    body: CreateStoreBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_WRITE)),
) -> dict[str, Any]:
    """Resumen de configuración antes de commit/push (no escribe archivos)."""
    settings = load_stores_settings()
    store_id = (body.store_id or body.folder_name).strip()
    if not store_id:
        raise HTTPException(400, "El código de tienda es obligatorio.")
    application = (body.application or "Poslite").strip() or "Poslite"
    distro = body.distro.strip().lower()
    try:
        equipment = find_equipment_for_store(store_id, application=application, distro=distro)
        root = _stores_repo_root(settings, user)
        preview = preview_create_store(
            root,
            folder_name=body.folder_name.strip() or store_id,
            store_id=store_id,
            distro=distro,
            application=application,
            image_channel=body.image_channel.strip() or "stable",
        )
    except RancherNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except EquipmentNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except StoreTemplateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("store preview failed")
        raise HTTPException(status_code=500, detail="Error al generar el resumen.") from e

    folder = body.folder_name.strip() or store_id
    return {
        "ok": True,
        "preview": preview,
        "branch": settings.get("branch", "main"),
        "repoUrl": settings.get("repo_url", ""),
        "suggestedCommitMessage": _create_store_commit_message(
            store_id=store_id,
            folder_name=folder,
            user=user,
        ),
        "equipment": {
            "name": equipment.get("name"),
            "displayName": equipment.get("displayName"),
            "state": equipment.get("state"),
        },
    }


@router.get("/change-requests")
def get_change_requests(
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
    status: str = "pending",
    limit: int = 50,
    folder: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    include_direct: bool = False,
) -> dict[str, Any]:
    can_approve = has_permission(user, PERM_STORES_APPROVE)
    if not can_approve and not has_permission(user, PERM_STORES_WRITE):
        raise HTTPException(403, "Sin permiso para ver solicitudes de cambio.")
    try:
        items = list_change_requests(
            user,
            can_approve=can_approve,
            status=status,
            limit=limit,
            folder=folder,
            date_from=date_from,
            date_to=date_to,
            include_direct=include_direct,
        )
    except ChangeRequestError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "canApprove": can_approve, "requests": items}


@router.get("/direct-publishes/{publish_id}")
def get_direct_publish_detail(
    publish_id: int,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_APPROVE)),
) -> dict[str, Any]:
    del user
    try:
        item = get_direct_publish(publish_id)
    except DirectPublishError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True, "request": item}


@router.get("/change-requests/{request_id}")
def get_change_request_detail(
    request_id: int,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    can_approve = has_permission(user, PERM_STORES_APPROVE)
    try:
        item = get_change_request(request_id, user, can_approve=can_approve)
    except ChangeRequestError as e:
        raise HTTPException(status_code=404 if "no encontrada" in str(e).lower() else 403, detail=str(e)) from e
    return {"ok": True, "request": item}


@router.post("/change-requests/{request_id}/approve")
def post_approve_change_request(
    request_id: int,
    body: ReviewChangeBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_APPROVE)),
) -> dict[str, Any]:
    try:
        result = approve_change_request(
            request_id,
            user,
            review_note=body.review_note,
        )
    except ChangeRequestError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("approve change request failed")
        raise HTTPException(status_code=500, detail="Error al aprobar la solicitud.") from e
    log.info("change request approved id=%s by=%s", request_id, user.get("username"))
    return {"ok": True, **result}


@router.post("/change-requests/{request_id}/reject")
def post_reject_change_request(
    request_id: int,
    body: ReviewChangeBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_APPROVE)),
) -> dict[str, Any]:
    try:
        result = reject_change_request(request_id, user, review_note=body.review_note)
    except ChangeRequestError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    log.info("change request rejected id=%s by=%s", request_id, user.get("username"))
    return {"ok": True, "request": result}


@router.delete("/change-requests/{request_id}")
def delete_change_request(
    request_id: int,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_WRITE)),
) -> dict[str, Any]:
    try:
        result = cancel_change_request(request_id, user)
    except ChangeRequestError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "request": result}


@router.get("/stores/{folder_name}")
def get_store_detail(
    folder_name: str,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        root = _stores_repo_root(settings, user, pull=False)
        store = load_store(root, folder_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("get store failed")
        raise HTTPException(status_code=500, detail="Error al leer la tienda.") from e
    safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    return {"ok": True, "store": safe}


@router.put("/stores/{folder_name}")
def put_store(
    folder_name: str,
    body: SaveStoreBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_WRITE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    patch = body.model_dump(exclude_none=True, exclude={"commit_message"})
    msg = (body.commit_message or "Atlas: actualizar tienda").strip()

    if not _can_publish_stores(user):
        try:
            req = create_update_request(
                user,
                folder_name=folder_name,
                patch=patch,
                commit_message=msg,
            )
        except ChangeRequestError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        log.info("store change proposed folder=%s user=%s req=%s", folder_name, user.get("username"), req["id"])
        return {
            "ok": True,
            "pendingApproval": True,
            "changeRequest": req,
            "message": f"Solicitud #{req['id']} enviada. Un administrador debe aprobarla para publicar en Git.",
        }

    try:
        root = _stores_repo_root(settings, user)
        store = save_store(root, folder_name, patch)
        git_msg = git_commit_and_push(
            settings,
            message=_save_store_commit_message(base=msg, folder_name=folder_name, user=user),
        )
        safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("save store failed")
        raise HTTPException(status_code=500, detail="Error al guardar la tienda.") from e

    log.info("store saved folder=%s user=%s", folder_name, user.get("username"))
    try:
        record_direct_publish(
            user,
            kind=KIND_UPDATE,
            folder_name=folder_name,
            store_id=str(store.get("id") or folder_name),
            summary=summarize_direct_update(folder_name, patch),
            commit_message=git_msg,
            patch=patch,
        )
    except Exception:
        log.exception("failed to record direct store publish folder=%s", folder_name)
    return {"ok": True, "store": safe, "publishMessage": git_msg}


@router.get("/store-templates")
def get_store_templates(
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    if not settings.get("repo_url"):
        return {
            "ok": True,
            "configured": False,
            "templates": [],
            "message": "Configura la URL Git de atlas-stores.",
        }
    try:
        root = _stores_repo_root(settings, user)
        templates = list_store_templates(root)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "configured": True, "templates": templates}


@router.post("/stores")
def post_create_store(
    body: CreateStoreBody,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_WRITE)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    store_id = (body.store_id or body.folder_name).strip()
    if not store_id:
        raise HTTPException(400, "El código de tienda es obligatorio.")
    application = (body.application or "Poslite").strip() or "Poslite"
    distro = body.distro.strip().lower()
    folder = body.folder_name.strip() or store_id

    try:
        equipment = find_equipment_for_store(store_id, application=application, distro=distro)
    except RancherNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except EquipmentNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    commit_msg = _create_store_commit_message(store_id=store_id, folder_name=folder, user=user)

    if not _can_publish_stores(user):
        try:
            req = create_create_request(
                user,
                body={
                    "folder_name": folder,
                    "store_id": store_id,
                    "application": application,
                    "distro": distro,
                    "image_channel": body.image_channel.strip() or "stable",
                },
                commit_message=commit_msg,
            )
        except ChangeRequestError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        log.info("store create proposed store=%s user=%s req=%s", store_id, user.get("username"), req["id"])
        return {
            "ok": True,
            "pendingApproval": True,
            "changeRequest": req,
            "message": f"Solicitud #{req['id']} enviada. Un administrador debe aprobarla para crear la tienda en Git.",
            "equipment": {
                "name": equipment.get("name"),
                "displayName": equipment.get("displayName"),
                "state": equipment.get("state"),
            },
        }

    try:
        root = _stores_repo_root(settings, user)
        store = create_store(
            root,
            folder_name=folder,
            store_id=store_id,
            application=application,
            distro=distro,
            image_channel=body.image_channel.strip() or "stable",
        )
        git_msg = git_commit_and_push(settings, message=commit_msg)
        safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except StoreTemplateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("create store failed")
        raise HTTPException(status_code=500, detail="Error al crear la tienda.") from e

    log.info(
        "store created folder=%s store=%s equipment=%s user=%s",
        folder,
        store_id,
        equipment.get("name"),
        user.get("username"),
    )
    create_body = {
        "folder_name": folder,
        "store_id": store_id,
        "application": application,
        "distro": distro,
        "image_channel": body.image_channel.strip() or "stable",
    }
    try:
        record_direct_publish(
            user,
            kind=KIND_CREATE,
            folder_name=folder,
            store_id=store_id,
            summary=summarize_direct_create(create_body),
            commit_message=git_msg,
            body=create_body,
        )
    except Exception:
        log.exception("failed to record direct store create folder=%s", folder)
    template_used = f"templates/poslite/{distro}/fleet.yaml"
    return {
        "ok": True,
        "store": safe,
        "publishMessage": git_msg,
        "templateSource": template_used,
        "equipment": {
            "name": equipment.get("name"),
            "displayName": equipment.get("displayName"),
            "state": equipment.get("state"),
        },
    }
