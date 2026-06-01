"""Daemon atlas-tunnels: mantiene todos los túneles cloudflared activos."""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from pathlib import Path
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
_config_mtime: float = 0.0
_lock = threading.Lock()


def _keeper_interval() -> float:
    try:
        return max(5.0, float(os.environ.get("ATLAS_TUNNEL_KEEPER_INTERVAL", "15")))
    except ValueError:
        return 15.0


def _config_mtime() -> float:
    try:
        return _config_path.stat().st_mtime
    except OSError:
        return 0.0


def reconcile_once() -> dict[str, Any]:
    global _config_mtime
    with _lock:
        _config_mtime = _config_mtime()
        result = tm.ensure_all_sites(_config_path)
        if result.get("lines"):
            for line in result["lines"]:
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
    global _config_mtime
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
            mtime = _config_mtime()
            if mtime != last_mtime:
                if last_mtime > 0:
                    logger.info("tunnels.json cambió; reconciliando…")
                last_mtime = mtime
            reconcile_once()
        except Exception:
            logger.exception("Error en reconcile")
        time.sleep(interval)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "atlas-tunnels"}


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
