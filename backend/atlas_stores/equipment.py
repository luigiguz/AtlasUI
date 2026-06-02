"""Validación de equipo Rancher vinculado a una tienda."""

from __future__ import annotations

from typing import Any

from atlas_rancher.client import RancherApiError, RancherConfigError, list_custom_clusters
from atlas_rancher.labels import normalize_application, normalize_distro
from atlas_rancher.settings_store import load_rancher_settings


class EquipmentNotFoundError(Exception):
    """No hay custom cluster que corresponda a la tienda."""


class RancherNotConfiguredError(Exception):
    pass


def find_equipment_for_store(
    store_id: str,
    *,
    distro: str,
    application: str = "poslite",
    require_application_match: bool = True,
    require_distro_match: bool = True,
) -> dict[str, Any]:
    """
    Busca un equipo (custom cluster) con label store = store_id.
    Opcionalmente exige match por application y distro.
    """
    settings = load_rancher_settings()
    if not settings.get("url") or not settings.get("token"):
        raise RancherNotConfiguredError(
            "Configura la conexión a Rancher antes de dar de alta una tienda (menú Equipos → Conexión Rancher)."
        )

    try:
        _, clusters = list_custom_clusters(settings)
    except (RancherConfigError, RancherApiError) as e:
        raise EquipmentNotFoundError(
            f"No se pudo consultar Rancher para validar el equipo: {e}"
        ) from e

    sid = store_id.strip().lower()
    if not sid:
        raise EquipmentNotFoundError("El código de tienda es obligatorio.")

    want_distro = normalize_distro(distro).lower()
    want_app = normalize_application(application).lower()
    candidates: list[dict[str, Any]] = []

    for cluster in clusters:
        c_store = str(cluster.get("store") or "").strip().lower()
        if c_store != sid:
            continue
        candidates.append(cluster)

    if not candidates:
        raise EquipmentNotFoundError(
            f"No existe ningún equipo en Rancher con tienda «{store_id}». "
            "Registra el equipo y asigna la etiqueta store antes de crear la configuración en Git."
        )

    if require_application_match and want_app:
        app_matches: list[dict[str, Any]] = []
        for cluster in candidates:
            c_app = normalize_application(str(cluster.get("application") or "")).lower()
            if c_app == want_app:
                app_matches.append(cluster)
        if not app_matches:
            names = ", ".join(
                normalize_application(str(c.get("application") or "")) or "sin aplicación"
                for c in candidates
            )
            raise EquipmentNotFoundError(
                f"Hay equipo para la tienda «{store_id}», pero ninguno con aplicación "
                f"«{normalize_application(application)}» (encontrado: {names}). Ajusta las etiquetas en Equipos."
            )
        candidates = app_matches

    if require_distro_match and want_distro:
        for cluster in candidates:
            c_distro = normalize_distro(str(cluster.get("distro") or "")).lower()
            if c_distro == want_distro:
                return cluster
        names = ", ".join(
            normalize_distro(str(c.get("distro") or "")) or "sin distribución" for c in candidates
        )
        raise EquipmentNotFoundError(
            f"Hay equipo para la tienda «{store_id}», pero ninguno con distribución "
            f"«{normalize_distro(distro)}» (encontrado: {names}). Ajusta las etiquetas en Equipos."
        )

    return candidates[0]
