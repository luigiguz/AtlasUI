"""Genera favicons cuadrados (recorte del globo/figura) desde el logo Atlas sin fondo."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "branding" / "Logo ATLAS - Sin Fondi.png"
OUT = ROOT / "public"


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    arr = np.array(im)
    mask = arr[:, :, 3] > 40
    ys, xs = np.where(mask)
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    content_h = y1 - y0
    content_w = x1 - x0
    cx = (x0 + x1) / 2
    # Recorte apretado: figura + globo (sin la franja del texto "ATLAS")
    cy = y0 + content_h * 0.36
    side = int(content_h * 0.78)
    half = side // 2
    left = int(max(0, cx - half))
    top = int(max(0, cy - half))
    right = min(im.width, left + side)
    bottom = min(im.height, top + side)
    if right - left < side:
        left = max(0, right - side)
    if bottom - top < side:
        top = max(0, bottom - side)
    cropped = im.crop((left, top, left + side, top + side))

    sizes = {
        "favicon-16.png": 16,
        "favicon-32.png": 32,
        "favicon-48.png": 48,
        "favicon-64.png": 64,
        "favicon.png": 32,
        "apple-touch-icon.png": 180,
    }
    for name, size in sizes.items():
        cropped.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)

    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    ico_imgs = [cropped.resize(s, Image.Resampling.LANCZOS) for s in ico_sizes]
    ico_imgs[0].save(OUT / "favicon.ico", format="ICO", sizes=ico_sizes, append_images=ico_imgs[1:])
    print("OK:", ", ".join(sizes))


if __name__ == "__main__":
    main()
