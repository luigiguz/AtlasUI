# Backend Atlas

Código Python de la plataforma **Atlas**, organizado por capas. La UI está en `ui/`; el build va a `ui/dist/`.

## Estructura

```
backend/
├── atlas_core/          # Compartido: auth, usuarios, JWT, rutas del proyecto
├── atlas_vpn/           # Módulo Atlas VPN (Cloudflare, túneles, SSH, Poslite, GUI legacy)
├── atlas_rancher/       # Módulo Atlas Rancher (placeholder; API en desarrollo)
└── atlas_api/           # FastAPI + entrada CLI (`python -m atlas_api`)

scripts/                 # CLI cloudflared (`tunnel_manager.py`)
ui/
├── public/branding/     # Logos Atlas, Verkku, Rancher (PNG/SVG)
└── dist/                # Salida de `npm run build` (generado)
```

## Paquetes

| Paquete | Responsabilidad |
|---------|-----------------|
| **atlas_core** | Sesiones, usuarios SQLite, JWT, `paths` (`.atlas/`, `ui/public/branding/`, `scripts/tunnels.json`) |
| **atlas_vpn** | Sync Cloudflare, settings, SSH WebSocket, Poslite, pgAdmin, CustomTkinter |
| **atlas_rancher** | Rancher API: listado de Custom clusters (`/api/atlas-rancher/custom-clusters`) |
| **atlas_api** | `create_app()`, `run_web_server()`, `run_web_desktop()`, `__main__` |

## Cómo se ejecuta

Desde la raíz del repo (con `backend/` en el path vía `atlas_api.__main__`):

```bash
python -m atlas_api              # WebView2 + API
python -m atlas_api --no-browser   # Solo API (Docker)
python -m atlas_api --browser
python -m atlas_api --tk         # GUI legacy CustomTkinter
```

En Docker el `WORKDIR` es `/app`; se copia `backend/` y el comando es `python -m atlas_api`.

## Atlas Rancher

- Config: `.atlas/rancher.json` o variables `ATLAS_RANCHER_URL`, `ATLAS_RANCHER_TOKEN`, `ATLAS_RANCHER_INSECURE_TLS`.
- Si Rancher está detrás de Cloudflare (Error 1010): el cliente envía `User-Agent` de navegador; opcional `ATLAS_RANCHER_CF_ACCESS_CLIENT_ID` / `ATLAS_RANCHER_CF_ACCESS_CLIENT_SECRET`, o URL interna sin proxy.
- Admin: `POST /api/atlas-rancher/settings` (URL + token Bearer).
- Listado: `GET /api/atlas-rancher/custom-clusters` (recurso Steve `customclusters` o clusters provisioning sin machine pools).

## Añadir otro módulo

1. Crear `backend/atlas_<modulo>/` con `router.py` (`APIRouter`).
2. En `atlas_api/app.py`: `app.include_router(...)`.
3. Menú en `ui/src/atlasNav.ts` y vista asociada.

## Datos y variables de entorno

| Ruta / variable | Notas |
|-----------------|--------|
| `.atlas/` | Datos locales (settings, usuarios, secretos de sesión) |
| `ATLAS_*` | Variables de entorno (Docker, producción) |
| `ATLASVPN_*` | Legacy: el backend las acepta en transición |
| `atlas-runtime-config.js` | Runtime UI en nginx (`window.__ATLAS_API_BASE__`) |
| `atlas_access_token` | Token JWT en localStorage (migra desde `atlasvpn_access_token`) |

### Migración desde nombres antiguos

- Carpeta `.atlasvpn/` → `.atlas/` al primer arranque (`ensure_atlas_data_dir()`).
- En Docker: volumen montado en `/app/.atlas` (antes `/app/.atlasvpn`).
- En el host/RPi: renombrar variables en `.env` de `ATLASVPN_*` a `ATLAS_*` cuando puedas.

## Desarrollo

```bash
pip install -r requirements.txt
cd ui && npm run build
PYTHONPATH=backend python -m atlas_api --no-browser
```

Docker: `backend/Dockerfile` (contexto = raíz del repo). Copia `backend/`, `ui/public/branding/` y `scripts/`.

Swagger UI: `/swagger` (ReDoc: `/redoc`, OpenAPI JSON: `/openapi.json`). En producción: `https://api-atlas-vpn.verkku.com/swagger`.
