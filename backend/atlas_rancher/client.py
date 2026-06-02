"""Cliente HTTP para la API Steve / Rancher."""

from __future__ import annotations

import json
import logging
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Iterator

log = logging.getLogger(__name__)

from atlas_core.env import atlas_env
from atlas_rancher.labels import (
    ALLOWED_LABEL_KEYS,
    normalize_application,
    normalize_distro,
    prepare_label_values,
)

STEVE_CUSTOM_CLUSTER_PATHS = (
    "v1/provisioning.cattle.io.customclusters",
    "v1/provisioning.cattle.io.customcluster",
)
STEVE_PROVISIONING_CLUSTERS = "v1/provisioning.cattle.io.clusters"
STEVE_COLLECTION_CUSTOM = "provisioning.cattle.io.customclusters"
STEVE_COLLECTION_CLUSTER = "provisioning.cattle.io.clusters"
RANCHER_HTTP_TIMEOUT_S = 12.0
RANCHER_POD_COUNT_TIMEOUT_S = 8.0
RANCHER_POD_LOG_TIMEOUT_S = 45.0
RANCHER_POD_LOG_STREAM_TIMEOUT_S = 600.0
ROLLOUT_WAIT_TIMEOUT_S = 120.0
ROLLOUT_POLL_INTERVAL_S = 2.0
POD_COUNT_MAX_WORKERS = 4
# Cloudflare (p. ej. atlas.asptienda.com) suele bloquear Python-urllib; usar firma de navegador.
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


class RancherConfigError(Exception):
    pass


class RancherApiError(Exception):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _ssl_context(insecure: bool) -> ssl.SSLContext:
    if insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return ssl.create_default_context()


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _rancher_request_headers(settings: dict[str, str | bool]) -> dict[str, str]:
    token = str(settings.get("token") or "")
    ua = str(settings.get("user_agent") or "").strip() or atlas_env("RANCHER_USER_AGENT") or _DEFAULT_USER_AGENT
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "User-Agent": ua,
        "Cache-Control": "no-cache",
    }
    cf_id = str(settings.get("cf_access_client_id") or "").strip() or atlas_env("RANCHER_CF_ACCESS_CLIENT_ID")
    cf_secret = (
        str(settings.get("cf_access_client_secret") or "").strip()
        or atlas_env("RANCHER_CF_ACCESS_CLIENT_SECRET")
    )
    if cf_id and cf_secret:
        headers["CF-Access-Client-Id"] = cf_id
        headers["CF-Access-Client-Secret"] = cf_secret
    return headers


def _cloudflare_hint(body: str, status: int) -> str | None:
    if status not in (403, 503):
        return None
    low = body.lower()
    if "error 1010" in low or "browser_signature" in low or "cloudflare_error" in low:
        return (
            " Cloudflare bloqueó la petición del servidor Atlas (Error 1010). "
            "Usa la URL interna de Rancher sin proxy, permite la IP del RPi en WAF, "
            "o configura CF-Access-Client-Id/Secret si Rancher está detrás de Cloudflare Access."
        )
    return None


def _rancher_request(
    settings: dict[str, str | bool],
    path: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    timeout_s: float = RANCHER_HTTP_TIMEOUT_S,
) -> Any:
    url = str(settings.get("url") or "").strip()
    token = str(settings.get("token") or "").strip()
    insecure_tls = bool(settings.get("insecure_tls"))
    if not url or not token:
        raise RancherConfigError("Configura la URL y el token de Rancher (Atlas Rancher o variables ATLAS_RANCHER_*).")
    full = f"{url.rstrip('/')}/{path.lstrip('/')}"
    headers = _rancher_request_headers(settings)
    data: bytes | None = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(full, headers=headers, method=method, data=data)
    try:
        with urllib.request.urlopen(
            req, timeout=timeout_s, context=_ssl_context(insecure_tls)
        ) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:800]
        except OSError:
            pass
        hint = _cloudflare_hint(err_body, e.code) or ""
        raise RancherApiError(
            f"Rancher respondió HTTP {e.code} en {path}"
            + (f": {err_body}" if err_body else "")
            + hint,
            status=e.code,
        ) from e
    except urllib.error.URLError as e:
        raise RancherApiError(f"No se pudo conectar con Rancher: {e.reason}") from e
    except TimeoutError as e:
        raise RancherApiError(
            f"Timeout al consultar Rancher ({timeout_s}s en {path})."
        ) from e

    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as e:
        raise RancherApiError("La respuesta de Rancher no es JSON válido.") from e


def rancher_get(
    settings: dict[str, str | bool],
    path: str,
    *,
    timeout_s: float = RANCHER_HTTP_TIMEOUT_S,
) -> Any:
    return _rancher_request(settings, path, method="GET", timeout_s=timeout_s)


def rancher_put(
    settings: dict[str, str | bool],
    path: str,
    body: dict[str, Any],
    *,
    timeout_s: float = RANCHER_HTTP_TIMEOUT_S,
) -> Any:
    return _rancher_request(settings, path, method="PUT", body=body, timeout_s=timeout_s)


def _rancher_open_stream(
    settings: dict[str, str | bool],
    path: str,
    *,
    timeout_s: float,
) -> Any:
    """Abre respuesta HTTP cruda (p. ej. log follow=true)."""
    url = str(settings.get("url") or "").strip()
    token = str(settings.get("token") or "").strip()
    insecure_tls = bool(settings.get("insecure_tls"))
    if not url or not token:
        raise RancherConfigError("Configura la URL y el token de Rancher (Atlas Rancher o variables ATLAS_RANCHER_*).")
    full = f"{url.rstrip('/')}/{path.lstrip('/')}"
    headers = _rancher_request_headers(settings)
    headers["Accept"] = "text/plain, */*"
    req = urllib.request.Request(full, headers=headers, method="GET")
    try:
        return urllib.request.urlopen(
            req, timeout=timeout_s, context=_ssl_context(insecure_tls)
        )
    except urllib.error.HTTPError as e:
        err_body = ""
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:800]
        except OSError:
            pass
        hint = _cloudflare_hint(err_body, e.code) or ""
        raise RancherApiError(
            f"Rancher respondió HTTP {e.code} en {path}"
            + (f": {err_body}" if err_body else "")
            + hint,
            status=e.code,
        ) from e
    except urllib.error.URLError as e:
        raise RancherApiError(f"No se pudo conectar con Rancher: {e.reason}") from e
    except TimeoutError as e:
        raise RancherApiError(
            f"Timeout al consultar Rancher ({timeout_s}s en {path})."
        ) from e


def rancher_get_text(
    settings: dict[str, str | bool],
    path: str,
    *,
    timeout_s: float = RANCHER_POD_LOG_TIMEOUT_S,
) -> str:
    with _rancher_open_stream(settings, path, timeout_s=timeout_s) as resp:
        raw = resp.read()
    if not raw:
        return ""
    return raw.decode("utf-8", errors="replace")


def rancher_iter_text_stream(
    settings: dict[str, str | bool],
    path: str,
    *,
    timeout_s: float = RANCHER_POD_LOG_STREAM_TIMEOUT_S,
    chunk_size: int = 4096,
) -> Iterator[str]:
    resp = _rancher_open_stream(settings, path, timeout_s=timeout_s)
    try:
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            yield chunk.decode("utf-8", errors="replace")
    finally:
        resp.close()


def _steve_resource_path(collection: str, namespace: str, name: str) -> str:
    return f"v1/{collection}/{namespace}/{name}"


def _collection_from_list_source(source: str) -> str:
    if "customcluster" in source.lower():
        return STEVE_COLLECTION_CUSTOM
    return STEVE_COLLECTION_CLUSTER


def _collect_items(payload: Any) -> list[dict[str, Any]] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if payload.get("type") and payload.get("id"):
        return [payload]
    return []


def _resource_kind(item: dict[str, Any]) -> str:
    kind = str(item.get("kind") or "").strip()
    if kind:
        return kind
    rtype = str(item.get("type") or "").strip()
    if "." in rtype:
        return rtype.rsplit(".", 1)[-1]
    return rtype


def _is_custom_cluster_resource(item: dict[str, Any]) -> bool:
    kind = _resource_kind(item).lower()
    if kind in ("customcluster", "customclusters"):
        return True
    rtype = str(item.get("type") or "").lower()
    return "customcluster" in rtype


def _is_provisioning_custom_cluster(item: dict[str, Any]) -> bool:
    if _is_custom_cluster_resource(item):
        return True
    spec = item.get("spec")
    if not isinstance(spec, dict):
        return False
    if spec.get("cloudCredentialSecretName"):
        return False
    rke = spec.get("rkeConfig")
    if isinstance(rke, dict):
        pools = rke.get("machinePools")
        if isinstance(pools, list) and len(pools) > 0:
            return False
    imported = spec.get("importedConfig")
    if isinstance(imported, dict) and imported:
        return False
    return bool(spec.get("kubernetesVersion") or rke)


def _condition_state(item: dict[str, Any]) -> str:
    status = item.get("status")
    if not isinstance(status, dict):
        return "unknown"
    for key in ("summary", "displayState", "state"):
        v = status.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    conditions = status.get("conditions")
    if isinstance(conditions, list):
        for c in conditions:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "Ready" and c.get("status") == "True":
                return "ready"
            if c.get("type") == "Ready" and c.get("status") == "False":
                return str(c.get("reason") or c.get("message") or "not-ready")
    if status.get("ready") is True:
        return "ready"
    return "unknown"


def _normalize_cluster(item: dict[str, Any], *, steve_collection: str) -> dict[str, Any]:
    meta = _as_dict(item.get("metadata"))
    spec = _as_dict(item.get("spec"))
    status = _as_dict(item.get("status"))
    annotations = _as_dict(meta.get("annotations"))
    labels = _as_dict(meta.get("labels"))
    if not labels:
        labels = _as_dict(item.get("labels"))
    name = str(meta.get("name") or item.get("name") or item.get("id") or "")
    namespace = str(meta.get("namespace") or item.get("namespaceId") or "fleet-default")
    k8s = str(spec.get("kubernetesVersion") or "")
    display = (
        annotations.get("provisioning.cattle.io/management-cluster-display-name")
        or labels.get("app.kubernetes.io/name")
        or name
    )
    ready: bool | None = None
    if "ready" in status:
        ready = bool(status.get("ready"))

    def _label(key: str) -> str:
        v = labels.get(key)
        return str(v).strip() if v is not None else ""

    return {
        "id": str(item.get("id") or f"{namespace}/{name}"),
        "name": name,
        "namespace": namespace,
        "displayName": str(display),
        "state": _condition_state(item),
        "kubernetesVersion": k8s,
        "ready": ready,
        "kind": _resource_kind(item),
        "createdAt": meta.get("creationTimestamp"),
        "labels": {str(k): str(v) for k, v in labels.items() if v is not None},
        "application": normalize_application(_label("application")),
        "distro": normalize_distro(_label("distro")),
        "store": _label("store"),
        "atlas": _label("atlas"),
        "steveCollection": steve_collection,
        "managementClusterId": _management_cluster_id_from_item(item),
    }


def _management_cluster_id_from_item(item: dict[str, Any]) -> str:
    status = _as_dict(item.get("status"))
    for key in ("clusterName", "managementClusterName", "clusterId"):
        val = status.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    mgmt = status.get("managementCluster")
    if isinstance(mgmt, dict):
        for key in ("name", "id"):
            val = mgmt.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    meta = _as_dict(item.get("metadata"))
    labels = _as_dict(meta.get("labels"))
    for label_key in (
        "fleet.cattle.io/managed-cluster-name",
        "cluster-name",
        "management.cattle.io/cluster-name",
    ):
        val = labels.get(label_key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _find_management_cluster_id(
    settings: dict[str, str | bool],
    provisioning_resource: dict[str, Any],
    *,
    prov_name: str,
) -> str:
    found = _management_cluster_id_from_item(provisioning_resource)
    if found:
        return found
    prov_name_l = prov_name.strip().lower()
    if not prov_name_l:
        return ""
    try:
        payload = rancher_get(settings, "v1/management.cattle.io.clusters")
    except RancherApiError:
        return ""
    items = _collect_items(payload) or []
    for item in items:
        meta = _as_dict(item.get("metadata"))
        spec = _as_dict(item.get("spec"))
        candidates = [
            str(item.get("id") or ""),
            str(meta.get("name") or ""),
            str(spec.get("displayName") or ""),
            str(spec.get("internalClusterId") or ""),
        ]
        for cand in candidates:
            if cand.strip().lower() == prov_name_l:
                return str(item.get("id") or meta.get("name") or cand).strip()
    return ""


def _application_from_item(item: dict[str, Any]) -> str:
    meta = _as_dict(item.get("metadata"))
    labels = _as_dict(meta.get("labels"))
    if not labels:
        labels = _as_dict(item.get("labels"))

    def _label(key: str) -> str:
        v = labels.get(key)
        return str(v).strip() if v is not None else ""

    return normalize_application(_label("application"))


def _k8s_namespace_for_application(application: str) -> str:
    """En Verkku el namespace del cluster coincide con el label application (minúsculas)."""
    return normalize_application(application).lower()


def _pod_matches_application_namespace(pod_namespace: str, application: str) -> bool:
    app_ns = _k8s_namespace_for_application(application)
    if not app_ns:
        return False
    return str(pod_namespace or "").strip().lower() == app_ns


def _normalize_pod(item: dict[str, Any], *, application_namespace: str) -> dict[str, Any]:
    meta = _as_dict(item.get("metadata"))
    status = _as_dict(item.get("status"))
    spec = _as_dict(item.get("spec"))
    phase = str(status.get("phase") or "Unknown")
    container_statuses = status.get("containerStatuses")
    if not isinstance(container_statuses, list):
        container_statuses = []
    ready_count = 0
    restart_total = 0
    for cs in container_statuses:
        if not isinstance(cs, dict):
            continue
        if cs.get("ready"):
            ready_count += 1
        try:
            restart_total += int(cs.get("restartCount") or 0)
        except (TypeError, ValueError):
            pass
    containers = spec.get("containers")
    total_containers = len(containers) if isinstance(containers, list) else len(container_statuses)
    container_names: list[str] = []
    if isinstance(containers, list):
        for c in containers:
            if isinstance(c, dict) and c.get("name"):
                container_names.append(str(c["name"]))
    raw_ns = str(meta.get("namespace") or "").strip()
    return {
        "name": str(meta.get("name") or ""),
        "k8sNamespace": raw_ns,
        "namespace": application_namespace or raw_ns,
        "phase": phase,
        "node": str(spec.get("nodeName") or ""),
        "ready": f"{ready_count}/{total_containers}" if total_containers else "—",
        "restarts": restart_total,
        "podIP": str(status.get("podIP") or ""),
        "createdAt": meta.get("creationTimestamp"),
        "containers": container_names,
    }


def resolve_custom_cluster_context(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
) -> tuple[str, str, str]:
    """Devuelve (management_cluster_id, k8s_namespace, application)."""
    ns = namespace.strip()
    cluster_name = name.strip()
    if not ns or not cluster_name:
        raise RancherConfigError("Namespace y nombre del cluster son obligatorios.")

    collection = steve_collection.strip() or STEVE_COLLECTION_CUSTOM
    prov_path = _steve_resource_path(collection, ns, cluster_name)
    prov_resource = rancher_get(settings, prov_path)
    if not isinstance(prov_resource, dict):
        raise RancherApiError("Rancher no devolvió el custom cluster.")

    application = _application_from_item(prov_resource)
    if not application:
        raise RancherConfigError(
            "El cluster no tiene label application; Atlas usa application como namespace de pods."
        )
    app_ns = _k8s_namespace_for_application(application)

    mgmt_id = _find_management_cluster_id(settings, prov_resource, prov_name=cluster_name)
    if not mgmt_id:
        raise RancherConfigError(
            "No se pudo resolver el cluster de gestión Rancher (status.clusterName). "
            "Comprueba que el custom cluster esté provisionado y activo."
        )
    return mgmt_id, app_ns, application


def _deployment_path(mgmt_id: str, k8s_ns: str, deployment_name: str | None = None) -> str:
    base = f"k8s/clusters/{mgmt_id}/v1/apps.deployments"
    if deployment_name:
        return f"{base}/{k8s_ns}/{deployment_name}"
    return f"{base}/{k8s_ns}?pagesize=500"


def _images_from_container_list(containers: Any) -> list[str]:
    out: list[str] = []
    if not isinstance(containers, list):
        return out
    for c in containers:
        if isinstance(c, dict) and c.get("image"):
            img = str(c["image"]).strip()
            if img and img not in out:
                out.append(img)
    return out


def _collect_workload_images(spec: dict[str, Any]) -> list[str]:
    """Imágenes en Deployment/DaemonSet (spec.template.spec.containers)."""
    images: list[str] = []
    images.extend(_images_from_container_list(spec.get("containers")))
    template = _as_dict(spec.get("template"))
    pod_spec = _as_dict(template.get("spec"))
    for key in ("containers", "initContainers"):
        images.extend(_images_from_container_list(pod_spec.get(key)))
    # dedupe preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for img in images:
        if img not in seen:
            seen.add(img)
            unique.append(img)
    return unique


def _image_display_parts(image: str) -> tuple[str, str]:
    """(image completa, etiqueta corta para tabla)."""
    img = image.strip()
    if not img:
        return "", ""
    if "@" in img:
        digest = img.split("@", 1)[1]
        short = digest[:19] + ("…" if len(digest) > 19 else "")
        return img, f"@{short}"
    tail = img.rsplit("/", 1)[-1]
    if ":" in tail:
        return img, tail.split(":", 1)[1]
    return img, tail or img


def _deployment_name_from_pod(item: dict[str, Any]) -> str:
    meta = _as_dict(item.get("metadata"))
    for ref in meta.get("ownerReferences") or []:
        if not isinstance(ref, dict):
            continue
        kind = str(ref.get("kind") or "")
        name = str(ref.get("name") or "")
        if kind == "ReplicaSet" and name and "-" in name:
            return name.rsplit("-", 1)[0]
    pod_name = str(meta.get("name") or "")
    if "-" in pod_name:
        return pod_name.rsplit("-", 1)[0]
    return ""


def _pod_workload_image(item: dict[str, Any]) -> str:
    pod_spec = _as_dict(item.get("spec"))
    imgs = _images_from_container_list(pod_spec.get("containers"))
    return imgs[0] if imgs else ""


def _normalize_deployment(
    item: dict[str, Any],
    *,
    k8s_ns: str,
    image_override: str = "",
) -> dict[str, Any]:
    meta = _as_dict(item.get("metadata"))
    spec = _as_dict(item.get("spec"))
    status = _as_dict(item.get("status"))
    try:
        replicas = int(spec.get("replicas") if spec.get("replicas") is not None else 1)
    except (TypeError, ValueError):
        replicas = 1
    try:
        ready = int(status.get("readyReplicas") or 0)
    except (TypeError, ValueError):
        ready = 0
    try:
        available = int(status.get("availableReplicas") or 0)
    except (TypeError, ValueError):
        available = 0
    images = _collect_workload_images(spec)
    image = image_override.strip() or (images[0] if images else "")
    full, tag = _image_display_parts(image)
    return {
        "name": str(meta.get("name") or ""),
        "namespace": str(meta.get("namespace") or k8s_ns),
        "replicas": replicas,
        "readyReplicas": ready,
        "availableReplicas": available,
        "image": full,
        "imageTag": tag,
        "images": images,
        "createdAt": meta.get("creationTimestamp"),
    }


def _enrich_deployments_images_from_pods(
    deployments: list[dict[str, Any]],
    pod_items: list[dict[str, Any]],
) -> None:
    """Si el listado de deployments no trae spec.template, usar imagen del pod en ejecución."""
    by_name = {str(d.get("name") or ""): d for d in deployments if d.get("name")}
    for pod in pod_items:
        if not isinstance(pod, dict):
            continue
        dep_name = _deployment_name_from_pod(pod)
        if not dep_name or dep_name not in by_name:
            continue
        dep = by_name[dep_name]
        if dep.get("image"):
            continue
        img = _pod_workload_image(pod)
        if not img:
            continue
        full, tag = _image_display_parts(img)
        dep["image"] = full
        dep["imageTag"] = tag
        dep["images"] = [full]


def list_custom_cluster_deployments(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
) -> tuple[str, str, str, list[dict[str, Any]]]:
    mgmt_id, app_ns, application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    dep_path = _deployment_path(mgmt_id, app_ns)
    try:
        payload = rancher_get(settings, dep_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    except RancherApiError as e:
        if e.status != 404:
            raise
        dep_path = f"k8s/clusters/{mgmt_id}/v1/apps.deployments?pagesize=500"
        payload = rancher_get(settings, dep_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)

    items = _collect_items(payload) or []
    deployments: list[dict[str, Any]] = []
    for i in items:
        if not isinstance(i, dict):
            continue
        meta = _as_dict(i.get("metadata"))
        if not meta.get("name"):
            continue
        raw_ns = str(meta.get("namespace") or "").strip().lower()
        if raw_ns and raw_ns != app_ns:
            continue
        deployments.append(_normalize_deployment(i, k8s_ns=app_ns))
    if deployments and any(not d.get("image") for d in deployments):
        try:
            _, _, _, pod_items = _list_pod_items_for_cluster(settings, mgmt_id=mgmt_id, app_ns=app_ns)
            _enrich_deployments_images_from_pods(deployments, pod_items)
        except Exception as e:
            log.debug("deployment image enrich from pods failed: %s", e)
    deployments.sort(key=lambda d: (d.get("name") or ""))
    return dep_path, mgmt_id, application, deployments


def _list_pod_items_for_cluster(
    settings: dict[str, str | bool],
    *,
    mgmt_id: str,
    app_ns: str,
) -> tuple[str, str, str, list[dict[str, Any]]]:
    """Lista cruda de pods (items API) en el namespace de la aplicación."""
    pods_path = f"k8s/clusters/{mgmt_id}/v1/pods/{app_ns}?pagesize=500"
    try:
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    except RancherApiError as e:
        if e.status != 404:
            raise
        pods_path = f"k8s/clusters/{mgmt_id}/v1/pods?pagesize=500"
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    return pods_path, mgmt_id, app_ns, _collect_items(payload) or []


def _get_deployment_resource(
    settings: dict[str, str | bool],
    *,
    mgmt_id: str,
    k8s_ns: str,
    deployment_name: str,
) -> dict[str, Any]:
    path = _deployment_path(mgmt_id, k8s_ns, deployment_name)
    resource = rancher_get(settings, path)
    if not isinstance(resource, dict):
        raise RancherApiError(f"No se encontró el deployment {deployment_name}.")
    return resource


def _deployment_status_replicas(resource: dict[str, Any]) -> tuple[int, int, int]:
    spec = _as_dict(resource.get("spec"))
    status = _as_dict(resource.get("status"))
    try:
        desired = int(spec.get("replicas") if spec.get("replicas") is not None else 1)
    except (TypeError, ValueError):
        desired = 1
    try:
        ready = int(status.get("readyReplicas") or 0)
    except (TypeError, ValueError):
        ready = 0
    try:
        available = int(status.get("availableReplicas") or 0)
    except (TypeError, ValueError):
        available = 0
    return desired, ready, available


def set_deployment_replicas(
    settings: dict[str, str | bool],
    *,
    mgmt_id: str,
    k8s_ns: str,
    deployment_name: str,
    replicas: int,
) -> dict[str, Any]:
    if replicas < 0:
        raise ValueError("Las réplicas no pueden ser negativas.")
    resource = _get_deployment_resource(
        settings, mgmt_id=mgmt_id, k8s_ns=k8s_ns, deployment_name=deployment_name
    )
    spec = _as_dict(resource.get("spec"))
    spec["replicas"] = replicas
    resource["spec"] = spec
    path = _deployment_path(mgmt_id, k8s_ns, deployment_name)
    updated = rancher_put(settings, path, resource)
    if not isinstance(updated, dict):
        raise RancherApiError("Rancher no devolvió el deployment actualizado.")
    return _normalize_deployment(updated, k8s_ns=k8s_ns)


def _wait_deployment_replicas(
    settings: dict[str, str | bool],
    *,
    mgmt_id: str,
    k8s_ns: str,
    deployment_name: str,
    want_available: int,
    timeout_s: float = ROLLOUT_WAIT_TIMEOUT_S,
) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        resource = _get_deployment_resource(
            settings, mgmt_id=mgmt_id, k8s_ns=k8s_ns, deployment_name=deployment_name
        )
        _, _, available = _deployment_status_replicas(resource)
        if want_available == 0 and available == 0:
            return
        if want_available > 0 and available >= want_available:
            return
        time.sleep(ROLLOUT_POLL_INTERVAL_S)
    raise RancherApiError(
        f"Timeout esperando réplicas del deployment «{deployment_name}» "
        f"(objetivo disponibles: {want_available})."
    )


def rollout_deployment_image_pull(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    deployment_name: str,
) -> dict[str, Any]:
    """
    Escala a 0 y vuelve al número de réplicas original para forzar pull de imagen
  (patrón habitual con imagePullPolicy Always / IfNotPresent en edge).
    """
    dep_name = deployment_name.strip()
    if not dep_name:
        raise RancherConfigError("El nombre del deployment es obligatorio.")

    mgmt_id, app_ns, application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    resource = _get_deployment_resource(
        settings, mgmt_id=mgmt_id, k8s_ns=app_ns, deployment_name=dep_name
    )
    desired, _, _ = _deployment_status_replicas(resource)
    target = desired if desired > 0 else 1

    set_deployment_replicas(
        settings,
        mgmt_id=mgmt_id,
        k8s_ns=app_ns,
        deployment_name=dep_name,
        replicas=0,
    )
    try:
        _wait_deployment_replicas(
            settings,
            mgmt_id=mgmt_id,
            k8s_ns=app_ns,
            deployment_name=dep_name,
            want_available=0,
        )
    except RancherApiError:
        log.warning("rollout %s: timeout en escala a 0; continuando a %s", dep_name, target)

    final = set_deployment_replicas(
        settings,
        mgmt_id=mgmt_id,
        k8s_ns=app_ns,
        deployment_name=dep_name,
        replicas=target,
    )
    return {
        "deployment": final,
        "managementClusterId": mgmt_id,
        "namespace": app_ns,
        "application": application,
        "targetReplicas": target,
        "steps": ["scaled_to_0", f"scaled_to_{target}"],
    }


def list_custom_cluster_pods(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
) -> tuple[str, str, str, list[dict[str, Any]]]:
    mgmt_id, app_ns, application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )

    pods_path = f"k8s/clusters/{mgmt_id}/v1/pods/{app_ns}?pagesize=500"
    try:
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    except RancherApiError as e:
        if e.status != 404:
            raise
        pods_path = f"k8s/clusters/{mgmt_id}/v1/pods?pagesize=500"
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)

    items = _collect_items(payload) or []
    pods: list[dict[str, Any]] = []
    for i in items:
        if not isinstance(i, dict):
            continue
        meta = _as_dict(i.get("metadata"))
        if not meta.get("name"):
            continue
        raw_ns = str(meta.get("namespace") or "")
        if not _pod_matches_application_namespace(raw_ns, application):
            continue
        pods.append(_normalize_pod(i, application_namespace=application))
    pods.sort(key=lambda p: (p.get("name") or ""))
    return pods_path, mgmt_id, application, pods


def _pod_log_query_params(
    *,
    container: str = "",
    tail_lines: int = 500,
    since_seconds: int | None = None,
    follow: bool = False,
    previous: bool = False,
    timestamps: bool = True,
) -> str:
    params: list[str] = []
    if since_seconds is not None and since_seconds > 0:
        params.append(f"sinceSeconds={min(int(since_seconds), 604800)}")
    else:
        params.append(f"tailLines={max(1, min(tail_lines, 5000))}")
    if timestamps:
        params.append("timestamps=true")
    if follow:
        params.append("follow=true")
    if previous:
        params.append("previous=true")
    if container.strip():
        params.append(f"container={urllib.parse.quote(container.strip())}")
    return "&".join(params)


def build_pod_exec_ws_url(
    mgmt_id: str,
    k8s_ns: str,
    pod_name: str,
    *,
    container: str = "",
    commands: list[str] | None = None,
) -> str:
    """Ruta relativa (HTTP→WS) para exec en pod, protocolo base64.channel.k8s.io."""
    params: list[tuple[str, str]] = [
        ("stdout", "1"),
        ("stdin", "1"),
        ("stderr", "1"),
        ("tty", "1"),
    ]
    if container.strip():
        params.append(("container", container.strip()))
    for cmd in commands or ["/bin/sh"]:
        params.append(("command", cmd))
    base = f"k8s/clusters/{mgmt_id}/api/v1/namespaces/{k8s_ns}/pods/{pod_name}/exec"
    return f"{base}?{urllib.parse.urlencode(params)}"


def _pod_log_path_k8s_proxy(
    mgmt_id: str,
    k8s_ns: str,
    pod_name: str,
    **kwargs: Any,
) -> str:
    """Misma ruta que usa el visor de logs de Rancher (proxy api/v1 del cluster)."""
    base = (
        f"k8s/clusters/{mgmt_id}/api/v1/namespaces/{k8s_ns}/pods/{pod_name}/log"
    )
    return f"{base}?{_pod_log_query_params(**kwargs)}"


def _pod_log_path_steve_link(
    mgmt_id: str,
    k8s_ns: str,
    pod_name: str,
    **kwargs: Any,
) -> str:
    """Fallback Steve: subrecurso link=log sobre el pod."""
    base = f"k8s/clusters/{mgmt_id}/v1/pods/{k8s_ns}/{pod_name}"
    return f"{base}?link=log&{_pod_log_query_params(**kwargs)}"


def _rancher_log_looks_like_html(text: str) -> bool:
    head = (text or "")[:1200].lstrip().lower()
    if not head:
        return False
    if head.startswith("<!") or head.startswith("<html"):
        return True
    return "if you are reading this" in head and "application/json" in head


def _read_pod_log_text(
    settings: dict[str, str | bool],
    mgmt_id: str,
    k8s_ns: str,
    pod_name: str,
    **log_kw: Any,
) -> str:
    paths = (
        _pod_log_path_k8s_proxy(mgmt_id, k8s_ns, pod_name, **log_kw),
        _pod_log_path_steve_link(mgmt_id, k8s_ns, pod_name, **log_kw),
    )
    last_html = ""
    for path in paths:
        text = rancher_get_text(settings, path, timeout_s=RANCHER_POD_LOG_TIMEOUT_S)
        if not _rancher_log_looks_like_html(text):
            return text
        last_html = text
    raise RancherApiError(
        "Rancher devolvió la interfaz HTML del pod en lugar del log. "
        "Comprueba el namespace del pod y los permisos del token."
        + (f" Inicio de respuesta: {last_html[:200]!r}" if last_html else "")
    )


def _iter_pod_log_text_stream(
    settings: dict[str, str | bool],
    mgmt_id: str,
    k8s_ns: str,
    pod_name: str,
    **log_kw: Any,
) -> Iterator[str]:
    paths = (
        _pod_log_path_k8s_proxy(mgmt_id, k8s_ns, pod_name, **log_kw),
        _pod_log_path_steve_link(mgmt_id, k8s_ns, pod_name, **log_kw),
    )
    for path in paths:
        resp = _rancher_open_stream(
            settings, path, timeout_s=RANCHER_POD_LOG_STREAM_TIMEOUT_S
        )
        try:
            head = resp.read(1200)
            if head and _rancher_log_looks_like_html(
                head.decode("utf-8", errors="replace")
            ):
                continue
            if head:
                yield head.decode("utf-8", errors="replace")
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                yield chunk.decode("utf-8", errors="replace")
            return
        finally:
            resp.close()
    raise RancherApiError(
        "No se pudo abrir el stream de logs del pod (Rancher devolvió HTML o error HTTP)."
    )


def fetch_pod_logs(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    pod_name: str,
    pod_k8s_namespace: str = "",
    container: str = "",
    tail_lines: int = 500,
    since_seconds: int | None = None,
    previous: bool = False,
    timestamps: bool = True,
) -> dict[str, Any]:
    """Últimas líneas del log de un pod (vía API Steve de Rancher)."""
    pod_key = pod_name.strip()
    if not pod_key:
        raise RancherConfigError("El nombre del pod es obligatorio.")
    mgmt_id, app_ns, application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    k8s_ns = (pod_k8s_namespace or app_ns).strip() or app_ns
    text = _read_pod_log_text(
        settings,
        mgmt_id,
        k8s_ns,
        pod_key,
        container=container,
        tail_lines=tail_lines,
        since_seconds=since_seconds,
        follow=False,
        previous=previous,
        timestamps=timestamps,
    )
    return {
        "managementClusterId": mgmt_id,
        "application": application,
        "podNamespace": k8s_ns,
        "pod": pod_key,
        "container": container.strip() or None,
        "logs": text,
    }


def iter_pod_log_stream(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    pod_name: str,
    pod_k8s_namespace: str = "",
    container: str = "",
    tail_lines: int = 200,
    since_seconds: int | None = None,
    previous: bool = False,
    timestamps: bool = True,
) -> Iterator[str]:
    """Stream de log en vivo (follow=true)."""
    pod_key = pod_name.strip()
    if not pod_key:
        raise RancherConfigError("El nombre del pod es obligatorio.")
    mgmt_id, app_ns, _application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    k8s_ns = (pod_k8s_namespace or app_ns).strip() or app_ns
    yield from _iter_pod_log_text_stream(
        settings,
        mgmt_id,
        k8s_ns,
        pod_key,
        container=container,
        tail_lines=tail_lines,
        since_seconds=since_seconds,
        follow=True,
        previous=previous,
        timestamps=timestamps,
    )


def _count_pods_in_management_cluster(
    settings: dict[str, str | bool],
    *,
    mgmt_id: str,
    application: str,
) -> int:
    app_ns = _k8s_namespace_for_application(application)
    pods_path = f"k8s/clusters/{mgmt_id}/v1/pods/{app_ns}?pagesize=500"
    try:
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    except RancherApiError as e:
        if e.status != 404:
            raise
        pods_path = f"k8s/clusters/{mgmt_id}/v1/pods?pagesize=500"
        payload = rancher_get(settings, pods_path, timeout_s=RANCHER_POD_COUNT_TIMEOUT_S)
    items = _collect_items(payload) or []
    count = 0
    for i in items:
        if not isinstance(i, dict):
            continue
        meta = _as_dict(i.get("metadata"))
        if not meta.get("name"):
            continue
        raw_ns = str(meta.get("namespace") or "")
        if _pod_matches_application_namespace(raw_ns, application):
            count += 1
    return count


def count_custom_cluster_pods(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    cluster: dict[str, Any] | None = None,
) -> int | None:
    """Cuenta pods en el namespace del label application. None si no aplica o falla."""
    application = normalize_application(
        str((cluster or {}).get("application") or "")
    )
    if not application and cluster is None:
        application = ""
    if not application:
        return None

    mgmt_id = str((cluster or {}).get("managementClusterId") or "").strip()
    if mgmt_id:
        try:
            return _count_pods_in_management_cluster(
                settings, mgmt_id=mgmt_id, application=application
            )
        except Exception as e:
            log.debug(
                "pod count (mgmt) failed %s/%s: %s",
                namespace,
                name,
                e,
            )

    try:
        _, _, _, pods = list_custom_cluster_pods(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=steve_collection,
        )
        return len(pods)
    except Exception as e:
        log.debug("pod count failed %s/%s: %s", namespace, name, e)
        return None


def list_pod_counts_for_clusters(
    settings: dict[str, str | bool],
    clusters: list[dict[str, Any]],
) -> dict[str, int | None]:
    """Cuenta pods por cluster en paralelo; nunca lanza al llamador."""

    def _count_one(item: dict[str, Any]) -> tuple[str, int | None]:
        cid = str(item.get("id") or "")
        application = str(item.get("application") or "").strip()
        if not application:
            return cid, None
        steve = str(item.get("steveCollection") or STEVE_COLLECTION_CUSTOM)
        n = count_custom_cluster_pods(
            settings,
            namespace=str(item.get("namespace") or ""),
            name=str(item.get("name") or ""),
            steve_collection=steve,
            cluster=item,
        )
        return cid, n

    counts: dict[str, int | None] = {}
    if not clusters:
        return counts

    workers = min(POD_COUNT_MAX_WORKERS, len(clusters))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_count_one, c) for c in clusters]
        for fut in as_completed(futures):
            try:
                cid, n = fut.result()
                if cid:
                    counts[cid] = n
            except Exception as e:
                log.debug("pod count worker failed: %s", e)
    return counts


def enrich_clusters_with_pod_counts(
    settings: dict[str, str | bool],
    clusters: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    counts = list_pod_counts_for_clusters(settings, clusters)
    for cluster in clusters:
        cid = str(cluster.get("id") or "")
        cluster["podCount"] = counts.get(cid)
    return clusters


def _is_connection_error(err: RancherApiError) -> bool:
    if err.status is not None:
        return False
    msg = str(err).lower()
    return "conectar" in msg or "timed out" in msg or "timeout" in msg


def list_custom_clusters(settings: dict[str, str | bool]) -> tuple[str, list[dict[str, Any]]]:
    url = str(settings.get("url") or "")

    for path in STEVE_CUSTOM_CLUSTER_PATHS:
        try:
            payload = rancher_get(settings, path)
        except RancherApiError as e:
            if e.status == 404:
                continue
            if _is_connection_error(e):
                raise
            raise
        items = _collect_items(payload)
        if items is not None:
            coll = _collection_from_list_source(path)
            normalized = [_normalize_cluster(i, steve_collection=coll) for i in items if _is_custom_cluster_resource(i)]
            return path, normalized

    try:
        payload = rancher_get(settings, STEVE_PROVISIONING_CLUSTERS)
    except RancherApiError as e:
        if _is_connection_error(e):
            raise RancherApiError(
                f"No se pudo alcanzar Rancher en {url}. "
                "Comprueba URL, token, TLS (insecure) y que el servidor Atlas pueda salir a esa red."
            ) from e
        raise
    items = _collect_items(payload) or []
    filtered = [i for i in items if _is_provisioning_custom_cluster(i)]
    coll = STEVE_COLLECTION_CLUSTER
    return (
        f"{STEVE_PROVISIONING_CLUSTERS}?filter=custom",
        [_normalize_cluster(i, steve_collection=coll) for i in filtered],
    )


def update_custom_cluster_labels(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    store: str = "",
    application: str = "",
    distro: str = "",
    atlas: str = "",
) -> dict[str, Any]:
    """Actualiza metadata.labels permitidos vía PUT al recurso Steve."""
    ns = namespace.strip()
    cluster_name = name.strip()
    if not ns or not cluster_name:
        raise RancherConfigError("Namespace y nombre del cluster son obligatorios.")
    collection = steve_collection.strip() or STEVE_COLLECTION_CUSTOM
    if collection not in (STEVE_COLLECTION_CUSTOM, STEVE_COLLECTION_CLUSTER):
        raise RancherConfigError("Colección Steve no válida para este cluster.")

    new_labels = prepare_label_values(store, application, distro, atlas)
    path = _steve_resource_path(collection, ns, cluster_name)
    resource = rancher_get(settings, path)
    if not isinstance(resource, dict):
        raise RancherApiError("Rancher no devolvió el recurso del cluster.")

    meta = _as_dict(resource.get("metadata"))
    labels = dict(_as_dict(meta.get("labels")))
    for key in ALLOWED_LABEL_KEYS:
        if key in new_labels:
            labels[key] = new_labels[key]
        elif key in labels:
            del labels[key]
    meta["labels"] = labels
    resource["metadata"] = meta

    updated = rancher_put(settings, path, resource)
    if not isinstance(updated, dict):
        raise RancherApiError("Rancher no devolvió el cluster actualizado.")
    return _normalize_cluster(updated, steve_collection=collection)
