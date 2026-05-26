"""Configuración Cloudflare (token API, cuenta, sufijo de dominio)."""

from __future__ import annotations

from atlas_vpn.cf_credentials import normalize_account_id, normalize_api_token
from atlas_core.db.settings import load_namespace, save_namespace

_NAMESPACE = "cloudflare"

_DEFAULTS = {
    "account_id": "",
    "api_token": "",
    "domain_suffix": "asptienda.com",
    "zone_id": "",
}


def _normalize(data: dict) -> dict:
    return {
        "account_id": normalize_account_id(str(data.get("account_id", ""))),
        "api_token": normalize_api_token(str(data.get("api_token", ""))),
        "domain_suffix": str(data.get("domain_suffix", "asptienda.com")).strip() or "asptienda.com",
        "zone_id": normalize_account_id(str(data.get("zone_id", ""))),
    }


def load_settings() -> dict:
    raw = load_namespace(_NAMESPACE)
    if not raw:
        return dict(_DEFAULTS)
    return _normalize(raw)


def save_settings(
    account_id: str, api_token: str, domain_suffix: str, zone_id: str = ""
) -> None:
    blob = _normalize(
        {
            "account_id": account_id,
            "api_token": api_token,
            "domain_suffix": domain_suffix,
            "zone_id": zone_id,
        }
    )
    save_namespace(_NAMESPACE, blob)
