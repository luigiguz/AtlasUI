"""Plantilla HTML de correo Atlas (marca Verkku / colores consola)."""

from __future__ import annotations

import html
from typing import Any

# Paleta Atlas UI
_BG = "#0b0d10"
_PANEL = "#111418"
_BORDER = "#2a2f36"
_TEXT = "#e4e4e7"
_MUTED = "#71717a"
_ACCENT = "#F48120"
_FOOTER = "#52525b"

_SEVERITY_STYLES: dict[str, dict[str, str]] = {
    "critical": {"bg": "#450a0a", "border": "#f87171", "label": "Crítico", "dot": "#f87171"},
    "warning": {"bg": "#422006", "border": "#fbbf24", "label": "Aviso", "dot": "#fbbf24"},
    "success": {"bg": "#052e16", "border": "#34d399", "label": "Completado", "dot": "#34d399"},
    "info": {"bg": "#0c4a6e", "border": "#38bdf8", "label": "Información", "dot": "#38bdf8"},
}


def _severity_style(severity: str) -> dict[str, str]:
    return _SEVERITY_STYLES.get(severity.strip().lower(), _SEVERITY_STYLES["info"])


def _route_label(route: str) -> str:
    labels = {
        "home": "Inicio",
        "conn": "Conexiones",
        "poslite": "DNS",
        "cf": "Cloudflare",
        "rancher-stores": "Tiendas",
        "rancher-store-requests": "Solicitudes",
        "rancher-clusters": "Equipos",
        "rancher-pods": "Contenedores",
        "users": "Usuarios",
        "roles": "Roles",
    }
    return labels.get(route.strip(), "Atlas")


_STORE_KIND_META: dict[str, dict[str, str]] = {
    "store_change_pending": {
        "severity": "info",
        "subject_prefix": "Nueva solicitud de tienda",
        "headline": "Nueva solicitud pendiente de revisión",
        "cta": "Revisar cola de solicitudes",
        "intro_admin": "Un operador envió una solicitud de cambio que requiere tu aprobación.",
        "intro_user": "",
    },
    "store_change_approved": {
        "severity": "success",
        "subject_prefix": "Solicitud aprobada",
        "headline": "Tu solicitud fue aprobada",
        "cta": "Ver solicitud en Atlas",
        "intro_admin": "",
        "intro_user": "Un administrador aprobó tu solicitud y el cambio se publicó en Git.",
    },
    "store_change_rejected": {
        "severity": "warning",
        "subject_prefix": "Solicitud rechazada",
        "headline": "Tu solicitud fue rechazada",
        "cta": "Ver detalle en Atlas",
        "intro_admin": "",
        "intro_user": "Un administrador rechazó tu solicitud. Revisa el motivo indicado abajo.",
    },
}


def _detail_row(label: str, value: str) -> str:
    if not value.strip():
        return ""
    safe_label = html.escape(label)
    safe_value = html.escape(value.strip())
    return (
        f'<tr><td style="padding:6px 0;font-size:12px;color:{_MUTED};width:38%;vertical-align:top;">'
        f"{safe_label}</td>"
        f'<td style="padding:6px 0;font-size:13px;color:{_TEXT};vertical-align:top;">{safe_value}</td></tr>'
    )


def render_store_request_email(
    *,
    kind: str,
    title: str,
    body: str,
    route: str,
    action_url: str,
    recipient_name: str = "",
    payload: dict[str, Any] | None = None,
    logo_data_uri: str | None = None,
) -> tuple[str, str, str]:
    """Devuelve (html, plain_text, subject)."""
    meta = _STORE_KIND_META.get(kind, _STORE_KIND_META["store_change_pending"])
    severity = meta["severity"]
    sev = _severity_style(severity)
    pdata = payload if isinstance(payload, dict) else {}

    request_id = pdata.get("requestId")
    folder = str(pdata.get("folderName") or pdata.get("storeId") or "—")
    summary = str(pdata.get("summary") or body.split(". Motivo:")[0] or body).strip()
    creator = str(pdata.get("createdByUsername") or "—")
    reviewer = str(pdata.get("reviewedByUsername") or "—")
    review_note = str(pdata.get("reviewNote") or "")
    req_kind = str(pdata.get("requestKind") or "")
    type_label = "Nueva tienda" if req_kind == "create" else "Actualización" if req_kind == "update" else "—"

    headline = meta["headline"]
    intro = meta["intro_admin"] if kind == "store_change_pending" else meta["intro_user"]

    safe_title = html.escape(title.strip())
    safe_body = html.escape(body.strip()).replace("\n", "<br />")
    safe_name = html.escape(recipient_name.strip()) if recipient_name.strip() else ""
    route_name = html.escape(_route_label(route))
    safe_url = html.escape(action_url.strip(), quote=True)

    id_line = f" #{request_id}" if request_id is not None else ""
    subject = f"Atlas — {meta['subject_prefix']}{id_line}"

    if safe_name:
        greeting = (
            f'<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:{_MUTED};">Hola {safe_name},</p>'
        )
    else:
        greeting = ""

    intro_block = (
        f'<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:{_MUTED};">{html.escape(intro)}</p>'
        if intro
        else ""
    )

    details_rows = "".join(
        r
        for r in [
            _detail_row("Solicitud", f"#{request_id}" if request_id is not None else "—"),
            _detail_row("Tienda", folder),
            _detail_row("Tipo", type_label) if type_label != "—" else "",
            _detail_row("Solicitante", creator) if kind == "store_change_pending" else "",
            _detail_row("Revisado por", reviewer) if kind != "store_change_pending" else "",
            _detail_row("Resumen", summary),
            _detail_row("Motivo del rechazo", review_note) if kind == "store_change_rejected" and review_note else "",
        ]
        if r
    )

    details_table = (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" '
        f'style="margin:16px 0 0;border-top:1px solid {_BORDER};padding-top:12px;">{details_rows}</table>'
        if details_rows
        else ""
    )

    logo_block = (
        f'<img src="{logo_data_uri}" alt="Atlas" width="120" height="auto" '
        f'style="display:block;max-width:120px;height:auto;border:0;" />'
        if logo_data_uri
        else f'<div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:{_TEXT};">'
        f'Atlas<span style="color:{_ACCENT};">.</span></div>'
    )

    html_doc = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>{html.escape(headline)}</title>
</head>
<body style="margin:0;padding:0;background-color:{_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:{_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr><td style="padding-bottom:24px;">{logo_block}</td></tr>
          <tr>
            <td style="background-color:{_PANEL};border:1px solid {_BORDER};border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr><td style="height:4px;background:linear-gradient(90deg,{_ACCENT},#fb923c);font-size:0;">&nbsp;</td></tr>
                <tr>
                  <td style="padding:28px 28px 8px;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;
                      letter-spacing:0.04em;text-transform:uppercase;color:{sev['dot']};
                      background-color:{sev['bg']};border:1px solid {sev['border']};">{html.escape(sev['label'])}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 0;">
                    <h1 style="margin:0;font-size:20px;line-height:1.35;font-weight:600;color:{_TEXT};">{html.escape(headline)}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px 0;">
                    {greeting}
                    {intro_block}
                    <p style="margin:0;font-size:15px;line-height:1.6;color:{_TEXT};">{safe_body}</p>
                    {details_table}
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px 28px;">
                    <a href="{safe_url}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:12px 22px;border-radius:10px;background-color:{_ACCENT};
                      color:#0b0d10;font-size:14px;font-weight:700;text-decoration:none;box-shadow:0 4px 14px rgba(244,129,32,0.35);">
                      {html.escape(meta['cta'])} — {route_name}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:{_FOOTER};">Plataforma Atlas · Powered by Verkku</p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:{_MUTED};">
                Notificación de solicitudes de tienda · Gestión Atlas Rancher
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    plain_lines = [f"Atlas — {meta['subject_prefix']}{id_line}", "", headline]
    if intro:
        plain_lines.extend(["", intro])
    plain_lines.extend(["", body.strip()])
    if request_id is not None:
        plain_lines.append(f"\nSolicitud: #{request_id}")
    plain_lines.append(f"Tienda: {folder}")
    if kind == "store_change_pending":
        plain_lines.append(f"Solicitante: {creator}")
    if kind != "store_change_pending":
        plain_lines.append(f"Revisado por: {reviewer}")
    if review_note and kind == "store_change_rejected":
        plain_lines.append(f"Motivo: {review_note}")
    plain_lines.extend(["", f"{meta['cta']}: {action_url.strip()}", "", "---", "Plataforma Atlas · Powered by Verkku"])
    return html_doc, "\n".join(plain_lines), subject


def render_notification_email(
    *,
    title: str,
    body: str,
    severity: str,
    route: str,
    action_url: str,
    recipient_name: str = "",
    logo_data_uri: str | None = None,
) -> tuple[str, str]:
    """Devuelve (html, plain_text)."""
    sev = _severity_style(severity)
    safe_title = html.escape(title.strip())
    safe_body = html.escape(body.strip()).replace("\n", "<br />")
    safe_name = html.escape(recipient_name.strip()) if recipient_name.strip() else ""
    route_name = html.escape(_route_label(route))
    safe_url = html.escape(action_url.strip(), quote=True)

    if safe_name:
        greeting = (
            f'<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:{_MUTED};">'
            f"Hola {safe_name},</p>"
        )
    else:
        greeting = (
            f'<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:{_MUTED};">'
            "Tienes una nueva notificación en Atlas.</p>"
        )

    logo_block = ""
    if logo_data_uri:
        logo_block = (
            f'<img src="{logo_data_uri}" alt="Atlas" width="120" height="auto" '
            f'style="display:block;max-width:120px;height:auto;border:0;" />'
        )
    else:
        logo_block = (
            f'<div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:{_TEXT};">'
            f'Atlas<span style="color:{_ACCENT};">.</span></div>'
        )

    html_doc = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>{safe_title}</title>
</head>
<body style="margin:0;padding:0;background-color:{_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:{_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr>
            <td style="padding-bottom:24px;">{logo_block}</td>
          </tr>
          <tr>
            <td style="background-color:{_PANEL};border:1px solid {_BORDER};border-radius:16px;overflow:hidden;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,{_ACCENT},#fb923c);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:28px 28px 8px;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;
                      letter-spacing:0.04em;text-transform:uppercase;color:{sev['dot']};
                      background-color:{sev['bg']};border:1px solid {sev['border']};">{html.escape(sev['label'])}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 28px 0;">
                    <h1 style="margin:0;font-size:20px;line-height:1.35;font-weight:600;color:{_TEXT};">{safe_title}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px 0;">
                    {greeting}
                    <p style="margin:0;font-size:15px;line-height:1.6;color:{_TEXT};">{safe_body}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px 28px;">
                    <a href="{safe_url}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:12px 22px;border-radius:10px;background-color:{_ACCENT};
                      color:#0b0d10;font-size:14px;font-weight:700;text-decoration:none;box-shadow:0 4px 14px rgba(244,129,32,0.35);">
                      Abrir en Atlas — {route_name}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 8px 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:{_FOOTER};">
                Plataforma Atlas · Powered by Verkku
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:{_MUTED};">
                Recibes este correo porque tienes notificaciones por email activadas en tu cuenta.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    plain = (
        f"Atlas — {sev['label']}\n\n"
        f"{title.strip()}\n\n"
        f"{body.strip()}\n\n"
        f"Abrir en Atlas ({_route_label(route)}): {action_url.strip()}\n\n"
        "---\nPlataforma Atlas · Powered by Verkku"
    )
    return html_doc, plain
