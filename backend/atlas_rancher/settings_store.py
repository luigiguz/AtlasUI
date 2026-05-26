"""Configuración de conexión a Rancher (URL + token API)."""

from __future__ import annotations

from atlas_core.db.settings import load_namespace, save_namespace
from atlas_core.env import atlas_env

_NAMESPACE = "rancher"


def _from_env_and_file(file_cfg: dict[str, str | bool]) -> dict[str, str | bool]:
    url = atlas_env("RANCHER_URL") or str(file_cfg.get("url", ""))
    token = atlas_env("RANCHER_TOKEN") or str(file_cfg.get("token", ""))
    insecure = atlas_env("RANCHER_INSECURE_TLS").lower() in ("1", "true", "yes") or bool(
        file_cfg.get("insecure_tls", False)
    )
    cf_id = atlas_env("RANCHER_CF_ACCESS_CLIENT_ID") or str(file_cfg.get("cf_access_client_id", ""))
    cf_secret = atlas_env("RANCHER_CF_ACCESS_CLIENT_SECRET") or str(
        file_cfg.get("cf_access_client_secret", "")
    )
    user_agent = atlas_env("RANCHER_USER_AGENT") or str(file_cfg.get("user_agent", ""))
    return {
        "url": url.strip().rstrip("/"),
        "token": token.strip(),
        "insecure_tls": insecure,
        "cf_access_client_id": cf_id.strip(),
        "cf_access_client_secret": cf_secret.strip(),
        "user_agent": user_agent.strip(),
    }


def load_rancher_settings() -> dict[str, str | bool]:
    raw = load_namespace(_NAMESPACE)
    file_cfg: dict[str, str | bool] = {
        "url": str(raw.get("url", "")).strip().rstrip("/"),
        "token": str(raw.get("token", "")).strip(),
        "insecure_tls": bool(raw.get("insecure_tls", False)),
        "cf_access_client_id": str(raw.get("cf_access_client_id", "")).strip(),
        "cf_access_client_secret": str(raw.get("cf_access_client_secret", "")).strip(),
        "user_agent": str(raw.get("user_agent", "")).strip(),
    }
    return _from_env_and_file(file_cfg)


def save_rancher_settings(
    url: str,
    token: str,
    insecure_tls: bool = False,
    *,
    cf_access_client_id: str = "",
    cf_access_client_secret: str = "",
    user_agent: str = "",
) -> None:
    blob = {
        "url": url.strip().rstrip("/"),
        "token": token.strip(),
        "insecure_tls": bool(insecure_tls),
        "cf_access_client_id": cf_access_client_id.strip(),
        "cf_access_client_secret": cf_access_client_secret.strip(),
        "user_agent": user_agent.strip(),
    }
    save_namespace(_NAMESPACE, blob)
