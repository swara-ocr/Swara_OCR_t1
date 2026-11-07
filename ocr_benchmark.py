#!/usr/bin/env python3
"""
OCR benchmark for the vision device: Tesseract vs Gemini vs Claude.

Test set layout (one folder):
    si_medicine_01.jpg + si_medicine_01.txt   <- ground-truth text, UTF-8
    ta_busboard_02.jpg + ta_busboard_02.txt
    en_label_03.jpg    + en_label_03.txt
The filename prefix (si_ / ta_ / en_) picks the Tesseract language and groups the results.

Usage:
    python ocr_benchmark.py testset/
    python ocr_benchmark.py testset/ --providers tesseract,gemini
Env: GEMINI_API_KEY, GEMINI_MODEL, ANTHROPIC_API_KEY, CLAUDE_MODEL
Metric: character error rate (lower is better). Text is NFC-normalised, whitespace-collapsed and
zero-width joiners are dropped, because Sinhala conjuncts use ZWJ and models disagree about it.
"""
import argparse
import base64
import csv
import io
import os
import sys
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

import requests
from PIL import Image, ImageOps

PROMPT = ("Transcribe all text in this image exactly as printed or written, in its original script. "
          "Keep the reading order. Output only the transcription, nothing else.")
TESS_LANG = {"si": "sin", "ta": "tam", "en": "eng"}
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")


def norm(s):
    s = unicodedata.normalize("NFC", s).replace("\u200d", "").replace("\u200c", "")
    return " ".join(s.split())


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(ref, hyp):
    return edit_distance(ref, hyp) / max(1, len(ref))


def jpeg_b64(path, side=2000):
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((side, side))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode()


def run_tesseract(path, code):
    import pytesseract
    img = ImageOps.autocontrast(ImageOps.grayscale(Image.open(path)))
    return pytesseract.image_to_string(img, lang=TESS_LANG[code], config="--psm 6")


def run_gemini(path, code):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    body = {"contents": [{"role": "user", "parts": [
        {"inline_data": {"mime_type": "image/jpeg", "data": jpeg_b64(path)}},
        {"text": PROMPT}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 4096}}
    r = requests.post(url, json=body, timeout=90,
                      headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    r.raise_for_status()
    parts = r.json()["candidates"][0].get("content", {}).get("parts", [])
    return "".join(p.get("text", "") for p in parts)


def run_claude(path, code):
    body = {"model": CLAUDE_MODEL, "max_tokens": 4096, "messages": [{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": jpeg_b64(path)}},
        {"type": "text", "text": PROMPT}]}]}
    r = requests.post("https://api.anthropic.com/v1/messages", json=body, timeout=90,
                      headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"],
                               "anthropic-version": "2023-06-01"})
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")


PROVIDERS = {"tesseract": run_tesseract, "gemini": run_gemini, "claude": run_claude}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--providers", default="tesseract,gemini,claude")
    args = ap.parse_args()
    names = [p.strip() for p in args.providers.split(",") if p.strip()]

    images = sorted(p for p in Path(args.folder).iterdir()
                    if p.suffix.lower() in {".jpg", ".jpeg", ".png"} and p.with_suffix(".txt").exists())
    if not images:
        sys.exit("No image + .txt pairs found.")

    rows = []
    for img in images:
        code = img.stem.split("_")[0]
        code = code if code in TESS_LANG else "en"
        ref = norm(img.with_suffix(".txt").read_text(encoding="utf-8"))
        for name in names:
            t0 = time.time()
            try:
                hyp = norm(PROVIDERS[name](img, code))
                err = cer(ref, hyp)
            except Exception as e:
                print(f"{img.name:35} {name:10} FAILED: {e}")
                continue
            dt = time.time() - t0
            rows.append(dict(file=img.name, lang=code, provider=name, cer=round(err, 4),
                             seconds=round(dt, 2), hyp=hyp))
            print(f"{img.name:35} {name:10} CER {err:6.3f}  {dt:5.1f}s")

    out = Path(args.folder) / "results.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["file", "lang", "provider", "cer", "seconds", "hyp"])
        w.writeheader()
        w.writerows(rows)

    agg = defaultdict(list)
    for r in rows:
        agg[(r["lang"], r["provider"])].append(r)
    print("\nSUMMARY (mean CER, mean seconds, n)")
    for (lang, prov), rs in sorted(agg.items()):
        mc = sum(x["cer"] for x in rs) / len(rs)
        ms = sum(x["seconds"] for x in rs) / len(rs)
        print(f"  {lang}  {prov:10} CER {mc:6.3f}  {ms:5.1f}s  n={len(rs)}")
    print(f"\nFull results: {out}")


if __name__ == "__main__":
    main()
