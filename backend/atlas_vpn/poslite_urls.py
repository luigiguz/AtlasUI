"""URLs Poslite: subdominio tipo Tunnel (sitio-sufijo.zona) o modo legado con :puerto.

Los sufijos «portal» salen de tunnels.json: la sincronización Cloudflare los deduce de los
hostnames vistos; opcionalmente poslite.portal_suffixes_extra añade enlaces a mano.
"""

from __future__ import annotations

from typing import Any


def _parse_ports(raw: object) -> list[int] | None:
    if not isinstance(raw, list):
        return None
    out: list[int] = []
    for x in raw:
        try:
            p = int(x)
        except (TypeError, ValueError):
            continue
        if 1 <= p <= 65535:
            out.append(p)
    return out or None


def _parse_suffixes(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    out: list[str] = []
    for x in raw:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
        elif isinstance(x, int):
            out.append(str(x))
    return out or None


def _parse_tunnel_hosts(raw: object) -> list[str] | None:
    if not isinstance(raw, list):
        return None
    out: list[str] = []
    for x in raw:
        s = str(x).strip().lower()
        if s:
            out.append(s)
    return out or None


def _url_style(root: dict[str, Any], pl: dict[str, Any]) -> str:
    for blob in (pl, root):
        v = blob.get("url_style")
        if isinstance(v, str) and v.strip().lower() in ("tunnel_subdomain", "legacy_host_port"):
            return v.strip().lower()
    return "tunnel_subdomain"


def _merge_tunnel_options(
    site_entry: dict[str, Any],
    root_defaults: dict[str, Any] | None,
) -> tuple[str, list[str]]:
    suffixes: list[str] = []
    scheme = "https"
    root = root_defaults if isinstance(root_defaults, dict) else {}
    ns = _parse_suffixes(root.get("portal_suffixes"))
    if ns is not None:
        suffixes = list(ns)
    if isinstance(root.get("scheme"), str) and root["scheme"].strip():
        scheme = root["scheme"].strip().lower().split(":")[0] or "https"

    pl = site_entry.get("poslite") if isinstance(site_entry.get("poslite"), dict) else {}
    ns = _parse_suffixes(pl.get("portal_suffixes"))
    if ns is not None:
        suffixes = list(ns)
    if isinstance(pl.get("scheme"), str) and pl["scheme"].strip():
        scheme = pl["scheme"].strip().lower().split(":")[0] or "https"

    return scheme, suffixes


def _merge_legacy_options(
    site_entry: dict[str, Any],
    root_defaults: dict[str, Any] | None,
) -> tuple[str, list[int], str]:
    ports = [7014, 9014, 14]
    scheme = "https"
    host = ""
    root = root_defaults if isinstance(root_defaults, dict) else {}
    np = _parse_ports(root.get("ports"))
    if np is not None:
        ports = np
    if isinstance(root.get("scheme"), str) and root["scheme"].strip():
        scheme = root["scheme"].strip().lower().split(":")[0] or "https"
    if isinstance(root.get("host"), str) and root["host"].strip():
        host = root["host"].strip().lower()

    pl = site_entry.get("poslite") if isinstance(site_entry.get("poslite"), dict) else {}
    np = _parse_ports(pl.get("ports"))
    if np is not None:
        ports = np
    if isinstance(pl.get("scheme"), str) and pl["scheme"].strip():
        scheme = pl["scheme"].strip().lower().split(":")[0] or "https"
    if isinstance(pl.get("host"), str) and pl["host"].strip():
        host = pl["host"].strip().lower()

    return scheme, ports, host


def poslite_links_for_site(
    site_slug: str,
    domain_suffix: str,
    site_entry: dict[str, Any],
    root_defaults: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Por defecto (tunnel_subdomain): https://{sitio}-{sufijo}.{dominio}/

    Los sufijos vienen de poslite.portal_suffixes (rellenados al sincronizar desde Cloudflare)
    o de poslite_defaults.portal_suffixes como respaldo global opcional.
    """
    suf = (domain_suffix or "").strip().lower().lstrip(".")
    root = root_defaults if isinstance(root_defaults, dict) else {}
    pl = site_entry.get("poslite") if isinstance(site_entry.get("poslite"), dict) else {}
    style = _url_style(root, pl)

    if style == "legacy_host_port":
        scheme, ports, host = _merge_legacy_options(site_entry, root_defaults)
        if not host:
            host = f"{site_slug}.{suf}" if suf else site_slug
        return [
            {
                "suffix": None,
                "port": p,
                "url": f"{scheme}://{host}:{p}/",
            }
            for p in ports
        ]

    scheme, suffixes = _merge_tunnel_options(site_entry, root_defaults)
    explicit = _parse_tunnel_hosts(pl.get("tunnel_hosts"))
    if explicit:
        out: list[dict[str, Any]] = []
        for host_part in explicit:
            if "." in host_part:
                fqdn = host_part
            elif suf:
                fqdn = f"{host_part}.{suf}"
            else:
                fqdn = host_part
            url = f"{scheme}://{fqdn}/"
            out.append({"suffix": host_part, "url": url, "port": None})
        return out

    out: list[dict[str, Any]] = []
    for token in suffixes:
        token = token.strip()
        if not token:
            continue
        fqdn = f"{site_slug}-{token}.{suf}" if suf else f"{site_slug}-{token}"
        url = f"{scheme}://{fqdn}/"
        row: dict[str, Any] = {"suffix": token, "url": url}
        if token.isdigit():
            try:
                row["port"] = int(token, 10)
            except ValueError:
                row["port"] = None
        else:
            row["port"] = None
        out.append(row)
    return out
