# PRIOR ART: none — one-off row cutter for the Whish 147 line-strip test (projection-profile segmentation failed on these leaves; rows are laid out by eye in rows-by-eye.json).
import sys, json, numpy as np
from PIL import Image, ImageFilter
src, out, spec = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
manifest = {}
for lf, g in spec.items():
    if lf.startswith('_'): continue
    im = Image.open(f'{src}/L{lf}.jpg'); W, H = im.size
    gray = im.convert('L'); a = np.asarray(gray).astype(float)
    bg = np.asarray(gray.filter(ImageFilter.BoxBlur(6))).astype(float)
    ink = (a < bg - 18) & (a > 40)
    hole = g['hole']
    sides = {'L': (230, min(W, hole + 40)), 'R': (max(0, hole - 40), W)}
    rows = []
    for side, (x0, x1) in sides.items():
        first, last, n = g[side]
        p = np.convolve(ink[:, x0:x1].mean(axis=1), np.ones(21)/21, mode='same')
        for k in range(n):
            c = round(first + (last - first) * k / max(1, n - 1))
            lo, hi = max(0, c - 12), min(H, c + 13)
            c2 = lo + int(np.argmax(p[lo:hi]))
            rows.append({'side': side, 'k': k, 'y': c2, 'x0': x0, 'x1': x1})
    rows.sort(key=lambda r: (r['k'], r['side']))      # reading order: row by row, left of the hole then right
    files = []
    for i, r in enumerate(rows, 1):
        y0, y1 = max(0, r['y'] - 66), min(H, r['y'] + 66)
        fn = f'{lf}-p{i:02d}.jpg'
        im.crop((r['x0'], y0, r['x1'], y1)).save(f'{out}/{fn}', quality=93)
        r.update(file=fn, y0=y0, y1=y1); files.append(fn)
    manifest[lf] = rows
    print(lf, len(rows), 'strips; widths', sorted({r['x1'] - r['x0'] for r in rows}))
json.dump(manifest, open(f'{out}/strips.json', 'w'), indent=1)
