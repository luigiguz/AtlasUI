"""Configuración del repositorio atlas-stores (URL Git)."""

from __future__ import annotations

from atlas_core.db.settings import load_namespace, save_namespace
from atlas_core.env import atlas_env

_NAMESPACE = "stores"


def _from_env_and_file(file_cfg: dict[str, str | bool]) -> dict[str, str | bool]:
    repo_url = atlas_env("ATLAS_STORES_REPO_URL") or str(file_cfg.get("repo_url", ""))
    branch = atlas_env("ATLAS_STORES_BRANCH") or str(file_cfg.get("branch", "main"))
    git_token = atlas_env("ATLAS_STORES_GIT_TOKEN") or str(file_cfg.get("git_token", ""))
    auto_pull = atlas_env("ATLAS_STORES_AUTO_PULL").lower() in ("1", "true", "yes") or bool(
        file_cfg.get("auto_pull", True)
    )
    auto_push = atlas_env("ATLAS_STORES_AUTO_PUSH").lower() in ("1", "true", "yes") or bool(
        file_cfg.get("auto_push", True)
    )
    return {
        "repo_url": repo_url.strip(),
        "branch": (branch.strip() or "main"),
        "git_token": git_token.strip(),
        "auto_pull": auto_pull,
        "auto_push": auto_push,
    }


def load_stores_settings() -> dict[str, str | bool]:
    raw = load_namespace(_NAMESPACE)
    file_cfg: dict[str, str | bool] = {
        "repo_url": str(raw.get("repo_url", "")).strip(),
        "branch": str(raw.get("branch", "main")).strip() or "main",
        "git_token": str(raw.get("git_token", "")).strip(),
        "auto_pull": bool(raw.get("auto_pull", True)),
        "auto_push": bool(raw.get("auto_push", True)),
    }
    return _from_env_and_file(file_cfg)


def save_stores_settings(
    *,
    repo_url: str = "",
    branch: str = "main",
    git_token: str = "",
    auto_pull: bool = True,
    auto_push: bool = False,
) -> None:
    prev = load_stores_settings()
    token = git_token.strip() or str(prev.get("git_token") or "")
    blob = {
        "repo_url": repo_url.strip(),
        "branch": (branch.strip() or "main"),
        "git_token": token,
        "auto_pull": bool(auto_pull),
        "auto_push": bool(auto_push),
    }
    save_namespace(_NAMESPACE, blob)
