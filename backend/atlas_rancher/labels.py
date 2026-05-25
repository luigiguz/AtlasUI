"""Normalización de labels Rancher (application, distro) para Atlas."""

from __future__ import annotations

DISTRO_CANONICAL: dict[str, str] = {
    "pam": "Pam",
    "horustech": "Horustech",
}

APPLICATION_CANONICAL: dict[str, str] = {
    "poslite": "Poslite",
}

# Distribuciones válidas cuando application=Poslite
POSLITE_DISTROS: frozenset[str] = frozenset({"Pam", "Horustech"})


def normalize_distro(raw: str) -> str:
    low = str(raw or "").strip().lower()
    if not low:
        return ""
    return DISTRO_CANONICAL.get(low, low[:1].upper() + low[1:])


def normalize_application(raw: str) -> str:
    low = str(raw or "").strip().lower()
    if not low:
        return ""
    return APPLICATION_CANONICAL.get(low, low[:1].upper() + low[1:])


def is_poslite_application(app: str) -> bool:
    return normalize_application(app) == "Poslite"


def is_valid_poslite_distro(distro: str) -> bool:
    return normalize_distro(distro) in POSLITE_DISTROS


# Labels que Atlas puede editar en Custom clusters (Rancher metadata.labels).
ALLOWED_LABEL_KEYS: frozenset[str] = frozenset({"store", "application", "distro", "atlas"})


def validate_editable_labels(application: str, distro: str) -> str | None:
    """Devuelve mensaje de error o None si es válido."""
    app = normalize_application(application)
    d = normalize_distro(distro)
    if is_poslite_application(app) and d and not is_valid_poslite_distro(d):
        return "Poslite solo permite distribución Pam u Horustech."
    return None


def prepare_label_values(
    store: str,
    application: str,
    distro: str,
    atlas: str,
) -> dict[str, str]:
    """Valores normalizados para persistir en Rancher (vacío = quitar label)."""
    out: dict[str, str] = {}
    s = str(store or "").strip()
    if s:
        out["store"] = s
    app = normalize_application(application)
    if app:
        out["application"] = app
    d = normalize_distro(distro)
    if d:
        out["distro"] = d
    a = str(atlas or "").strip()
    if a:
        out["atlas"] = a
    err = validate_editable_labels(out.get("application", ""), out.get("distro", ""))
    if err:
        raise ValueError(err)
    return out
