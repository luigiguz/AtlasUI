"""Resolución de sitio → túnel SSH local (compartido terminal / SFTP)."""

from __future__ import annotations

from typing import Any

from atlas_vpn.constants import resolve_ssh_username

from atlas_core.paths import SCRIPTS_DIR
import sys

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
import tunnel_manager as tm  # noqa: E402


def tunnel_ssh_host() -> str:
    return tm.tunnel_connect_host()


class SshTunnelError(ValueError):
    """Configuración o sitio inválido para SSH."""


def resolve_site_ssh(site: str) -> tuple[str, int, str]:
    """Devuelve (site_key, local_port, ssh_username)."""
    key = (site or "").strip()
    if not key:
        raise SshTunnelError("Falta el sitio.")
    cfg = tm.load_config_optional(tm.default_config_path())
    if not cfg:
        raise SshTunnelError("Sin tunnels.json.")
    entry = (cfg.get("sites") or {}).get(key) or {}
    ssh = entry.get("ssh")
    if not isinstance(ssh, dict) or ssh.get("local_port") in (None, ""):
        raise SshTunnelError("Sitio sin SSH en la configuración.")
    try:
        port = int(ssh["local_port"])
    except (TypeError, ValueError) as e:
        raise SshTunnelError("Puerto SSH inválido.") from e
    if port < 1 or port > 65535:
        raise SshTunnelError("Puerto SSH fuera de rango.")
    user = resolve_ssh_username(ssh)
    return key, port, user
