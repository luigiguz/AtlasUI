#!/usr/bin/env python3
"""
Gestor de túneles locales cloudflared access tcp (SSH / BD).
Requisito: cloudflared instalado y en PATH; acceso Cloudflare Access configurado.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

if sys.platform != "win32":
    import signal

STATE_DIR = Path(__file__).resolve().parent.parent / ".cloudflared-tunnels"
STATE_FILE = STATE_DIR / "state.json"


def default_config_path() -> Path:
    p = Path(__file__).resolve().parent / "tunnels.json"
    env = os.environ.get("TUNNELS_CONFIG")
    return Path(env) if env else p


def load_config_optional(path: Path) -> dict | None:
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_config(path: Path) -> dict:
    data = load_config_optional(path)
    if data is None:
        sys.stderr.write(
            f"No existe {path}. Copia scripts/tunnels.example.json a scripts/tunnels.json.\n"
        )
        sys.exit(2)
    return data


def cloudflared_bin() -> str:
    return os.environ.get("CLOUDFLARED", "cloudflared")


def tunnel_bind_host() -> str:
    """Interfaz donde cloudflared escucha (0.0.0.0 en contenedor atlas-tunnels)."""
    return (os.environ.get("ATLAS_TUNNEL_BIND") or "127.0.0.1").strip() or "127.0.0.1"


def tunnel_connect_host() -> str:
    """Host al que se conecta la API/SSH (atlas-tunnels en Docker, 127.0.0.1 en local)."""
    return (os.environ.get("ATLAS_TUNNEL_HOST") or "127.0.0.1").strip() or "127.0.0.1"


def start_tunnel(hostname: str, local_port: int) -> subprocess.Popen:
    url = f"{tunnel_bind_host()}:{local_port}"
    cmd = [
        cloudflared_bin(),
        "access",
        "tcp",
        "--hostname",
        hostname,
        "--url",
        url,
    ]
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    return subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
    )


def read_state() -> dict:
    if not STATE_FILE.is_file():
        return {"processes": []}
    with STATE_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def write_state(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with STATE_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def kill_pid(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F", "/T"],
            capture_output=True,
            text=True,
        )
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def init_config_from_example() -> tuple[bool, str]:
    src = Path(__file__).resolve().parent / "tunnels.example.json"
    dst = Path(__file__).resolve().parent / "tunnels.json"
    if dst.exists():
        return False, f"Ya existe {dst}"
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return True, f"Creado {dst}. Edita hostnames y puertos."


def cmd_init_example() -> None:
    _ok, msg = init_config_from_example()
    print(msg)


def _proc_for_site_label(state: dict, site: str, label: str) -> dict | None:
    for row in state.get("processes", []):
        if row.get("site") == site and row.get("label") == label:
            return row
    return None


def _label_alive(state: dict, site: str, label: str) -> bool:
    row = _proc_for_site_label(state, site, label)
    if not row:
        return False
    if pid_alive(int(row["pid"])):
        return True
    return tunnel_listener_alive(row, host=tunnel_bind_host())


def prune_dead_processes() -> int:
    """Elimina del state los procesos cuyo PID murió y el puerto ya no escucha."""
    state = read_state()
    procs: list[dict] = list(state.get("processes", []))
    alive: list[dict] = []
    for row in procs:
        pid = int(row["pid"])
        if pid_alive(pid) or tunnel_listener_alive(row, host=tunnel_bind_host()):
            alive.append(row)
    removed = len(procs) - len(alive)
    if removed:
        write_state({"processes": alive})
    return removed


def ensure_site_tunnels(
    site: str, config_path: Path, services: str = "both"
) -> tuple[bool, list[str]]:
    """Levanta túneles faltantes para un sitio (no duplica los ya activos)."""
    state = read_state()
    want_ssh = services in ("ssh", "both")
    want_db = services in ("db", "both")
    if want_ssh and _label_alive(state, site, "ssh"):
        want_ssh = False
    if want_db and _label_alive(state, site, "db"):
        want_db = False
    if not want_ssh and not want_db:
        return True, [f"[skip] {site}: túneles ya activos"]
    if want_ssh and want_db:
        svc = "both"
    elif want_ssh:
        svc = "ssh"
    else:
        svc = "db"
    return start_site_services(site, svc, config_path)


def ensure_all_sites(config_path: Path) -> dict:
    """Reconcilia todos los sitios: poda muertos y levanta túneles faltantes."""
    removed = prune_dead_processes()
    cfg = load_config_optional(config_path)
    lines: list[str] = []
    if cfg is None:
        return {
            "ok": False,
            "removedDead": removed,
            "siteCount": 0,
            "lines": [f"No existe la configuración: {config_path}"],
        }
    sites: dict = cfg.get("sites") or {}
    ok = True
    for name in sorted(sites.keys()):
        entry = sites[name]
        if not isinstance(entry, dict):
            continue
        has_ssh = isinstance(entry.get("ssh"), dict)
        has_db = isinstance(entry.get("db"), dict)
        if has_ssh and has_db:
            svc = "both"
        elif has_ssh:
            svc = "ssh"
        elif has_db:
            svc = "db"
        else:
            continue
        site_ok, site_lines = ensure_site_tunnels(name, config_path, svc)
        lines.extend(site_lines)
        ok = ok and site_ok
    return {
        "ok": ok,
        "removedDead": removed,
        "siteCount": len(sites),
        "lines": lines,
    }


def start_site_services(site: str, services: str, config_path: Path) -> tuple[bool, list[str]]:
    """
    Levanta túneles para un sitio. Devuelve (éxito_total, líneas de texto para log/consola).
    """
    lines: list[str] = []
    cfg = load_config_optional(config_path)
    if cfg is None:
        return False, [f"No existe la configuración: {config_path}"]
    sites: dict = cfg.get("sites") or {}
    if site not in sites:
        return False, [f'Sitio "{site}" no está en la configuración.']
    entry = sites[site]
    ssh = entry.get("ssh")
    db = entry.get("db")
    want_ssh = services in ("ssh", "both")
    want_db = services in ("db", "both")
    if want_ssh and not ssh:
        return False, ["Este sitio no define ssh."]
    if want_db and not db:
        return False, ["Este sitio no define db."]

    state = read_state()
    procs: list[dict] = list(state.get("processes", []))
    new_procs: list[dict] = []
    ok = True

    def launch(label: str, spec: dict) -> None:
        nonlocal ok
        hostname = spec["hostname"]
        port = int(spec["local_port"])
        p = start_tunnel(hostname, port)
        time.sleep(0.6)
        if p.poll() is not None:
            manual = " ".join(
                [
                    cloudflared_bin(),
                    "access",
                    "tcp",
                    "--hostname",
                    hostname,
                    "--url",
                    f"localhost:{port}",
                ]
            )
            lines.append(
                f"ERROR {label}: no se mantuvo vivo ({hostname} -> {port}). Prueba en terminal: {manual}"
            )
            ok = False
            return
        new_procs.append(
            {
                "pid": p.pid,
                "site": site,
                "label": label,
                "hostname": hostname,
                "local_port": port,
                "started_at": int(time.time()),
            }
        )
        lines.append(f"[OK] {label}: {hostname} -> 127.0.0.1:{port} (pid {p.pid})")

    if want_ssh:
        launch("ssh", ssh)
    if want_db and ok:
        launch("db", db)
    elif want_db and not ok:
        pass

    if new_procs:
        procs.extend(new_procs)
        write_state({"processes": procs})

    if ok and (want_ssh or want_db):
        lines.append("")
        lines.append("Conexión sugerida:")
        if want_ssh and ssh:
            lines.append(f"  ssh <usuario>@localhost -p {ssh['local_port']} (usuario: ssh_user en tunnels.json o «admin»)")
        if want_db and db:
            lines.append(
                f"  BD: host=127.0.0.1 port={db['local_port']} (cliente al puerto local)."
            )

    return ok, lines


def cmd_start(args: argparse.Namespace) -> None:
    ok, lines = start_site_services(args.site, args.services, Path(args.config))
    out = sys.stdout if ok else sys.stderr
    for line in lines:
        print(line, file=out)
    if not ok:
        sys.exit(1)


def stop_tunnels(site: str | None, label: str | None = None) -> list[str]:
    """Detiene procesos registrados.

    site=None: todos los procesos (label se ignora).
    site='x': procesos de ese sitio; si además label='ssh'|'db', solo ese rol.
    """
    lines: list[str] = []
    state = read_state()
    procs: list[dict] = list(state.get("processes", []))
    if not procs:
        lines.append("No hay procesos registrados.")
        return lines
    remaining: list[dict] = []
    for row in procs:
        if site is not None and row.get("site") != site:
            remaining.append(row)
            continue
        if label is not None and row.get("label") != label:
            remaining.append(row)
            continue
        pid = int(row["pid"])
        kill_pid(pid)
        lines.append(f"Detenido pid {pid} ({row.get('label')} {row.get('hostname')})")
    write_state({"processes": remaining})
    return lines


def cmd_stop(args: argparse.Namespace) -> None:
    for line in stop_tunnels(args.site):
        print(line)


def cmd_status(_args: argparse.Namespace) -> None:
    state = read_state()
    procs: list[dict] = list(state.get("processes", []))
    if not procs:
        print("Sin túneles registrados en state.")
        return
    for row in procs:
        pid = int(row["pid"])
        alive = pid_alive(pid) or tunnel_listener_alive(row, host=tunnel_bind_host())
        print(
            f"{'vivo' if alive else 'muerto':4} pid={pid} site={row.get('site')} "
            f"{row.get('label')} {row.get('hostname')} -> {tunnel_bind_host()}:{row.get('local_port')}"
        )


def pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        r = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
        )
        return str(pid) in (r.stdout or "")
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def tunnel_port_open(port: int, host: str | None = None, timeout: float = 0.35) -> bool:
    """Comprueba si hay un listener TCP en el host del túnel (funciona entre contenedores)."""
    if port < 1 or port > 65535:
        return False
    h = (host or tunnel_connect_host()).strip() or "127.0.0.1"
    try:
        with socket.create_connection((h, port), timeout=timeout):
            return True
    except OSError:
        return False


def tunnel_listener_alive(row: dict | None, host: str | None = None) -> bool:
    """True si el puerto local del túnel acepta conexiones."""
    if not row:
        return False
    try:
        port = int(row["local_port"])
    except (KeyError, TypeError, ValueError):
        return False
    return tunnel_port_open(port, host=host)


def tunnel_row_status(row: dict | None, spec: dict | None = None) -> str:
    """
    idle | active | dead
    Con atlas-tunnels en otro contenedor el PID no es visible; se usa probe TCP.
    """
    if not spec and not row:
        return "idle"
    if tunnel_listener_alive(row):
        return "active"
    if isinstance(spec, dict):
        try:
            port = int(spec.get("local_port"))
        except (TypeError, ValueError):
            port = 0
        if port > 0 and tunnel_port_open(port):
            return "active"
    if row:
        return "dead"
    return "idle"


def cmd_list_sites(args: argparse.Namespace) -> None:
    cfg = load_config(Path(args.config))
    for name in sorted((cfg.get("sites") or {}).keys()):
        print(name)


def main() -> None:
    parser = argparse.ArgumentParser(description="Túneles cloudflared access tcp")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init-config", help="Copia tunnels.example.json -> tunnels.json")
    p_init.set_defaults(func=cmd_init_example)

    p_list = sub.add_parser("list-sites", help="Lista sitios del JSON")
    p_list.add_argument("--config", default=str(default_config_path()))
    p_list.set_defaults(func=cmd_list_sites)

    p_start = sub.add_parser("start", help="Levanta túneles para un sitio")
    p_start.add_argument("site")
    p_start.add_argument(
        "--services",
        choices=("ssh", "db", "both"),
        default="both",
        help="Qué túneles abrir (default: both)",
    )
    p_start.add_argument("--config", default=str(default_config_path()))
    p_start.set_defaults(func=cmd_start)

    p_stop = sub.add_parser("stop", help="Mata procesos registrados (opcional: por sitio)")
    p_stop.add_argument("--site", default=None, help="Solo este sitio; si se omite, todos")
    p_stop.set_defaults(func=cmd_stop)

    p_stat = sub.add_parser("status", help="Muestra estado de PIDs guardados")
    p_stat.set_defaults(func=cmd_status)

    p_ensure = sub.add_parser("ensure-all", help="Levanta túneles faltantes para todos los sitios")
    p_ensure.add_argument("--config", default=str(default_config_path()))
    p_ensure.set_defaults(
        func=lambda args: _cmd_ensure_all(args),
    )

    ns = parser.parse_args()
    ns.func(ns)


def _cmd_ensure_all(args: argparse.Namespace) -> None:
    result = ensure_all_sites(Path(args.config))
    out = sys.stdout if result.get("ok") else sys.stderr
    for line in result.get("lines") or []:
        print(line, file=out)
    if not result.get("ok"):
        sys.exit(1)


if __name__ == "__main__":
    main()
