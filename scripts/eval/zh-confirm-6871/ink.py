#!/usr/bin/env python3
"""ink.py — how much printed text a page image carries, for the guard's "output length vs ink" rule (#6871 row 3).

PRIOR ART: scripts/eval/zh-residue-bakeoff-6871/score.py (scores text, never looks at the image);
scripts/gpu/ocr-bakeoff-r3-5660/ (engine runners, no image features). Nothing in scripts/ measured ink per page.

  ink.py <img dir> > ink.jsonl        (needs numpy + opencv; run on gex45 with /root/pz/venv/bin/python)
Per page: grey, long side 1200, Otsu; ruling lines (runs ≥ 6% of the side, horizontal or vertical) removed by
morphological opening; the outer 4% border dropped (scan edge, fold strip shadow). `ink` = remaining dark pixels per
10,000 px; `blobs` = connected components of character-stroke size (area 6..2,500 px), a rough glyph-piece count.
"""
import json, os, sys
import cv2, numpy as np


def ink(path):
    g = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    h, w = g.shape; s = 1200 / max(h, w)
    g = cv2.resize(g, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    h, w = g.shape
    _, b = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    lines = cv2.morphologyEx(b, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(1, int(0.06 * w)), 1))) | \
        cv2.morphologyEx(b, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(1, int(0.06 * h)))))
    t = cv2.subtract(b, lines)
    my, mx = int(0.04 * h), int(0.04 * w)
    t = t[my:h - my, mx:w - mx]
    n, _, st, _ = cv2.connectedComponentsWithStats(t, connectivity=8)
    a = st[1:, cv2.CC_STAT_AREA]
    return {'ink': round(float((t > 0).mean()) * 10000, 1), 'blobs': int(((a >= 6) & (a <= 2500)).sum()),
            'lines': round(float((lines > 0).mean()) * 10000, 1)}


if __name__ == '__main__':
    d = sys.argv[1]
    for f in sorted(os.listdir(d)):
        if f.endswith('.jpg'):
            print(json.dumps({'page_id': f[:-4], **ink(os.path.join(d, f))}), flush=True)
