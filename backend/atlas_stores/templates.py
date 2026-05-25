"""Plantillas fleet.yaml desde el repo atlas-stores (templates/poslite/)."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

TEMPLATE_HORUSTECH = Path("templates/poslite/horustech/fleet.yaml")
TEMPLATE_PAM = Path("templates/poslite/pam/fleet.yaml")
TEMPLATE_DB = Path("templates/poslite/db/fleet.yaml")
DB_REFERENCE = Path("stores/poslite/aspdemos/db/fleet.yaml")

DISTRO_STACK: dict[str, tuple[str, Path]] = {
    "horustech": ("horustech", TEMPLATE_HORUSTECH),
    "pam": ("pam", TEMPLATE_PAM),
}


class StoreTemplateError(Exception):
    pass


def _load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise StoreTemplateError(f"No se encontró la plantilla: {path}")
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise StoreTemplateError(f"Plantilla inválida (no es un objeto YAML): {path}")
    return data


def _replace_placeholders(value: Any, mapping: dict[str, str]) -> Any:
    if isinstance(value, str):
        out = value
        for placeholder, replacement in mapping.items():
            out = out.replace(placeholder, replacement)
        return out
    if isinstance(value, dict):
        return {k: _replace_placeholders(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [_replace_placeholders(item, mapping) for item in value]
    return value


def _placeholder_map(*, store_id: str, distro: str, image_channel: str) -> dict[str, str]:
    tag = (image_channel or "stable").strip() or "stable"
    return {
        "<id-tienda>": store_id.strip(),
        "<tag-imagen>": tag,
        "<ierp-url>": "",
        "<horustech-ip>": "",
        "<pam-ip>": "",
        "<pam-password>": "",
        "<pam-tcp-port>": "997",
    }


def _ensure_cluster_labels(doc: dict[str, Any], *, store_id: str, distro: str) -> None:
    """Asegura matchLabels tras sustituir placeholders."""
    for cust in doc.get("targetCustomizations") or []:
        if not isinstance(cust, dict):
            continue
        sel = cust.get("clusterSelector")
        if not isinstance(sel, dict):
            continue
        ml = sel.get("matchLabels")
        if not isinstance(ml, dict):
            ml = {}
            sel["matchLabels"] = ml
        ml["atlas"] = "true"
        ml["store"] = store_id
        ml["application"] = "poslite"
        if distro:
            ml["distro"] = distro


def _apply_template(
    doc: dict[str, Any],
    *,
    store_id: str,
    distro: str,
    image_channel: str,
) -> dict[str, Any]:
    cloned = deepcopy(doc)
    mapped = _replace_placeholders(cloned, _placeholder_map(store_id=store_id, distro=distro, image_channel=image_channel))
    if not isinstance(mapped, dict):
        raise StoreTemplateError("La plantilla no produjo un documento YAML válido.")
    _ensure_cluster_labels(mapped, store_id=store_id, distro=distro)
    return mapped


def _db_template_meta(root: Path) -> dict[str, Any]:
    """Ruta efectiva para db/fleet.yaml: plantilla → referencia aspdemos → builtin."""
    tpl = root / TEMPLATE_DB
    ref = root / DB_REFERENCE
    tpl_s = str(TEMPLATE_DB).replace("\\", "/")
    ref_s = str(DB_REFERENCE).replace("\\", "/")
    if tpl.is_file():
        return {
            "distro": "db",
            "label": "Base de datos",
            "stackDir": "db",
            "templatePath": tpl_s,
            "primaryTemplatePath": tpl_s,
            "fallbackTemplatePath": ref_s,
            "available": True,
            "source": "template",
        }
    if ref.is_file():
        return {
            "distro": "db",
            "label": "Base de datos",
            "stackDir": "db",
            "templatePath": ref_s,
            "primaryTemplatePath": tpl_s,
            "fallbackTemplatePath": ref_s,
            "available": True,
            "source": "reference",
            "referenceStore": "aspdemos",
        }
    return {
        "distro": "db",
        "label": "Base de datos",
        "stackDir": "db",
        "templatePath": tpl_s,
        "primaryTemplatePath": tpl_s,
        "fallbackTemplatePath": ref_s,
        "available": False,
        "source": "builtin",
    }


def _load_db_fleet(
    root: Path,
    *,
    store_id: str,
    image_channel: str,
) -> dict[str, Any]:
    tpl = root / TEMPLATE_DB
    if tpl.is_file():
        return _apply_template(_load_yaml_file(tpl), store_id=store_id, distro="", image_channel=image_channel)
    ref = root / DB_REFERENCE
    if ref.is_file():
        doc = _apply_template(_load_yaml_file(ref), store_id=store_id, distro="", image_channel=image_channel)
        _ensure_cluster_labels(doc, store_id=store_id, distro="")
        return doc
    return _fallback_db_fleet(store_id)


def list_store_templates(repo_root: Path) -> list[dict[str, Any]]:
    """Metadatos de plantillas disponibles en el repo clonado."""
    root = Path(repo_root)
    items: list[dict[str, Any]] = []
    for distro, (stack_dir, rel_path) in DISTRO_STACK.items():
        path = root / rel_path
        items.append(
            {
                "distro": distro,
                "label": "Horustech" if distro == "horustech" else "PAM",
                "stackDir": stack_dir,
                "templatePath": str(rel_path).replace("\\", "/"),
                "available": path.is_file(),
                "source": "template",
            }
        )
    items.append(_db_template_meta(root))
    return items


def new_store_files_from_repo(
    repo_root: Path,
    *,
    store_id: str,
    distro: str,
    image_channel: str = "stable",
) -> dict[str, Any]:
    """
    Crea archivos para una tienda nueva:
    - db: templates/poslite/db/fleet.yaml (o referencia aspdemos / builtin)
    - horustech|pam: templates/poslite/<distro>/fleet.yaml
    """
    distro_l = distro.strip().lower()
    if distro_l not in DISTRO_STACK:
        raise ValueError("La distribución debe ser horustech o pam.")

    root = Path(repo_root)
    sid = store_id.strip()
    if not sid:
        raise ValueError("El código de tienda es obligatorio.")

    files: dict[str, Any] = {}
    files["db/fleet.yaml"] = _load_db_fleet(root, store_id=sid, image_channel=image_channel)

    stack_dir, template_rel = DISTRO_STACK[distro_l]
    template_path = root / template_rel
    station_doc = _apply_template(_load_yaml_file(template_path), store_id=sid, distro=distro_l, image_channel=image_channel)
    files[f"{stack_dir}/fleet.yaml"] = station_doc

    return files


def _fallback_db_fleet(store_id: str) -> dict[str, Any]:
    """Si no existe referencia aspdemos/db en el repo."""
    return {
        "defaultNamespace": "poslite",
        "targetCustomizations": [
            {
                "name": "db",
                "clusterSelector": {
                    "matchLabels": {
                        "atlas": "true",
                        "store": store_id,
                        "application": "poslite",
                    }
                },
                "helm": {
                    "chart": "oci://atlashelmrepo.azurecr.io/helm/poslite-db",
                    "version": "1.0.0",
                    "values": {
                        "bundleVersion": "1.0.0",
                        "postgresql": {
                            "timezone": "America/Panama",
                            "database": "poslite",
                            "user": "poslite",
                        },
                        "persistence": {
                            "enabled": True,
                            "storageClass": "local-path",
                            "size": "10Gi",
                            "accessMode": "ReadWriteOnce",
                        },
                        "pgadmin": {"enabled": False},
                    },
                },
            }
        ],
    }


# Compatibilidad con código que importaba new_store_files
def new_store_files(*, store_id: str, distro: str, image_channel: str) -> dict[str, Any]:
    raise StoreTemplateError(
        "Usa new_store_files_from_repo(repo_root, ...) con el repositorio atlas-stores configurado."
    )
