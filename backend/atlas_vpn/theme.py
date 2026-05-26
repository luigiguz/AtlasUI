"""Paleta inspirada en Zero Trust / cloudflared (oscuro, naranja Cloudflare, acentos fríos)."""

from __future__ import annotations

# Base tipo dashboard oscuro
BG = "#0B0D10"
SURFACE = "#111418"
SURFACE_ELEVATED = "#161B22"
NAVY = "#0D1B2A"
NAVY_HOVER = "#152535"
SLATE = "#1C2128"
SLATE_LIGHT = "#2D333B"
CARD = "#161B22"
ACCENT = "#F48120"
ACCENT_HOVER = "#FF9A3C"
ACCENT_MUTED = "#C9650E"
TEXT = "#E6EDF3"
TEXT_MUTED = "#8B949E"
TEXT_SUBTLE = "#6E7681"
DANGER = "#F85149"
SUCCESS = "#3FB950"
WARNING = "#D29922"
BORDER = "#30363D"
GRID_LINE = "#21262D"

FONT_TITLE = ("Segoe UI", 22, "bold")
FONT_SUB = ("Segoe UI", 13)
FONT_UI = ("Segoe UI", 12)
FONT_SMALL = ("Segoe UI", 11)
FONT_MONO = ("Consolas", 10)
FONT_MONO_SMALL = ("Consolas", 9)

# Compatibilidad con código que aún use NAVY en botones secundarios
# (misma familia que SURFACE)
