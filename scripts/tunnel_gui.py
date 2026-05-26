#!/usr/bin/env python3
"""Compatibilidad: abre Atlas (antes tunnel_gui)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
for p in (ROOT, BACKEND, ROOT / "scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from atlas_api.__main__ import main

if __name__ == "__main__":
    main()
