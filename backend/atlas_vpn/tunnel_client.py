"""Cliente HTTP hacia el servicio atlas-tunnels (reconciliación)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

from atlas_core.env import atlas_env

logger = logging.getLogger(__name__)


def tunnels_service_url() -> str:
    return (atlas_env("ATLAS_TUNNELS_URL") or os.environ.get("ATLAS_TUNNELS_URL") or "").strip().rstrip("/")


def fetch_tunnel_diagnostics(timeout: float = 5.0) -> dict[str, Any] | None:
    """Diagnóstico completo desde atlas-tunnels (/diagnostics)."""
    base = tunnels_service_url()
    if not base:
        return None
    url = f"{base}/diagnostics"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body.strip() else {}
            return data if isinstance(data, dict) else None
    except Exception as e:
        logger.debug("tunnel /diagnostics failed: %s", e)
        return None


def fetch_tunnel_listener_status(timeout: float = 4.0) -> dict[str, str] | None:
    """Estado site:label desde atlas-tunnels (/status). None si no hay servicio."""
    base = tunnels_service_url()
    if not base:
        return None
    url = f"{base}/status"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body.strip() else {}
            listeners = data.get("listeners")
            if isinstance(listeners, dict):
                return {str(k): str(v) for k, v in listeners.items()}
    except Exception as e:
        logger.debug("tunnel /status failed: %s", e)
    return None


def request_tunnel_restart(
    site: str,
    services: str = "both",
    timeout: float = 20.0,
) -> dict[str, Any] | None:
    """Pide al keeper reiniciar túneles de un sitio. None si no hay URL configurada."""
    base = tunnels_service_url()
    if not base:
        return None
    url = f"{base}/restart"
    payload = json.dumps({"site": site.strip(), "services": services}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if body.strip() else {"ok": True}
    except urllib.error.HTTPError as e:
        logger.warning("tunnel restart HTTP %s: %s", e.code, e.reason)
        try:
            detail = e.read().decode("utf-8", errors="replace")
            parsed = json.loads(detail) if detail.strip() else {}
            if isinstance(parsed, dict):
                return {**parsed, "ok": False, "error": f"HTTP {e.code}"}
        except Exception:
            pass
        return {"ok": False, "error": f"HTTP {e.code}"}
    except Exception as e:
        logger.warning("tunnel restart failed: %s", e)
        return {"ok": False, "error": str(e)[:200]}


def request_tunnel_reconcile(timeout: float = 8.0) -> dict[str, Any] | None:
    """Pide al keeper que reconcilie túneles. None si no hay URL configurada."""
    base = tunnels_service_url()
    if not base:
        return None
    url = f"{base}/reconcile"
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if body.strip() else {"ok": True}
    except urllib.error.HTTPError as e:
        logger.warning("tunnel reconcile HTTP %s: %s", e.code, e.reason)
        return {"ok": False, "error": f"HTTP {e.code}"}
    except Exception as e:
        logger.warning("tunnel reconcile failed: %s", e)
        return {"ok": False, "error": str(e)[:200]}
