"""SFTP sobre el túnel SSH local (mismo host/puerto que la terminal web)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import posixpath
import secrets
import stat
import time
from dataclasses import dataclass
from typing import Any, AsyncIterator

import asyncssh
from asyncssh.sftp import SFTPClient, SFTPName

from atlas_vpn.ssh_shared import (
    acquire_shared_ssh,
    get_cached_ssh_password,
    release_shared_ssh,
)
from atlas_vpn.ssh_tunnel import SshTunnelError, resolve_site_ssh

log = logging.getLogger(__name__)

SESSION_TTL_S = 1800.0
_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
_CONNECT_TIMEOUT_S = 20.0
_SFTP_START_TIMEOUT_S = 12.0


@dataclass
class _SftpSession:
    site: str
    atlas_user: str
    ssh_user: str
    port: int
    conn: asyncssh.SSHClientConnection | None
    sftp: SFTPClient
    owns_connection: bool
    created_at: float
    last_used: float


_sessions: dict[str, _SftpSession] = {}
_lock = asyncio.Lock()


def _normalize_remote_path(path: str) -> str:
    raw = (path or "").strip().replace("\\", "/")
    if not raw or raw == "/":
        return "/"
    if not raw.startswith("/"):
        raw = f"/{raw}"
    parts: list[str] = []
    for seg in raw.split("/"):
        if not seg or seg == ".":
            continue
        if seg == "..":
            raise SshTunnelError("Ruta no permitida.")
        parts.append(seg)
    return "/" + "/".join(parts) if parts else "/"


def _auth_error_message(ssh_user: str, exc: BaseException) -> str:
    s = str(exc).lower()
    if "permission denied" in s or "authentication failed" in s or "auth fail" in s:
        return (
            f"SSH no aceptó la autenticación para «{ssh_user}». "
            "Vuelve a escribir la contraseña en la terminal y pulsa «Reintentar SFTP»."
        )
    return (
        "No se pudo conectar por SFTP al túnel SSH. "
        "¿Está activo el túnel SSH de este sitio?"
    )


async def _purge_expired() -> None:
    now = time.monotonic()
    stale = [
        sid
        for sid, s in _sessions.items()
        if now - s.last_used > SESSION_TTL_S
    ]
    for sid in stale:
        await close_session(sid)


async def _open_sftp_on_connection(
    conn: asyncssh.SSHClientConnection,
) -> tuple[SFTPClient, str]:
    sftp = await asyncio.wait_for(conn.start_sftp_client(), timeout=_SFTP_START_TIMEOUT_S)
    home = await asyncio.wait_for(sftp.realpath("."), timeout=10.0)
    return sftp, home


async def open_session(
    site: str,
    *,
    password: str | None,
    atlas_user: str,
) -> dict[str, Any]:
    """SFTP: primero canal sobre la SSH de la terminal; si falla, conexión propia con contraseña en caché."""
    await _purge_expired()
    site_key, port, ssh_user = resolve_site_ssh(site)
    pw = (password or "").strip() or (get_cached_ssh_password(atlas_user, site_key) or "")
    reused = False
    conn: asyncssh.SSHClientConnection | None = None
    owns_connection = False
    sftp: SFTPClient | None = None
    home = "/"

    shared_row = await acquire_shared_ssh(atlas_user, site_key)
    if shared_row is not None:
        try:
            sftp, home = await _open_sftp_on_connection(shared_row.conn)
            reused = True
            log.info("sftp: canal sobre terminal web site=%s user=%s", site_key, atlas_user)
        except Exception as e:
            await release_shared_ssh(atlas_user, site_key)
            log.warning("sftp: fallo canal compartido site=%s: %s", site_key, e)
            sftp = None

    if sftp is None:
        if not pw:
            raise SshTunnelError(
                "No hay contraseña SSH en caché. Escribe la contraseña en la terminal web "
                "(si la pide) y pulsa «Reintentar SFTP»."
            )
        try:
            conn = await asyncssh.connect(
                host="127.0.0.1",
                port=port,
                username=ssh_user,
                password=pw,
                known_hosts=None,
                client_keys=None,
                connect_timeout=_CONNECT_TIMEOUT_S,
                login_timeout=_CONNECT_TIMEOUT_S,
            )
            owns_connection = True
            sftp, home = await _open_sftp_on_connection(conn)
            log.info("sftp: conexión dedicada site=%s port=%s", site_key, port)
        except asyncio.TimeoutError:
            if conn is not None:
                conn.close()
                await conn.wait_closed()
            raise SshTunnelError("Tiempo de espera al conectar SFTP al túnel SSH.") from None
        except (OSError, asyncssh.Error) as e:
            if conn is not None:
                conn.close()
                await conn.wait_closed()
            raise SshTunnelError(_auth_error_message(ssh_user, e)) from e

    assert sftp is not None
    session_id = secrets.token_urlsafe(24)
    now = time.monotonic()
    async with _lock:
        await _purge_expired()
        _sessions[session_id] = _SftpSession(
            site=site_key,
            atlas_user=atlas_user,
            ssh_user=ssh_user,
            port=port,
            conn=conn if owns_connection else None,
            sftp=sftp,
            owns_connection=owns_connection,
            created_at=now,
            last_used=now,
        )
    return {
        "session_id": session_id,
        "site": site_key,
        "user": ssh_user,
        "port": port,
        "home": home,
        "reused_terminal_ssh": reused,
    }


async def close_sessions_for_site(atlas_user: str, site: str) -> None:
    site_key = site.strip()
    async with _lock:
        doomed = [sid for sid, s in _sessions.items() if s.atlas_user == atlas_user and s.site == site_key]
    for sid in doomed:
        await close_session(sid)


async def _get_session(session_id: str) -> _SftpSession:
    sid = (session_id or "").strip()
    if not sid:
        raise SshTunnelError("Sesión SFTP inválida.")
    async with _lock:
        row = _sessions.get(sid)
        if not row:
            raise SshTunnelError("Sesión SFTP caducada o inexistente. Vuelve a conectar.")
        row.last_used = time.monotonic()
        return row


async def close_session(session_id: str) -> None:
    async with _lock:
        row = _sessions.pop((session_id or "").strip(), None)
    if not row:
        return
    with contextlib.suppress(Exception):
        row.sftp.exit()
    if row.owns_connection and row.conn is not None:
        row.conn.close()
        await row.conn.wait_closed()
    else:
        await release_shared_ssh(row.atlas_user, row.site)


async def list_directory(session_id: str, path: str) -> dict[str, Any]:
    row = await _get_session(session_id)
    remote = _normalize_remote_path(path)
    try:
        names: list[SFTPName] = await row.sftp.readdir(remote)
    except (OSError, asyncssh.SFTPError) as e:
        raise SshTunnelError(f"No se pudo listar «{remote}»: {e}") from e
    entries: list[dict[str, Any]] = []
    for ent in sorted(names, key=lambda x: (not _entry_is_dir(x), x.filename.lower())):
        name = ent.filename
        if name in (".", ".."):
            continue
        is_dir = _entry_is_dir(ent)
        entries.append(
            {
                "name": name,
                "path": posixpath.join(remote, name) if remote != "/" else f"/{name}",
                "is_dir": is_dir,
                "size": int(ent.attrs.size or 0) if not is_dir and ent.attrs else None,
                "mtime": float(ent.attrs.mtime) if ent.attrs and ent.attrs.mtime else None,
            }
        )
    parent = posixpath.dirname(remote.rstrip("/")) if remote != "/" else None
    return {"path": remote, "parent": parent or None, "entries": entries}


def _entry_is_dir(ent: SFTPName) -> bool:
    attrs = ent.attrs
    if not attrs:
        return False
    if attrs.type is not None:
        return stat.S_ISDIR(attrs.type)
    if attrs.permissions is not None:
        return stat.S_ISDIR(attrs.permissions)
    return False


async def read_file_chunks(session_id: str, path: str, *, chunk_size: int = 65536) -> AsyncIterator[bytes]:
    row = await _get_session(session_id)
    remote = _normalize_remote_path(path)
    try:
        async with row.sftp.open(remote, "rb") as f:
            while True:
                chunk = await f.read(chunk_size)
                if not chunk:
                    break
                yield chunk
    except (OSError, asyncssh.SFTPError) as e:
        raise SshTunnelError(f"No se pudo descargar «{remote}»: {e}") from e


async def write_file(session_id: str, path: str, data: bytes, *, append: bool = False) -> dict[str, Any]:
    if len(data) > _MAX_UPLOAD_BYTES:
        raise SshTunnelError(f"Archivo demasiado grande (máx. {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB).")
    row = await _get_session(session_id)
    remote = _normalize_remote_path(path)
    mode = "ab" if append else "wb"
    try:
        async with row.sftp.open(remote, mode) as f:
            await f.write(data)
    except (OSError, asyncssh.SFTPError) as e:
        raise SshTunnelError(f"No se pudo subir a «{remote}»: {e}") from e
    return {"ok": True, "path": remote, "size": len(data)}


async def mkdir(session_id: str, path: str) -> dict[str, Any]:
    row = await _get_session(session_id)
    remote = _normalize_remote_path(path)
    try:
        await row.sftp.mkdir(remote)
    except (OSError, asyncssh.SFTPError) as e:
        raise SshTunnelError(f"No se pudo crear la carpeta «{remote}»: {e}") from e
    return {"ok": True, "path": remote}


async def remove_path(session_id: str, path: str) -> None:
    row = await _get_session(session_id)
    remote = _normalize_remote_path(path)
    try:
        st = await row.sftp.stat(remote)
        if stat.S_ISDIR(st.type):
            await row.sftp.rmdir(remote)
        else:
            await row.sftp.remove(remote)
    except (OSError, asyncssh.SFTPError) as e:
        raise SshTunnelError(f"No se pudo eliminar «{remote}»: {e}") from e
