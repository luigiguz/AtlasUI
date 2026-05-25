"""Configuración del repositorio atlas-stores (solo URL Git)."""

from __future__ import annotations

import json

from atlas_core.env import atlas_env
from atlas_core.paths import ATLAS_DATA_DIR, ensure_atlas_data_dir

STORES_SETTINGS_FILE = ATLAS_DATA_DIR / "stores.json"


def load_stores_settings() -> dict[str, str | bool]:
    file_cfg: dict[str, str | bool] = {
        "repo_url": "",
        "branch": "main",
        "git_token": "",
        "auto_pull": True,
        "auto_push": False,
    }
    if STORES_SETTINGS_FILE.is_file():
        try:
            with STORES_SETTINGS_FILE.open(encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = {}
        file_cfg["repo_url"] = str(data.get("repo_url", "")).strip()
        file_cfg["branch"] = str(data.get("branch", "main")).strip() or "main"
        file_cfg["git_token"] = str(data.get("git_token", "")).strip()
        file_cfg["auto_pull"] = bool(data.get("auto_pull", True))
        file_cfg["auto_push"] = bool(data.get("auto_push", False))

    repo_url = atlas_env("ATLAS_STORES_REPO_URL") or str(file_cfg["repo_url"])
    branch = atlas_env("ATLAS_STORES_BRANCH") or str(file_cfg["branch"])
    git_token = atlas_env("ATLAS_STORES_GIT_TOKEN") or str(file_cfg["git_token"])
    auto_pull = atlas_env("ATLAS_STORES_AUTO_PULL").lower() in ("1", "true", "yes") or bool(
        file_cfg["auto_pull"]
    )
    auto_push = atlas_env("ATLAS_STORES_AUTO_PUSH").lower() in ("1", "true", "yes") or bool(
        file_cfg["auto_push"]
    )
    return {
        "repo_url": repo_url.strip(),
        "branch": (branch.strip() or "main"),
        "git_token": git_token.strip(),
        "auto_pull": auto_pull,
        "auto_push": auto_push,
    }


def save_stores_settings(
    *,
    repo_url: str = "",
    branch: str = "main",
    git_token: str = "",
    auto_pull: bool = True,
    auto_push: bool = False,
) -> None:
    ensure_atlas_data_dir()
    prev = load_stores_settings()
    token = git_token.strip() or str(prev.get("git_token") or "")
    blob = {
        "repo_url": repo_url.strip(),
        "branch": (branch.strip() or "main"),
        "git_token": token,
        "auto_pull": bool(auto_pull),
        "auto_push": bool(auto_push),
    }
    with STORES_SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(blob, f, indent=2)
