"""Variables de entorno Atlas (`ATLAS_*`). Acepta `ATLASVPN_*` legacy en transición."""

from __future__ import annotations

import os


def atlas_env(name: str, default: str = "") -> str:
    """Lee `ATLAS_{name}` o, si no existe, el nombre legacy `ATLASVPN_{name}`."""
    primary = f"ATLAS_{name}"
    legacy = f"ATLASVPN_{name}"
    v = os.environ.get(primary, "").strip()
    if v:
        return v
    return os.environ.get(legacy, default).strip()


def atlas_env_flag(name: str) -> bool:
    return atlas_env(name).lower() in ("1", "true", "yes")
