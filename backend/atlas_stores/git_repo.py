"""Sincronización Git del repositorio atlas-stores."""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

log = logging.getLogger(__name__)

REPO_CACHE_DIR = ATLAS_DATA_DIR / "stores-repo-cache"


class StoresRepoError(Exception):
    pass


def _auth_repo_url(repo_url: str, token: str) -> str:
    if not token.strip():
        return repo_url
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https"):
        return repo_url
    host = parsed.hostname or ""
    netloc = f"x-access-token:{token}@{host}"
    if parsed.port:
        netloc = f"x-access-token:{token}@{host}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def resolve_repo_root(settings: dict[str, str | bool]) -> Path:
    local = str(settings.get("local_path") or "").strip()
    if local:
        root = Path(local).expanduser().resolve()
        if not root.is_dir():
            raise StoresRepoError(f"La ruta local no existe: {root}")
        return root

    repo_url = str(settings.get("repo_url") or "").strip()
    if not repo_url:
        raise StoresRepoError(
            "Configura la ruta local del repositorio atlas-stores o la URL Git (Gestión de Tiendas → Conexión)."
        )

    ensure_atlas_data_dir()
    REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = REPO_CACHE_DIR

    if not (cache / ".git").is_dir():
        if any(cache.iterdir()):
            shutil.rmtree(cache)
            cache.mkdir(parents=True, exist_ok=True)
        url = _auth_repo_url(repo_url, str(settings.get("git_token") or ""))
        branch = str(settings.get("branch") or "main")
        _run_git(["clone", "--branch", branch, "--single-branch", url, str(cache)], cwd=None)
    elif settings.get("auto_pull"):
        _run_git(["pull", "--ff-only"], cwd=cache)

    return cache


def git_pull(settings: dict[str, str | bool]) -> str:
    root = resolve_repo_root(settings)
    if str(settings.get("local_path") or "").strip():
        if not (root / ".git").is_dir():
            return "Ruta local sin repositorio Git; no se hizo pull."
        _run_git(["pull", "--ff-only"], cwd=root)
        return "Repositorio local actualizado (git pull)."
    _run_git(["pull", "--ff-only"], cwd=root)
    return "Repositorio actualizado desde remoto."


def git_commit_and_push(
    settings: dict[str, str | bool],
    *,
    message: str,
) -> str:
    root = resolve_repo_root(settings)
    if not (root / ".git").is_dir():
        return "Cambios guardados en disco (sin Git en esta ruta)."

    _run_git(["add", "-A"], cwd=root)
    status = _run_git(["status", "--porcelain"], cwd=root)
    if not status.strip():
        return "No hay cambios pendientes."

    _run_git(["commit", "-m", message], cwd=root)
    if settings.get("auto_push") and str(settings.get("repo_url") or "").strip():
        _run_git(["push"], cwd=root)
        return "Cambios publicados (commit + push)."
    return "Cambios guardados en commit local (push desactivado)."


def _run_git(args: list[str], *, cwd: Path | None) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except FileNotFoundError as e:
        raise StoresRepoError(
            "Git no está instalado en el contenedor. Usa ruta local montada o instala git."
        ) from e
    except subprocess.TimeoutExpired as e:
        raise StoresRepoError("Timeout ejecutando git.") from e

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        safe = re.sub(r"x-access-token:[^@\s]+", "x-access-token:***", err)
        raise StoresRepoError(safe or f"git {' '.join(args)} falló")
    return (proc.stdout or "").strip()
