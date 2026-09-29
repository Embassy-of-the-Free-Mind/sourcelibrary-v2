#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-preprocessing/tibetan-prep.py (round 1) — this loads that module and reuses its
# production image path verbatim (native capture, gutter gate, leafsplit.detect, partition(), prep() to 2400 px,
# save() at JPEG q95). Round 2 only adds band crops inside each production leaf and the photometric arms.
"""Make every #5250 ROUND-2 Tibetan arm image on Hetzner (CPU), before the GPU is on.

Pages: the round-1 referenced 100 (seed 5250, Derge locus fixed at draw time) + the 18 hand-verified controls.
Arms (all start from the production leafcrop — each leaf cut from the NATIVE capture, then the 2400 px cap):
  leafcrop           the control; must reproduce round 1. leafcrop-repeat (first 30 referenced) is the A/A floor.
  leaf-2band         each leaf cut into top/bottom halves with one line-height of overlap
  leaf-3band         thirds, same overlap
  leaf-lines         per-line strips of 2-3 lines — ONLY if tibetan-lineseg-check.py passed its >= 95% gate
                     (pass --lines to enable; otherwise the arm is skipped and reported as such)
  leaf+unsharp, leaf+gamma08, leaf+gamma12, leaf+flatten, leaf+gray, leaf+denoise   (preprocess.ARMS_R2 on the leaf)

Band geometry: nominal cuts divide the leaf's TEXT extent (leafsplit's detected band) into n equal parts, and each
cut is placed in an inter-line valley, not through a line. On the native leaf, a row profile of
horizontal-gradient energy (ink texture, the leafsplit.py signal) gives the line pitch p (autocorrelation peak) and
the valleys. For a cut nominally at y_c: v = the profile minimum within y_c ± p/2; v2 = the minimum within
[v + 0.6p, v + 1.4p]. Band k ends at v2, band k+1 starts at v, so the line between v and v2 is in BOTH (one
line-height of overlap) and the merge rule (tibetan-score-r2.py) drops its second copy. Each band is then prepped
(<= 2400 px wide) exactly as a leaf is, so a band delivers the leaf's pixels without the model's own downscale.

Out: /root/pp5250/r2/tibetan/img/<arm>/<stem>.L<i>[.B<j>].jpg,
     /root/pp5250/r2/tibetan/manifest.jsonl {stem, book, page, substratum, arm, files[], groups[[file idx per leaf]]}
     /root/pp5250/r2/tibetan/prep-meta.jsonl {stem, geo, bands:{arm:[per-leaf cuts]}, arms meta}
"""
import importlib.util
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

CODE = "/root/pp5250/code"
sys.path.insert(0, CODE)
spec = importlib.util.spec_from_file_location("tprep", f"{CODE}/tibetan-prep.py")
T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)
import preprocess as pp  # noqa: E402

R1 = "/root/pp5250/tibetan"
W = "/root/pp5250/r2/tibetan"
T.W = W  # save() writes under W/img/<arm>
N_REPEAT = 30
PHOTO = {f"leaf+{a}": a for a in pp.ARMS_R2}
LINES = "--lines" in sys.argv


def row_profile(gray):
    """Horizontal-gradient energy per row over the central 80% of columns, smoothed over ~1/3 of a text line."""
    a = gray.astype(np.float32)
    w = a.shape[1]
    g = np.abs(np.diff(a[:, int(w * 0.1):int(w * 0.9)], axis=1)).mean(axis=1)
    k = max(3, a.shape[0] // 120)
    return np.convolve(g, np.ones(k) / k, mode="same")


def pitch(prof):
    """Line pitch in px: the first autocorrelation peak between 3% and 45% of the leaf height."""
    x = prof - prof.mean()
    ac = np.correlate(x, x, mode="full")[len(x) - 1:]
    lo, hi = max(3, int(0.03 * len(x))), int(0.45 * len(x))
    if hi <= lo + 2:
        return None
    seg = ac[lo:hi]
    peaks = [i for i in range(1, len(seg) - 1) if seg[i] >= seg[i - 1] and seg[i] >= seg[i + 1] and seg[i] > 0]
    return lo + peaks[0] if peaks else None


def valley(prof, a, b):
    a, b = max(0, int(a)), min(len(prof), int(b))
    return a + int(np.argmin(prof[a:b])) if b > a else None


def band_cuts(gray, n, text=None):
    """[(y0, y1)] for n bands with one line of overlap at each cut; None if the geometry cannot be found.
    `text` = (t0, t1), the leaf's text extent in leaf px (leafsplit's detected band); nominal cuts divide THAT, so
    margins and colour charts inside the leaf crop do not unbalance the bands. The outer bands keep the leaf edges."""
    H = gray.shape[0]
    t0, t1 = text if text else (0, H)
    prof = row_profile(gray)
    p = pitch(prof[t0:t1]) if t1 - t0 > 20 else None
    if not p:
        return None, None
    spans, start = [], 0
    for k in range(1, n):
        yc = t0 + (t1 - t0) * k / n
        v = valley(prof, yc - p / 2, yc + p / 2)
        v2 = valley(prof, v + 0.6 * p, v + 1.4 * p) if v is not None else None
        if v is None or v2 is None or v2 <= v:
            return None, p
        spans.append((start, v2)); start = v
    spans.append((start, H))
    return spans, p


def line_strips(ys, H, per=3):
    """Group the segmenter's line boxes (prepped-leaf px) into strips of 2-3 lines, cut midway between lines."""
    ys = sorted(ys)
    groups = [ys[i:i + per] for i in range(0, len(ys), per)]
    if len(groups) > 1 and len(groups[-1]) == 1:  # never a 1-line strip: fold it into the previous one
        groups[-2] += groups.pop()
    cuts = [0] + [int((groups[i][-1][1] + groups[i + 1][0][0]) / 2) for i in range(len(groups) - 1)] + [H]
    return [(cuts[i], cuts[i + 1]) for i in range(len(groups))]


def main():
    os.makedirs(W, exist_ok=True)
    rows = []
    for sub, path in (("referenced", f"{R1}/referenced.jsonl"), ("control", "/root/tibetan-reocr/_tmp-reread-control18.jsonl")):
        for i, l in enumerate(open(path)):
            r = json.loads(l)
            rows.append({"book": r["book"], "page": int(r["page"]), "substratum": sub, "repeat": sub == "referenced" and i < N_REPEAT})
    lineseg = {}
    if LINES:
        lineseg = {j["stem"]: j for j in map(json.loads, open(f"{R1}/lineseg.jsonl"))}
    man = open(f"{W}/manifest.jsonl", "w"); meta_f = open(f"{W}/prep-meta.jsonl", "w")
    for r in rows:
        stem = f"{r['book']}_{r['page']:05d}"
        nat = f"{R1}/native/{stem}.jpg"
        if not os.path.exists(nat):
            meta_f.write(json.dumps({"stem": stem, "skip": "no-native"}) + "\n"); continue
        im = Image.open(nat); im.load(); im = im.convert("RGB")
        if T.is_guttered(im.convert("L")):
            meta_f.write(json.dumps({"stem": stem, "skip": "guttered"}) + "\n"); continue
        info = T.detect(im); H = im.height
        spans = T.partition(info, H)
        native_leaves = [im.crop((0, y0, im.width, y1)) for y0, y1 in spans]
        # text extent per leaf = leafsplit's detected band (already padded), as pp_worker crops_for("tight")
        texts = info["bands"] if info["path"] == "detected" and len(info["bands"]) == len(spans) else [None] * len(spans)
        leaves = [T.prep(x) for x in native_leaves]
        common = {"stem": stem, "book": r["book"], "page": r["page"], "substratum": r["substratum"]}
        meta = {"stem": stem, "substratum": r["substratum"],
                "geo": {"w": im.width, "h": H, "path": info["path"], "nb": len(info.get("bands", [])),
                        "leaf_px": [list(x.size) for x in leaves]}, "bands": {}, "arms": {}}

        def emit(arm, fs, groups):
            man.write(json.dumps({**common, "arm": arm, "files": fs, "groups": groups}) + "\n")

        # control + A/A
        fs = [T.save("none", stem, leaf, idx=i, arm_dir="leafcrop")[0] for i, leaf in enumerate(leaves)]
        g1 = [[i] for i in range(len(fs))]
        emit("leafcrop", fs, g1)
        if r["repeat"]:
            emit("leafcrop-repeat", fs, g1)
        # band arms
        for arm, n in (("leaf-2band", 2), ("leaf-3band", 3)):
            fs, groups, cuts_all, ok = [], [], [], True
            for i, nl in enumerate(native_leaves):
                y0l, y1l = spans[i]
                tb = texts[i]
                ext = (max(0, tb[0] - y0l), min(y1l, tb[1]) - y0l) if tb else None
                cuts, p = band_cuts(np.asarray(nl.convert("L")), n, ext)
                cuts_all.append({"pitch": p, "cuts": cuts})
                if not cuts:
                    ok = False; break
                grp = []
                for j, (y0, y1) in enumerate(cuts):
                    band = T.prep(nl.crop((0, y0, nl.width, y1)))
                    d = f"{W}/img/{arm}"; os.makedirs(d, exist_ok=True)
                    f = f"{d}/{stem}.L{i}.B{j}.jpg"
                    cv2.imwrite(f, cv2.cvtColor(np.asarray(band), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
                    grp.append(len(fs)); fs.append(f)
                groups.append(grp)
            meta["bands"][arm] = cuts_all
            # A geometry failure is a merge failure: the arm is scored as a LOSS for this page, never abstains.
            emit(arm, fs if ok else [], groups if ok else [])
        if LINES and stem in lineseg:
            fs, groups = [], []
            for i, (leaf, L) in enumerate(zip(leaves, lineseg[stem]["leaves"])):
                grp = []
                for j, (y0, y1) in enumerate(line_strips(L["ys"], leaf.height) if L["ys"] else [(0, leaf.height)]):
                    d = f"{W}/img/leaf-lines"; os.makedirs(d, exist_ok=True)
                    f = f"{d}/{stem}.L{i}.S{j}.jpg"
                    strip = leaf.crop((0, y0, leaf.width, y1))
                    cv2.imwrite(f, cv2.cvtColor(np.asarray(strip), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
                    grp.append(len(fs)); fs.append(f)
                groups.append(grp)
            emit("leaf-lines", fs, groups)
        # photometric arms on the leaf
        for arm, t in PHOTO.items():
            fs, ms = [], []
            for i, leaf in enumerate(leaves):
                f, m = T.save(t, stem, leaf, idx=i, arm_dir=arm)
                fs.append(f); ms.append(m)
            meta["arms"][arm] = ms
            emit(arm, fs, [[i] for i in range(len(fs))])
        meta_f.write(json.dumps(meta) + "\n")
        man.flush(); meta_f.flush()
    print("prep-r2 done", flush=True)


if __name__ == "__main__":
    main()
