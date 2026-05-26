<p align="center">
  <img src="ui/public/branding/Logo%20ATLAS%20-%20Sin%20Fondi.png" alt="Atlas" width="220" />
</p>

<p align="center">
  <strong>Plataforma Verkku</strong> para operar tiendas PosLite en el edge
</p>

<p align="center">
  <a href="https://atlas-ui.verkku.com">UI</a> ·
  <a href="https://api-atlas-vpn.verkku.com/swagger">API</a> ·
  Uso interno
</p>

---

## Qué es Atlas

**Atlas** es la consola web unificada: menú lateral, inicio con métricas en vivo y módulos operativos.

| Módulo | Función |
|--------|---------|
| **Atlas VPN** | Túneles Cloudflare Access TCP (`cloudflared`) hacia SSH y bases de datos |
| **Atlas Rancher** | Equipos Kubernetes, tiendas en Git (`atlas-stores`) y contenedores Poslite |
| **Administración** | Usuarios y roles (admin / operador / visor) |

Por defecto `python -m atlas_api` abre la app en **WebView2** (Windows) con la UI React integrada. También: `--browser`, `--no-browser` (solo API) o `--tk` (CustomTkinter legacy).

> Los datos locales viven en `.atlas/` (se migra desde `.atlasvpn/` al primer arranque si existía).

---

## Tabla de contenidos

- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Uso rápido](#uso-rápido)
- [Producción](#producción)
- [Docker](#docker-desarrollo--rpi)
- [Datos locales](#datos-locales)
- [Estructura del repo](#estructura-del-repositorio)
- [Desarrollo](#desarrollo)
- [Seguridad](#seguridad)

---

## Requisitos

| Componente | Versión / nota |
|------------|----------------|
| Python | 3.10+ |
| Node.js | 18+ (`npm` para compilar `ui/`) |
| WebView2 | Windows (ventana integrada) |
| cloudflared | En el `PATH` (Atlas VPN) |
| Cloudflare Zero Trust | Apps `NOMBRE-ssh` y `NOMBRE-bd` (VPN) |
| Rancher + Git | Repo `atlas-stores` (Atlas Rancher) |

---

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

---

## Uso rápido

### Consola web

```powershell
python -m atlas_api
```

| Paso | Qué verás |
|------|-----------|
| Login | Logo Atlas, «Bienvenido a Atlas», pie Powered by **Verkku** |
| Inicio | Métricas VPN, Rancher y Cloudflare (tarjetas clicables) |
| Menú | Módulos según tu rol |

**Atlas VPN**

- Conexiones — túneles SSH/BD por sitio  
- Poslite — portales cuando el túnel está activo  
- Cloudflare — sync de sitios (admin)

**Atlas Rancher**

- Tiendas — configuración en Git, plantillas, publicación  
- Equipos — clusters RPi en Rancher (columna **Servicios** → Contenedores)  
- Contenedores — servicios por tienda, actualizar imagen  

**Otros modos**

```powershell
python -m atlas_api --browser      # Navegador externo
python -m atlas_api --no-browser   # Solo API (Docker)
python -m atlas_api --port 9000    # Puerto distinto
python -m atlas_api --tk           # GUI legacy
```

### CLI túneles (sin UI)

```powershell
python scripts\tunnel_manager.py list-sites
python scripts\tunnel_manager.py start laarena --services both
```

### Cloudflare API Token

Permisos de lectura: **Zero Trust** y **Access Applications**. Si la sync devuelve 403, revisa el token o configura **Zone ID** en Atlas VPN → Cloudflare.

---

## Producción

| Servicio | URL |
|----------|-----|
| UI | https://atlas-ui.verkku.com |
| API | https://api-atlas-vpn.verkku.com |
| Swagger | https://api-atlas-vpn.verkku.com/swagger |

En **atlas-api**, `ATLAS_CORS_ORIGINS` debe incluir `https://atlas-ui.verkku.com`.

---

## Docker (desarrollo / RPi)

```powershell
docker compose build
docker compose up -d
```

| Recurso | Nombre |
|---------|--------|
| Servicios | `atlas-api`, `atlas-ui` |
| Proyecto Compose | `atlas` |
| Datos | volumen → `/app/.atlas` |

Deploy automático en push a `dev` o `feat/atlas-platform`: [`.github/workflows/atlas-dev-deploy.yml`](.github/workflows/atlas-dev-deploy.yml) (runner self-hosted **Linux ARM64** en el RPi).

---

## Datos locales

No subir al git:

| Ruta | Contenido |
|------|-----------|
| `.atlas/auth.json` | Hash de contraseña local |
| `.atlas/settings.json` | Credenciales Cloudflare |
| `.atlas/rancher.json` | Conexión Rancher |
| `.atlas/stores.json` | URL Git del repo de tiendas |
| `scripts/tunnels.json` | Inventario de sitios VPN |
| `.cloudflared-tunnels/state.json` | PIDs de `cloudflared` |

---

## Estructura del repositorio

```
VPN-Poslite/
├── backend/
│   ├── atlas_api/       # FastAPI + CLI (python -m atlas_api)
│   ├── atlas_core/      # Auth, usuarios, paths
│   ├── atlas_vpn/       # Cloudflare, túneles, SSH
│   ├── atlas_rancher/   # Clusters, pods, deployments, rollout
│   └── atlas_stores/    # Tiendas Git, YAML, plantillas
├── ui/
│   ├── src/views/       # Inicio, VPN, Tiendas, Equipos, Contenedores
│   ├── src/components/  # Shell, AuthLoginPanel, …
│   └── public/branding/ # Logos Atlas y Verkku
├── scripts/             # tunnel_manager (cloudflared)
├── docker-compose.yml
└── .github/workflows/   # Deploy dev RPi
```

| Carpeta | Rol |
|---------|-----|
| `backend/atlas_api/` | Entrada FastAPI y ventana WebView2 |
| `backend/atlas_vpn/` | Módulo Atlas VPN |
| `backend/atlas_rancher/` | API Rancher |
| `backend/atlas_stores/` | API tiendas Poslite |
| `ui/src/views/` | Pantallas React |
| `ui/public/branding/` | Assets de marca |

Más detalle del backend: [backend/README.md](backend/README.md).

---

## Desarrollo

```powershell
cd ui && npm run build
$env:PYTHONPATH="backend"
python -m atlas_api --browser
```

- UI: React + Vite + Tailwind (`cf-orange`, tema oscuro `#0b0d10`)
- Login: tipografía **Outfit** (`font-display`), logos en `ui/public/branding/`
- API: prefijos `/api/atlas-rancher/…`, `/api/atlas-stores/…`, auth, VPN

```powershell
python -m py_compile backend\atlas_api\app.py
```

---

## Seguridad

- Protege `.atlas/` — contiene tokens y secretos.
- Atlas VPN **no sustituye** Cloudflare Access: `cloudflared` y el navegador siguen pidiendo autenticación cuando corresponda.

---

## Licencia

Uso interno **Verkku**.

<p align="center">
  <img src="ui/public/branding/verkku-logo.svg" alt="Verkkutech" width="120" />
</p>
