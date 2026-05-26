"""Router FastAPI de Atlas Rancher."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from atlas_core.permissions import PERM_RANCHER_CONFIGURE, PERM_RANCHER_READ, PERM_RANCHER_WRITE
from atlas_core.web_auth import current_user, require_permission
from atlas_rancher.client import (
    RancherApiError,
    RancherConfigError,
    enrich_clusters_with_pod_counts,
    fetch_pod_logs,
    iter_pod_log_stream,
    list_custom_cluster_deployments,
    list_custom_cluster_pods,
    list_custom_clusters,
    list_pod_counts_for_clusters,
    rollout_deployment_image_pull,
    update_custom_cluster_labels,
)
from atlas_rancher.settings_store import load_rancher_settings, save_rancher_settings

router = APIRouter(prefix="/api/atlas-rancher", tags=["atlas-rancher"])
log = logging.getLogger(__name__)


class RancherSettingsBody(BaseModel):
    url: str = ""
    token: str = ""
    insecure_tls: bool = False
    cf_access_client_id: str = ""
    cf_access_client_secret: str = ""
    user_agent: str = ""


class ClusterLabelsBody(BaseModel):
    store: str = ""
    application: str = ""
    distro: str = ""
    atlas: str = ""
    steve_collection: str = "provisioning.cattle.io.customclusters"


class DeploymentRolloutBody(BaseModel):
    steve_collection: str = "provisioning.cattle.io.customclusters"


@router.get("/health")
def rancher_health() -> dict[str, str]:
    return {"module": "atlas-rancher", "status": "ok"}


@router.get("/settings")
def get_rancher_settings(
    user: dict[str, Any] = Depends(require_permission(PERM_RANCHER_CONFIGURE)),
) -> dict[str, Any]:
    s = load_rancher_settings()
    return {
        "url": s["url"],
        "token": s["token"],
        "insecure_tls": s["insecure_tls"],
        "cf_access_client_id": s.get("cf_access_client_id", ""),
        "cf_access_client_secret": "***" if s.get("cf_access_client_secret") else "",
        "user_agent": s.get("user_agent", ""),
        "configured": bool(s["url"] and s["token"]),
    }


@router.post("/settings")
def post_rancher_settings(
    body: RancherSettingsBody,
    _admin: dict[str, Any] = Depends(require_permission(PERM_RANCHER_CONFIGURE)),
) -> dict[str, bool]:
    if not body.url.strip() or not body.token.strip():
        raise HTTPException(400, "URL y token de Rancher son obligatorios.")
    prev = load_rancher_settings()
    cf_secret = body.cf_access_client_secret.strip() or str(prev.get("cf_access_client_secret") or "")
    save_rancher_settings(
        body.url,
        body.token,
        body.insecure_tls,
        cf_access_client_id=body.cf_access_client_id.strip() or str(prev.get("cf_access_client_id") or ""),
        cf_access_client_secret=cf_secret,
        user_agent=body.user_agent.strip() or str(prev.get("user_agent") or ""),
    )
    return {"ok": True}


@router.get("/custom-clusters")
def get_custom_clusters(
    include_pod_counts: bool = Query(default=False),
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        return {
            "ok": True,
            "configured": False,
            "source": "",
            "rancherUrl": "",
            "count": 0,
            "clusters": [],
            "message": "Configura la conexión a Rancher (Conexión Rancher o ATLAS_RANCHER_URL / ATLAS_RANCHER_TOKEN).",
        }
    try:
        source, clusters = list_custom_clusters(settings)
        if include_pod_counts:
            try:
                clusters = enrich_clusters_with_pod_counts(settings, clusters)
            except Exception:
                log.exception("include_pod_counts failed; returning clusters without counts")
                for cluster in clusters:
                    cluster.setdefault("podCount", None)
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        log.exception("custom-clusters failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al consultar Rancher. Revisa los logs del contenedor atlas-api.",
        ) from e
    return {
        "ok": True,
        "configured": True,
        "source": source,
        "rancherUrl": settings["url"],
        "count": len(clusters),
        "clusters": clusters,
    }


@router.get("/custom-clusters/pod-counts")
def get_custom_cluster_pod_counts(
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    """Conteos de pods por cluster (en paralelo). No bloquea el listado principal."""
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(
            400,
            "Configura la conexión a Rancher antes de consultar conteos de pods.",
        )
    try:
        _, clusters = list_custom_clusters(settings)
        counts = list_pod_counts_for_clusters(settings, clusters)
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("custom-cluster pod-counts failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al consultar conteos de pods.",
        ) from e
    return {"ok": True, "counts": counts}


@router.patch("/custom-clusters/{namespace}/{name}/labels")
def patch_custom_cluster_labels(
    namespace: str,
    name: str,
    body: ClusterLabelsBody,
    user: dict[str, Any] = Depends(require_permission(PERM_RANCHER_WRITE)),
) -> dict[str, Any]:
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(
            400,
            "Configura la conexión a Rancher antes de editar labels.",
        )
    try:
        cluster = update_custom_cluster_labels(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=body.steve_collection.strip(),
            store=body.store,
            application=body.application,
            distro=body.distro,
            atlas=body.atlas,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        if e.status == 404:
            status = 404
        elif e.status == 403:
            status = 403
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("patch cluster labels failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al actualizar labels en Rancher.",
        ) from e

    log.info(
        "rancher cluster labels updated namespace=%s name=%s user=%s",
        namespace,
        name,
        user.get("username"),
    )
    return {"ok": True, "cluster": cluster}


@router.get("/custom-clusters/{namespace}/{name}/deployments")
def get_custom_cluster_deployments(
    namespace: str,
    name: str,
    steve_collection: str = Query(default="provisioning.cattle.io.customclusters"),
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(
            400,
            "Configura la conexión a Rancher antes de consultar deployments.",
        )
    try:
        source, mgmt_id, application, deployments = list_custom_cluster_deployments(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=steve_collection.strip(),
        )
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        if e.status == 404:
            status = 404
        elif e.status == 403:
            status = 403
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("custom-cluster deployments failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al consultar deployments en Rancher.",
        ) from e
    return {
        "ok": True,
        "source": source,
        "managementClusterId": mgmt_id,
        "application": application,
        "podNamespace": application,
        "count": len(deployments),
        "deployments": deployments,
    }


@router.post("/custom-clusters/{namespace}/{name}/deployments/{deployment_name}/rollout")
def post_deployment_rollout(
    namespace: str,
    name: str,
    deployment_name: str,
    body: DeploymentRolloutBody,
    user: dict[str, Any] = Depends(require_permission(PERM_RANCHER_WRITE)),
) -> dict[str, Any]:
    """Réplicas 0 → N para forzar descarga de imagen en el nodo."""
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(
            400,
            "Configura la conexión a Rancher antes de gestionar contenedores.",
        )
    try:
        result = rollout_deployment_image_pull(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=body.steve_collection.strip(),
            deployment_name=deployment_name,
        )
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        if e.status == 404:
            status = 404
        elif e.status == 403:
            status = 403
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("deployment rollout failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al actualizar el deployment.",
        ) from e

    log.info(
        "deployment rollout namespace=%s cluster=%s deployment=%s user=%s",
        namespace,
        name,
        deployment_name,
        user.get("username"),
    )
    return {"ok": True, **result}


@router.get("/custom-clusters/{namespace}/{name}/pods")
def get_custom_cluster_pods(
    namespace: str,
    name: str,
    steve_collection: str = Query(default="provisioning.cattle.io.customclusters"),
    _user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(
            400,
            "Configura la conexión a Rancher antes de consultar pods.",
        )
    try:
        source, mgmt_id, application, pods = list_custom_cluster_pods(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=steve_collection.strip(),
        )
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        if e.status == 404:
            status = 404
        elif e.status == 403:
            status = 403
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("custom-cluster pods failed")
        raise HTTPException(
            status_code=500,
            detail="Error interno al consultar pods en Rancher.",
        ) from e
    return {
        "ok": True,
        "source": source,
        "managementClusterId": mgmt_id,
        "application": application,
        "podNamespace": application,
        "count": len(pods),
        "pods": pods,
    }


@router.get("/custom-clusters/{namespace}/{name}/pods/{pod_name}/logs")
def get_custom_cluster_pod_logs(
    namespace: str,
    name: str,
    pod_name: str,
    steve_collection: str = Query(default="provisioning.cattle.io.customclusters"),
    container: str = Query(default=""),
    tail_lines: int = Query(default=500, ge=1, le=5000),
    previous: bool = Query(default=False),
    follow: bool = Query(default=False),
    _user: dict[str, Any] = Depends(require_permission(PERM_RANCHER_READ)),
) -> Any:
    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        raise HTTPException(400, "Configura la conexión a Rancher antes de consultar logs.")
    steve = steve_collection.strip()
    try:
        if follow:

            def _stream():
                try:
                    for chunk in iter_pod_log_stream(
                        settings,
                        namespace=namespace,
                        name=name,
                        steve_collection=steve,
                        pod_name=pod_name,
                        container=container,
                        tail_lines=min(tail_lines, 500),
                        previous=previous,
                    ):
                        yield chunk
                except RancherApiError as e:
                    yield f"\n[Atlas] {e}\n"
                except RancherConfigError as e:
                    yield f"\n[Atlas] {e}\n"

            return StreamingResponse(
                _stream(),
                media_type="text/plain; charset=utf-8",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        result = fetch_pod_logs(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=steve,
            pod_name=pod_name,
            container=container,
            tail_lines=tail_lines,
            previous=previous,
        )
    except RancherConfigError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RancherApiError as e:
        status = 503 if e.status is None or e.status >= 500 else 502
        if e.status == 404:
            status = 404
        elif e.status == 403:
            status = 403
        raise HTTPException(status_code=status, detail=str(e)) from e
    except Exception as e:
        log.exception("custom-cluster pod logs failed")
        raise HTTPException(status_code=500, detail="Error interno al leer logs del pod.") from e
    return {"ok": True, **result}
