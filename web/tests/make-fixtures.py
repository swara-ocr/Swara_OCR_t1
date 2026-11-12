"""Builds the 640x480 test frames in tests/fixtures from the textbook pages in benchmark/testset.

Run from the repository root:  .venv/bin/python web/tests/make-fixtures.py
The spreads are synthetic open books: two pages side by side, a shadow at the gutter,
the text squeezed towards the gutter (page curl) and a slight rotation. They are not real photos.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

SRC = Path("benchmark/testset")
OUT = Path("web/tests/fixtures")
W, H = 640, 480
TABLE = (46, 41, 38)
rng = np.random.default_rng(7)


def page(name, height):
    im = Image.open(SRC / name).convert("RGB")
    im = ImageEnhance.Brightness(im).enhance(0.9)
    return im.resize((round(im.width * height / im.height), height), Image.LANCZOS)


def frame():
    arr = np.full((H, W, 3), TABLE, dtype=np.float32) + rng.normal(0, 3, (H, W, 3))
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def spread(left, right, height, shadow=0.0, curl=0.0, angle=0.0, gap=0):
    a, b = page(left, height), page(right, height)
    book = Image.new("RGB", (a.width + b.width + gap, height), (230, 228, 222))
    book.paste(a, (0, 0))
    book.paste(b, (a.width + gap, 0))
    gx = a.width + gap / 2
    arr = np.asarray(book).astype(np.float32)
    xs = np.arange(arr.shape[1], dtype=np.float32)
    if shadow:
        arr *= (1 - shadow * np.exp(-(((xs - gx) / 16) ** 2)))[None, :, None]
    if curl:  # squeeze the content towards the gutter
        src = xs + curl * (xs - gx) * np.exp(-(((xs - gx) / 70) ** 2))
        src = np.clip(src, 0, arr.shape[1] - 1)
        i0 = np.floor(src).astype(int)
        i1 = np.minimum(i0 + 1, arr.shape[1] - 1)
        f = (src - i0)[None, :, None]
        arr = arr[:, i0] * (1 - f) + arr[:, i1] * f
    book = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if angle:
        book = book.rotate(angle, expand=True, fillcolor=TABLE, resample=Image.BICUBIC)
    f = frame()
    x, y = (W - book.width) // 2, (H - book.height) // 2
    f.paste(book, (x, y))
    return f, x + gx - (book.width - (a.width + b.width + gap)) / 2 if not angle else x + book.width / 2


truth = {}

f = frame()
p = page("en_textbook_07.png", 456)
f.paste(p, ((W - p.width) // 2, 12))
f.save(OUT / "single.png")

f2 = frame()
t = page("en_textbook_07.png", 400).rotate(10, expand=True, fillcolor=TABLE, resample=Image.BICUBIC)
f2.paste(t, ((W - t.width) // 2, (H - t.height) // 2))
f2.save(OUT / "single_tilt10.png")

f3 = frame()
big = page("en_textbook_07.png", 1250)
f3.paste(big, (-(big.width - W) // 2, -330))  # text runs off both sides
f3.save(OUT / "single_cut.png")

for name, args in {
    "spread_flat": ("en_textbook_07.png", "en_textbook_08.png", 360, dict(shadow=0.0, curl=0.0)),
    "spread_shadow": ("en_textbook_07.png", "en_textbook_08.png", 360, dict(shadow=0.45, curl=0.12, gap=0)),
    "spread_tilt": ("en_textbook_07.png", "en_textbook_08.png", 340, dict(shadow=0.4, curl=0.12, angle=3)),
    "spread_si": ("sn_textbook_02.png", "sn_textbook_03.png", 360, dict(shadow=0.45, curl=0.12)),
}.items():
    img, gx = spread(args[0], args[1], args[2], **args[3])
    img.save(OUT / f"{name}.png")
    truth[name] = {"gutterX": round(float(gx), 1)}

(OUT / "truth.json").write_text(json.dumps(truth, indent=2))
print(truth)
