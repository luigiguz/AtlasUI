"""WebSocket → exec interactivo en un pod vía proxy Kubernetes de Rancher."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import ssl
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from atlas_core.permissions import PERM_RANCHER_WRITE, has_any_permission
from atlas_core.web_tokens import decode_access_token, resolve_user_from_access_token
from atlas_rancher.client import (
    RancherConfigError,
    build_pod_exec_ws_url,
    resolve_custom_cluster_context,
)
from atlas_rancher.settings_store import load_rancher_settings

log = logging.getLogger(__name__)

DEFAULT_SHELL_COMMAND = [
    "/bin/sh",
    "-c",
    'TERM=xterm-256color; export TERM; [ -x /bin/bash ] && '
    '([ -x /usr/bin/script ] && /usr/bin/script -q -c "/bin/bash" /dev/null || exec /bin/bash) '
    "|| exec /bin/sh",
]


def _user_from_token(token: str | None) -> dict[str, Any] | None:
    if not token or not token.strip():
        return None
    u = resolve_user_from_access_token(token.strip())
    if u and u.get("username"):
        if has_any_permission(u, PERM_RANCHER_WRITE):
            return u
        role = str(u.get("role") or "")
        if role == "admin":
            return u
    payload = decode_access_token(token.strip())
    if not payload:
        return None
    perms = payload.get("permissions")
    if isinstance(perms, list) and PERM_RANCHER_WRITE in perms:
        return {
            "username": str(payload.get("sub") or ""),
            "role": str(payload.get("role") or ""),
            "permissions": perms,
        }
    if str(payload.get("role") or "") == "admin":
        return {"username": str(payload.get("sub") or ""), "role": "admin"}
    return None


def _ssl_context(insecure: bool) -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _http_to_ws_url(http_url: str) -> str:
    parsed = urlparse(http_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunparse((scheme, parsed.netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


async def _safe_ws_close(websocket: WebSocket, *, code: int | None = None) -> None:
    with contextlib.suppress(RuntimeError, OSError):
        if code is not None:
            await websocket.close(code=code)
        else:
            await websocket.close()


async def _relay_client_to_rancher(client: WebSocket, upstream: Any) -> None:
    while client.client_state == WebSocketState.CONNECTED:
        msg = await client.receive()
        if msg["type"] == "websocket.disconnect":
            break
        if msg["type"] != "websocket.receive":
            continue
        if "text" in msg and msg["text"]:
            await upstream.send(msg["text"])
        elif "bytes" in msg and msg["bytes"]:
            # xterm envía binario; el protocolo Rancher/K8s usa texto base64.channel
            payload = base64.b64encode(msg["bytes"]).decode("ascii")
            await upstream.send(f"0{payload}")


async def _relay_rancher_to_client(client: WebSocket, upstream: Any) -> None:
    async for message in upstream:
        if client.client_state != WebSocketState.CONNECTED:
            break
        if isinstance(message, bytes):
            await client.send_bytes(message)
        else:
            await client.send_text(message)


async def run_pod_exec_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    token = websocket.query_params.get("token")
    user_ctx = _user_from_token(token)
    if not user_ctx:
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "No autorizado o sesión caducada."})
            )
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1008)
        return

    cluster_ns = (websocket.query_params.get("cluster_ns") or "").strip()
    cluster_name = (websocket.query_params.get("cluster_name") or "").strip()
    steve = (websocket.query_params.get("steve_collection") or "provisioning.cattle.io.customclusters").strip()
    pod_name = (websocket.query_params.get("pod") or "").strip()
    container = (websocket.query_params.get("container") or "").strip()
    pod_k8s_ns = (websocket.query_params.get("pod_namespace") or "").strip()

    if not cluster_ns or not cluster_name or not pod_name:
        try:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Faltan parámetros cluster_ns, cluster_name o pod.",
                    }
                )
            )
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1008)
        return

    settings = load_rancher_settings()
    if not settings["url"] or not settings["token"]:
        try:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Configura la conexión a Rancher antes de abrir shell en contenedor.",
                    }
                )
            )
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
        return

    try:
        mgmt_id, app_ns, _application = resolve_custom_cluster_context(
            settings,
            namespace=cluster_ns,
            name=cluster_name,
            steve_collection=steve,
        )
        k8s_ns = pod_k8s_ns or app_ns
        exec_path = build_pod_exec_ws_url(
            mgmt_id,
            k8s_ns,
            pod_name,
            container=container,
            commands=DEFAULT_SHELL_COMMAND,
        )
        rancher_ws = _http_to_ws_url(f"{settings['url'].rstrip('/')}/{exec_path}")
        headers = {
            k: v
            for k, v in {
                "Authorization": f"Bearer {settings['token']}",
                "Origin": settings["url"].rstrip("/"),
            }.items()
            if v
        }
        cf_id = str(settings.get("cf_access_client_id") or "").strip()
        cf_secret = str(settings.get("cf_access_client_secret") or "").strip()
        if cf_id and cf_secret:
            headers["CF-Access-Client-Id"] = cf_id
            headers["CF-Access-Client-Secret"] = cf_secret

        async with websockets.connect(
            rancher_ws,
            subprotocols=["base64.channel.k8s.io"],
            additional_headers=headers,
            ssl=_ssl_context(bool(settings.get("insecure_tls"))),
            open_timeout=30,
            close_timeout=5,
            ping_interval=20,
            ping_timeout=20,
        ) as upstream:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "ready",
                        "pod": pod_name,
                        "container": container or "(principal)",
                        "namespace": k8s_ns,
                    }
                )
            )
            to_rancher = asyncio.create_task(_relay_client_to_rancher(websocket, upstream))
            from_rancher = asyncio.create_task(_relay_rancher_to_client(websocket, upstream))
            done, pending = await asyncio.wait(
                {to_rancher, from_rancher},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            for task in done:
                with contextlib.suppress(Exception):
                    task.result()
    except RancherConfigError as e:
        log.warning("pod exec config error: %s", e)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except OSError:
            pass
    except Exception as e:
        log.exception("pod exec ws failed pod=%s", pod_name)
        msg = str(e).strip() or "No se pudo abrir shell en el contenedor."
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": msg}))
        except OSError:
            pass
    finally:
        await _safe_ws_close(websocket)
