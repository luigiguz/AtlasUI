# Atlas

**Atlas** es la plataforma web de Verkku: consola con menú lateral, inicio con **métricas en vivo** y módulos operativos. **Atlas VPN** cubre túneles **Cloudflare Access TCP** (`cloudflared access tcp`) hacia **SSH** y **bases de datos** detrás de Zero Trust. **Atlas Rancher** gestiona equipos Kubernetes (Rancher), tiendas en Git (`atlas-stores`) y contenedores/servicios Poslite en el edge.

Por defecto `python -m atlas_api` abre **Atlas** en una ventana de escritorio Windows (**WebView2** + React), sin abrir Chrome/Edge como navegador aparte. Opcional: `--browser`, `--tk` (CustomTkinter legacy) o `--no-browser` (solo API).

> Los datos locales viven en `.atlas/` (al arrancar se migra automáticamente desde `.atlasvpn/` si existía).

## Requisitos

- **Python 3.10+**
- **Node.js 18+** y `npm` (compilar la UI en `ui/` → `ui/dist/`)
- **WebView2** en Windows (ventana integrada)
- **`cloudflared`** en el `PATH` (módulo Atlas VPN)
- Cloudflare **Zero Trust / Access** con apps `NOMBRE-ssh.TUDOMINIO` y `NOMBRE-bd.TUDOMINIO` (si usas VPN)
- **Rancher** + repo Git de tiendas (si usas Atlas Rancher)

## Instalación

```powershell
cd "ruta\a\VPN-Poslite"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ui
npm install
npm run build
cd ..
```

## Uso rápido

### Interfaz web (recomendado)

```powershell
python -m atlas_api
```

**Login:** logo Atlas (branding), texto «Bienvenido a Atlas», formulario y pie «Powered by Verkku».

**Inicio:** tarjetas de métricas (no textos explicativos largos):

| Bloque | Métricas |
|--------|----------|
| Atlas VPN | Sitios, túneles activos, sitios al 100 %, incidencias |
| Atlas Rancher | Equipos, Ready, desconectados, tiendas Git |
| Cloudflare (admin) | Sync, sitios en catálogo, intervalo |

**Menú principal:**

- **Atlas VPN** → Conexiones, Poslite, Cloudflare (admin)
- **Atlas Rancher** → Tiendas (repo Git), Equipos (clusters Rancher), Contenedores (servicios por tienda; actualizar imagen)
- **Administración** → Usuarios (admin)

Desde **Equipos**, la columna **Servicios** abre **Contenedores** con esa tienda preseleccionada.

**Navegador externo:** `python -m atlas_api --browser`. **Solo API:** `--no-browser`. **Puerto:** `--port 9000`.

### CustomTkinter (legacy)

```powershell
python -m atlas_api --tk
```

### CLI túneles

```powershell
python scripts\tunnel_manager.py list-sites
python scripts\tunnel_manager.py start laarena --services both
```

## API Token de Cloudflare

Permisos de lectura: **Zero Trust** y **Access Applications**. Los tokens `cfat_…` se validan con el account ID correcto.

Si falla la sync con 403: revisa permisos del token o usa **Zone ID** en Atlas VPN (Cloudflare → Overview de la zona).

## Archivos locales (no subir al git)

| Ruta | Contenido |
|------|-----------|
| `.atlas/auth.json` | Hash de contraseña |
| `.atlas/settings.json` | Credenciales Cloudflare |
| `.atlas/rancher.json` | URL/token Rancher (o `ATLAS_RANCHER_*` en env) |
| `.atlas/stores.json` | URL Git del repo atlas-stores |
| `scripts/tunnels.json` | Sitios y puertos VPN |
| `.cloudflared-tunnels/state.json` | PIDs de `cloudflared` |

## Docker (desarrollo / RPi)

Contenedores `atlas-api` y `atlas-ui`. Imágenes: `backend/Dockerfile` y `ui/Dockerfile` (contexto de build = raíz del repo). Ver `docker-compose.yml`.

Deploy automático en push a `dev` o `feat/atlas-platform`: workflow **`.github/workflows/atlas-dev-deploy.yml`** (runner self-hosted Linux ARM64 en el RPi; sin `actions/checkout` de terceros).

```powershell
docker compose build
docker compose up -d
```

Documentación interactiva del API (tras desplegar `atlas-api`): [https://api-atlas-vpn.verkku.com/swagger](https://api-atlas-vpn.verkku.com/swagger) · OpenAPI en `/openapi.json`.

## URLs públicas Verkku

| Servicio | URL |
|----------|-----|
| UI | `https://atlas-ui.verkku.com` |
| API | `https://api-atlas-vpn.verkku.com` |

`ATLAS_CORS_ORIGINS` en **atlas-api** debe incluir `https://atlas-ui.verkku.com`.

## Seguridad

- Protege `.atlas/` (tokens sensibles).
- Atlas VPN **no sustituye** Cloudflare Access: `cloudflared` y el navegador siguen pidiendo login cuando corresponda.

## Estructura del repositorio

| Carpeta | Rol |
|---------|-----|
| `backend/atlas_core/` | Auth, usuarios, rutas compartidas |
| `backend/atlas_vpn/` | Módulo Atlas VPN (Cloudflare, túneles, SSH) |
| `backend/atlas_rancher/` | Rancher: clusters, pods, deployments, rollout |
| `backend/atlas_stores/` | Tiendas Poslite en Git (YAML, plantillas, sync) |
| `backend/atlas_api/` | FastAPI + entrada CLI (`python -m atlas_api`) |
| `ui/src/views/` | Vistas: Inicio, VPN, Tiendas, Equipos, Contenedores |
| `ui/src/components/AuthLoginPanel.tsx` | Pantalla de login |
| `ui/public/branding/` | Logos Atlas y Verkku |
| `scripts/` | CLI `tunnel_manager` (cloudflared) |

Detalle backend: [backend/README.md](backend/README.md).

## Desarrollo

```powershell
cd ui && npm run build
PYTHONPATH=backend python -m atlas_api --browser
```

Tipografía de marca en login: **Outfit** (`font-display` en Tailwind), cargada desde Google Fonts en `ui/index.html`.

## Licencia

Uso interno Verkku.
