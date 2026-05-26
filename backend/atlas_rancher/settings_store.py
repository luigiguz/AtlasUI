"""Configuración de conexión a Rancher (URL + token API)."""

from __future__ import annotations

import json

from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

RANCHER_SETTINGS_FILE = ATLAS_DATA_DIR / "rancher.json"


def load_rancher_settings() -> dict[str, str | bool]:
    file_cfg: dict[str, str | bool] = {
        "url": "",
        "token": "",
        "insecure_tls": False,
        "cf_access_client_id": "",
        "cf_access_client_secret": "",
        "user_agent": "",
    }
    if RANCHER_SETTINGS_FILE.is_file():
        try:
            with RANCHER_SETTINGS_FILE.open(encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = {}
        file_cfg["url"] = str(data.get("url", "")).strip().rstrip("/")
        file_cfg["token"] = str(data.get("token", "")).strip()
        file_cfg["insecure_tls"] = bool(data.get("insecure_tls", False))
        file_cfg["cf_access_client_id"] = str(data.get("cf_access_client_id", "")).strip()
        file_cfg["cf_access_client_secret"] = str(data.get("cf_access_client_secret", "")).strip()
        file_cfg["user_agent"] = str(data.get("user_agent", "")).strip()

    url = atlas_env("RANCHER_URL") or str(file_cfg["url"])
    token = atlas_env("RANCHER_TOKEN") or str(file_cfg["token"])
    insecure = atlas_env("RANCHER_INSECURE_TLS").lower() in ("1", "true", "yes") or bool(file_cfg["insecure_tls"])
    cf_id = atlas_env("RANCHER_CF_ACCESS_CLIENT_ID") or str(file_cfg["cf_access_client_id"])
    cf_secret = atlas_env("RANCHER_CF_ACCESS_CLIENT_SECRET") or str(file_cfg["cf_access_client_secret"])
    user_agent = atlas_env("RANCHER_USER_AGENT") or str(file_cfg["user_agent"])
    return {
        "url": url.strip().rstrip("/"),
        "token": token.strip(),
        "insecure_tls": insecure,
        "cf_access_client_id": cf_id.strip(),
        "cf_access_client_secret": cf_secret.strip(),
        "user_agent": user_agent.strip(),
    }


def save_rancher_settings(
    url: str,
    token: str,
    insecure_tls: bool = False,
    *,
    cf_access_client_id: str = "",
    cf_access_client_secret: str = "",
    user_agent: str = "",
) -> None:
    ensure_atlas_data_dir()
    blob = {
        "url": url.strip().rstrip("/"),
        "token": token.strip(),
        "insecure_tls": bool(insecure_tls),
        "cf_access_client_id": cf_access_client_id.strip(),
        "cf_access_client_secret": cf_access_client_secret.strip(),
        "user_agent": user_agent.strip(),
    }
    with RANCHER_SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(blob, f, indent=2)
