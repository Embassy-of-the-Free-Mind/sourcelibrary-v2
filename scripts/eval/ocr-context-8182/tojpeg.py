"""#8182: JPEG copies of the composed test images for the control readers (agy and claude -p take a JPEG).
PRIOR ART: compose.py here writes PNG only (the GPU engines read PNG); this converts, nothing else.
  python -I tojpeg.py BUILD_DIR STEM [STEM ...]
    -> BUILD_DIR/STEM/{N,N2,S,W,B}.jpg (quality 90, full size), for Flash
    -> BUILD_DIR/STEM/{N,S}.o<k>.jpg, for Opus: its Read tool downscales a 3,600 px Tibetan strip until the letters are
       illegible (it declined the first test read), so Opus gets the same image in ordered slices, cut at the
       least-inked column near each nominal cut: Tibetan 3 slices left to right, Chinese 2 slices right to left.
       N and S are cut by the same rule, so the comparison between them stays fair.
"""
import os
import sys

import numpy as np
from PIL import Image


def slices(im, k, script):
    g = np.asarray(im.convert("L"), dtype=np.float32)
    ink = (g < g.mean() - 25).sum(axis=0)
    w = im.width; cuts = [0]
    for i in range(1, k):
        c = int(w * i / k); lo, hi = max(1, c - int(0.08 * w)), min(w - 1, c + int(0.08 * w))
        cuts.append(lo + int(np.argmin(ink[lo:hi])))
    cuts.append(w)
    parts = [im.crop((a, 0, b, im.height)) for a, b in zip(cuts, cuts[1:])]
    return parts if script == "tib" else parts[::-1]


build, script = sys.argv[1], None
for stem in sys.argv[2:]:
    script = "tib" if stem[0] == "T" else "zh"
    for im in ("N", "N2", "S", "W", "B"):
        src = os.path.join(build, stem, f"{im}.png")
        dst = os.path.join(build, stem, f"{im}.jpg")
        if not os.path.exists(src):
            continue
        pic = Image.open(src).convert("RGB")
        if not os.path.exists(dst):
            pic.save(dst, quality=90)
        if im in ("N", "S"):
            for i, p in enumerate(slices(pic, 3 if script == "tib" else 2, script), 1):
                p.save(os.path.join(build, stem, f"{im}.o{i}.jpg"), quality=90)
