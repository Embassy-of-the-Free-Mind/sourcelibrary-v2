#!/usr/bin/env python3
# PRIOR ART: scripts/eval/latin-bakeoff-5924/prep.py (fed images capped at 2,400 px, sha256 of both); this adds the reference readers' tiles.
# prep.py: run in the job dir holding img/<slug>.jpg and pages.json; writes in/, tiles/, inputs.json.
import json, hashlib, io, os
from PIL import Image, ImageOps
d = json.load(open('pages.json')); os.makedirs('in', exist_ok=True); os.makedirs('tiles', exist_ok=True)
rows = []
def smooth(v, k):
    out = []; acc = 0; q = []
    for i in range(len(v)):
        lo, hi = max(0, i - k // 2), min(len(v), i + k // 2 + 1); out.append(sum(v[lo:hi]) / (hi - lo))
    return out
def rowprof(img):  # mean darkness per row (PIL only)
    return [255 - x for x in img.resize((1, img.size[1]), Image.BOX).getdata()]
def colprof(img):
    return [255 - x for x in img.resize((img.size[0], 1), Image.BOX).getdata()]
def cuts(gray, n_target, axis_len):
    # ink profile per row; cut at the lowest-ink row near each target
    prof = rowprof(gray)
    k = max(3, axis_len // 200); prof = smooth(prof, k)
    out = [0]
    for j in range(1, n_target):
        t = int(axis_len * j / n_target); w = axis_len // (n_target * 4)
        lo, hi = max(out[-1] + 50, t - w), min(axis_len - 50, t + w)
        out.append(lo + min(range(hi - lo), key=lambda i: prof[lo + i]) if hi > lo else t)
    out.append(axis_len); return out
for p in d['pages']:
    raw = open(f"img/{p['slug']}.jpg", 'rb').read(); im = Image.open(io.BytesIO(raw)); im = ImageOps.exif_transpose(im).convert('RGB')
    w, h = im.size; s = min(1, 2400 / max(w, h))
    fed = im if s == 1 else im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    buf = io.BytesIO(); fed.save(buf, 'JPEG', quality=92); b = buf.getvalue() if s < 1 else raw
    open(f"in/{p['slug']}.jpg", 'wb').write(b)
    ob = p['observed']; src = im
    if ob['layout'] == 'rotated': src = im.rotate(-90, expand=True)  # reader tiles only; engines get the page as scanned
    # reader tiles: columns, then horizontal strips cut at the lowest-ink rows, each upscaled/downscaled to ~1500 px wide
    W, H = src.size; g = src.convert('L')
    cols = [(0, W)]
    if ob['cols'] == 2:
        prof = smooth(colprof(g), 15); lo, hi = int(W * 0.35), int(W * 0.65); m = lo + min(range(hi - lo), key=lambda i: prof[lo + i]); cols = [(0, m + 10), (m - 10, W)]
    tiles = []
    for ci, (x0, x1) in enumerate(cols):
        sub = g.crop((x0, 0, x1, H)); cw = x1 - x0
        n = max(1, round(H / (cw * 0.55)))  # strips about half as tall as wide
        n = min(n, 8)
        cs = cuts(sub, n, H)
        for si in range(len(cs) - 1):
            y0, y1 = max(0, cs[si] - 25), min(H, cs[si + 1] + 25)
            t = src.crop((x0, y0, x1, y1)); sc = 1500 / t.size[0]; t = t.resize((1500, max(1, round(t.size[1] * sc))), Image.LANCZOS)
            fn = f"tiles/{p['slug']}-c{ci+1}-s{si+1}.jpg"; t.save(fn, quality=90); tiles.append(fn)
    ov = src.copy(); ov.thumbnail((1400, 1400)); ov.save(f"tiles/{p['slug']}-overview.jpg", quality=85)
    rows.append({'slug': p['slug'], 'url': p['image_url'], 'sha256_original': hashlib.sha256(raw).hexdigest(), 'original_size': [w, h],
                 'fed': {'sha256': hashlib.sha256(b).hexdigest(), 'size': list(fed.size), 'downscaled': s < 1}, 'tiles': tiles})
json.dump({'pages': rows}, open('inputs.json', 'w'), indent=1)
print(len(rows), 'pages', sum(r['fed']['downscaled'] for r in rows), 'downscaled; tiles', sum(len(r['tiles']) for r in rows))
