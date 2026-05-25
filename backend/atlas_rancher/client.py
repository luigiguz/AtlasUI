"""Cliente HTTP para la API Steve / Rancher."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any

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
    return {
        "name": str(meta.get("name") or ""),
        "namespace": application_namespace or str(meta.get("namespace") or ""),
        "phase": phase,
        "node": str(spec.get("nodeName") or ""),
        "ready": f"{ready_count}/{total_containers}" if total_containers else "—",
        "restarts": restart_total,
        "podIP": str(status.get("podIP") or ""),
        "createdAt": meta.get("creationTimestamp"),
    }


def list_custom_cluster_pods(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
) -> tuple[str, str, str, list[dict[str, Any]]]:
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

    pods_path = f"k8s/clusters/{mgmt_id}/v1/pods/{app_ns}?pagesize=500"
    try:
        payload = rancher_get(settings, pods_path)
    except RancherApiError as e:
        if e.status != 404:
            raise
        pods_path = f"k8s/clusters/{mgmt_id}/v1/pods?pagesize=500"
        payload = rancher_get(settings, pods_path)

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


def count_custom_cluster_pods(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
) -> int | None:
    """Cuenta pods en el namespace del label application. None si no aplica o falla."""
    try:
        _, _, _, pods = list_custom_cluster_pods(
            settings,
            namespace=namespace,
            name=name,
            steve_collection=steve_collection,
        )
        return len(pods)
    except RancherConfigError:
        return None
    except RancherApiError:
        return None


def enrich_clusters_with_pod_counts(
    settings: dict[str, str | bool],
    clusters: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    for cluster in clusters:
        application = str(cluster.get("application") or "").strip()
        if not application:
            cluster["podCount"] = None
            continue
        steve = str(cluster.get("steveCollection") or STEVE_COLLECTION_CUSTOM)
        cluster["podCount"] = count_custom_cluster_pods(
            settings,
            namespace=str(cluster.get("namespace") or ""),
            name=str(cluster.get("name") or ""),
            steve_collection=steve,
        )
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
