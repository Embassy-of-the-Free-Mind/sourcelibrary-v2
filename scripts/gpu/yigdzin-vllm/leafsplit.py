#!/usr/bin/env python3
"""Leaf detector for two-leaf (or n-leaf) pecha captures (#4722 re-read).

PRIOR ART: /root/tibetan-reocr/yigdzin-run-logs/bench_split.py on clawdbot cut at h//2 blindly;
the handoff's fixed fractions (y 12-48 % / 55-90 %) were eyeballed for visual crops. This
detects text bands from horizontal-gradient energy per row (ink texture, not brightness, so
dark EAP backgrounds and pale paper both work), blurs, thresholds (Otsu on the log profile),
merges runs separated by less than a line-gap, and requires 1..4 bands of plausible height
that span the width (a colour chart or ruler does not). A second Otsu pass over the rows
OUTSIDE the first bands catches faint/dim leaves that a bright leaf pushed under the first
threshold (measured 2026-09-25: 3/38 sample captures). Falls back to halves (aspect says two
leaves) or whole, and LOGS which path.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

MAXW = 600  # analysis width
MIN_BAND = 0.05   # of capture height (a leaf with one or two lines)
MAX_BAND = 0.70
MIN_COVER = 0.75  # measured 2026-09-25 on 38 captures: text bands 0.81-1.0, colour charts 0.59-0.68
REL_HEIGHT = 0.45  # a band shorter than this x the tallest band is a ruler / chart / edge, not a leaf
MAX_BANDS = 4


def otsu(v):
    hist, edges = np.histogram(v, bins=128)
    mids = (edges[:-1] + edges[1:]) / 2
    total = hist.sum(); best, thr = -1, mids[0]
    w0 = 0; s0 = 0.0; s_all = (hist * mids).sum()
    for i in range(len(hist)):
        w0 += hist[i]
        if w0 == 0: continue
        w1 = total - w0
        if w1 == 0: break
        s0 += hist[i] * mids[i]
        m0 = s0 / w0; m1 = (s_all - s0) / w1
        var = w0 * w1 * (m0 - m1) ** 2
        if var > best: best, thr = var, mids[i]
    return thr


def _runs(on):
    runs = []; start = None
    for i, v in enumerate(on):
        if v and start is None: start = i
        elif not v and start is not None: runs.append([start, i]); start = None
    if start is not None: runs.append([start, len(on)])
    return runs


def _bands_from(lp, mask, h, g, bg_col):
    """Threshold the masked profile with Otsu, return plausible bands (a0,a1) with coverage."""
    vals = lp[mask]
    if len(vals) < 10: return []
    thr = otsu(vals)
    if not (vals.max() - vals.min() > 0.15):   # no contrast left: nothing there
        return []
    on = (lp > thr) & mask
    runs = _runs(on)
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 0.04 * h: merged[-1][1] = r[1]
        else: merged.append(r)
    out = []
    for a0, a1 in merged:
        if not (MIN_BAND * h <= (a1 - a0) <= MAX_BAND * h): continue
        col = g[a0:a1].mean(axis=0)            # per-column energy inside the band
        cover = float((col > 1.5 * bg_col).mean())
        if cover < MIN_COVER: continue
        out.append((a0, a1, round(cover, 2)))
    return out


def detect(path_or_img):
    im = path_or_img if isinstance(path_or_img, Image.Image) else Image.open(path_or_img)
    im = im.convert("L")
    W, H = im.size
    s = MAXW / W
    small = im.resize((MAXW, max(1, round(H * s))), Image.BILINEAR)
    a = np.asarray(small, dtype=np.float32)
    h, w = a.shape
    x0, x1 = int(w * 0.1), int(w * 0.9)
    g = np.abs(np.diff(a[:, x0:x1], axis=1))
    prof = g.mean(axis=1)
    k = max(3, int(h / 60)); ker = np.ones(k) / k
    pb = np.convolve(prof, ker, mode="same")
    lp = np.log1p(pb)
    # background column level: rows in the lowest 30 % of the profile
    bg_rows = lp <= np.percentile(lp, 30)
    bg_col = float(np.median(g[bg_rows].mean(axis=0))) if bg_rows.sum() > 2 else float(np.median(g))
    mask = np.ones(h, dtype=bool)
    bands = []
    passes = 0
    for _ in range(3):
        found = _bands_from(lp, mask, h, g, bg_col)
        if not found: break
        passes += 1
        for a0, a1, cov in found:
            bands.append((a0, a1, cov))
            lo, hi = max(0, int(a0 - 0.03 * h)), min(h, int(a1 + 0.03 * h))
            mask[lo:hi] = False
        if len(bands) >= MAX_BANDS: break
    bands.sort()
    if bands:
        tallest = max(a1 - a0 for a0, a1, _ in bands)
        dropped = [(a0, a1) for a0, a1, _ in bands if (a1 - a0) < REL_HEIGHT * tallest]
        bands = [b for b in bands if (b[1] - b[0]) >= REL_HEIGHT * tallest]
    else:
        dropped = []
    bands = bands[:MAX_BANDS]
    info = {"w": W, "h": H, "aspect": round(H / W, 3), "passes": passes,
            "dropped": [(round(a0 / h, 3), round(a1 / h, 3)) for a0, a1 in dropped]}
    if bands:
        out = []
        pad = 0.04 * h
        for i, (a0, a1, cov) in enumerate(bands):
            y0 = max(0, a0 - pad); y1 = min(h, a1 + pad)
            if i > 0: y0 = max(y0, (bands[i - 1][1] + a0) / 2)
            if i < len(bands) - 1: y1 = min(y1, (a1 + bands[i + 1][0]) / 2)
            out.append((int(y0 / s), int(y1 / s)))
        info.update(path="detected", bands=out,
                    band_frac=[(round(a0 / h, 3), round(a1 / h, 3), cov) for a0, a1, cov in bands])
    else:
        if H / W > 0.42:
            info.update(path="fallback-halves", bands=[(0, int(H * 0.52)), (int(H * 0.48), H)])
        else:
            info.update(path="fallback-whole", bands=[(0, H)])
    return info


def debug_image(path, info, out, width=420):
    im = Image.open(path).convert("RGB")
    W, H = im.size; s = width / W
    d = im.resize((width, round(H * s)))
    dr = ImageDraw.Draw(d)
    cols = ["red", "lime", "cyan", "yellow"]
    for i, (y0, y1) in enumerate(info["bands"]):
        dr.rectangle([2 + 4 * i, y0 * s, width - 3 - 4 * i, y1 * s - 1], outline=cols[i % 4], width=3)
    dr.text((6, 4), f"{info['path']} n={len(info['bands'])} p={info.get('passes')}", fill="red")
    d.save(out, quality=80)
    return d


if __name__ == "__main__":
    src = sys.argv[1]; dbg = sys.argv[2]
    os.makedirs(dbg, exist_ok=True)
    thumbs = []
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".jpg"): continue
        info = detect(os.path.join(src, fn)); info["id"] = fn[:-4]
        print(json.dumps(info))
        thumbs.append(debug_image(os.path.join(src, fn), info, os.path.join(dbg, fn)))
    cols = 4; tw = 420; th = max(t.height for t in thumbs)
    per = 12
    for si in range(0, len(thumbs), per):
        chunk = thumbs[si:si + per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), "white")
        for i, t in enumerate(chunk):
            sheet.paste(t, ((i % cols) * tw, (i // cols) * th))
        sheet.save(os.path.join(dbg, f"sheet{si // per}.jpg"), quality=75)
