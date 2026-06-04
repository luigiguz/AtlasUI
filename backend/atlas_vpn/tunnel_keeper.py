"""Daemon atlas-tunnels: mantiene todos los túneles cloudflared activos."""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from atlas_core.paths import SCRIPTS_DIR

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import tunnel_manager as tm  # noqa: E402

logger = logging.getLogger("atlas.tunnels")

app = FastAPI(title="Atlas Tunnels", version="1.0.0")

_config_path = tm.default_config_path()
_lock = threading.Lock()
_last_snapshot: dict[str, Any] = {
    "at": None,
    "ok": True,
    "siteCount": 0,
    "removedDead": 0,
    "lines": [],
    "errors": [],
    "loopError": None,
}


def _keeper_interval() -> float:
    try:
        return max(5.0, float(os.environ.get("ATLAS_TUNNEL_KEEPER_INTERVAL", "15")))
    except ValueError:
        return 15.0


def _read_config_mtime() -> float:
    try:
        return _config_path.stat().st_mtime
    except OSError:
        return 0.0


def reconcile_once() -> dict[str, Any]:
    with _lock:
        result = tm.ensure_all_sites(_config_path)
        lines = [str(x) for x in (result.get("lines") or []) if str(x).strip()]
        errors = [ln for ln in lines if ln.startswith("ERROR")]
        _last_snapshot.update(
            {
                "at": time.time(),
                "ok": bool(result.get("ok")),
                "siteCount": int(result.get("siteCount") or 0),
                "removedDead": int(result.get("removedDead") or 0),
                "lines": lines[-50:],
                "errors": errors,
                "loopError": None,
            }
        )
        if lines:
            for line in lines:
                if line.startswith("[OK]") or line.startswith("ERROR"):
                    logger.info("%s", line)
        logger.debug(
            "reconcile ok=%s sites=%s removed=%s",
            result.get("ok"),
            result.get("siteCount"),
            result.get("removedDead"),
        )
        return result


def _keeper_loop() -> None:
    last_mtime = 0.0
    interval = _keeper_interval()
    logger.info(
        "Atlas tunnels keeper: config=%s bind=%s interval=%ss",
        _config_path,
        tm.tunnel_bind_host(),
        interval,
    )
    while True:
        try:
            mtime = _read_config_mtime()
            if mtime != last_mtime:
                if last_mtime > 0:
                    logger.info("tunnels.json cambió; reconciliando…")
                last_mtime = mtime
            reconcile_once()
        except Exception as exc:
            logger.exception("Error en reconcile")
            with _lock:
                _last_snapshot["loopError"] = str(exc)[:500]
                _last_snapshot["at"] = time.time()
        time.sleep(interval)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "atlas-tunnels"}


@app.get("/diagnostics")
def diagnostics() -> dict[str, Any]:
    """Último reconcile, listeners caídos e incidencias del loop (para depuración en UI)."""
    listeners = tm.build_listener_status_map(_config_path)
    dead = sorted(k for k, v in listeners.items() if v == "dead")
    idle = sorted(k for k, v in listeners.items() if v == "idle")
    with _lock:
        last = dict(_last_snapshot)
    return {
        "ok": True,
        "bind": tm.tunnel_bind_host(),
        "listeners": listeners,
        "dead": dead,
        "idle": idle,
        "active": sum(1 for v in listeners.values() if v == "active"),
        "lastReconcile": last,
    }


@app.get("/status")
def listener_status() -> dict[str, Any]:
    """Estado real de listeners (sondeo dentro del contenedor atlas-tunnels)."""
    listeners = tm.build_listener_status_map(_config_path)
    active = sum(1 for v in listeners.values() if v == "active")
    dead = sum(1 for v in listeners.values() if v == "dead")
    return {
        "ok": True,
        "listeners": listeners,
        "active": active,
        "dead": dead,
        "idle": len(listeners) - active - dead,
    }


@app.post("/reconcile")
def reconcile_endpoint() -> JSONResponse:
    result = reconcile_once()
    status = 200 if result.get("ok") else 207
    return JSONResponse(content=result, status_code=status)


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    port = int(os.environ.get("ATLAS_TUNNEL_KEEPER_PORT", "8766"))
    host = os.environ.get("ATLAS_TUNNEL_KEEPER_HOST", "0.0.0.0")

    t = threading.Thread(target=_keeper_loop, name="tunnel-keeper", daemon=True)
    t.start()

    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
