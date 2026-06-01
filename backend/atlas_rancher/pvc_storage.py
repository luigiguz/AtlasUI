"""PVC/PV en clusters Rancher y resolución de ruta local en el nodo."""

from __future__ import annotations

import re
import sys
from typing import Any

from atlas_core.paths import SCRIPTS_DIR
from atlas_rancher.client import (
    RancherApiError,
    rancher_get,
    resolve_custom_cluster_context,
)

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import tunnel_manager as tm  # noqa: E402


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _pvc_list_path(mgmt_id: str, k8s_ns: str) -> str:
    return f"k8s/clusters/{mgmt_id}/v1/persistentvolumeclaims/{k8s_ns}?pagesize=500"


def _pv_path(mgmt_id: str, pv_name: str) -> str:
    return f"k8s/clusters/{mgmt_id}/v1/persistentvolumes/{pv_name}"


def _pv_host_path(pv: dict[str, Any]) -> str | None:
    spec = _as_dict(pv.get("spec"))
    local = _as_dict(spec.get("local"))
    path = str(local.get("path") or "").strip()
    if path:
        return path
    host = _as_dict(spec.get("hostPath"))
    path = str(host.get("path") or "").strip()
    if path:
        return path
    csi = _as_dict(spec.get("csi"))
    handle = str(csi.get("volumeHandle") or "").strip()
    if handle.startswith("/"):
        return handle
    return None


def _normalize_pvc(item: dict[str, Any], *, host_path: str | None, pv_name: str | None) -> dict[str, Any]:
    meta = _as_dict(item.get("metadata"))
    spec = _as_dict(item.get("spec"))
    status = _as_dict(item.get("status"))
    capacity = _as_dict(status.get("capacity"))
    storage = str(capacity.get("storage") or "").strip()
    return {
        "name": str(meta.get("name") or ""),
        "namespace": str(meta.get("namespace") or ""),
        "storageClassName": str(spec.get("storageClassName") or ""),
        "volumeName": str(spec.get("volumeName") or pv_name or ""),
        "phase": str(status.get("phase") or ""),
        "capacity": storage,
        "accessModes": [str(x) for x in (spec.get("accessModes") or []) if x],
        "hostPath": host_path,
        "createdAt": meta.get("creationTimestamp"),
    }


def _normalize_site_slug(value: str) -> str:
    """Clave comparable: minúsculas sin guiones, espacios ni puntos (texaco-javito ≈ texacojavito)."""
    return re.sub(r"[-_\s.]+", "", (value or "").strip().lower())


def resolve_cluster_vpn_site(
    cluster_name: str,
    *,
    store_label: str = "",
) -> tuple[str | None, str | None]:
    """Empareja nombre del cluster Rancher ↔ clave en tunnels.json (p. ej. texaco-javito)."""
    primary = (cluster_name or "").strip()
    if not primary:
        return None, "Falta el nombre del cluster."

    candidates: list[str] = [primary]
    fallback = (store_label or "").strip()
    if fallback and _normalize_site_slug(fallback) != _normalize_site_slug(primary):
        if fallback.lower() != primary.lower():
            candidates.append(fallback)

    cfg = tm.load_config_optional(tm.default_config_path())
    if not cfg:
        return None, "No hay tunnels.json en el servidor Atlas. Configura VPN desde Conexiones."

    sites = cfg.get("sites") or {}
    if not isinstance(sites, dict):
        return None, "tunnels.json no tiene sección sites válida."

    def _site_has_ssh(key: str) -> bool:
        entry = sites.get(key)
        if not isinstance(entry, dict):
            return False
        ssh = entry.get("ssh")
        return isinstance(ssh, dict) and ssh.get("local_port") not in (None, "")

    def _tunnel_label(entry: dict[str, Any]) -> str:
        return str(entry.get("tunnel_name") or "").strip()

    def _find_site_by_tunnel_name(candidate: str) -> list[str]:
        lower_c = candidate.lower()
        norm_c = _normalize_site_slug(candidate)
        matches: list[str] = []
        for key, entry in sites.items():
            if not isinstance(entry, dict):
                continue
            tn = _tunnel_label(entry)
            if not tn:
                continue
            if (
                tn == candidate
                or tn.lower() == lower_c
                or _normalize_site_slug(tn) == norm_c
            ):
                matches.append(str(key))
        return matches

    site_keys = [str(k) for k in sites.keys()]

    for candidate in candidates:
        tunnel_matches = _find_site_by_tunnel_name(candidate)
        if len(tunnel_matches) == 1:
            key = tunnel_matches[0]
            if _site_has_ssh(key):
                return key, None
            entry = sites.get(key) or {}
            tn = _tunnel_label(entry) if isinstance(entry, dict) else candidate
            return None, f"El túnel «{tn}» existe pero no tiene SSH activo en Atlas. Actívalo en Conexiones."
        if len(tunnel_matches) > 1:
            joined = ", ".join(f"«{k}»" for k in tunnel_matches)
            return (
                None,
                f"Varios sitios comparten el nombre de túnel «{candidate}» ({joined}).",
            )

        if candidate in sites:
            if _site_has_ssh(candidate):
                return candidate, None
            return None, f"El sitio «{candidate}» existe pero no tiene túnel SSH. Actívalo en Conexiones."

        lower = candidate.lower()
        for key in site_keys:
            if key.lower() == lower:
                if _site_has_ssh(key):
                    return key, None
                return None, f"El sitio «{key}» existe pero no tiene túnel SSH. Actívalo en Conexiones."

        norm = _normalize_site_slug(candidate)
        if not norm:
            continue
        slug_matches = [key for key in site_keys if _normalize_site_slug(key) == norm]
        if len(slug_matches) == 1:
            key = slug_matches[0]
            if _site_has_ssh(key):
                return key, None
            return None, f"El sitio «{key}» existe pero no tiene túnel SSH. Actívalo en Conexiones."
        if len(slug_matches) > 1:
            joined = ", ".join(f"«{k}»" for k in slug_matches)
            return (
                None,
                f"Varios sitios VPN coinciden con «{candidate}» ({joined}). "
                "Usa un nombre de cluster único o alinea tunnels.json.",
            )

    return (
        None,
        f"No hay sitio VPN para el cluster/túnel «{primary}» en tunnels.json. "
        "El nombre del cluster debe coincidir con el túnel Zero Trust o el sitio en Conexiones. "
        "Activa el túnel SSH de ese sitio.",
    )


def list_cluster_persistent_volume_claims(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    store_label: str = "",
) -> tuple[str, str, str, list[dict[str, Any]], dict[str, Any]]:
    """Devuelve (source, mgmt_id, k8s_ns, pvcs, ssh_info)."""
    cluster_name = name.strip()
    mgmt_id, k8s_ns, application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    list_path = _pvc_list_path(mgmt_id, k8s_ns)
    payload = rancher_get(settings, list_path)
    items: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]
        elif payload.get("type") and payload.get("metadata"):
            items = [payload]

    pv_cache: dict[str, str | None] = {}
    out: list[dict[str, Any]] = []
    for item in items:
        meta = _as_dict(item.get("metadata"))
        spec = _as_dict(item.get("spec"))
        pv_name = str(spec.get("volumeName") or meta.get("name") or "").strip()
        host_path: str | None = None
        if pv_name:
            if pv_name not in pv_cache:
                try:
                    pv = rancher_get(settings, _pv_path(mgmt_id, pv_name))
                    pv_cache[pv_name] = _pv_host_path(pv) if isinstance(pv, dict) else None
                except RancherApiError:
                    pv_cache[pv_name] = None
            host_path = pv_cache[pv_name]
        out.append(_normalize_pvc(item, host_path=host_path, pv_name=pv_name or None))

    out.sort(key=lambda x: x.get("name") or "")
    site_key, ssh_err = resolve_cluster_vpn_site(
        cluster_name,
        store_label=(store_label or "").strip(),
    )
    tunnel_name: str | None = None
    if site_key:
        entry = (tm.load_config_optional(tm.default_config_path()) or {}).get("sites") or {}
        row = entry.get(site_key) if isinstance(entry, dict) else None
        if isinstance(row, dict):
            tunnel_name = str(row.get("tunnel_name") or "").strip() or None
    ssh_info = {
        "clusterName": cluster_name,
        "store": (store_label or "").strip(),
        "tunnelName": tunnel_name,
        "site": site_key,
        "available": bool(site_key),
        "message": ssh_err,
    }
    return list_path, mgmt_id, k8s_ns, out, ssh_info


def resolve_pvc_host_path(
    settings: dict[str, str | bool],
    *,
    namespace: str,
    name: str,
    steve_collection: str,
    store_label: str,
    pvc_name: str,
) -> str | None:
    """Ruta en el nodo del PVC (solo servidor; no exponer al cliente)."""
    target = pvc_name.strip()
    if not target:
        return None
    mgmt_id, k8s_ns, _application = resolve_custom_cluster_context(
        settings,
        namespace=namespace,
        name=name,
        steve_collection=steve_collection,
    )
    payload = rancher_get(settings, _pvc_list_path(mgmt_id, k8s_ns))
    items: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            items = [x for x in data if isinstance(x, dict)]
        elif payload.get("type") and payload.get("metadata"):
            items = [payload]

    pv_name: str | None = None
    for item in items:
        meta = _as_dict(item.get("metadata"))
        if str(meta.get("name") or "").strip() != target:
            continue
        spec = _as_dict(item.get("spec"))
        pv_name = str(spec.get("volumeName") or "").strip() or None
        break
    if not pv_name:
        return None
    try:
        pv = rancher_get(settings, _pv_path(mgmt_id, pv_name))
    except RancherApiError:
        return None
    return _pv_host_path(pv) if isinstance(pv, dict) else None
