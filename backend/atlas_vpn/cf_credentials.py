"""Normalización de Account ID y API Token (evita errores 403 por pegados sucios)."""

from __future__ import annotations

import re

_ACCOUNT_ID_RE = re.compile(r"^[a-f0-9]{32}$", re.IGNORECASE)


def normalize_api_token(raw: str) -> str:
    t = (raw or "").strip()
    # Caracteres invisibles típicos de copiar desde web/PDF
    for zw in ("\ufeff", "\u200b", "\u200c", "\u200d", "\u00a0"):
        t = t.replace(zw, "")
    if len(t) >= 2 and t[0] in "\"'" and t[-1] == t[0]:
        t = t[1:-1].strip()
    low = t.lower()
    if low.startswith("bearer "):
        t = t[7:].strip()
    # Un solo bloque: quita saltos de línea/espacios accidentales en medio del token
    t = "".join(t.split())
    return t.strip()


def normalize_account_id(raw: str) -> str:
    """Quita espacios y guiones (por si pegaron UUID con guiones)."""
    return re.sub(r"[\s-]+", "", (raw or "").strip())


def validate_account_id(account_id: str) -> str | None:
    """Devuelve mensaje de error en español o None si es válido."""
    if not account_id:
        return "El Account ID está vacío."
    if not _ACCOUNT_ID_RE.match(account_id):
        return (
            "El Account ID debe ser exactamente 32 caracteres hexadecimales "
            "(sin guiones). Cópialo del panel derecho en Overview del account."
        )
    return None


def validate_api_token_shape(api_token: str) -> str | None:
    """Comprueba formato obvio antes de llamar a la API (evita confusiones comunes)."""
    if not api_token:
        return "El API Token está vacío."
    if "@" in api_token:
        return (
            "El valor parece una Global API Key (suele ser «correo:clave»). "
            "Atlas VPN necesita un API Token: My Profile → API Tokens → Create Token "
            "(cadena larga, sin arroba)."
        )
    if len(api_token) < 20:
        return "El API Token es demasiado corto; seguramente falta parte al copiar."
    if len(api_token) > 512:
        return "El API Token es demasiado largo; revisa que no hayas pegado texto de más."
    return None


def validate_zone_id(raw: str) -> str | None:
    """Opcional; mismo formato 32 hex. Vacío = omitir."""
    z = normalize_account_id(raw)
    if not z:
        return None
    if not _ACCOUNT_ID_RE.match(z):
        return (
            "Zone ID debe ser 32 caracteres hexadecimales. "
            "Cópialo desde Overview de la zona (dominio asptienda.com o raíz)."
        )
    return None
