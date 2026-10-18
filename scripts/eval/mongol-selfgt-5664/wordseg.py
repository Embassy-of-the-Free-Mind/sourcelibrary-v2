# PRIOR ART: scripts/eval/mongol-synth-5664/segment.py (page -> columns); this is column -> words.
# Word segmentation for horizontal (rotated 90° CCW) Kanjur column crops (#5664, job mongol-selfgt-5664).
# A Mongolian word is written on one continuous spine (the horizontal stroke in these crops); teeth sit on one side and
# tails on the other, often into the gap before the next word. So the break is read in a narrow band around the spine,
# whose row is tracked along the column in windows (columns are not perfectly straight).
import numpy as np
from PIL import Image, ImageDraw
def ink_map(im):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    g = a[..., 1]   # green channel: red ink is dark in it
    # flatten slow background (stains) column-wise
    k = 31
    bgcol = np.percentile(g, 80, axis=0)
    bgs = np.convolve(np.pad(bgcol, k, mode='edge'), np.ones(2*k+1)/(2*k+1), mode='valid')
    d = (bgs[None, :] - g)
    sc = np.percentile(d, 99.5)
    return (d / max(10.0, sc)).clip(0, 1)
def spine_rows(s, win=80, half=5):
    h, w = s.shape; rows = np.zeros(w, int)
    lo, hi = int(h*0.2), int(h*0.8)
    for x0 in range(0, w, win // 2):
        p = s[lo:hi, x0:x0+win].sum(1)
        p = np.convolve(p, np.ones(5)/5, mode='same')
        rows[x0:x0+win] = lo + int(p.argmax())
    return rows
def segment(im, thr=0.45, half=4, min_gap=4, min_len=5):
    s = ink_map(im); h, w = s.shape
    r = spine_rows(s)
    band = np.stack([s[max(0, r[x]-half):r[x]+half+1, x].max() if True else 0 for x in range(w)])
    on = band > thr
    segs = []; x = 0
    while x < w:
        if not on[x]: x += 1; continue
        x0 = x
        while True:
            while x < w and on[x]: x += 1
            g0 = x
            while x < w and not on[x]: x += 1
            if x >= w or x - g0 >= min_gap: x = g0; break
        segs.append((x0, x))
    out = []
    for x0, x1 in segs:
        mass = float((s[:, x0:x1] > thr).sum())
        if x1 - x0 >= min_len and mass >= 20: out.append((x0, x1, mass))
    return out, s, r
def draw(im, segs, r=None):
    im = im.convert('RGB').copy(); d = ImageDraw.Draw(im)
    if r is not None:
        for x in range(0, im.width, 3): d.point((x, int(r[x])), fill=(255, 0, 255))
    for i, (x0, x1, _) in enumerate(segs):
        d.rectangle([x0, 1, x1 - 1, im.height - 2], outline=(0, 160, 0) if i % 2 else (0, 0, 255))
    return im
