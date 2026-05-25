"""Router FastAPI — Gestión de Tiendas (atlas-stores)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from atlas_core.web_auth import current_user, require_roles
from atlas_stores.equipment import (
    EquipmentNotFoundError,
    RancherNotConfiguredError,
    find_equipment_for_store,
)
from atlas_stores.git_repo import StoresRepoError, git_commit_and_push, git_pull, resolve_repo_root
from atlas_stores.settings_store import load_stores_settings, save_stores_settings
from atlas_stores.templates import StoreTemplateError, list_store_templates
from atlas_stores.yaml_store import create_store, list_stores, load_store, save_store

router = APIRouter(prefix="/api/atlas-stores", tags=["atlas-stores"])
log = logging.getLogger(__name__)


class StoresSettingsBody(BaseModel):
    repo_url: str = ""
    branch: str = "main"
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
def get_stores_settings(user: dict[str, Any] = Depends(require_roles("admin"))) -> dict[str, Any]:
    s = load_stores_settings()
    configured = bool(s.get("repo_url"))
    return {
        "repo_url": s.get("repo_url", ""),
        "branch": s.get("branch", "main"),
        "git_token": "***" if s.get("git_token") else "",
        "auto_pull": s.get("auto_pull", True),
        "auto_push": s.get("auto_push", False),
        "configured": configured,
    }


@router.post("/settings")
def post_stores_settings(
    body: StoresSettingsBody,
    _admin: dict[str, Any] = Depends(require_roles("admin")),
) -> dict[str, bool]:
    if not body.repo_url.strip():
        raise HTTPException(400, "La URL Git del repositorio atlas-stores es obligatoria.")
    save_stores_settings(
        repo_url=body.repo_url,
        branch=body.branch,
        git_token=body.git_token,
        auto_pull=body.auto_pull,
        auto_push=body.auto_push,
    )
    return {"ok": True}


@router.post("/sync")
def post_stores_sync(
    _user: dict[str, Any] = Depends(require_roles("admin", "operator")),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        msg = git_pull(settings)
        root = resolve_repo_root(settings)
        count = len(list_stores(root))
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        log.exception("stores sync failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True, "message": msg, "storeCount": count}


@router.get("/stores")
def get_stores(
    _user: dict[str, Any] = Depends(current_user),
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
        root = resolve_repo_root(settings)
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


@router.get("/stores/{folder_name}")
def get_store_detail(
    folder_name: str,
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        root = resolve_repo_root(settings)
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
    user: dict[str, Any] = Depends(require_roles("admin", "operator")),
) -> dict[str, Any]:
    settings = load_stores_settings()
    try:
        root = resolve_repo_root(settings)
        patch = body.model_dump(exclude_none=True, exclude={"commit_message"})
        msg = (body.commit_message or "Atlas: actualizar tienda").strip()
        store = save_store(root, folder_name, patch)
        git_msg = git_commit_and_push(settings, message=f"{msg} ({folder_name})")
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
    _user: dict[str, Any] = Depends(current_user),
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
        root = resolve_repo_root(settings)
        templates = list_store_templates(root)
    except StoresRepoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "configured": True, "templates": templates}


@router.post("/stores")
def post_create_store(
    body: CreateStoreBody,
    user: dict[str, Any] = Depends(require_roles("admin", "operator")),
) -> dict[str, Any]:
    settings = load_stores_settings()
    store_id = (body.store_id or body.folder_name).strip()
    if not store_id:
        raise HTTPException(400, "El código de tienda es obligatorio.")
    distro = body.distro.strip().lower()
    try:
        equipment = find_equipment_for_store(store_id, distro=distro)
        root = resolve_repo_root(settings)
        store = create_store(
            root,
            folder_name=body.folder_name.strip(),
            store_id=store_id,
            distro=distro,
            image_channel=body.image_channel.strip() or "stable",
        )
        git_msg = git_commit_and_push(
            settings,
            message=f"Atlas: nueva tienda {store_id} ({body.folder_name})",
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
