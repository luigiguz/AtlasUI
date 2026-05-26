"""WebSocket → proxy SSH interactivo hacia 127.0.0.1 (puerto del túnel en este host)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import shlex
import sys
import time
from pathlib import Path
from typing import Any

import asyncssh
from asyncssh import SSHClient
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from atlas_vpn.constants import resolve_ssh_username
from atlas_core.env import atlas_env_flag
from atlas_core.paths import SCRIPTS_DIR
from atlas_core.web_tokens import decode_access_token

log = logging.getLogger(__name__)


def _host_stats_print(msg: str) -> None:
    """Salida directa a stdout (p. ej. Docker) si ATLAS_SSH_HOST_STATS_DEBUG=1."""
    if atlas_env_flag("SSH_HOST_STATS_DEBUG"):
        print(f"[Atlas host_stats] {msg}", flush=True)


def _ssh_stats_payload_body() -> str:
    try:
        return (Path(__file__).resolve().parent / "ssh_remote_stats_payload.py").read_text(encoding="utf-8")
    except OSError:
        return ""


_SSH_STATS_BODY = _ssh_stats_payload_body()


if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import tunnel_manager as tm  # noqa: E402


async def _safe_ws_close(websocket: WebSocket, *, code: int | None = None) -> None:
    """Evita RuntimeError si el socket ya envió websocket.close (p. ej. tras error + finally)."""
    with contextlib.suppress(RuntimeError, OSError):
        if code is not None:
            await websocket.close(code=code)
        else:
            await websocket.close()


class _WsAuthLineReader:
    """Durante el handshake SSH, lee líneas (contraseña / retos) desde mensajes binarios del WebSocket."""

    def __init__(self, websocket: WebSocket) -> None:
        self._ws = websocket
        self._buf = bytearray()

    async def _recv_payload(self) -> bytes:
        while True:
            msg = await self._ws.receive()
            if msg["type"] == "websocket.disconnect":
                raise WebSocketDisconnect()
            if msg["type"] != "websocket.receive":
                continue
            if "text" in msg and msg["text"]:
                try:
                    j = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if isinstance(j, dict) and j.get("type") == "resize":
                    continue
                continue
            if "bytes" in msg and msg["bytes"]:
                return msg["bytes"]

    async def readline(self) -> str:
        while True:
            for sep in (b"\r\n", b"\n", b"\r"):
                i = self._buf.find(sep)
                if i >= 0:
                    raw = self._buf[:i]
                    del self._buf[: i + len(sep)]
                    return raw.decode("utf-8", errors="replace")
            self._buf.extend(await self._recv_payload())

    def take_buffered_bytes(self) -> bytes:
        b = bytes(self._buf)
        self._buf.clear()
        return b


class _WebSshClient(SSHClient):
    """Contraseña y keyboard-interactive leyendo del WebSocket; muestra prompts en la terminal."""

    def __init__(self, reader: _WsAuthLineReader, websocket: WebSocket, ssh_login: str) -> None:
        super().__init__()
        self._reader = reader
        self._ws = websocket
        self._ssh_login = ssh_login

    async def _emit_tty(self, text: str) -> None:
        if self._ws.client_state != WebSocketState.CONNECTED:
            return
        with contextlib.suppress(OSError, RuntimeError):
            await self._ws.send_bytes(text.encode("utf-8"))

    def auth_banner_received(self, msg: str, lang: str) -> None:
        if not (msg and msg.strip()):
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        banner = "\r\n" + msg.rstrip("\n") + "\r\n"
        loop.create_task(self._emit_tty(banner))

    def kbdint_auth_requested(self) -> str:
        return ""

    async def password_auth_requested(self) -> str | None:
        await self._emit_tty(f"\r\n{self._ssh_login}@127.0.0.1's password: ")
        line = await self._reader.readline()
        return line if line else None

    async def kbdint_challenge_received(
        self,
        name: str,
        instructions: str,
        lang: str,
        prompts: Any,
    ) -> list[str] | None:
        if instructions and str(instructions).strip():
            await self._emit_tty("\r\n" + str(instructions).strip() + "\r\n")
        if not prompts:
            return []
        out: list[str] = []
        for item in prompts:
            try:
                prompt_text, _echo = item
            except (TypeError, ValueError):
                out.append(await self._reader.readline())
                continue
            if prompt_text:
                await self._emit_tty(str(prompt_text))
            else:
                await self._emit_tty("\r\nPassword: ")
            out.append(await self._reader.readline())
        return out


def _user_from_token(token: str | None) -> dict[str, Any] | None:
    if not token or not token.strip():
        return None
    payload = decode_access_token(token.strip())
    if not payload:
        return None
    role = str(payload.get("role") or "")
    if role not in ("admin", "operator"):
        return None
    return {"username": str(payload.get("sub") or ""), "role": role}


def _ssh_connect_error_message(exc: BaseException, ssh_user: str) -> str:
    s = str(exc).lower()
    if "permission denied" in s or "authentication failed" in s or "auth fail" in s:
        return (
            f"SSH no aceptó la autenticación para «{ssh_user}». "
            "Comprueba la contraseña o la clave en el servidor; en tunnels.json puedes fijar "
            '"ssh_user" (o "user") si el usuario no es «admin».'
        )
    return (
        "No se pudo conectar por SSH a 127.0.0.1 en el puerto del túnel. "
        "¿Está iniciado el túnel SSH para este sitio?"
    )


async def run_ssh_terminal_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    token = websocket.query_params.get("token")
    site = (websocket.query_params.get("site") or "").strip()
    if not _user_from_token(token):
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "No autorizado o sesión caducada."})
            )
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1008)
        return
    if not site:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "Falta el parámetro site."}))
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1008)
        return

    cfg = tm.load_config_optional(tm.default_config_path())
    if not cfg:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "Sin tunnels.json."}))
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
        return
    entry = (cfg.get("sites") or {}).get(site) or {}
    ssh = entry.get("ssh")
    if not isinstance(ssh, dict) or ssh.get("local_port") in (None, ""):
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": "Sitio sin SSH en la configuración."})
            )
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
        return
    try:
        port = int(ssh["local_port"])
    except (TypeError, ValueError):
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "Puerto SSH inválido."}))
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
        return
    if port < 1 or port > 65535:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": "Puerto SSH fuera de rango."}))
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
        return

    user = resolve_ssh_username(ssh)
    cols, rows = 120, 34
    auth_reader = _WsAuthLineReader(websocket)

    try:
        try:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "auth_hint",
                        "message": "Autenticando SSH… Si el servidor pide contraseña, escríbela en la terminal y pulsa Enter.",
                    }
                )
            )
        except OSError:
            pass

        async with asyncssh.connect(
            "127.0.0.1",
            port=port,
            username=user,
            known_hosts=None,
            client_keys=None,
            client_factory=lambda: _WebSshClient(auth_reader, websocket, user),
        ) as conn:
            async with conn.create_process(
                encoding=None,
                term_type="xterm-256color",
                term_size=(cols, rows),
                stderr=asyncssh.STDOUT,
            ) as process:
                pending = auth_reader.take_buffered_bytes()
                if pending and process.stdin is not None:
                    process.stdin.write(pending)
                    await process.stdin.drain()

                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "ready",
                            "site": site,
                            "user": user,
                            "port": port,
                            "command": f"ssh {user}@localhost -p {port}",
                        }
                    )
                )

                stats_task = asyncio.create_task(_host_stats_pump(conn, websocket, site, user))
                out_task = asyncio.create_task(_pump_stdout_to_ws(websocket, process))

                try:
                    while websocket.client_state == WebSocketState.CONNECTED:
                        msg = await websocket.receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if msg["type"] != "websocket.receive":
                            continue
                        if "bytes" in msg and msg["bytes"]:
                            b = msg["bytes"]
                            if process.stdin is not None:
                                process.stdin.write(b)
                                await process.stdin.drain()
                        elif "text" in msg and msg["text"]:
                            try:
                                ctrl = json.loads(msg["text"])
                            except json.JSONDecodeError:
                                continue
                            if ctrl.get("type") == "resize":
                                try:
                                    cols = int(ctrl.get("cols") or cols)
                                    rows = int(ctrl.get("rows") or rows)
                                except (TypeError, ValueError):
                                    continue
                                cols = max(40, min(cols, 500))
                                rows = max(8, min(rows, 200))
                                with contextlib.suppress(OSError, asyncssh.Error):
                                    process.change_terminal_size(cols, rows)
                except WebSocketDisconnect:
                    pass
                finally:
                    stats_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await stats_task
                    out_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await out_task
                    with contextlib.suppress(OSError, ProcessLookupError, asyncssh.Error):
                        process.terminate()
    except (OSError, asyncio.TimeoutError, asyncssh.Error) as e:
        log.warning("ssh ws fallo site=%s port=%s user=%s: %s", site, port, user, e)
        msg = _ssh_connect_error_message(e, user)
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": msg}))
        except OSError:
            pass
        await _safe_ws_close(websocket, code=1011)
    finally:
        await _safe_ws_close(websocket)


def _clip_text(s: Any, max_len: int) -> str:
    if s is None:
        return ""
    t = str(s).replace("\r", " ").replace("\n", " ").strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 3] + "..."


async def _host_stats_pump(conn: asyncssh.SSHClientConnection, websocket: WebSocket, site: str, ssh_login: str) -> None:
    """Ejecuta en el host remoto un script corto (Linux) y envía JSON por el WebSocket sin mezclarlo con el PTY."""
    body = _SSH_STATS_BODY.strip()
    if not body:
        log.warning("host_stats: payload vacío (¿falta atlas_vpn/ssh_remote_stats_payload.py?) site=%s", site)
        return
    log.debug("host_stats: bucle iniciado site=%s tunnel_user=%s", site, ssh_login)
    _host_stats_print(f"bucle iniciado site={site} tunnel_user={ssh_login}")
    last_rx: int | None = None
    last_tx: int | None = None
    last_t: float | None = None
    delay_s = 1.0
    try:
        while websocket.client_state == WebSocketState.CONNECTED:
            await asyncio.sleep(delay_s)
            delay_s = 3.0
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            now = time.monotonic()
            data: dict[str, Any] | None = None
            last_diag = ""
            for exe in ("python3", "python"):
                remote_cmd = f"{shlex.quote(exe)} -u -"
                try:
                    proc = await asyncio.wait_for(
                        conn.run(
                            remote_cmd,
                            input=body,
                            encoding="utf-8",
                            check=False,
                        ),
                        timeout=22.0,
                    )
                except (asyncio.TimeoutError, OSError, asyncssh.Error, ConnectionError) as e:
                    last_diag = f"{exe}: excepción {type(e).__name__}: {e}"
                    log.debug("host_stats site=%s %s", site, last_diag)
                    continue
                rc = proc.returncode
                raw = (proc.stdout or "").strip()
                stderr = (proc.stderr or "").strip() if proc.stderr else ""
                if rc is not None and rc != 0:
                    last_diag = (
                        f"{exe}: rc={rc} stderr={_clip_text(stderr, 240)} "
                        f"stdout_head={_clip_text(raw, 240)}"
                    )
                    log.debug("host_stats site=%s %s", site, last_diag)
                    continue
                if not raw:
                    last_diag = f"{exe}: stdout vacío rc={rc!r}"
                    log.debug("host_stats site=%s %s", site, last_diag)
                    continue
                try:
                    parsed = json.loads(raw.splitlines()[-1])
                except (json.JSONDecodeError, TypeError, ValueError) as e:
                    last_diag = f"{exe}: JSON inválido ({e}) stdout_tail={_clip_text(raw, 320)}"
                    log.debug("host_stats site=%s %s", site, last_diag)
                    continue
                if isinstance(parsed, dict):
                    data = parsed
                    break
            if data is None:
                log.warning(
                    "host_stats: no se obtuvieron métricas del host remoto site=%s tunnel_user=%s último_intento=%s",
                    site,
                    ssh_login,
                    last_diag or "sin diagnóstico",
                )
                _host_stats_print(f"FALLO site={site} tunnel_user={ssh_login} -> {last_diag or 'sin diagnóstico'}")
                continue
            rx = data.get("rx_bytes")
            tx = data.get("tx_bytes")
            down_mbps: float | None = None
            up_mbps: float | None = None
            if (
                isinstance(rx, int)
                and isinstance(tx, int)
                and last_rx is not None
                and last_tx is not None
                and last_t is not None
            ):
                dt = max(1e-3, now - last_t)
                drx = max(0, rx - last_rx)
                dtx = max(0, tx - last_tx)
                down_mbps = (drx * 8.0 / 1e6) / dt
                up_mbps = (dtx * 8.0 / 1e6) / dt
            if isinstance(rx, int) and isinstance(tx, int):
                last_rx, last_tx, last_t = rx, tx, now
            data.pop("rx_bytes", None)
            data.pop("tx_bytes", None)
            if down_mbps is not None:
                data["net_down_mbps"] = round(down_mbps, 2)
            if up_mbps is not None:
                data["net_up_mbps"] = round(up_mbps, 2)
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            with contextlib.suppress(OSError, RuntimeError):
                await websocket.send_text(json.dumps({"type": "host_stats", "stats": data}, ensure_ascii=False))
            log.debug(
                "host_stats: enviado site=%s hostname=%r cpu_pct=%s mem_kb=%s/%s",
                site,
                data.get("hostname"),
                data.get("cpu_pct"),
                data.get("mem_avail_kb"),
                data.get("mem_total_kb"),
            )
            _host_stats_print(
                f"OK site={site} hostname={data.get('hostname')!r} "
                f"cpu_pct={data.get('cpu_pct')} load1={data.get('load1')} "
                f"net_down_mbps={data.get('net_down_mbps')} net_up_mbps={data.get('net_up_mbps')}"
            )
    except asyncio.CancelledError:
        log.debug("host_stats: tarea cancelada site=%s", site)
        _host_stats_print(f"tarea cancelada site={site}")
        raise


async def _pump_stdout_to_ws(websocket: WebSocket, process: asyncssh.SSHClientProcess) -> None:
    assert process.stdout is not None
    try:
        while True:
            data = await process.stdout.read(32768)
            if not data:
                if websocket.client_state == WebSocketState.CONNECTED:
                    try:
                        await websocket.send_text(
                            json.dumps(
                                {
                                    "type": "ssh_exit",
                                    "message": "La sesión SSH terminó (shell cerrado o desconexión).",
                                }
                            )
                        )
                    except OSError:
                        pass
                await _safe_ws_close(websocket)
                break
            if websocket.client_state != WebSocketState.CONNECTED:
                break
            await websocket.send_bytes(data)
    except (WebSocketDisconnect, OSError, RuntimeError) as ex:
        log.debug("pump_stdout fin: %s", ex)
