"""Conexión SSH compartida entre terminal web y SFTP (misma autenticación)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass

import asyncssh

log = logging.getLogger(__name__)

_PASSWORD_TTL_S = 600.0


@dataclass
class _TerminalTunnel:
    conn: asyncssh.SSHClientConnection
    site: str
    atlas_user: str
    ssh_user: str
    port: int
    sftp_refs: int = 0


_lock = asyncio.Lock()
_tunnels: dict[tuple[str, str], _TerminalTunnel] = {}
_passwords: dict[tuple[str, str], tuple[str, float]] = {}


def _key(atlas_user: str, site: str) -> tuple[str, str]:
    return (atlas_user.strip(), site.strip())


def cache_ssh_password(atlas_user: str, site: str, password: str) -> None:
    if not password:
        return
    _passwords[_key(atlas_user, site)] = (password, time.monotonic())


def get_cached_ssh_password(atlas_user: str, site: str) -> str | None:
    key = _key(atlas_user, site)
    row = _passwords.get(key)
    if not row:
        return None
    pw, ts = row
    if time.monotonic() - ts > _PASSWORD_TTL_S:
        _passwords.pop(key, None)
        return None
    return pw


async def register_terminal_ssh(
    atlas_user: str,
    site: str,
    conn: asyncssh.SSHClientConnection,
    *,
    ssh_user: str,
    port: int,
) -> None:
    key = _key(atlas_user, site)
    async with _lock:
        prev = _tunnels.get(key)
        if prev is not None and prev.conn is not conn:
            with contextlib.suppress(Exception):
                prev.conn.close()
        _tunnels[key] = _TerminalTunnel(
            conn=conn,
            site=site,
            atlas_user=atlas_user,
            ssh_user=ssh_user,
            port=port,
        )
    log.debug("ssh shared: terminal registrada atlas=%s site=%s", atlas_user, site)


async def unregister_terminal_ssh(atlas_user: str, site: str) -> None:
    key = _key(atlas_user, site)
    async with _lock:
        row = _tunnels.pop(key, None)
    if not row:
        return
    if row.sftp_refs > 0:
        log.debug("ssh shared: terminal cerrada con %s SFTP activos", row.sftp_refs)
    log.debug("ssh shared: terminal desregistrada atlas=%s site=%s", atlas_user, site)


async def acquire_shared_ssh(
    atlas_user: str, site: str,
) -> _TerminalTunnel | None:
    key = _key(atlas_user, site)
    async with _lock:
        row = _tunnels.get(key)
        if not row:
            return None
        try:
            if row.conn.is_closed():
                _tunnels.pop(key, None)
                return None
        except AttributeError:
            pass
        row.sftp_refs += 1
        return row


async def release_shared_ssh(atlas_user: str, site: str) -> None:
    key = _key(atlas_user, site)
    async with _lock:
        row = _tunnels.get(key)
        if row and row.sftp_refs > 0:
            row.sftp_refs -= 1


async def invalidate_sftp_for_site(atlas_user: str, site: str) -> None:
    """Cierra sesiones SFTP que dependían del túnel (import lazy)."""
    from atlas_vpn import ssh_sftp

    await ssh_sftp.close_sessions_for_site(atlas_user, site)
