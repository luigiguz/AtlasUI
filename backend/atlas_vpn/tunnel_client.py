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
