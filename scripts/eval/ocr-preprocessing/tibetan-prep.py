#!/usr/bin/env python3
# PRIOR ART: sl-mitra-1:/root/yig/yig_leaf_worker.py fetch_loop()/crops_for()/prep() — the production image path
# (fetch, gutter gate, leafsplit.detect, partition crops, 2400 px PIL Lanczos). Copied here so the #5250 arm
# images start from EXACTLY that input; the only addition is preprocess.py applied after prep().
"""Make every #5250 Tibetan arm image on Hetzner (CPU), before the GPU is on.

Inputs: /root/pp5250/tibetan/{referenced,mark}.jsonl and /root/tibetan-reocr/_tmp-reread-control18.jsonl.
Arms (whole capture): none, otsu, sauvola, clahe, deskew, upscale2x.
Arms (per leaf, partition crops as in production since 2026-09-28): leafcrop, leaf+otsu, leaf+sauvola,
leaf+clahe, leaf+deskew.  A/A repeats (none-repeat, leafcrop-repeat) reuse the same files; the manifest says so.
Out: tibetan/img/<arm>/<stem>[.L<i>].jpg (JPEG q95 for every arm, so the encode is shared),
     tibetan/manifest.jsonl  {stem, book, page, substratum, arm, files[]}  one row per GPU job,
     tibetan/prep-meta.jsonl {stem, geo, arm meta}.
"""
import io
import json
import os
import sys
import time

import cv2
import numpy as np
import requests
from PIL import Image

sys.path.insert(0, "/root/pp5250/code")
import preprocess as pp  # noqa: E402
from leafsplit import detect  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
UA = "SourceLibrary-reocr/0.1 (Tibetan OCR preprocessing experiment #5250; contact: library@sourcelibrary.org)"
W = "/root/pp5250/tibetan"
OCR_TARGET_W = 2400
WHITE_LEVEL, BAND_PURITY, MIN_BAND_PX = 250, 0.98, 200
WHOLE = ["none", "otsu", "sauvola", "clahe", "deskew", "upscale2x"]
LEAF = {"leafcrop": "none", "leaf+otsu": "otsu", "leaf+sauvola": "sauvola", "leaf+clahe": "clahe", "leaf+deskew": "deskew"}
N_REPEAT = 30  # A/A pages: the first 30 referenced pages


def prep(im):  # production, verbatim
    if im.width > OCR_TARGET_W:
        im = im.resize((OCR_TARGET_W, round(im.height * OCR_TARGET_W / im.width)), Image.LANCZOS)
    return im


def _interior_bands(profile):
    runs, start = [], None
    for i, v in enumerate(profile):
        if v >= BAND_PURITY and start is None:
            start = i
        elif v < BAND_PURITY and start is not None:
            runs.append((start, i)); start = None
    if start is not None:
        runs.append((start, len(profile)))
    return [(a, b) for a, b in runs if a > 0 and b < len(profile) and b - a >= MIN_BAND_PX]


def is_guttered(gray):
    w = np.asarray(gray) >= WHITE_LEVEL
    return bool(_interior_bands(w.mean(axis=0)) and _interior_bands(w.mean(axis=1)))


def partition(info, H):
    if info["path"] != "detected" or len(info["bands"]) < 2:
        return [(0, H)]
    b = info["bands"]
    cuts = [0] + [int((b[i][1] + b[i + 1][0]) / 2) for i in range(len(b) - 1)] + [H]
    return [(cuts[i], cuts[i + 1]) for i in range(len(b))]


def save(arm, stem, pil_base, idx=None, arm_dir=None):
    """Apply transform `arm` to an already-prepped image; write it under img/<arm_dir or arm>/."""
    bgr = cv2.cvtColor(np.asarray(pil_base), cv2.COLOR_RGB2BGR)
    out, meta = pp.apply(arm, bgr, already_base=True)
    d = f"{W}/img/{arm_dir or arm}"
    os.makedirs(d, exist_ok=True)
    f = f"{d}/{stem}{'' if idx is None else f'.L{idx}'}.jpg"
    cv2.imwrite(f, out, [cv2.IMWRITE_JPEG_QUALITY, 95])
    return f, meta


def main():
    rows = []
    for sub, path in (("referenced", f"{W}/referenced.jsonl"), ("control", "/root/tibetan-reocr/_tmp-reread-control18.jsonl"),
                      ("mark", f"{W}/mark.jsonl")):
        for i, l in enumerate(open(path)):
            r = json.loads(l)
            rows.append({"book": r["book"], "page": int(r["page"]), "substratum": sub, "repeat": sub == "referenced" and i < N_REPEAT})
    man = open(f"{W}/manifest.jsonl", "w"); meta_f = open(f"{W}/prep-meta.jsonl", "w")
    sess = requests.Session(); sess.headers["User-Agent"] = UA
    os.makedirs(f"{W}/native", exist_ok=True)
    for r in rows:
        stem = f"{r['book']}_{r['page']:05d}"
        nat = f"{W}/native/{stem}.jpg"
        if not os.path.exists(nat):
            time.sleep(0.25)
            resp = sess.get(f"https://images.sourcelibrary.org/archived/{r['book']}/{r['page']}.jpg", timeout=90)
            if resp.status_code != 200 or len(resp.content) < 5000:
                meta_f.write(json.dumps({"stem": stem, "skip": f"http:{resp.status_code}:{len(resp.content)}b"}) + "\n"); continue
            open(nat, "wb").write(resp.content)
        im = Image.open(nat); im.load(); im = im.convert("RGB")
        if is_guttered(im.convert("L")):
            meta_f.write(json.dumps({"stem": stem, "skip": "guttered"}) + "\n"); continue
        info = detect(im); H = im.height
        spans = partition(info, H)
        base_whole = prep(im)
        leaves = [prep(im.crop((0, y0, im.width, y1))) for y0, y1 in spans]
        geo = {"w": im.width, "h": H, "path": info["path"], "nb": len(info.get("bands", [])),
               "spans": [(round(a / H, 3), round(b / H, 3)) for a, b in spans]}
        ameta = {}
        common = {"stem": stem, "book": r["book"], "page": r["page"], "substratum": r["substratum"]}
        for arm in WHOLE:
            f, m = save(arm, stem, base_whole); ameta[arm] = m
            man.write(json.dumps({**common, "arm": arm, "files": [f]}) + "\n")
            if arm == "none" and r["repeat"]:
                man.write(json.dumps({**common, "arm": "none-repeat", "files": [f]}) + "\n")
        for arm, t in LEAF.items():
            fs, ms = [], []
            for i, leaf in enumerate(leaves):
                f, m = save(t, stem, leaf, idx=i, arm_dir=arm)
                fs.append(f); ms.append(m)
            ameta[arm] = ms
            man.write(json.dumps({**common, "arm": arm, "files": fs}) + "\n")
            if arm == "leafcrop" and r["repeat"]:
                man.write(json.dumps({**common, "arm": "leafcrop-repeat", "files": fs}) + "\n")
        meta_f.write(json.dumps({"stem": stem, "substratum": r["substratum"], "geo": geo, "arms": ameta}) + "\n")
        man.flush(); meta_f.flush()
    print("prep done", flush=True)


if __name__ == "__main__":
    main()
