"""Segment Aldine page scans into glyph blobs, cluster by shape, emit contact sheet.

Output: glyphs.npz (crops + metadata), clusters.json, sheet_*.png
"""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from scipy.cluster.hierarchy import linkage, fcluster

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

def otsu(a):
    hist, _ = np.histogram(a, bins=256, range=(0, 256))
    total = a.size; sumB = 0; wB = 0; maximum = 0; sum1 = np.dot(np.arange(256), hist); level = 0
    for i in range(256):
        wB += hist[i]
        if wB == 0: continue
        wF = total - wB
        if wF == 0: break
        sumB += i * hist[i]
        mB = sumB / wB; mF = (sum1 - sumB) / wF
        between = wB * wF * (mB - mF) ** 2
        if between > maximum: level = i; maximum = between
    return level

glyphs = []   # dict(page, line, x0,y0,x1,y1, baseline, crop(bool array))
for path in sorted(glob.glob(os.environ.get('GLOB','ia*.jpg'))):
    page = os.path.basename(path)[:-4]
    im = Image.open(path).convert('L')
    a = np.asarray(im)
    H, W = a.shape
    # text block: crop away the scanner frame / dark borders (keep central region)
    # find the paper: bright rows/cols
    ink = a < otsu(a)
    # remove the black frame: rows/cols with >50% ink are frame
    rowink = ink.mean(1); colink = ink.mean(0)
    ys = np.where(rowink < 0.3)[0]; xs = np.where(colink < 0.3)[0]
    # restrict to big paper region: take rows/cols between first/last sparse-ink index within the middle 90%
    y0, y1 = int(H*0.12), int(H*0.80); x0, x1 = int(W*0.14), int(W*0.72)
    sub = a[y0:y1, x0:x1]
    thr = otsu(sub)
    ink = sub < thr
    Image.fromarray(((~ink)*255).astype(np.uint8)).resize((ink.shape[1]//4, ink.shape[0]//4)).save(f'bin_{page}.png')
    # line detection by horizontal projection, restricted to text-column region
    colsum = ink.sum(0)
    # text column: columns where ink density is meaningful
    smooth = ndimage.uniform_filter1d(colsum.astype(float), 80)
    if smooth.max() <= 0: print(page, 'blank, skipped', file=sys.stderr); continue
    cols = np.where(smooth > smooth.max() * 0.15)[0]
    cx0, cx1 = cols.min(), cols.max()
    ink_col = ink[:, cx0:cx1]
    rowsum = ink_col.sum(1)
    rs = ndimage.uniform_filter1d(rowsum.astype(float), 5)
    if rs.max() <= 0: print(page, 'no ink, skipped', file=sys.stderr); continue
    on = rs > rs.max() * 0.08
    # line spans
    lines = []
    i = 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]: j += 1
            if j - i > 40: lines.append((i, j))
            i = j
        else: i += 1
    if not lines: print(page, 'no lines, skipped', file=sys.stderr); continue
    if lines:
        import statistics as _st
        medh = _st.median([b - a for a, b in lines])
        split = []
        for a, b in lines:
            k = max(1, round((b - a) / medh))
            if k == 1: split.append((a, b)); continue
            # split at the k-1 lowest-ink rows near the expected boundaries
            cuts = [a]
            for q in range(1, k):
                c0 = a + int((b - a) * q / k); lo, hi = max(a + 20, c0 - 25), min(b - 20, c0 + 25)
                cuts.append(lo + int(np.argmin(rs[lo:hi])))
            cuts.append(b)
            split += list(zip(cuts, cuts[1:]))
        lines = [(a, b) for a, b in split if b - a >= 30]
    print(page, 'lines', len(lines), 'col', cx0, cx1, file=sys.stderr)
    lab_all, n_all = ndimage.label(ink_col)
    objs = ndimage.find_objects(lab_all)
    comps = []
    for k, sl in enumerate(objs):
        if sl is None: continue
        h = sl[0].stop - sl[0].start; w = sl[1].stop - sl[1].start
        if h < 8 or w < 4 or h > 260 or w > 260: continue
        comps.append((sl[0].start, sl[0].stop, sl[1].start, sl[1].stop, k + 1))
    for li, (ly0, ly1) in enumerate(lines):
        # x-height / baseline estimate per line: rows with max ink
        lr = rowsum[ly0:ly1].astype(float)
        if lr.size == 0 or lr.max() <= 0: continue
        dense = np.where(lr > lr.max() * 0.5)[0]
        xtop, base = ly0 + dense.min(), ly0 + dense.max()
        # components whose vertical centre lies in the line band
        mine = [c for c in comps if ly0 - 30 <= (c[0] + c[1]) / 2 <= ly1 + 30]
        mine.sort(key=lambda c: c[2])
        # merge components with strong horizontal overlap (i-dots, accents, broken letters)
        merged = []
        for c in mine:
            if merged:
                m = merged[-1]
                ov = min(m[3], c[3]) - max(m[2], c[2])
                vgap = max(m[0], c[0]) - min(m[1], c[1])
                if ov > 0.5 * min(m[3] - m[2], c[3] - c[2]) and vgap < 22:
                    merged[-1] = (min(m[0], c[0]), max(m[1], c[1]), min(m[2], c[2]), max(m[3], c[3]), m[4] + [c[4]])
                    continue
            merged.append((c[0], c[1], c[2], c[3], [c[4]]))
        for (a0, a1, b0, b1, ids) in merged:
            sub_lab = lab_all[a0:a1, b0:b1]
            mask = np.isin(sub_lab, ids)
            if mask.sum() < 60: continue
            glyphs.append(dict(page=page, line=li, y0=int(a0), y1=int(a1), x0=int(b0), x1=int(b1),
                               xtop=int(xtop), base=int(base), mask=mask, offx=x0 + cx0, offy=y0))
print('glyphs', len(glyphs), file=sys.stderr)

# features: normalised 24x24 + relative vertical position wrt baseline/x-height
S = 24
feats = []
for g in glyphs:
    m = g['mask']; h, w = m.shape
    side = max(h, w)
    canvas = np.zeros((side, side), bool)
    canvas[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w] = m
    im = Image.fromarray((canvas * 255).astype(np.uint8)).resize((S, S), Image.BILINEAR)
    f = np.asarray(im, float).ravel() / 255
    xh = max(g['base'] - g['xtop'], 1)
    asc = (g['base'] - g['y0']) / xh       # top relative to x-height
    desc = (g['y1'] - g['base']) / xh
    aspect = w / h
    feats.append(np.concatenate([f, [asc * 6, desc * 6, aspect * 6]]))
X = np.array(feats)
if os.environ.get('NOCLUSTER'):
    labels = np.arange(1, len(X) + 1)
else:
    Z = linkage(X, 'average', metric='euclidean')
    labels = fcluster(Z, t=float(sys.argv[1]) if len(sys.argv) > 1 else 5.0, criterion='distance')
print('clusters', labels.max(), file=sys.stderr)

# medoid per cluster + counts
clusters = {}
for i, l in enumerate(labels):
    clusters.setdefault(int(l), []).append(i)
order = sorted(clusters, key=lambda l: -len(clusters[l]))
meta = []
for l in order:
    idx = clusters[l]
    sub = X[idx]
    if len(idx) == 1: med = idx[0]
    else:
        d = ((sub[:, None, :] - sub[None, :, :]) ** 2).sum(-1).sum(1)
        med = idx[int(np.argmin(d))]
    meta.append(dict(cluster=l, medoid=med, members=idx, n=len(idx)))

# contact sheets: cell 64px glyph + label number
cell = 72; per_row = 16
chunks = [] if os.environ.get('NOCLUSTER') else [meta[i:i + 160] for i in range(0, len(meta), 160)]
for si, chunk in enumerate(chunks):
    rows = (len(chunk) + per_row - 1) // per_row
    sheet = Image.new('L', (per_row * cell, rows * (cell + 18)), 255)
    dr = ImageDraw.Draw(sheet)
    for ci, m in enumerate(chunk):
        g = glyphs[m['medoid']]
        mk = g['mask']; h, w = mk.shape
        sc = min(56 / h, 56 / w, 1.0)
        im = Image.fromarray(((~mk) * 255).astype(np.uint8)).resize((max(1, int(w * sc)), max(1, int(h * sc))))
        r, c = divmod(ci, per_row)
        sheet.paste(im, (c * cell + (cell - im.width) // 2, r * (cell + 18) + (cell - im.height) // 2))
        dr.text((c * cell + 2, r * (cell + 18) + cell - 2), f"{si*160+ci}:{m['n']}", fill=0)
    sheet.save(os.environ.get('PREFIX','')+f'sheet_{si}.png')
json.dump([dict(i=i, medoid=m['medoid'], members=m['members'], n=m['n']) for i, m in enumerate(meta)], open(os.environ.get('PREFIX','')+'clusters.json', 'w'))
np.savez_compressed(os.environ.get('PREFIX','')+'glyphs.npz', masks=np.array([g['mask'] for g in glyphs], dtype=object),
                    meta=np.array([{k: v for k, v in g.items() if k != 'mask'} for g in glyphs], dtype=object))
print('sheets', len(chunks), file=sys.stderr)
