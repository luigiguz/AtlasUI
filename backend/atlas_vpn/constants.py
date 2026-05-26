"""Valores compartidos entre GUI clásica, servidor web y scripts."""

from __future__ import annotations

import re

SSH_LOCAL_USER = "admin"
_SSH_LOGIN_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,64}$")


def resolve_ssh_username(ssh: dict | None) -> str:
    """Usuario para `ssh usuario@localhost -p …` y terminal web. Por defecto SSH_LOCAL_USER."""
    if not isinstance(ssh, dict):
        return SSH_LOCAL_USER
    for key in ("ssh_user", "user", "local_user"):
        v = ssh.get(key)
        if isinstance(v, str) and v.strip():
            s = v.strip()
            if _SSH_LOGIN_RE.match(s):
                return s
    return SSH_LOCAL_USER
