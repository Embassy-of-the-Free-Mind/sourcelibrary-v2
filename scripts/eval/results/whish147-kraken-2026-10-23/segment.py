"""Whish 147 Kraken line model (#7119): row segmentation of a palm leaf by horizontal projection.
PRIOR ART: kraken's blla baseline segmenter (kraken 7.1.1, default model) — tried first on leaf 6-t: 78 fragments for
10 rows, broken at every gap and at both string holes, and 130 s a leaf on CPU, so it is not used. No projection
segmenter exists in the repo (searched scripts/ for "projection" and "row segment"; the half-leaf and column crops of
../whish147-best-attempt-2026-10-22/ cut columns, not rows).
Method: deskew (the rotation that sharpens the row profile most), background-normalise (divide by a wide blur), ink = darker than 0.82 of local background; ink profile over
y in 24 vertical strips (string-hole strips damped by taking the median strip profile); rows = peaks of the median
profile (min distance 0.6 × the typical row pitch); each row is then followed strip by strip
(local peak within ±pitch/3, median-smoothed), and the line image is cut as a band of ±0.55 pitch around that centre
line, strips stacked so the line comes out straight.
Rows without writing texture (horizontal/vertical gradient energy < 0.6: a leaf edge) are dropped; with K given, the
weaker end row is trimmed until K remain (fewer than K: the leaf is reported short and not used for training).
Usage: python segment.py <out dir> <leaf.png>[:K] …        -> <out dir>/<leaf>-r01.png …, <leaf>.seg.json
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import uniform_filter1d, median_filter, rotate
from scipy.signal import find_peaks

NS = 24

def ink(im):
    g = np.asarray(im, dtype=np.float32)
    bg = np.asarray(im.filter(ImageFilter.BoxBlur(40)), dtype=np.float32) + 1
    a = (g / bg < 0.82).astype(np.float32)
    # the leaf, not the black backdrop: a wide blur stays bright over thin ink strokes but not off the leaf; the
    # leaf's own edges then sit 35 px inside it, so they never count as a row
    big = np.asarray(im.filter(ImageFilter.BoxBlur(30)), dtype=np.float32)
    leaf = big > 0.55 * np.median(big)
    cols = leaf.any(0)
    top = np.where(cols, leaf.argmax(0), 0); bot = np.where(cols, leaf.shape[0] - leaf[::-1].argmax(0), 0)
    yy = np.arange(a.shape[0])[:, None]
    a[(yy < top + 35) | (yy > bot - 35)] = 0
    return a

def texture(im, edges, pitch, cs):
    """Horizontal over vertical gradient energy in the row band: ~0.8–1.1 on writing, < 0.6 on a leaf edge."""
    g = np.asarray(im.filter(ImageFilter.GaussianBlur(2)), dtype=np.float32)
    sx = sy = 1e-6
    for i in range(NS):
        y0, y1 = max(0, int(cs[i] - pitch / 4)), int(cs[i] + pitch / 4)
        b = g[y0:y1 + 1, edges[i]:edges[i + 1] + 1]
        sx += np.abs(np.diff(b, axis=1)).sum(); sy += np.abs(np.diff(b, axis=0)).sum()
    return sx / sy

def rows(a, K=None, im=None):
    h, w = a.shape
    x0, x1 = int(w * 0.04), int(w * 0.96)
    edges = np.linspace(x0, x1, NS + 1).astype(int)
    prof = np.stack([a[:, edges[i]:edges[i + 1]].mean(1) for i in range(NS)])  # NS x h
    prof = uniform_filter1d(prof, 25, axis=1)
    med = np.median(prof, 0)
    # pitch from the autocorrelation of the median profile
    m = med - med.mean(); ac = np.correlate(m, m, 'full')[h - 1:]
    lo = 60; pk, _ = find_peaks(ac[lo:h // 3]); pitch = (pk[0] + lo) if len(pk) else 120
    p, pr = find_peaks(med, distance=int(pitch * 0.6), prominence=med.max() * 0.08)
    centres = []
    for y in p:
        # follow the row outward from its strongest strip, each strip within ±pitch/5 of its neighbour
        win = lambda i, c, r: (max(0, int(c - r)), min(h, int(c + r)))
        st = [prof[i, slice(*win(i, y, pitch / 3))].max() for i in range(NS)]
        s0 = int(np.argmax(st)); cs = [None] * NS
        a0, a1 = win(s0, y, pitch / 3); cs[s0] = a0 + int(np.argmax(prof[s0, a0:a1]))
        for rng in (range(s0 + 1, NS), range(s0 - 1, -1, -1)):
            for i in rng:
                prev = cs[i - 1] if rng.step == 1 else cs[i + 1]
                a0, a1 = win(i, prev, pitch / 5)
                cs[i] = a0 + int(np.argmax(prof[i, a0:a1])) if prof[i, a0:a1].max() > 0.03 else prev
        cs = median_filter(np.array(cs, dtype=float), 3, mode='nearest')
        cs = np.clip(cs, y - pitch / 3, y + pitch / 3)
        centres.append(cs)
    # leaf edges and the stacked leaves under them: drop rows with no writing texture, then (K given) trim the
    # weaker end row until K remain
    tx = [texture(im, edges, pitch, c) for c in centres]
    keep = [j for j in range(len(p)) if tx[j] >= 0.6]
    while K and len(keep) > K:
        keep.pop(0 if tx[keep[0]] < tx[keep[-1]] else -1)
    return edges, pitch, p[keep], [centres[j] for j in keep], [round(float(tx[j]), 2) for j in keep]

def cut(im, edges, pitch, cs):
    g = np.asarray(im); h = g.shape[0]; half = int(pitch * 0.55)
    parts = []
    for i in range(NS):
        c = int(cs[i]); a0, a1 = c - half, c + half
        strip = np.full((2 * half, edges[i + 1] - edges[i]), 255, np.uint8)
        s0, s1 = max(0, a0), min(h, a1)
        strip[s0 - a0:s1 - a0] = g[s0:s1, edges[i]:edges[i + 1]]
        parts.append(strip)
    return Image.fromarray(np.concatenate(parts, 1))

def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for arg in sys.argv[2:]:
        f, _, k = arg.partition(':')
        one(Path(f), out, int(k) if k else None)

def deskew(im):
    """Rotation (−3°..3°, 0.25° steps) that makes the row profile sharpest, measured on a quarter-size ink image."""
    a = ink(im.resize((im.width // 4, im.height // 4)))
    a = a[:, int(a.shape[1] * 0.04):int(a.shape[1] * 0.96)]
    best = max(np.arange(-3, 3.01, 0.25), key=lambda d: np.var(rotate(a, d, reshape=False, order=0).sum(1)))
    return float(best)

def one(f, out, K):
    im = Image.open(f).convert('L')
    ang = deskew(im)
    if ang: im = im.rotate(ang, resample=Image.BICUBIC, fillcolor=0)
    a = ink(im)
    edges, pitch, p, centres, tx = rows(a, K, im)
    meta = dict(leaf=f.stem, deskew=ang, size=list(im.size), pitch=int(pitch), rows=len(p), K=K, texture=tx, edges=edges.tolist(), centres=[c.round().astype(int).tolist() for c in centres])
    for j, cs in enumerate(centres):
        cut(im, edges, pitch, cs).save(out / f'{f.stem}-r{j + 1:02d}.png')
    (out / f'{f.stem}.seg.json').write_text(json.dumps(meta))
    print(f.stem, 'pitch', int(pitch), 'rows', len(p), 'K', K, flush=True)

if __name__ == '__main__':
    main()
