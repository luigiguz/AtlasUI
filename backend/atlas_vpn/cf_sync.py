"""
Sincroniza hostnames hacia tunnels.json desde Cloudflare:
  • Zero Trust → Access → Applications (dominios de la app)
  • Zero Trust → Tunnels → cloudflared: configuración remota (ingress → hostname)
  • DNS de la zona (opcional, con Zone ID): CNAME hacia *.cfargotunnel.com / trycloudflare

Luego filtra por sufijo y patrón *-ssh / *-bd.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from cloudflare import (
    APIError,
    APIStatusError,
    AuthenticationError,
    Cloudflare,
    PermissionDeniedError,
)

from atlas_vpn.cf_credentials import (
    normalize_account_id,
    normalize_api_token,
    validate_account_id,
    validate_api_token_shape,
    validate_zone_id,
)
from atlas_core.paths import TUNNELS_JSON

SSH_RE = re.compile(r"^(.+)-ssh\.(.+)$", re.IGNORECASE)
BD_RE = re.compile(r"^(.+)-bd\.(.+)$", re.IGNORECASE)

# Hostnames tipo «sitio-014» / «sitio-9014» (no SSH/BD) → enlaces Poslite; se deducen al sincronizar.
_POSLITE_INFRA = frozenset({"ssh", "bd"})


def _poslite_token_sort_key(token: str) -> tuple[Any, ...]:
    t = token.lower()
    if t.isdigit():
        return (0, len(token), int(token, 10), token)
    return (1, t)


def _parse_poslite_extra_list(raw: object) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for x in raw:
        if isinstance(x, str) and x.strip():
            out.append(x.strip())
        elif isinstance(x, int):
            out.append(str(x))
    return out


def discover_poslite_suffixes_by_site(
    hostnames: Iterable[str],
    domain_suffix: str,
    site_slugs: Iterable[str],
) -> dict[str, list[str]]:
    """
    A partir de todos los FQDN vistos (Access, ingress túnel, DNS CNAME→túnel),
    agrupa sufijos Poslite por clave de sitio en tunnels.json.

    Reglas (sitios ordenados por nombre más largo primero para evitar colisiones):
      • «sitio-sufijo.dominio» con sufijo distinto de ssh/bd → sufijo Poslite (p. ej. 014, 9014).
      • «sitiosufijo.dominio» sin guion tras el slug (p. ej. gasolineria-aspdemo010) → token pegado.
    """
    suf = (domain_suffix or "").strip().lower().lstrip(".")
    if not suf:
        return {}
    sites_sorted = sorted(set(site_slugs), key=lambda x: (-len(x), x.lower()))
    needle = f".{suf}"
    collected: dict[str, set[str]] = {s: set() for s in set(site_slugs)}

    for raw in hostnames:
        h = _host_only(str(raw)).lower()
        if not h.endswith(needle):
            continue
        base = h[: -len(needle)]
        matched_site: str | None = None
        matched_token: str | None = None
        for s in sites_sorted:
            if base.startswith(s + "-"):
                tok = base[len(s) + 1 :]
                if not tok:
                    continue
                if tok.lower() in _POSLITE_INFRA:
                    break
                matched_site, matched_token = s, tok
                break
            if len(base) > len(s) and base.startswith(s):
                if base[len(s)] == "-":
                    continue
                tok = base[len(s) :]
                if tok and tok.lower() not in _POSLITE_INFRA:
                    matched_site, matched_token = s, tok
                    break
        if matched_site and matched_token:
            collected.setdefault(matched_site, set()).add(matched_token)

    return {
        k: sorted(v, key=_poslite_token_sort_key)
        for k, v in collected.items()
        if v
    }


def _apply_poslite_from_discovery(
    site: str,
    entry: dict[str, Any],
    portal_by_site: dict[str, list[str]],
    old_entry: dict[str, Any] | None,
) -> None:
    """Rellena entry['poslite'] desde hostnames descubiertos; conserva tunnel_hosts y extras manuales."""
    old_pl: dict[str, Any] = {}
    if isinstance(old_entry, dict):
        pl = old_entry.get("poslite")
        if isinstance(pl, dict):
            old_pl = pl
    if old_pl.get("tunnel_hosts"):
        entry["poslite"] = dict(old_pl)
        return

    discovered = list(portal_by_site.get(site, []))
    extra = _parse_poslite_extra_list(old_pl.get("portal_suffixes_extra"))
    prev_suffixes = _parse_poslite_extra_list(old_pl.get("portal_suffixes"))
    if discovered:
        tokens = sorted(set(discovered) | set(extra), key=_poslite_token_sort_key)
    else:
        tokens = sorted(set(extra) | set(prev_suffixes or []), key=_poslite_token_sort_key)

    new_pl: dict[str, Any] = {}
    for key in ("scheme", "url_style"):
        v = old_pl.get(key)
        if isinstance(v, str) and v.strip():
            new_pl[key] = v.strip()
    if isinstance(old_pl.get("host"), str) and old_pl["host"].strip():
        new_pl["host"] = old_pl["host"].strip().lower()

    if tokens:
        new_pl["portal_suffixes"] = tokens
    if extra:
        new_pl["portal_suffixes_extra"] = extra

    if new_pl:
        entry["poslite"] = new_pl
    else:
        entry.pop("poslite", None)


# Destino típico de CNAME «Public hostname» hacia un túnel gestionado en Cloudflare
_TUNNEL_CNAME_MARKERS = ("cfargotunnel.com", "trycloudflare.com")


class CfSyncError(Exception):
    pass


def _access_denied_help(account_id: str, api_token: str) -> str:
    base = (
        "Cloudflare devolvió 403 (sin permiso para listar Access, o Account ID equivocado).\n\n"
        "Permisos que debe tener el token (añade filas hasta que ninguna quede «sin elegir»):\n"
        "  • Account → Zero Trust → Read\n"
        "  • Account → Access: Apps and Policies → Read\n"
        "    (si en tu cuenta el menú muestra otro nombre, busca lo equivalente a Access / Zero Trust.)\n\n"
        "En «Account resources» / ámbito del token debe incluirse el account donde están "
        "las aplicaciones Access (el mismo que en Zero Trust → Overview).\n\n"
        f"Account ID usado en la URL: {account_id}\n\n"
        "Si Zero Trust lo tenéis en otro account de Cloudflare, ese ID debe ser el de ese account.\n"
    )
    if api_token.lower().startswith("cfat_"):
        base += (
            "\nEstás usando un Account API Token (cfat_…).\n"
            "Créalo o edítalo desde el account en Cloudflare (p. ej. menú del account → "
            "«Manage account» / «API Tokens» / «Account API tokens», según la vista de tu cuenta), "
            "no solo desde My Profile. Vuelve a publicar el token tras guardar los permisos nuevos.\n"
            "\n"
            "Si los permisos parecen correctos y sigue el 403: prueba un **User API Token** "
            "(icono de perfil → API Tokens → Create Token) con Zero Trust Read + "
            "Access Apps / Policies Read en este account; en algunos entornos los tokens "
            "cfat_ devuelven 403 en APIs Zero Trust pese a la documentación.\n"
            "\n"
            "Otra opción en Atlas VPN: rellena el campo **Zone ID** (Overview de la zona del dominio) "
            "para listar aplicaciones Access «por zona» (GET …/zones/{zone_id}/access/apps) "
            "en lugar de por account.\n"
        )
    else:
        base += (
            "\nSi es User API Token: My Profile → API Tokens → Edit, y revisa permisos + "
            "recursos de cuenta incluidos.\n"
        )
    return base


def _api_error_detail(exc: APIError) -> str:
    parts = [exc.message or str(exc)]
    for err in (getattr(exc, "errors", None) or [])[:3]:
        msg = getattr(err, "message", None) if err is not None else None
        if msg:
            c = getattr(err, "code", None)
            parts.append(f"[{c}] {msg}" if c is not None else str(msg))
        elif isinstance(err, dict):
            c, m = err.get("code"), err.get("message")
            if m:
                parts.append(f"[{c}] {m}" if c is not None else str(m))
    return " ".join(parts)


def preflight_api_token(api_token: str, account_id: str) -> None:
    """
    Valida el token antes de listar Access.

    Los Account API Tokens (prefijo cfat_) deben verificarse con
    GET /accounts/{account_id}/tokens/verify, no con /user/tokens/verify
    (este último devuelve 401 «Invalid API Token» aunque el cfat_ sea válido).
    """
    client = Cloudflare(api_token=api_token)
    ayuda = (
        "\n\nComprueba:\n"
        "• Token de tipo «API Token» (My Profile o Account → API Tokens), no Global API Key.\n"
        "• Si es Account API Token (cfat_…), el Account ID debe ser el del recurso del token.\n"
        "• Copiar el token completo al crearlo.\n"
        "• Si editaste .atlas/settings.json a mano, valida JSON; mejor pegar desde la app.\n"
        "• Si el token se filtró, revócalo y crea uno nuevo."
    )

    def _raise_verify(kind: str, exc: APIError) -> None:
        raise CfSyncError(
            f"Verificación del token ({kind}) falló.\n"
            + _api_error_detail(exc)
            + ayuda
        ) from exc

    low = api_token.lower()
    if low.startswith("cfat_"):
        try:
            client.accounts.tokens.verify(account_id=account_id)
        except APIError as e:
            _raise_verify("Account API Token → /accounts/…/tokens/verify", e)
        return

    try:
        client.user.tokens.verify()
        return
    except APIError as e:
        sc = getattr(e, "status_code", None)
        if sc == 401:
            try:
                client.accounts.tokens.verify(account_id=account_id)
                return
            except APIError as e2:
                raise CfSyncError(
                    "No se pudo verificar el token (ni como User API Token ni como Account API Token).\n"
                    f"User verify: {_api_error_detail(e)}\n"
                    f"Account verify: {_api_error_detail(e2)}"
                    + ayuda
                ) from e2
        _raise_verify("User API Token → /user/tokens/verify", e)


def _host_only(raw: str) -> str:
    """Host en minúsculas sin ruta ni esquema (p. ej. SSH.app/path → ssh.app)."""
    h = (raw or "").strip().lower()
    if "://" in h:
        try:
            from urllib.parse import urlparse

            u = urlparse(h if "://" in h else f"https://{h}")
            hn = u.hostname
            if hn:
                h = hn
        except Exception:
            pass
    if "/" in h:
        h = h.split("/")[0]
    return h.strip().lower()


def _iter_domains(app: dict[str, Any]) -> list[str]:
    out: list[str] = []
    d = app.get("domain")
    if isinstance(d, str) and d.strip():
        out.append(_host_only(d))
    for item in app.get("self_hosted_domains") or []:
        if isinstance(item, str) and item.strip():
            out.append(_host_only(item))
        elif isinstance(item, dict):
            dom = item.get("domain") or item.get("hostname") or item.get("url")
            if isinstance(dom, str) and dom.strip():
                out.append(_host_only(dom))
    seen: set[str] = set()
    uniq: list[str] = []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def hostnames_from_access_apps(apps: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for app in apps:
        out.extend(_iter_domains(app))
    return out


def _merge_unique_hostnames(*batches: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for batch in batches:
        for raw in batch:
            h = _host_only(str(raw))
            if not h or h in seen:
                continue
            seen.add(h)
            out.append(h)
    return out


def fetch_tunnel_ingress_hostnames(
    account_id: str, api_token: str
) -> tuple[list[str], str | None]:
    """
    Hostnames públicos definidos en la configuración remota de cada túnel cloudflared.
    Los túneles solo «locales» (config en YAML en el servidor) suelen no tener config en la API.
    """
    client = Cloudflare(api_token=api_token)
    hosts: list[str] = []
    try:
        page = client.zero_trust.tunnels.cloudflared.list(
            account_id=account_id, is_deleted=False, per_page=50
        )
        while True:
            for tunnel in page.result:
                tid = tunnel.id
                if not tid:
                    continue
                try:
                    cfg = client.zero_trust.tunnels.cloudflared.configurations.get(
                        tid, account_id=account_id
                    )
                except APIStatusError as e:
                    if getattr(e, "status_code", None) == 404:
                        continue
                    continue
                except APIError:
                    continue
                if not cfg or not cfg.config or not cfg.config.ingress:
                    continue
                for rule in cfg.config.ingress:
                    hn = _host_only(str(getattr(rule, "hostname", None) or ""))
                    if not hn or hn in ("*", "any"):
                        continue
                    if "." not in hn:
                        continue
                    hosts.append(hn)
            if not page.has_next_page():
                break
            page = page.get_next_page()
    except PermissionDeniedError as e:
        return [], (
            "Túneles (403): el token no puede listar túneles Cloudflare. "
            "Añade permiso de lectura de túneles (p. ej. Account → Cloudflare Tunnel → Read, "
            "o el permiso equivalente «Zero Trust / Tunnels» en tu plantilla de token). "
            + _api_error_detail(e)
        )
    except AuthenticationError as e:
        return [], "Túneles: " + _api_error_detail(e)
    except APIStatusError as e:
        if getattr(e, "status_code", None) == 403:
            return [], (
                "Túneles (403): sin permiso. Añade lectura de Cloudflare Tunnel al API Token. "
                + _api_error_detail(e)
            )
        return [], "Túneles: " + _api_error_detail(e)
    except APIError as e:
        return [], "Túneles: " + _api_error_detail(e)
    except Exception as e:
        return [], f"Túneles: {e}"
    return sorted(set(hosts)), None


def fetch_dns_cname_tunnel_hostnames(
    zone_id: str, api_token: str, domain_suffix: str
) -> tuple[list[str], str | None]:
    """CNAME en la zona cuyo destino apunta a un hostname de túnel (*.cfargotunnel.com, etc.)."""
    z = normalize_account_id(zone_id).strip()
    if not z:
        return [], None
    suf = domain_suffix.lower().strip().lstrip(".")
    client = Cloudflare(api_token=api_token)
    hosts: list[str] = []
    try:
        page = client.dns.records.list(zone_id=z, type="CNAME", per_page=100)
        while True:
            for r in page.result:
                content = (getattr(r, "content", None) or "").lower()
                if not any(m in content for m in _TUNNEL_CNAME_MARKERS):
                    continue
                name = _host_only(str(getattr(r, "name", None) or ""))
                if not name.endswith(suf):
                    continue
                hosts.append(name)
            if not page.has_next_page():
                break
            page = page.get_next_page()
    except PermissionDeniedError as e:
        return [], (
            "DNS (403): no se pueden listar registros de la zona. "
            "Añade Zone → DNS → Read para el Zone ID configurado. "
            + _api_error_detail(e)
        )
    except AuthenticationError as e:
        return [], "DNS: " + _api_error_detail(e)
    except APIStatusError as e:
        if getattr(e, "status_code", None) == 403:
            return [], "DNS (403): " + _api_error_detail(e)
        return [], "DNS: " + _api_error_detail(e)
    except APIError as e:
        return [], "DNS: " + _api_error_detail(e)
    except Exception as e:
        return [], f"DNS: {e}"
    return sorted(set(hosts)), None


def fetch_access_applications(
    account_id: str, api_token: str, zone_id: str | None = None
) -> list[dict[str, Any]]:
    client = Cloudflare(api_token=api_token)
    collected: list[dict[str, Any]] = []
    zid = (zone_id or "").strip()
    if zid:
        list_kw: dict[str, Any] = {"zone_id": zid, "per_page": 50}
    else:
        list_kw = {"account_id": account_id, "per_page": 50}
    try:
        page = client.zero_trust.access.applications.list(**list_kw)
        while True:
            for app in page.result:
                collected.append(app.model_dump(mode="json"))
            if not page.has_next_page():
                break
            page = page.get_next_page()
    except PermissionDeniedError as e:
        raise CfSyncError(
            _api_error_detail(e) + "\n\n" + _access_denied_help(account_id, api_token)
        ) from e
    except AuthenticationError as e:
        raise CfSyncError(
            "Autenticación rechazada (401). Revisa que el API Token sea el valor completo "
            "y que no sea la Global API Key.\n" + _api_error_detail(e)
        ) from e
    except APIStatusError as e:
        if e.status_code == 403:
            raise CfSyncError(
                _api_error_detail(e) + "\n\n" + _access_denied_help(account_id, api_token)
            ) from e
        raise CfSyncError(_api_error_detail(e)) from e
    except APIError as e:
        raise CfSyncError(_api_error_detail(e)) from e
    except Exception as e:
        raise CfSyncError(str(e)) from e
    return collected


def discover_sites_from_hostnames(
    hostnames: Iterable[str], domain_suffix: str
) -> dict[str, dict[str, str]]:
    """Devuelve { sitio: { 'ssh': fqdn, 'db': fqdn } } a partir de una lista plana de FQDN."""
    suf = domain_suffix.lower().strip().lstrip(".")
    acc: dict[str, dict[str, str]] = {}
    for raw in hostnames:
        domain = _host_only(str(raw))
        if not domain.endswith(suf):
            continue
        m_ssh = SSH_RE.match(domain)
        if m_ssh:
            site = m_ssh.group(1)
            acc.setdefault(site, {})["ssh"] = domain
            continue
        m_db = BD_RE.match(domain)
        if m_db:
            site = m_db.group(1)
            acc.setdefault(site, {})["db"] = domain
    return dict(sorted(acc.items(), key=lambda x: x[0].lower()))


def discover_hostnames(
    apps: list[dict[str, Any]], domain_suffix: str
) -> dict[str, dict[str, str]]:
    """Solo Access: { sitio: { 'ssh': fqdn, 'db': fqdn } }."""
    return discover_sites_from_hostnames(hostnames_from_access_apps(apps), domain_suffix)


def _collect_used_ports(sites: dict[str, Any]) -> tuple[set[int], set[int]]:
    ssh_u: set[int] = set()
    db_u: set[int] = set()
    for _name, entry in sites.items():
        if not isinstance(entry, dict):
            continue
        s = entry.get("ssh")
        if isinstance(s, dict) and "local_port" in s:
            try:
                ssh_u.add(int(s["local_port"]))
            except (TypeError, ValueError):
                pass
        d = entry.get("db")
        if isinstance(d, dict) and "local_port" in d:
            try:
                db_u.add(int(d["local_port"]))
            except (TypeError, ValueError):
                pass
    return ssh_u, db_u


def _alloc_ssh(used: set[int]) -> int:
    p = 2222
    while p in used:
        p += 2
    used.add(p)
    return p


def _alloc_db(used: set[int]) -> int:
    p = 15432
    while p in used:
        p += 2
    used.add(p)
    return p


def _port_for_role(
    site: str,
    role: str,
    hostname: str,
    old_sites: dict[str, Any],
    ssh_used: set[int],
    db_used: set[int],
) -> int:
    old = old_sites.get(site) or {}
    block = old.get(role)
    if isinstance(block, dict) and block.get("hostname") == hostname and "local_port" in block:
        try:
            lp = int(block["local_port"])
            if role == "ssh":
                ssh_used.add(lp)
            else:
                db_used.add(lp)
            return lp
        except (TypeError, ValueError):
            pass
    if role == "ssh":
        return _alloc_ssh(ssh_used)
    return _alloc_db(db_used)


def sync_to_tunnels_json(
    account_id: str,
    api_token: str,
    domain_suffix: str,
    tunnels_path: Path | None = None,
    zone_id: str = "",
) -> tuple[int, str]:
    account_id = normalize_account_id(account_id)
    api_token = normalize_api_token(api_token)
    zid = normalize_account_id(zone_id)
    err = validate_account_id(account_id)
    if err:
        raise CfSyncError(err)
    err_z = validate_zone_id(zone_id)
    if err_z:
        raise CfSyncError(err_z)
    err_t = validate_api_token_shape(api_token)
    if err_t:
        raise CfSyncError(err_t)
    preflight_api_token(api_token, account_id)

    path = tunnels_path or TUNNELS_JSON
    apps = fetch_access_applications(account_id, api_token, zid if zid else None)
    h_access = hostnames_from_access_apps(apps)
    h_tunnel, err_tunnel = fetch_tunnel_ingress_hostnames(account_id, api_token)
    h_dns: list[str] = []
    err_dns: str | None = None
    if zid:
        h_dns, err_dns = fetch_dns_cname_tunnel_hostnames(zid, api_token, domain_suffix)

    merged_hosts = _merge_unique_hostnames(h_access, h_tunnel, h_dns)
    discovered = discover_sites_from_hostnames(merged_hosts, domain_suffix)

    suf_n = (domain_suffix or "").lower().strip().lstrip(".")
    under_suffix = [h for h in merged_hosts if h.endswith(suf_n)]

    sync_warnings = [w for w in (err_tunnel, err_dns) if w]
    old_blob: dict[str, Any] = {}
    if path.is_file():
        with path.open(encoding="utf-8") as f:
            old_blob = json.load(f)
    old_sites: dict[str, Any] = dict(old_blob.get("sites") or {})

    ssh_used, db_used = _collect_used_ports(old_sites)
    merged: dict[str, Any] = {}

    for site, roles in discovered.items():
        entry: dict[str, Any] = {}
        if "ssh" in roles:
            h = roles["ssh"]
            entry["ssh"] = {
                "hostname": h,
                "local_port": _port_for_role(site, "ssh", h, old_sites, ssh_used, db_used),
            }
        if "db" in roles:
            h = roles["db"]
            entry["db"] = {
                "hostname": h,
                "local_port": _port_for_role(site, "db", h, old_sites, ssh_used, db_used),
            }
        merged[site] = entry

    for site, entry in old_sites.items():
        if site not in merged:
            merged[site] = entry

    portal_by_site = discover_poslite_suffixes_by_site(merged_hosts, suf_n, merged.keys())
    for site, entry in merged.items():
        _apply_poslite_from_discovery(site, entry, portal_by_site, old_sites.get(site))

    meta = {
        "source": "cloudflare_access+tunnel_ingress+dns_cname",
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "account_id": account_id,
        "zone_id": zid or None,
        "domain_suffix": domain_suffix,
        "access_apps_seen": len(apps),
        "access_hostnames_seen": len(set(h_access)),
        "tunnel_ingress_hostnames_seen": len(set(h_tunnel)),
        "dns_tunnel_cnames_seen": len(set(h_dns)),
        "hostnames_candidates": len(merged_hosts),
        "sites_matched": len(discovered),
        "poslite_suffixes_sites": len(portal_by_site),
        "sync_warnings": sync_warnings,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    out_obj: dict[str, Any] = {"meta": meta, "sites": merged}
    pd = old_blob.get("poslite_defaults")
    if isinstance(pd, dict):
        out_obj["poslite_defaults"] = pd
    with path.open("w", encoding="utf-8") as f:
        json.dump(out_obj, f, indent=2, ensure_ascii=False)

    n = len(discovered)
    na = len(apps)
    via = f" (zona {zid})" if zid else ""
    suf_disp = (domain_suffix or "").strip().lstrip(".") or "asptienda.com"
    summary = (
        f"Fuentes: Access {na} apps / {len(set(h_access))} hostnames; "
        f"ingress túneles {len(set(h_tunnel))}; "
        f"DNS CNAME→túnel {len(set(h_dns))}."
    )
    hint = ""
    if n == 0 and len(under_suffix) > 0:
        hint = (
            f" Hay {len(under_suffix)} hostname(s) que terminan en «.{suf_disp}»; "
            f"ninguno encaja en «*-ssh.{suf_disp}» ni «*-bd.{suf_disp}»."
        )
    elif n == 0 and len(merged_hosts) > 0:
        hint = (
            f" Hay {len(merged_hosts)} hostname(s) desde Access/túneles/DNS, pero ninguno termina en "
            f"«.{suf_disp}» — revisa el sufijo en ajustes."
        )
    elif n == 0 and len(merged_hosts) == 0:
        if na > 0:
            hint = (
                f" Las {na} aplicaciones Access no aportan dominios reconocibles, y no hay "
                "ingress en API de túneles ni CNAME a túnel en la zona (o faltan permisos / Zone ID)."
            )
        elif na == 0 and len(h_tunnel) == 0 and len(h_dns) == 0:
            hint = (
                " Sin aplicaciones Access, sin hostnames en config remota de túneles y sin CNAME "
                "a túnel en la zona. Comprueba permisos (Access, Cloudflare Tunnel Read) y, para DNS, "
                "Zone ID + Zone DNS Read."
            )
        else:
            hint = (
                " No hay hostnames candidatos. Si el túnel es solo «local» (config YAML), la API no "
                "expone ingress: usa DNS en Cloudflare o rellena tunnels.json a mano."
            )
    warn_tail = ""
    if sync_warnings:
        warn_tail = " Avisos: " + " | ".join(sync_warnings)
    return (
        n,
        f"Sincronizado{via}: {n} sitios (*-ssh / *-bd · {suf_disp}). "
        f"Entradas totales en JSON: {len(merged)}. Poslite: {len(portal_by_site)} sitios con enlaces deducidos. "
        f"{summary}{hint}{warn_tail}",
    )
