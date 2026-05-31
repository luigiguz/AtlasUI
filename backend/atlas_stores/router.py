"""Router FastAPI — Gestión de Tiendas (atlas-stores)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from atlas_core.permissions import (
    PERM_STORES_CONFIGURE,
    PERM_STORES_READ,
    PERM_STORES_WRITE,
    has_permission,
)
from atlas_core.web_auth import require_permission
from atlas_stores.equipment import (
    EquipmentNotFoundError,
    RancherNotConfiguredError,
    find_equipment_for_store,
)
from atlas_stores.git_repo import StoresRepoError, git_commit_and_push, git_pull, git_test_connection, resolve_repo_root
from atlas_stores.settings_store import load_stores_settings, save_stores_settings
from atlas_stores.templates import StoreTemplateError, list_store_templates
from atlas_stores.yaml_store import create_store, list_stores, load_store, preview_create_store, save_store

router = APIRouter(prefix="/api/atlas-stores", tags=["atlas-stores"])
log = logging.getLogger(__name__)

# Git (sync, publicar, credenciales): admin y operador (Write). Solo lectura: viewer (Read).
_STORES_GIT = (PERM_STORES_WRITE, PERM_STORES_CONFIGURE)


def _stores_repo_root(
    settings: dict[str, str | bool],
    user: dict[str, Any],
    *,
    pull: bool | None = None,
):
    if pull is None:
        pull = bool(settings.get("auto_pull")) and has_permission(user, PERM_STORES_WRITE)
    return resolve_repo_root(settings, pull=pull)


def _commit_actor_suffix(user: dict[str, Any]) -> str:
    """Sufijo con usuario Atlas que publica (sesión JWT)."""
    name = str(user.get("username") or "").strip()
    return f" [{name}]" if name else ""


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
    distro: str = Field(description="horustech o pam")
    image_channel: str = "stable"


class SaveStoreBody(BaseModel):
    id: str | None = None
    distro: str | None = None
    image_channel: str | None = None
    db: dict[str, Any] | None = None
    station: dict[str, Any] | None = None
    commit_message: str = "Atlas: actualizar configuración de tienda"


@router.get("/health")
def stores_health() -> dict[str, str]:
    return {"module": "atlas-stores", "status": "ok"}


@router.get("/settings")
def get_stores_settings(
    _user: dict[str, Any] = Depends(require_permission(*_STORES_GIT)),
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
    _user: dict[str, Any] = Depends(require_permission(*_STORES_GIT)),
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
    _user: dict[str, Any] = Depends(require_permission(*_STORES_GIT)),
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
    _user: dict[str, Any] = Depends(require_permission(PERM_STORES_WRITE)),
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
    try:
        root = _stores_repo_root(settings, user)
        stores = list_stores(root)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("list stores failed")
        raise HTTPException(status_code=500, detail="No se pudo leer el repositorio de tiendas.") from e
    return {
        "ok": True,
        "configured": True,
        "repoUrl": settings.get("repo_url", ""),
        "branch": settings.get("branch", "main"),
        "count": len(stores),
        "stores": stores,
    }


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
    distro = body.distro.strip().lower()
    try:
        equipment = find_equipment_for_store(store_id, distro=distro)
        root = _stores_repo_root(settings, user)
        preview = preview_create_store(
            root,
            folder_name=body.folder_name.strip() or store_id,
            store_id=store_id,
            distro=distro,
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


@router.get("/stores/{folder_name}")
def get_store_detail(
    folder_name: str,
    user: dict[str, Any] = Depends(require_permission(PERM_STORES_READ)),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        root = _stores_repo_root(settings, user)
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
    try:
        root = _stores_repo_root(settings, user)
        patch = body.model_dump(exclude_none=True, exclude={"commit_message"})
        msg = (body.commit_message or "Atlas: actualizar tienda").strip()
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
    distro = body.distro.strip().lower()
    try:
        equipment = find_equipment_for_store(store_id, distro=distro)
        root = _stores_repo_root(settings, user)
        store = create_store(
            root,
            folder_name=body.folder_name.strip(),
            store_id=store_id,
            distro=distro,
            image_channel=body.image_channel.strip() or "stable",
        )
        folder = body.folder_name.strip() or store_id
        git_msg = git_commit_and_push(
            settings,
            message=_create_store_commit_message(
                store_id=store_id,
                folder_name=folder,
                user=user,
            ),
        )
        safe = {k: v for k, v in store.items() if not str(k).startswith("_")}
    except RancherNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except EquipmentNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
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
        body.folder_name,
        store_id,
        equipment.get("name"),
        user.get("username"),
    )
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
