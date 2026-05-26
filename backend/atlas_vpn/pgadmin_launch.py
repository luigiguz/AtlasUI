"""Localizar e iniciar pgAdmin 4 (instalación de escritorio)."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_pgadmin_executable() -> Path | None:
    """Rutas habituales de pgAdmin 4; devuelve None si no hay binario conocido."""
    if sys.platform == "win32":
        for key in ("ProgramFiles", "ProgramFiles(x86)"):
            base = os.environ.get(key)
            if not base:
                continue
            cand = Path(base) / "pgAdmin 4" / "runtime" / "pgAdmin4.exe"
            if cand.is_file():
                return cand
        w = shutil.which("pgAdmin4") or shutil.which("pgadmin4")
        if w:
            return Path(w)
    elif sys.platform == "darwin":
        cand = Path("/Applications/pgAdmin 4.app/Contents/MacOS/pgAdmin4")
        if cand.is_file():
            return cand
    else:
        for name in ("pgadmin4", "pgAdmin4"):
            w = shutil.which(name)
            if w:
                return Path(w)
        for cand in (
            Path("/usr/pgadmin4/bin/pgadmin4"),
            Path("/usr/pgadmin4/web/pgAdmin4.py"),
        ):
            if cand.is_file():
                return cand
    return None


def launch_pgadmin() -> tuple[bool, str]:
    """
    Arranca pgAdmin en segundo plano.
    Returns:
        (True, ruta del ejecutable) o (False, mensaje de error).
    """
    exe = find_pgadmin_executable()
    if exe is None:
        return (
            False,
            "No se encontró pgAdmin 4. Instálalo desde https://www.pgadmin.org/download/ "
            "y vuelve a intentar.",
        )
    try:
        if exe.suffix.lower() == ".py":
            subprocess.Popen([sys.executable, str(exe)])
        else:
            subprocess.Popen([str(exe)])
    except OSError as e:
        return False, str(e)
    return True, str(exe)
