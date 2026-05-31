"""Sincronización Git del repositorio atlas-stores."""

from __future__ import annotations

import contextlib
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import quote, urlparse, urlunparse

from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

log = logging.getLogger(__name__)

REPO_CACHE_DIR = ATLAS_DATA_DIR / "stores-repo-cache"
_STASH_LABEL = "atlas-stores-sync"


class StoresRepoError(Exception):
    pass


def _strip_url_credentials(repo_url: str) -> str:
    parsed = urlparse(repo_url.strip())
    if not parsed.scheme or not parsed.hostname:
        return repo_url.strip()
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    return urlunparse((parsed.scheme, host, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _git_credential_pair(settings: dict[str, str | bool]) -> tuple[str, str] | None:
    token = str(settings.get("git_token") or "").strip()
    if not token:
        return None
    username = str(settings.get("git_username") or "").strip()
    repo_url = str(settings.get("repo_url") or "").strip()
    host = (urlparse(repo_url).hostname or "").lower()

    if username:
        return username, token
    if "github.com" in host:
        return "x-access-token", token
    if "gitlab" in host:
        return "oauth2", token
    if "dev.azure.com" in host or "visualstudio.com" in host:
        return "pat", token
    return "git", token


def _auth_repo_url(repo_url: str, settings: dict[str, str | bool]) -> str:
    creds = _git_credential_pair(settings)
    clean = _strip_url_credentials(repo_url)
    if not creds:
        return clean
    user, password = creds
    parsed = urlparse(clean)
    if parsed.scheme not in ("http", "https"):
        return clean
    host = parsed.hostname or ""
    if parsed.port:
        host = f"{host}:{parsed.port}"
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{host}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _sync_remote_auth(root: Path, settings: dict[str, str | bool]) -> None:
    """Aplica URL con credenciales al remoto y la identidad de commit."""
    repo_url = str(settings.get("repo_url") or "").strip()
    if not repo_url or not (root / ".git").is_dir():
        return
    clean_url = _strip_url_credentials(repo_url)
    auth_url = _auth_repo_url(clean_url, settings)
    _run_git(["remote", "set-url", "origin", auth_url], cwd=root)

    name = str(settings.get("git_username") or "").strip() or "Atlas"
    email = str(settings.get("git_email") or "").strip() or "atlas@verkku.local"
    _run_git(["config", "user.name", name], cwd=root)
    _run_git(["config", "user.email", email], cwd=root)


def _ensure_repo_root(settings: dict[str, str | bool]) -> Path:
    """Clona el repo si hace falta; no hace pull."""
    repo_url = str(settings.get("repo_url") or "").strip()
    if not repo_url:
        raise StoresRepoError(
            "Configura la URL Git del repositorio atlas-stores (Gestión de Tiendas → Conexión repositorio)."
        )

    ensure_atlas_data_dir()
    REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = REPO_CACHE_DIR

    if not (cache / ".git").is_dir():
        if any(cache.iterdir()):
            shutil.rmtree(cache)
            cache.mkdir(parents=True, exist_ok=True)
        url = _auth_repo_url(repo_url, settings)
        branch = str(settings.get("branch") or "main")
        _run_git(["clone", "--branch", branch, "--single-branch", url, str(cache)], cwd=None)
    else:
        _sync_remote_auth(cache, settings)

    return cache


def _working_tree_dirty(root: Path) -> bool:
    return bool(_run_git(["status", "--porcelain"], cwd=root).strip())


def _pull_ff_only(root: Path, settings: dict[str, str | bool]) -> None:
    """Pull fast-forward; si hay cambios locales sin commit, los aparta con stash."""
    _sync_remote_auth(root, settings)
    stashed = False
    if _working_tree_dirty(root):
        log.info("stores git: cambios locales sin commit; stash antes de pull")
        _run_git(["stash", "push", "-u", "-m", _STASH_LABEL], cwd=root)
        stashed = True
    try:
        _run_git(["pull", "--ff-only"], cwd=root)
    except StoresRepoError:
        if stashed:
            with contextlib.suppress(StoresRepoError):
                _run_git(["stash", "pop"], cwd=root)
        raise
    if stashed:
        try:
            _run_git(["stash", "pop"], cwd=root)
        except StoresRepoError as e:
            raise StoresRepoError(
                "Hay cambios locales sin publicar que chocan con el remoto. "
                "Publica la tienda desde Atlas o sincroniza de nuevo; si persiste, "
                "revisa el repositorio en el servidor (caché stores-repo-cache)."
            ) from e


def resolve_repo_root(settings: dict[str, str | bool], *, pull: bool | None = None) -> Path:
    root = _ensure_repo_root(settings)
    should_pull = settings.get("auto_pull") if pull is None else pull
    if should_pull:
        _pull_ff_only(root, settings)
    return root


def git_pull(settings: dict[str, str | bool]) -> str:
    root = _ensure_repo_root(settings)
    _pull_ff_only(root, settings)
    return "Repositorio actualizado desde remoto."


def git_test_connection(settings: dict[str, str | bool]) -> str:
    """Comprueba clone/remoto y credenciales Git."""
    if not str(settings.get("git_token") or "").strip():
        raise StoresRepoError(
            "Falta el token Git (PAT). Configúralo en Conexión repositorio para repos privados."
        )
    root = _ensure_repo_root(settings)
    _sync_remote_auth(root, settings)
    branch = str(settings.get("branch") or "main").strip() or "main"
    out = _run_git(["ls-remote", "--heads", "origin", branch], cwd=root)
    if not out.strip():
        raise StoresRepoError(
            f"Conectado al remoto, pero la rama «{branch}» no existe o no tienes permiso para leerla."
        )
    return f"Conexión Git correcta (rama {branch})."


def git_commit_and_push(
    settings: dict[str, str | bool],
    *,
    message: str,
) -> str:
    """Commit de cambios en disco, rebase sobre remoto y push."""
    root = _ensure_repo_root(settings)
    if not (root / ".git").is_dir():
        return "Cambios guardados en disco (sin Git en esta ruta)."

    if not str(settings.get("git_token") or "").strip():
        raise StoresRepoError(
            "Falta el token Git (PAT) para publicar. Configúralo en Conexión repositorio."
        )

    _sync_remote_auth(root, settings)
    _run_git(["add", "-A"], cwd=root)
    status = _run_git(["status", "--porcelain"], cwd=root)
    if not status.strip():
        return "No hay cambios pendientes."

    _run_git(["commit", "-m", message], cwd=root)
    repo_url = str(settings.get("repo_url") or "").strip()
    if not repo_url:
        return "Cambios guardados en el workspace (sin URL de repositorio remoto)."

    try:
        _run_git(["pull", "--rebase"], cwd=root)
    except StoresRepoError as e:
        with contextlib.suppress(StoresRepoError):
            _run_git(["rebase", "--abort"], cwd=root)
        raise StoresRepoError(
            "No se pudo integrar cambios remotos antes de publicar. "
            "Pulsa «Actualizar» para traer el remoto e inténtalo de nuevo."
        ) from e

    _run_git(["push"], cwd=root)
    branch = str(settings.get("branch") or "main").strip() or "main"
    return f"Cambios publicados en el repositorio remoto (rama {branch})."


def _humanize_git_error(err: str) -> str:
    low = err.lower()
    if any(x in low for x in ("authentication failed", "401", "403", "invalid credentials", "access denied")):
        return (
            "Autenticación Git fallida. Revisa la URL, el usuario (si aplica) y el token/PAT "
            "en Conexión repositorio."
        )
    if "could not read username" in low or "terminal prompts disabled" in low:
        return (
            "Git necesita credenciales. Añade un token/PAT en Conexión repositorio "
            "(Azure DevOps, GitHub, GitLab, etc.)."
        )
    return err


def _run_git(args: list[str], *, cwd: Path | None) -> str:
    try:
        proc = subprocess.run(
            ["git", *args],
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            env={
                **os.environ,
                "GIT_TERMINAL_PROMPT": "0",
            },
        )
    except FileNotFoundError as e:
        raise StoresRepoError(
            "Git no está instalado en el contenedor atlas-api."
        ) from e
    except subprocess.TimeoutExpired as e:
        raise StoresRepoError("Timeout ejecutando git.") from e

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        safe = re.sub(r"x-access-token:[^@\s]+", "x-access-token:***", err)
        safe = re.sub(r"://[^@\s]+@", "://***@", safe)
        raise StoresRepoError(_humanize_git_error(safe or f"git {' '.join(args)} falló"))
    return (proc.stdout or "").strip()
