"""Rutas del proyecto Atlas (datos locales en `.atlas/`)."""

from __future__ import annotations

import shutil
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
BRANDING_DIR = PROJECT_ROOT / "ui" / "public" / "branding"
STATIC_WEB_DIR = PROJECT_ROOT / "ui" / "dist"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
TUNNELS_JSON = SCRIPTS_DIR / "tunnels.json"
_LEGACY_DATA_DIR = PROJECT_ROOT / ".atlasvpn"
ATLAS_DATA_DIR = PROJECT_ROOT / ".atlas"
AUTH_FILE = ATLAS_DATA_DIR / "auth.json"
SETTINGS_FILE = ATLAS_DATA_DIR / "settings.json"

STATIC_WEB = STATIC_WEB_DIR

DEFAULT_LOGO_CANDIDATES = (
    "Logo ATLAS - Sin Fondi.png",
    "Logo ATLAS.png",
    "Logo Atlas Fondo.png",
    "Logo.png",
)


def ensure_atlas_data_dir() -> Path:
    """Crea `.atlas/` o migra desde `.atlasvpn/` si existe."""
    if not ATLAS_DATA_DIR.exists() and _LEGACY_DATA_DIR.is_dir():
        try:
            shutil.move(str(_LEGACY_DATA_DIR), str(ATLAS_DATA_DIR))
        except OSError:
            pass
    ATLAS_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return ATLAS_DATA_DIR


def resolve_logo_path() -> Path | None:
    for name in DEFAULT_LOGO_CANDIDATES:
        p = BRANDING_DIR / name
        if p.is_file():
            return p
    return None
