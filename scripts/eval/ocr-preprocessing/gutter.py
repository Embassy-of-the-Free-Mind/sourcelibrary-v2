#!/usr/bin/env python3
# PRIOR ART: scripts/lib/syriac-kraken-lane.mjs findGutter()/cutAtGutter() — the production gutter cut, in JS on
# sharp. Ported line for line (same defaults) so the #5250 Syriac "crop" arm is the lane's own crop, run where the
# arm images are made; any divergence from the JS is a bug in this file.
"""gutter.py <in_dir> <out_dir>: for each <slug>.jpg, find the gutter (lane method) and write <slug>.R.jpg and
<slug>.L.jpg, or nothing when the page has no gutter. Prints one JSON meta line per page."""
import json
import os
import sys

import cv2
import numpy as np


def find_gutter(g, lo=0.3, hi=0.7, min_band=0.015, max_ink=0.02, sample_width=600):
    h, w = g.shape
    if w > sample_width:
        g = cv2.resize(g, (sample_width, max(1, round(h * sample_width / w))), interpolation=cv2.INTER_AREA)
    h, w = g.shape
    flat = np.sort(g.ravel())[::-1]
    ground = int(flat[int(len(flat) * 0.05)])
    thr = max(0, ground - 60)
    ink = (g < thr).sum(axis=0) / h
    pad = np.pad(ink, 2, mode="edge")
    smooth = np.min(np.stack([pad[k:k + w] for k in range(5)]), axis=0)
    a, b = int(np.floor(w * lo)), int(np.ceil(w * hi))
    best, start = None, -1
    for x in range(a, b + 2):
        blank = x <= b and smooth[x] <= max_ink
        if blank and start < 0:
            start = x
        if not blank and start >= 0:
            if best is None or x - start > best[1]:
                best = (start, x - start)
            start = -1
    if best is None or best[1] < w * min_band:
        return None
    return {"x": round((best[0] + best[1] / 2) / w, 4), "band": round(best[1] / w, 4)}


def main():
    src, dst = sys.argv[1:3]
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if not f.endswith(".jpg"):
            continue
        slug = f[:-4]
        img = cv2.imread(os.path.join(src, f))
        gut = find_gutter(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        if gut:
            cut = round(img.shape[1] * gut["x"])
            cv2.imwrite(os.path.join(dst, f"{slug}.R.jpg"), img[:, cut:], [cv2.IMWRITE_JPEG_QUALITY, 92])
            cv2.imwrite(os.path.join(dst, f"{slug}.L.jpg"), img[:, :cut], [cv2.IMWRITE_JPEG_QUALITY, 92])
        print(json.dumps({"slug": slug, "meta": {"arm": "gutter", "gutter": gut}}))


if __name__ == "__main__":
    main()
