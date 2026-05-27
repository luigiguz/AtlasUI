"""Servidor local FastAPI + estáticos React de la plataforma Atlas (módulo Atlas VPN)."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from atlas_vpn.cf_sync import CfSyncError, sync_to_tunnels_json
from atlas_vpn.constants import resolve_ssh_username
from atlas_vpn.pgadmin_launch import launch_pgadmin
from atlas_vpn.poslite_urls import poslite_links_for_site
from atlas_core.env import atlas_env, atlas_env_flag
from atlas_core.paths import PROJECT_ROOT, STATIC_WEB, resolve_logo_path
from atlas_vpn.settings_store import load_settings, save_settings
from atlas_core.permissions import (
    PERM_CF_READ,
    PERM_CF_SYNC,
    PERM_CF_WRITE,
    PERM_ROLES_LIST,
    PERM_ROLES_MANAGE,
    PERM_USERS_CREATE,
    PERM_USERS_DELETE,
    PERM_USERS_LIST,
    PERM_USERS_UPDATE,
    PERM_VPN_INIT,
    PERM_VPN_OPERATE,
    has_permission,
)
from atlas_core.web_auth import (
    assert_login_allowed,
    clear_failed_logins,
    current_user,
    register_failed_login,
    require_permission,
    resolve_user_dict,
    revoke_request_session,
    session_middleware_config,
)
from atlas_core.web_roles import (
    create_role,
    delete_role,
    list_roles,
    permission_catalog,
    update_role,
)
from atlas_core.web_sessions import create_user_session, refresh_access_session
from atlas_rancher.router import router as atlas_rancher_router
from atlas_stores.router import router as atlas_stores_router
from atlas_vpn.ssh_sftp import (
    close_session as sftp_close_session,
    list_directory as sftp_list_directory,
    open_session as sftp_open_session,
    read_file_chunks as sftp_read_file_chunks,
    mkdir as sftp_mkdir,
    remove_path as sftp_remove_path,
    write_file as sftp_write_file,
)
from atlas_vpn.ssh_tunnel import SshTunnelError
from atlas_vpn.ssh_terminal_ws import run_ssh_terminal_ws
from atlas_core.web_tokens import encode_access_token
from atlas_core.web_users import (
    audit,
    create_user,
    delete_user,
    ensure_default_admin,
    init_db,
    list_users,
    update_user,
    verify_login,
)

_SCRIPTS = PROJECT_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
import tunnel_manager as tm


def _api_only() -> bool:
    return atlas_env_flag("API_ONLY")


_log = logging.getLogger("atlas_api")


def _cors_origins() -> list[str]:
    raw = atlas_env(
        "CORS_ORIGINS",
        "https://atlas-ui.verkku.com,https://atlas-vpn.verkku.com,http://127.0.0.1:5173,http://localhost:5173",
    )
    out = [x.strip() for x in raw.split(",") if x.strip()]
    return out if out else ["https://atlas-ui.verkku.com"]


def _cors_origin_regex() -> str | None:
    """Subdominios Verkku en producción (p. ej. atlas-ui, api-atlas-vpn)."""
    raw = atlas_env("CORS_ORIGIN_REGEX", r"https://([a-z0-9-]+\.)*verkku\.com")
    return raw.strip() or None


def _wait_tcp(host: str, port: int, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    last_err: OSError | None = None
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return
        except OSError as e:
            last_err = e
            time.sleep(0.06)
    msg = f"No arrancó el servidor en http://{host}:{port}/"
    if last_err:
        msg += f" ({last_err})"
    raise RuntimeError(msg)


class StartBody(BaseModel):
    site: str
    services: Literal["ssh", "db", "both"] = "both"


class StopBody(BaseModel):
    site: str | None = None
    label: str | None = None


class SyncBody(BaseModel):
    account_id: str
    api_token: str
    domain_suffix: str = "asptienda.com"
    zone_id: str = ""


class SettingsBody(BaseModel):
    account_id: str = ""
    api_token: str = ""
    domain_suffix: str = "asptienda.com"
    zone_id: str = ""


class OpenSshBody(BaseModel):
    site: str


class SftpOpenBody(BaseModel):
    password: str = Field(default="", max_length=512)


class OpenPgAdminBody(BaseModel):
    """Sitio opcional: si tiene BD en tunnels.json, se devuelve pista host/puerto local."""

    site: str = ""


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class RefreshBody(BaseModel):
    refresh_token: str = Field(..., min_length=16, max_length=512)


def _request_client_meta(request: Request) -> tuple[str, str]:
    ip = request.client.host if request.client else ""
    ua = (request.headers.get("user-agent") or "")[:512]
    return ip, ua


class CreateUserBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    email: str = Field(..., min_length=3, max_length=254)
    first_name: str = Field(..., min_length=1, max_length=64)
    last_name: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=12, max_length=256)
    role_ids: list[int] = Field(default_factory=list)
    role: Literal["admin", "operator", "viewer"] | None = None


class UpdateUserBody(BaseModel):
    role_ids: list[int] | None = None
    email: str | None = Field(None, max_length=254)
    first_name: str | None = Field(None, max_length=64)
    last_name: str | None = Field(None, max_length=64)
    password: str | None = Field(None, max_length=256)


class RoleBody(BaseModel):
    slug: str = Field(..., min_length=3, max_length=32)
    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=256)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateBody(BaseModel):
    name: str | None = Field(None, max_length=64)
    description: str | None = Field(None, max_length=256)
    permissions: list[str] | None = None


def _public_user(u: dict[str, Any]) -> dict[str, Any]:
    return {
        "username": str(u.get("username") or ""),
        "role": str(u.get("role") or "viewer"),
        "roles": u.get("roles") or [],
        "permissions": u.get("permissions") or [],
    }


def _encode_token(u: dict[str, Any], jti: str) -> str:
    return encode_access_token(
        username=str(u["username"]),
        role=str(u["role"]),
        user_id=int(u["id"]),
        jti=jti,
        permissions=list(u.get("permissions") or []),
        roles=list(u.get("roles") or []),
    )


def _proc_for_site_label(state: dict, site: str, label: str) -> dict | None:
    for row in state.get("processes", []):
        if row.get("site") == site and row.get("label") == label:
            return row
    return None


def _state_label(row: dict | None) -> str:
    if not row:
        return "idle"
    pid = int(row["pid"])
    return "active" if tm.pid_alive(pid) else "dead"


def _sites_payload(config_path: Path) -> dict[str, Any]:
    cfg = tm.load_config_optional(config_path)
    settings = load_settings()
    domain_suffix = str(settings.get("domain_suffix") or "asptienda.com").strip() or "asptienda.com"
    if not cfg:
        return {
            "configPath": str(config_path),
            "domainSuffix": domain_suffix,
            "sites": [],
        }
    state = tm.read_state()
    root_pd = (
        cfg.get("poslite_defaults")
        if isinstance(cfg.get("poslite_defaults"), dict)
        else None
    )
    sites_out: list[dict[str, Any]] = []
    for name in sorted((cfg.get("sites") or {}).keys()):
        e = (cfg.get("sites") or {})[name]
        if not isinstance(e, dict):
            continue
        ssh = e.get("ssh") if isinstance(e.get("ssh"), dict) else None
        db = e.get("db") if isinstance(e.get("db"), dict) else None
        pr_ssh = _proc_for_site_label(state, name, "ssh")
        pr_db = _proc_for_site_label(state, name, "db")
        portal_links = poslite_links_for_site(name, domain_suffix, e, root_pd)
        sites_out.append(
            {
                "id": name,
                "name": name,
                "ssh": ssh,
                "db": db,
                "sshStatus": _state_label(pr_ssh),
                "dbStatus": _state_label(pr_db),
                "posliteUrls": portal_links,
            }
        )
    return {
        "configPath": str(config_path),
        "domainSuffix": domain_suffix,
        "sites": sites_out,
    }


def _configure_openapi(app: FastAPI) -> None:
    """OpenAPI con esquema Bearer (JWT) para probar rutas en /swagger."""

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {})
        components.setdefault("securitySchemes", {})["BearerAuth"] = {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "Obtén el token con POST /api/auth/login (campo `access_token`).",
        }
        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi  # type: ignore[method-assign]


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        init_db()
        ensure_default_admin()
        yield

    app = FastAPI(
        title="Atlas API",
        description=(
            "API de la plataforma **Atlas** (Atlas VPN, Atlas Rancher, usuarios). "
            "Rutas protegidas: inicia sesión con `POST /api/auth/login`, copia `access_token` "
            "y pulsa **Authorize** (Bearer)."
        ),
        version="1.0",
        lifespan=lifespan,
        docs_url="/swagger",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )
    _configure_openapi(app)
    app.include_router(atlas_rancher_router)
    app.include_router(atlas_stores_router)
    # CORS primero en el stack (último add_middleware) para que también cubra errores 4xx/5xx.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_origin_regex=_cors_origin_regex(),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
    app.add_middleware(SessionMiddleware, **session_middleware_config())

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        if isinstance(exc, HTTPException):
            detail = exc.detail
            if not isinstance(detail, (str, dict, list)):
                detail = str(detail)
            return JSONResponse(status_code=exc.status_code, content={"detail": detail})
        _log.exception("Unhandled %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Error interno del servidor."})

    @app.get("/api/health")
    def health() -> dict[str, str]:
        from atlas_core.db.config import database_url
        from sqlalchemy import create_engine, text

        payload: dict[str, str] = {"status": "ok", "service": "atlas-api"}
        try:
            with create_engine(database_url(), pool_pre_ping=True).connect() as conn:
                conn.execute(text("SELECT 1"))
            payload["database"] = "ok"
        except Exception as e:
            payload["status"] = "degraded"
            payload["database"] = str(e)[:200]
        return payload

    @app.websocket("/api/ws/ssh-terminal")
    async def ws_ssh_terminal(websocket: WebSocket) -> None:
        await run_ssh_terminal_ws(websocket)

    @app.get("/api/logo")
    def logo() -> FileResponse:
        p = resolve_logo_path()
        if not p or not p.is_file():
            raise HTTPException(404, "Sin logo")
        return FileResponse(p, media_type="image/png")

    @app.get("/api/auth/status")
    def auth_status(request: Request) -> dict[str, Any]:
        u = resolve_user_dict(request)
        if u and u.get("username"):
            return {"authenticated": True, "user": _public_user(u)}
        return {"authenticated": False}

    @app.post("/api/auth/login")
    def auth_login(request: Request, body: LoginBody) -> dict[str, Any]:
        try:
            assert_login_allowed(request)
            row = verify_login(body.username.strip(), body.password)
            if not row:
                register_failed_login(request)
                raise HTTPException(401, "Usuario o contraseña incorrectos.")
            clear_failed_logins(request)
            ip, ua = _request_client_meta(request)
            jti, refresh_token = create_user_session(
                user_id=int(row["id"]),
                ip_address=ip,
                user_agent=ua,
            )
            # Cookie de sesión mínima (permisos se recargan vía jti en BD).
            request.session["user"] = {
                "username": row["username"],
                "role": row["role"],
                "id": row["id"],
                "jti": jti,
            }
            audit("login_ok", row["username"], "")
            token = _encode_token(row, jti)
            return {
                "ok": True,
                "user": _public_user(row),
                "access_token": token,
                "refresh_token": refresh_token,
            }
        except HTTPException:
            raise
        except Exception as e:
            _log.exception("auth_login failed", exc_info=e)
            raise HTTPException(
                status_code=500,
                detail="No se pudo iniciar sesión. Revisa los logs del API o vuelve a intentar.",
            ) from e

    @app.post("/api/auth/refresh")
    def auth_refresh(body: RefreshBody) -> dict[str, Any]:
        rotated = refresh_access_session(body.refresh_token.strip())
        if not rotated:
            raise HTTPException(401, "Sesión expirada o inválida. Vuelve a iniciar sesión.")
        jti, refresh_token, user = rotated
        token = _encode_token(user, jti)
        return {
            "ok": True,
            "user": _public_user(user),
            "access_token": token,
            "refresh_token": refresh_token,
        }

    @app.post("/api/auth/logout")
    def auth_logout(request: Request) -> dict[str, bool]:
        u = resolve_user_dict(request)
        if isinstance(u, dict) and u.get("username"):
            audit("logout", str(u.get("username")), "")
        revoke_request_session(request)
        request.session.pop("user", None)
        return {"ok": True}

    @app.get("/api/auth/permissions")
    def auth_permission_catalog(
        _user: dict[str, Any] = Depends(require_permission(PERM_ROLES_LIST, PERM_ROLES_MANAGE)),
    ) -> dict[str, Any]:
        return permission_catalog()

    @app.get("/api/auth/roles")
    def auth_list_roles(
        _user: dict[str, Any] = Depends(
            require_permission(PERM_ROLES_LIST, PERM_ROLES_MANAGE, PERM_USERS_LIST, PERM_USERS_CREATE)
        ),
    ) -> dict[str, Any]:
        return {"roles": list_roles()}

    @app.post("/api/auth/roles")
    def auth_create_role(
        body: RoleBody,
        admin: dict[str, Any] = Depends(require_permission(PERM_ROLES_MANAGE)),
    ) -> dict[str, Any]:
        try:
            row = create_role(
                slug=body.slug,
                name=body.name,
                description=body.description,
                permissions=body.permissions,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        audit("role_created", str(admin.get("username")), body.slug)
        return {"ok": True, "role": row}

    @app.patch("/api/auth/roles/{slug}")
    def auth_update_role(
        slug: str,
        body: RoleUpdateBody,
        admin: dict[str, Any] = Depends(require_permission(PERM_ROLES_MANAGE)),
    ) -> dict[str, Any]:
        try:
            row = update_role(
                slug,
                name=body.name,
                description=body.description,
                permissions=body.permissions,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        audit("role_updated", str(admin.get("username")), slug)
        return {"ok": True, "role": row}

    @app.delete("/api/auth/roles/{slug}")
    def auth_delete_role(
        slug: str,
        admin: dict[str, Any] = Depends(require_permission(PERM_ROLES_MANAGE)),
    ) -> dict[str, bool]:
        try:
            delete_role(slug)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        audit("role_deleted_by_admin", str(admin.get("username")), slug)
        return {"ok": True}

    @app.get("/api/auth/users")
    def auth_list_users(
        _user: dict[str, Any] = Depends(require_permission(PERM_USERS_LIST)),
    ) -> dict[str, Any]:
        try:
            return {"users": list_users()}
        except Exception as e:
            _log.exception("auth_list_users failed", exc_info=e)
            raise HTTPException(status_code=500, detail="No se pudo listar usuarios.") from e

    @app.post("/api/auth/users")
    def auth_create_user(
        body: CreateUserBody,
        admin: dict[str, Any] = Depends(require_permission(PERM_USERS_CREATE)),
    ) -> dict[str, bool]:
        try:
            create_user(
                body.username.strip(),
                body.password,
                email=body.email,
                first_name=body.first_name,
                last_name=body.last_name,
                role_ids=body.role_ids or None,
                role=body.role,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        audit("user_created_by_admin", str(admin.get("username")), body.username.strip().lower())
        return {"ok": True}

    @app.patch("/api/auth/users/{username}")
    def auth_update_user(
        username: str,
        body: UpdateUserBody,
        admin: dict[str, Any] = Depends(require_permission(PERM_USERS_UPDATE)),
    ) -> dict[str, bool]:
        pw = (body.password or "").strip() or None
        try:
            update_user(
                username,
                actor_username=str(admin.get("username") or ""),
                role_ids=body.role_ids,
                password=pw,
                email=body.email.strip() if body.email is not None else None,
                first_name=body.first_name.strip() if body.first_name is not None else None,
                last_name=body.last_name.strip() if body.last_name is not None else None,
            )
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"ok": True}

    @app.delete("/api/auth/users/{username}")
    def auth_delete_user(
        username: str,
        admin: dict[str, Any] = Depends(require_permission(PERM_USERS_DELETE)),
    ) -> dict[str, bool]:
        try:
            delete_user(username, actor_username=str(admin.get("username") or ""))
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"ok": True}

    @app.get("/api/settings")
    def get_settings(user: dict[str, Any] = Depends(current_user)) -> dict[str, str]:
        s = load_settings()
        out = {
            "account_id": s.get("account_id", ""),
            "api_token": s.get("api_token", ""),
            "domain_suffix": s.get("domain_suffix", "asptienda.com"),
            "zone_id": s.get("zone_id", ""),
        }
        if not has_permission(user, PERM_CF_READ):
            out["api_token"] = ""
            out["account_id"] = ""
        elif not has_permission(user, PERM_CF_WRITE):
            out["api_token"] = ""
        return out

    @app.post("/api/settings")
    def post_settings(
        body: SettingsBody,
        _admin: dict[str, Any] = Depends(require_permission(PERM_CF_WRITE)),
    ) -> dict[str, str]:
        save_settings(
            body.account_id,
            body.api_token,
            body.domain_suffix or "asptienda.com",
            body.zone_id,
        )
        return {"ok": "true"}

    @app.get("/api/sites")
    def get_sites(_user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return _sites_payload(tm.default_config_path())

    @app.post("/api/start")
    def post_start(
        body: StartBody,
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        ok, lines = tm.start_site_services(
            body.site, body.services, tm.default_config_path()
        )
        return {"ok": ok, "lines": lines}

    @app.post("/api/stop")
    def post_stop(
        body: StopBody,
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        if body.label and body.site is None:
            raise HTTPException(
                status_code=400,
                detail="Para detener solo SSH o BD indica también el sitio (site).",
            )
        if body.label is not None and body.label not in ("ssh", "db"):
            raise HTTPException(status_code=400, detail='label debe ser "ssh" o "db".')
        lines = tm.stop_tunnels(body.site, body.label)
        return {"ok": True, "lines": lines}

    @app.post("/api/sync")
    def post_sync(
        body: SyncBody,
        _admin: dict[str, Any] = Depends(require_permission(PERM_CF_SYNC)),
    ) -> dict[str, Any]:
        try:
            n, msg = sync_to_tunnels_json(
                body.account_id,
                body.api_token,
                body.domain_suffix or "asptienda.com",
                tm.default_config_path(),
                zone_id=body.zone_id.strip(),
            )
            return {"ok": True, "sitesCount": n, "message": msg}
        except CfSyncError as e:
            return JSONResponse(
                status_code=400, content={"ok": False, "message": str(e)}
            )

    @app.post("/api/init-template")
    def post_init(_admin: dict[str, Any] = Depends(require_permission(PERM_VPN_INIT))) -> dict[str, Any]:
        ok, msg = tm.init_config_from_example()
        return {"ok": ok, "message": msg}

    @app.post("/api/open-ssh-terminal")
    def post_open_ssh(
        body: OpenSshBody,
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        cfg = tm.load_config_optional(tm.default_config_path())
        if not cfg:
            raise HTTPException(400, "Sin tunnels.json")
        entry = (cfg.get("sites") or {}).get(body.site) or {}
        ssh = entry.get("ssh")
        if not isinstance(ssh, dict) or ssh.get("local_port") in (None, ""):
            raise HTTPException(400, "Sitio sin SSH")
        try:
            port = int(ssh["local_port"])
        except (TypeError, ValueError) as e:
            raise HTTPException(400, "Puerto inválido") from e
        user = resolve_ssh_username(ssh)
        try:
            if sys.platform == "win32":
                wt = shutil.which("wt")
                if wt:
                    subprocess.Popen(
                        [
                            wt,
                            "new-tab",
                            "--title",
                            f"SSH {body.site}",
                            "ssh",
                            f"{user}@localhost",
                            "-p",
                            str(port),
                        ],
                        cwd=str(Path.home()),
                    )
                else:
                    creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
                    subprocess.Popen(
                        ["ssh", f"{user}@localhost", "-p", str(port)],
                        creationflags=creationflags,
                    )
            elif sys.platform == "darwin":
                cmd = f"ssh {user}@localhost -p {port}"
                subprocess.Popen(["osascript", "-e", f'tell app "Terminal" to do script "{cmd}"'])
            else:
                if shutil.which("gnome-terminal"):
                    subprocess.Popen(
                        ["gnome-terminal", "--", "ssh", f"{user}@localhost", "-p", str(port)]
                    )
                elif shutil.which("konsole"):
                    subprocess.Popen(
                        ["konsole", "-e", f"ssh {user}@localhost -p {port}"]
                    )
                elif shutil.which("x-terminal-emulator"):
                    subprocess.Popen(
                        ["x-terminal-emulator", "-e", f"ssh {user}@localhost -p {port}"]
                    )
                else:
                    raise HTTPException(500, "No hay terminal gráfica")
        except OSError as e:
            raise HTTPException(500, str(e)) from e
        return {"ok": True, "command": f"ssh {user}@localhost -p {port}"}

    @app.post("/api/sftp/{site}/session")
    async def post_sftp_session(
        site: str,
        body: SftpOpenBody,
        op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        try:
            row = await sftp_open_session(
                site,
                password=body.password or None,
                atlas_user=str(op.get("username") or ""),
            )
        except SshTunnelError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"ok": True, **row}

    @app.delete("/api/sftp/session/{session_id}")
    async def delete_sftp_session(
        session_id: str,
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, bool]:
        await sftp_close_session(session_id)
        return {"ok": True}

    @app.get("/api/sftp/session/{session_id}/list")
    async def get_sftp_list(
        session_id: str,
        path: str = Query(default="/"),
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        try:
            return await sftp_list_directory(session_id, path)
        except SshTunnelError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.get("/api/sftp/session/{session_id}/download")
    async def get_sftp_download(
        session_id: str,
        path: str = Query(..., min_length=1),
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> StreamingResponse:
        import posixpath as pp

        name = pp.basename(path.rstrip("/")) or "download.bin"

        async def _body() -> Any:
            try:
                async for chunk in sftp_read_file_chunks(session_id, path):
                    yield chunk
            except SshTunnelError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

        return StreamingResponse(
            _body(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @app.post("/api/sftp/session/{session_id}/upload")
    async def post_sftp_upload(
        session_id: str,
        path: str = Query(..., min_length=1),
        file: UploadFile = File(...),
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        try:
            data = await file.read()
            return await sftp_write_file(session_id, path, data)
        except SshTunnelError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/api/sftp/session/{session_id}/mkdir")
    async def post_sftp_mkdir(
        session_id: str,
        path: str = Query(..., min_length=1),
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        try:
            return await sftp_mkdir(session_id, path)
        except SshTunnelError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.delete("/api/sftp/session/{session_id}/entry")
    async def delete_sftp_entry(
        session_id: str,
        path: str = Query(..., min_length=1),
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, bool]:
        try:
            await sftp_remove_path(session_id, path)
        except SshTunnelError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        return {"ok": True}

    @app.post("/api/open-pgadmin")
    def post_open_pgadmin(
        body: OpenPgAdminBody,
        _op: dict[str, Any] = Depends(require_permission(PERM_VPN_OPERATE)),
    ) -> dict[str, Any]:
        hint: str | None = None
        site = (body.site or "").strip()
        if site:
            cfg = tm.load_config_optional(tm.default_config_path())
            if cfg:
                entry = (cfg.get("sites") or {}).get(site) or {}
                db = entry.get("db")
                if isinstance(db, dict) and db.get("local_port") not in (None, ""):
                    try:
                        port = int(db["local_port"])
                    except (TypeError, ValueError):
                        pass
                    else:
                        hint = (
                            f"Conexión sugerida para «{site}»: host 127.0.0.1, puerto {port} "
                            "(con el túnel BD activo)."
                        )
        ok, msg = launch_pgadmin()
        if not ok:
            raise HTTPException(status_code=400, detail=msg)
        return {"ok": True, "executable": msg, "hint": hint}

    if _api_only():

        @app.get("/")
        def root_api() -> dict[str, str]:
            return {
                "service": "atlas-api",
                "status": "ok",
                "swagger": "/swagger",
                "openapi": "/openapi.json",
            }

    elif STATIC_WEB.is_dir() and (STATIC_WEB / "index.html").is_file():
        assets_dir = STATIC_WEB / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(STATIC_WEB / "index.html")

        @app.get("/favicon.ico")
        def fav() -> FileResponse:
            p = resolve_logo_path()
            if p and p.is_file():
                return FileResponse(p)
            raise HTTPException(404)

    return app


def run_web_desktop(host: str = "127.0.0.1", port: int = 8765) -> None:
    """Ventana de escritorio (WebView2 / pywebview) con la misma UI React; sin navegador externo."""
    if _api_only():
        print("ATLAS_API_ONLY=1: la UI integrada requiere estáticos; ejecuta sin esta variable.", file=sys.stderr)
        sys.exit(2)
    if not (STATIC_WEB / "index.html").is_file():
        print(
            "Atlas (web): no se encontró la UI compilada.\n"
            f"  Esperado: {STATIC_WEB / 'index.html'}\n"
            "  Ejecuta en la carpeta ui/:  npm install && npm run build\n",
            file=sys.stderr,
        )
        sys.exit(2)
    try:
        import webview
    except ImportError as e:
        print(
            "Falta el paquete pywebview (ventana integrada).\n"
            "  pip install pywebview\n"
            "  O usa: python -m atlas_api --browser\n",
            file=sys.stderr,
        )
        raise SystemExit(2) from e

    import uvicorn

    app = create_app()
    config = uvicorn.Config(app, host=host, port=port, log_level="warning")
    server = uvicorn.Server(config)

    def _serve() -> None:
        asyncio.run(server.serve())

    thread = threading.Thread(target=_serve, daemon=True)
    thread.start()
    try:
        _wait_tcp(host, port)
    except RuntimeError as err:
        print(str(err), file=sys.stderr)
        server.should_exit = True
        thread.join(timeout=6.0)
        sys.exit(2)

    url = f"http://{host}:{port}/"
    webview.create_window(
        "Atlas",
        url,
        width=1220,
        height=800,
        min_size=(720, 520),
        resizable=True,
    )
    print(
        "Atlas: ventana de escritorio Windows (motor WebView2 integrado).\n"
        "         No se abre Chrome ni Edge como navegador; es una ventana propia de la app.\n"
        f"         Origen local: {url}"
    )
    try:
        if sys.platform == "win32":
            webview.start(debug=False, gui="edgechromium")
        else:
            webview.start(debug=False)
    except Exception as exc:
        print(
            f"Aviso: no se pudo usar WebView2 explícito ({exc}); probando interfaz gráfica por defecto.",
            file=sys.stderr,
        )
        webview.start(debug=False)
    server.should_exit = True
    thread.join(timeout=12.0)


def run_web_server(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True) -> None:
    if _api_only():
        pass
    elif not (STATIC_WEB / "index.html").is_file():
        print(
            "Atlas (web): no se encontró la UI compilada.\n"
            f"  Esperado: {STATIC_WEB / 'index.html'}\n"
            "  Ejecuta en la carpeta ui/:  npm install && npm run build\n",
            file=sys.stderr,
        )
        sys.exit(2)
    import uvicorn

    app = create_app()
    url = f"http://{host}:{port}/"
    if open_browser:

        def _open() -> None:
            webbrowser.open(url)

        threading.Timer(0.6, _open).start()
    print(f"Atlas web: {url} (Ctrl+C para salir)")
    uvicorn.run(app, host=host, port=port, log_level="warning")
