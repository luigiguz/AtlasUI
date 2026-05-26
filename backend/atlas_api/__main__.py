"""Punto de entrada: python -m atlas_api"""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_ROOT = _BACKEND.parent
for _p in (_ROOT, _BACKEND):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
_scripts = _ROOT / "scripts"
if str(_scripts) not in sys.path:
    sys.path.insert(0, str(_scripts))


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Atlas (plataforma Verkku): por defecto abre una ventana de escritorio Windows (WebView2 + React). "
            "El módulo Atlas VPN gestiona túneles Cloudflare Access TCP."
        )
    )
    parser.add_argument(
        "--tk",
        action="store_true",
        help="Interfaz CustomTkinter (sin React)",
    )
    ui = parser.add_mutually_exclusive_group()
    ui.add_argument(
        "--browser",
        action="store_true",
        help="Abrir la UI en Chrome/Edge como navegador (no usar ventana integrada)",
    )
    ui.add_argument(
        "--no-browser",
        action="store_true",
        help="Solo servidor local en consola (sin ventana integrada ni abrir navegador)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        metavar="N",
        help="Puerto del servidor local (default 8765)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        metavar="ADDR",
        help="Host de escucha del servidor web (p. ej. 0.0.0.0 en contenedores Docker)",
    )
    args = parser.parse_args()
    if args.tk:
        from atlas_vpn.gui_main import run_app

        run_app()
    elif args.browser:
        from atlas_api.app import run_web_server

        run_web_server(host=args.host, open_browser=True, port=args.port)
    elif args.no_browser:
        from atlas_api.app import run_web_server

        run_web_server(host=args.host, open_browser=False, port=args.port)
    else:
        from atlas_api.app import run_web_desktop

        run_web_desktop(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
