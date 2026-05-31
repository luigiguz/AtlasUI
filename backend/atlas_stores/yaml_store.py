"""Lectura y escritura de tiendas PosLite (fleet.yaml en atlas-stores)."""

from __future__ import annotations

import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

from atlas_stores.templates import create_template_sources, new_store_files_from_repo

STACK_DB = "db"
STACK_HORUSTECH = "horustech"
STACK_PAM = "pam"
STATION_STACKS = (STACK_HORUSTECH, STACK_PAM)


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data if isinstance(data, dict) else {}


def _dump_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.dump(
            data,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )


def _first_customization(doc: dict[str, Any]) -> dict[str, Any]:
    items = doc.get("targetCustomizations")
    if isinstance(items, list) and items and isinstance(items[0], dict):
        return items[0]
    return {}


def _match_labels(doc: dict[str, Any]) -> dict[str, str]:
    cust = _first_customization(doc)
    sel = cust.get("clusterSelector")
    if isinstance(sel, dict):
        ml = sel.get("matchLabels")
        if isinstance(ml, dict):
            return {str(k): str(v) for k, v in ml.items() if v is not None}
    return {}


def _helm_block(doc: dict[str, Any]) -> dict[str, Any]:
    cust = _first_customization(doc)
    helm = cust.get("helm")
    return helm if isinstance(helm, dict) else {}


def _values_block(doc: dict[str, Any]) -> dict[str, Any]:
    helm = _helm_block(doc)
    values = helm.get("values")
    return values if isinstance(values, dict) else {}


def _collect_image_tags(values: dict[str, Any]) -> set[str]:
    found: set[str] = set()

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            if "image" in obj and isinstance(obj["image"], dict):
                t = obj["image"].get("tag")
                if isinstance(t, str) and t.strip():
                    found.add(t.strip())
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)

    walk(values)
    return found


def _image_channel_summary(values: dict[str, Any]) -> str:
    """Resumen para la tabla: un tag si todos coinciden, «varios» si hay mezcla."""
    tags = _collect_image_tags(values)
    if not tags:
        return ""
    if len(tags) == 1:
        return next(iter(tags))
    return "varios"


def _parse_stack(stack_key: str, doc: dict[str, Any]) -> dict[str, Any]:
    helm = _helm_block(doc)
    values = _values_block(doc)
    chart = str(helm.get("chart") or "")
    return {
        "stack": stack_key,
        "bundleName": str(_first_customization(doc).get("name") or stack_key),
        "chart": chart.split("/")[-1] if chart else "",
        "chartVersion": str(helm.get("version") or ""),
        "bundleVersion": str(values.get("bundleVersion") or ""),
        "namespace": str(doc.get("defaultNamespace") or "poslite"),
        "matchLabels": _match_labels(doc),
        "values": values,
        "raw": doc,
    }


def stores_poslite_dir(repo_root: Path) -> Path:
    return repo_root / "stores" / "poslite"


def list_stores(repo_root: Path) -> list[dict[str, Any]]:
    base = stores_poslite_dir(repo_root)
    if not base.is_dir():
        return []

    out: list[dict[str, Any]] = []
    for folder in sorted(base.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        try:
            detail = load_store(repo_root, folder.name)
            out.append(
                {
                    "id": detail["id"],
                    "folderName": detail["folderName"],
                    "application": detail["application"],
                    "distro": detail["distro"],
                    "stacks": detail["stacks"],
                    "chartVersions": detail.get("chartVersions") or {},
                    "imageChannel": detail.get("imageChannel") or "",
                    "namespace": detail.get("namespace") or "poslite",
                }
            )
        except Exception:
            continue
    return out


def load_store(repo_root: Path, folder_name: str) -> dict[str, Any]:
    folder = stores_poslite_dir(repo_root) / folder_name.strip()
    if not folder.is_dir():
        raise FileNotFoundError(f"No existe la tienda: {folder_name}")

    stacks_data: dict[str, dict[str, Any]] = {}
    stack_names: list[str] = []

    for stack_key, sub in (
        (STACK_DB, STACK_DB),
        (STACK_HORUSTECH, STACK_HORUSTECH),
        (STACK_PAM, STACK_PAM),
    ):
        path = folder / sub / "fleet.yaml"
        if path.is_file():
            doc = _load_yaml(path)
            stacks_data[stack_key] = _parse_stack(stack_key, doc)
            stack_names.append(stack_key)

    store_id = folder_name
    application = "poslite"
    distro = ""
    namespace = "poslite"
    labels: dict[str, str] = {"atlas": "true"}

    for st in stacks_data.values():
        ml = st.get("matchLabels") or {}
        if ml.get("store"):
            store_id = str(ml["store"])
        if ml.get("application"):
            application = str(ml["application"])
        if ml.get("distro"):
            distro = str(ml["distro"])
        if st.get("namespace"):
            namespace = str(st["namespace"])
        labels.update({str(k): str(v) for k, v in ml.items()})

    chart_versions = {
        k: str(v.get("chartVersion") or "")
        for k, v in stacks_data.items()
        if v.get("chartVersion")
    }

    station = stacks_data.get(STACK_HORUSTECH) or stacks_data.get(STACK_PAM)
    image_channel = _image_channel_summary(station.get("values") or {}) if station else ""

    services_summary = _summarize_services(station.get("values") if station else {})
    workers_summary = _summarize_workers(station.get("values") if station else {})

    db_stack = stacks_data.get(STACK_DB)
    db_summary = _summarize_db(db_stack.get("values") if db_stack else {})

    return {
        "id": store_id,
        "folderName": folder_name,
        "application": application,
        "distro": distro,
        "namespace": namespace,
        "stacks": stack_names,
        "chartVersions": chart_versions,
        "imageChannel": image_channel,
        "clusterLabels": labels,
        "db": db_summary,
        "station": {
            "stack": station.get("stack") if station else "",
            "config": (station.get("values") or {}).get("config") if station else {},
            "pullPolicy": _derive_station_pull_policy(station.get("values") or {}) if station else "IfNotPresent",
            "services": services_summary,
            "workerGroups": workers_summary,
            "workers": _flatten_worker_groups(workers_summary),
            "values": station.get("values") if station else {},
        },
        "stacksData": {k: {"chartVersion": v.get("chartVersion"), "bundleVersion": v.get("bundleVersion")} for k, v in stacks_data.items()},
        "_paths": {k: str(folder / k / "fleet.yaml") for k in stacks_data},
        "_rawStacks": {k: v.get("raw") for k, v in stacks_data.items()},
    }


def _summarize_db(values: dict[str, Any]) -> dict[str, Any]:
    pg = values.get("postgresql") if isinstance(values.get("postgresql"), dict) else {}
    pers = values.get("persistence") if isinstance(values.get("persistence"), dict) else {}
    pga = values.get("pgadmin") if isinstance(values.get("pgadmin"), dict) else {}
    return {
        "timezone": str(pg.get("timezone") or ""),
        "database": str(pg.get("database") or ""),
        "persistenceEnabled": bool(pers.get("enabled", True)),
        "storageClass": str(pers.get("storageClass") or "local-path"),
        "size": str(pers.get("size") or ""),
        "pgadminEnabled": bool(pga.get("enabled", False)),
    }


def _derive_station_pull_policy(values: dict[str, Any]) -> str:
    """Política global: común a todos los servicios o IfNotPresent si difieren."""
    skip = {"config", "workers", "nameOverride", "bundleVersion"}
    policies: set[str] = set()
    for key, val in values.items():
        if key in skip or not isinstance(val, dict):
            continue
        if "enabled" not in val and "image" not in val and "hostPort" not in val:
            continue
        img = val.get("image") if isinstance(val.get("image"), dict) else {}
        policies.add(_normalize_pull_policy(img.get("pullPolicy")))
    if not policies:
        return "IfNotPresent"
    if len(policies) == 1:
        return next(iter(policies))
    return "IfNotPresent"


def _apply_pull_policy_to_all_services(values: dict[str, Any], policy: str) -> None:
    """Aplica pullPolicy a todos los servicios de estación en values."""
    normalized = _normalize_pull_policy(policy)
    skip = {"config", "workers", "nameOverride", "bundleVersion"}
    for key, val in values.items():
        if key in skip or not isinstance(val, dict):
            continue
        if "enabled" not in val and "image" not in val and "hostPort" not in val:
            continue
        if "image" not in val or not isinstance(val["image"], dict):
            val["image"] = {}
        val["image"]["pullPolicy"] = normalized


def _summarize_services(values: dict[str, Any]) -> list[dict[str, Any]]:
    skip = {"config", "workers", "nameOverride", "bundleVersion"}
    out: list[dict[str, Any]] = []
    for key, val in values.items():
        if key in skip or not isinstance(val, dict):
            continue
        if "enabled" not in val and "image" not in val and "hostPort" not in val:
            continue
        img = val.get("image") if isinstance(val.get("image"), dict) else {}
        out.append(
            {
                "key": key,
                "enabled": bool(val.get("enabled", False)),
                "tag": str(img.get("tag") or ""),
                "hostPort": val.get("hostPort"),
            }
        )
    out.sort(key=lambda x: x["key"])
    return out


def _normalize_pull_policy(raw: Any) -> str:
    s = str(raw or "IfNotPresent").strip()
    low = s.lower().replace("_", "").replace("-", "")
    if low == "always":
        return "Always"
    if low == "never":
        return "Never"
    return "IfNotPresent"


def _is_worker_group(node: dict[str, Any]) -> bool:
    """Nodo contenedor (p. ej. workers.ierp) con sub-procesos, no un worker hoja."""
    child_worker = False
    for key, val in node.items():
        if key in (
            "enabled",
            "image",
            "replicas",
            "cronExpression",
            "resources",
            "persistence",
            "port",
            "hostPort",
        ):
            continue
        if isinstance(val, dict) and ("enabled" in val or "image" in val):
            child_worker = True
            break
    return child_worker


def _worker_toggle(path: str, val: dict[str, Any]) -> dict[str, Any]:
    img = val.get("image") if isinstance(val.get("image"), dict) else {}
    return {
        "key": path,
        "enabled": bool(val.get("enabled", False)),
        "tag": str(img.get("tag") or ""),
    }


def _summarize_workers(values: dict[str, Any]) -> dict[str, Any]:
    workers = values.get("workers")
    if not isinstance(workers, dict):
        return {"groups": []}

    general: list[dict[str, Any]] = []
    ierp_items: list[dict[str, Any]] = []

    def bucket(path: str, item: dict[str, Any]) -> None:
        if path == "ierp" or path.startswith("ierp."):
            ierp_items.append(item)
        else:
            general.append(item)

    def walk(prefix: str, node: dict[str, Any]) -> None:
        for key, val in node.items():
            if not isinstance(val, dict):
                continue
            path = f"{prefix}.{key}" if prefix else key
            if _is_worker_group(val):
                walk(path, val)
            elif "enabled" in val:
                bucket(path, _worker_toggle(path, val))
            else:
                walk(path, val)

    walk("", workers)

    groups: list[dict[str, Any]] = []
    if general:
        general.sort(key=lambda x: x["key"])
        groups.append({"id": "general", "label": "Procesos generales", "workers": general})
    if ierp_items:
        ierp_items.sort(key=lambda x: x["key"])
        groups.append({"id": "ierp", "label": "iERP", "workers": ierp_items})

    return {"groups": groups}


def _flatten_worker_groups(worker_groups: dict[str, Any] | list[Any] | None) -> list[dict[str, Any]]:
    """Acepta groups del API o lista plana legacy."""
    if isinstance(worker_groups, list):
        return worker_groups
    if not isinstance(worker_groups, dict):
        return []
    groups = worker_groups.get("groups")
    if not isinstance(groups, list):
        return []
    flat: list[dict[str, Any]] = []
    for group in groups:
        if isinstance(group, dict):
            items = group.get("workers")
            if isinstance(items, list):
                flat.extend(i for i in items if isinstance(i, dict))
    return flat


def save_store(
    repo_root: Path,
    folder_name: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    current = load_store(repo_root, folder_name)
    folder = stores_poslite_dir(repo_root) / folder_name

    store_id = str(patch.get("id") or current["id"]).strip()
    distro = str(patch.get("distro") or current["distro"]).strip().lower()
    image_channel = str(patch.get("imageChannel") or current.get("imageChannel") or "stable").strip()

    raw_stacks: dict[str, Any] = current.get("_rawStacks") or {}

    if patch.get("db") and STACK_DB in raw_stacks:
        _apply_db_patch(raw_stacks[STACK_DB], patch["db"], store_id)

    station_patch = patch.get("station") or {}
    station_stack = str(station_patch.get("stack") or current.get("station", {}).get("stack") or "")
    if station_stack in raw_stacks:
        _apply_station_patch(
            raw_stacks[station_stack],
            station_patch,
            store_id=store_id,
            distro=distro,
            image_channel=image_channel,
        )

    for stack_key, doc in raw_stacks.items():
        path = folder / stack_key / "fleet.yaml"
        _dump_yaml(path, doc)

    return load_store(repo_root, folder_name)


def _apply_db_patch(doc: dict[str, Any], db_patch: dict[str, Any], store_id: str) -> None:
    cust = _first_customization(doc)
    ml = _match_labels(doc)
    ml["atlas"] = "true"
    ml["store"] = store_id
    ml["application"] = ml.get("application") or "poslite"
    if "clusterSelector" not in cust:
        cust["clusterSelector"] = {}
    cust["clusterSelector"]["matchLabels"] = ml

    values = _values_block(doc)
    if "postgresql" not in values or not isinstance(values["postgresql"], dict):
        values["postgresql"] = {}
    if db_patch.get("timezone"):
        values["postgresql"]["timezone"] = db_patch["timezone"]
    if "persistence" not in values or not isinstance(values["persistence"], dict):
        values["persistence"] = {}
    if "persistenceEnabled" in db_patch:
        values["persistence"]["enabled"] = bool(db_patch["persistenceEnabled"])
    if "pgadmin" not in values or not isinstance(values["pgadmin"], dict):
        values["pgadmin"] = {}
    if "pgadminEnabled" in db_patch:
        values["pgadmin"]["enabled"] = bool(db_patch["pgadminEnabled"])

    helm = _helm_block(doc)
    helm["values"] = values


def _apply_station_patch(
    doc: dict[str, Any],
    station_patch: dict[str, Any],
    *,
    store_id: str,
    distro: str,
    image_channel: str,
) -> None:
    cust = _first_customization(doc)
    ml = _match_labels(doc)
    ml["atlas"] = "true"
    ml["store"] = store_id
    ml["application"] = ml.get("application") or "poslite"
    if distro:
        ml["distro"] = distro
    cust["clusterSelector"] = {"matchLabels": ml}

    values = _values_block(doc)
    config_patch = station_patch.get("config")
    if isinstance(config_patch, dict):
        if "config" not in values or not isinstance(values["config"], dict):
            values["config"] = {}
        for k, v in config_patch.items():
            if v is not None and str(v).strip() != "":
                values["config"][k] = v

    if "pullPolicy" in station_patch:
        _apply_pull_policy_to_all_services(values, station_patch.get("pullPolicy"))

    for svc in station_patch.get("services") or []:
        if not isinstance(svc, dict):
            continue
        key = str(svc.get("key") or "")
        if not key or key not in values or not isinstance(values[key], dict):
            continue
        if "enabled" in svc:
            values[key]["enabled"] = bool(svc["enabled"])
        if "tag" in svc:
            if "image" not in values[key] or not isinstance(values[key]["image"], dict):
                values[key]["image"] = {}
            values[key]["image"]["tag"] = str(svc.get("tag") or "").strip()

    for wrk in station_patch.get("workers") or []:
        if not isinstance(wrk, dict):
            continue
        path = str(wrk.get("key") or "")
        if not path:
            continue
        node: Any = values.get("workers")
        if not isinstance(node, dict):
            continue
        parts = path.split(".")
        target = node
        for part in parts[:-1]:
            if part not in target or not isinstance(target[part], dict):
                break
            target = target[part]
        else:
            leaf_key = parts[-1]
            if leaf_key in target and isinstance(target[leaf_key], dict) and "enabled" in wrk:
                target[leaf_key]["enabled"] = bool(wrk["enabled"])
                if "tag" in wrk:
                    if "image" not in target[leaf_key] or not isinstance(target[leaf_key]["image"], dict):
                        target[leaf_key]["image"] = {}
                    target[leaf_key]["image"]["tag"] = str(wrk.get("tag") or "").strip()

    has_components = bool(station_patch.get("services")) or bool(station_patch.get("workers"))
    if image_channel and not has_components:
        _set_all_image_tags(values, image_channel)

    helm = _helm_block(doc)
    helm["values"] = values


def _set_all_image_tags(values: dict[str, Any], tag: str) -> None:
    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            if "image" in obj and isinstance(obj["image"], dict):
                obj["image"]["tag"] = tag
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for x in obj:
                walk(x)

    walk(values)


_PLACEHOLDER_RE = re.compile(r"<[a-zA-Z0-9_-]+>")


def _collect_placeholders(obj: Any) -> list[str]:
    found: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, str):
            found.update(_PLACEHOLDER_RE.findall(value))
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(obj)
    return sorted(found)


def _preview_warnings(
    *,
    folder_exists: bool,
    folder_name: str,
    placeholders: list[str],
    station_values: dict[str, Any],
    distro: str,
    chart_versions: dict[str, str],
    services: list[dict[str, Any]],
) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    if folder_exists:
        warnings.append(
            {
                "level": "error",
                "code": "folder_exists",
                "message": f"Ya existe la carpeta stores/poslite/{folder_name} en el repositorio.",
            }
        )
    for ph in placeholders:
        warnings.append(
            {
                "level": "warn",
                "code": "placeholder",
                "message": f"Valor pendiente en plantilla: {ph}",
            }
        )
    config = station_values.get("config") if isinstance(station_values.get("config"), dict) else {}
    if not str(config.get("ierpUrl") or config.get("ierp_url") or "").strip():
        warnings.append(
            {
                "level": "warn",
                "code": "ierp_url",
                "message": "URL iERP vacía; configúrala después de crear la tienda.",
            }
        )
    if distro == "horustech" and not str(config.get("horustechIp") or config.get("horustech_ip") or "").strip():
        warnings.append(
            {
                "level": "warn",
                "code": "horustech_ip",
                "message": "IP Horustech vacía; necesaria para conexión on-prem.",
            }
        )
    if distro == "pam":
        if not str(config.get("pamIp") or config.get("pam_ip") or "").strip():
            warnings.append(
                {
                    "level": "warn",
                    "code": "pam_ip",
                    "message": "IP PAM vacía; necesaria para conexión on-prem.",
                }
            )
    ht_ver = chart_versions.get(STACK_HORUSTECH) or ""
    hka = services and any(s.get("key") == "hkaCliPaWebapi" and s.get("enabled") for s in services)
    if hka and ht_ver and ht_ver < "1.1.3":
        warnings.append(
            {
                "level": "warn",
                "code": "hka_chart",
                "message": f"HKA activo con chart {ht_ver}; se recomienda poslite-ht ≥ 1.1.3.",
            }
        )
    enabled = sum(1 for s in services if s.get("enabled"))
    if services and enabled == 0:
        warnings.append(
            {
                "level": "warn",
                "code": "no_services",
                "message": "Ningún servicio de estación está activo en la plantilla.",
            }
        )
    return warnings


def preview_create_store(
    repo_root: Path,
    *,
    folder_name: str,
    store_id: str,
    distro: str,
    image_channel: str = "stable",
) -> dict[str, Any]:
    """Genera resumen de lo que se publicará sin escribir en disco."""
    distro_l = distro.strip().lower()
    if distro_l not in ("horustech", "pam"):
        raise ValueError("El tipo de estación debe ser horustech o pam.")

    sid = store_id.strip()
    folder = folder_name.strip() or sid
    if not sid:
        raise ValueError("El código de tienda es obligatorio.")

    folder_path = stores_poslite_dir(repo_root) / folder
    folder_exists = folder_path.exists()

    files = new_store_files_from_repo(
        repo_root,
        store_id=sid,
        distro=distro_l,
        image_channel=image_channel,
    )
    sources = create_template_sources(repo_root, distro_l)

    stacks_data: dict[str, dict[str, Any]] = {}
    git_paths: list[str] = []
    file_entries: list[dict[str, Any]] = []
    placeholders: set[str] = set()

    for rel, doc in files.items():
        git_path = f"stores/poslite/{folder}/{rel}"
        git_paths.append(git_path)
        stack_key = rel.split("/")[0]
        if not isinstance(doc, dict):
            continue
        placeholders.update(_collect_placeholders(doc))
        parsed = _parse_stack(stack_key, doc)
        stacks_data[stack_key] = parsed
        src = sources["db"] if stack_key == STACK_DB else sources["station"]
        file_entries.append(
            {
                "path": git_path,
                "stack": stack_key,
                "sourceTemplate": src,
                "chart": parsed.get("chart") or "",
                "chartVersion": parsed.get("chartVersion") or "",
                "bundleVersion": parsed.get("bundleVersion") or "",
            }
        )

    labels: dict[str, str] = {"atlas": "true"}
    for st in stacks_data.values():
        labels.update(st.get("matchLabels") or {})

    chart_versions = {
        k: str(v.get("chartVersion") or "")
        for k, v in stacks_data.items()
        if v.get("chartVersion")
    }

    station_stack = stacks_data.get(STACK_HORUSTECH) or stacks_data.get(STACK_PAM)
    station_values = (station_stack or {}).get("values") or {}
    services_summary = _summarize_services(station_values)
    workers_summary = _summarize_workers(station_values)
    db_stack = stacks_data.get(STACK_DB)
    db_summary = _summarize_db((db_stack or {}).get("values") or {})

    warn_list = _preview_warnings(
        folder_exists=folder_exists,
        folder_name=folder,
        placeholders=sorted(placeholders),
        station_values=station_values,
        distro=distro_l,
        chart_versions=chart_versions,
        services=services_summary,
    )
    has_errors = any(w["level"] == "error" for w in warn_list)

    return {
        "storeId": sid,
        "folderName": folder,
        "distro": distro_l,
        "imageChannel": image_channel.strip() or "stable",
        "namespace": str((station_stack or db_stack or {}).get("namespace") or "poslite"),
        "clusterLabels": labels,
        "gitPaths": git_paths,
        "files": file_entries,
        "templateSources": sources,
        "chartVersions": chart_versions,
        "db": db_summary,
        "station": {
            "stack": (station_stack or {}).get("stack") or distro_l,
            "config": station_values.get("config") if isinstance(station_values.get("config"), dict) else {},
            "pullPolicy": _derive_station_pull_policy(station_values),
            "services": services_summary,
            "workerGroups": workers_summary,
            "workers": _flatten_worker_groups(workers_summary),
        },
        "placeholders": sorted(placeholders),
        "warnings": warn_list,
        "canPublish": not has_errors,
        "folderExists": folder_exists,
    }


def create_store(
    repo_root: Path,
    *,
    folder_name: str,
    store_id: str,
    distro: str,
    image_channel: str = "stable",
) -> dict[str, Any]:
    distro_l = distro.strip().lower()
    if distro_l not in ("horustech", "pam"):
        raise ValueError("El tipo de estación debe ser horustech o pam.")

    folder = stores_poslite_dir(repo_root) / folder_name.strip()
    if folder.exists():
        raise FileExistsError(f"Ya existe la carpeta de tienda: {folder_name}")

    files = new_store_files_from_repo(
        repo_root,
        store_id=store_id,
        distro=distro_l,
        image_channel=image_channel,
    )
    for rel, content in files.items():
        path = folder / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, dict):
            _dump_yaml(path, content)
        else:
            path.write_text(str(content), encoding="utf-8")

    return load_store(repo_root, folder_name)
