"""Whish 147 perturbation / preprocessing test (#7119): every image version of the 9 verse leaves.

Reads pieces.json (leaf box, holes, column pieces; made by pieces.mjs) and $JOB_SCRATCH/img/<page>.jpg, writes
$JOB_SCRATCH/crops/<variant>/<leaf>-<i>.jpg and variants.json (per leaf: which channel, row bands, mask area).

Exp 5, preprocessing (same pieces as the plain colour crop):
  clahe    L of CIELAB, CLAHE (clip 2.0, 8x8 tiles over the leaf box), grey
  channel  the R, G or B channel with the best Otsu separability on the leaf, stretched p1..p99, grey
  sauvola  Sauvola binarisation (window 51 px, k 0.2) of the CLAHE grey
  holes    plain colour with the two string holes painted flat grey (cords left: see hole_mask)
  rows     plain colour, each column piece cut into physical rows (horizontal ink projection), row-major order
Exp 2, perturbations of the plain colour crop:
  shift+ / shift-   the leaf box moved by +/-3% of its width and height (cuts at the holes unchanged)
  scale85 / scale115  every piece resized by 0.85 / 1.15
  gamma    gamma 0.7 on the colour crop

PRIOR ART: ../whish147-line-strips-2026-10-22/cut-strips.py — set rows by eye because a free projection profile put
boundaries mid-line; here the projection is constrained to the leaf's known row count (rows.json, from the stability
test) and every leaf's strips are checked by eye on a contact sheet (rows-sheet/). Nothing in scripts/ does CLAHE,
Sauvola or hole masking.
Usage: JOB_SCRATCH=<dir> python variants.py [--sheets]
"""
import os, sys, json
import numpy as np, cv2
from skimage.filters import threshold_sauvola, threshold_otsu
from scipy.ndimage import gaussian_filter1d

HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ['JOB_SCRATCH']
P = json.load(open(f'{HERE}/pieces.json')); ROWS = json.load(open(f'{HERE}/rows.json'))
OV = 60; MAXW = 1600


def cut_pieces(box, h1, h2):
    cols = [[box[0], h1 + OV], [h1 - OV, h2 + OV], [h2 - OV, box[2]]]
    out = []
    for a, b in cols:
        if b - a <= MAXW: out.append([a, b])
        else:
            m = round((a + b) / 2); out += [[a, m + OV], [m - OV, b]]
    return out


def save(img, variant, leaf, i):
    d = f'{S}/crops/{variant}'; os.makedirs(d, exist_ok=True)
    cv2.imwrite(f'{d}/{leaf}-{i}.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 92])


def write_pieces(full, variant, leaf, box, pieces):
    for i, (a, b) in enumerate(pieces):
        save(full[box[1]:box[3], a:b], variant, leaf, i + 1)


def clahe_grey(im, box):
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)
    L = lab[..., 0].copy()
    x0, y0, x1, y1 = box
    region = L[y0:y1, x0:x1]
    tw, th = max(8, (x1 - x0) // 8), max(8, (y1 - y0) // 8)
    # CLAHE's tile grid is in tiles; size the grid so a tile is 1/8 of the leaf box each way
    cl = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(max(1, L.shape[1] // tw), max(1, L.shape[0] // th)))
    return cl.apply(L)


def best_channel(im, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    inner = im[y0 + h // 10:y1 - h // 10, x0 + w // 10:x1 - w // 10]
    scores = {}
    for c, name in enumerate('BGR'):
        v = inner[..., c].astype(np.float64).ravel()
        t = threshold_otsu(v)
        lo, hi = v[v <= t], v[v > t]
        wb = len(lo) / len(v)
        between = wb * (1 - wb) * (lo.mean() - hi.mean()) ** 2
        scores[name] = round(float(between / v.var()), 4)   # Otsu separability eta: 0..1
    pick = max(scores, key=scores.get)
    ch = im[..., 'BGR'.index(pick)].astype(np.float64)
    p1, p99 = np.percentile(inner[..., 'BGR'.index(pick)], [1, 99])
    out = np.clip((ch - p1) / max(1, p99 - p1) * 255, 0, 255).astype(np.uint8)
    return out, pick, scores


def sauvola(grey, box):
    x0, y0, x1, y1 = box
    out = np.full_like(grey, 255)
    reg = grey[y0:y1, x0:x1]
    t = threshold_sauvola(reg, window_size=51, k=0.2)
    out[y0:y1, x0:x1] = np.where(reg > t, 255, 0).astype(np.uint8)
    return out


def hole_mask(im, box, holes):
    """The two string holes, as a boolean mask over the image: a 70 px disc at the darkest point (blurred V) within
    +/-250 px of the leaf's middle height at each hole x. The cords are NOT masked: tracking them (by colour component,
    then by least-saturated column) wandered onto the text on most leaves, checked by eye on the contact sheet, and a
    cord lies over text in the full-width rows, so masking it would also hide text."""
    x0, y0, x1, y1 = box
    Val = cv2.blur(cv2.cvtColor(im, cv2.COLOR_BGR2HSV)[..., 2], (21, 21))
    mask = np.zeros(im.shape[:2], np.uint8)
    for h in holes:
        ym = (y0 + y1) // 2
        win = Val[ym - 250:ym + 250, h - 40:h + 40]
        dy, dx = np.unravel_index(np.argmin(win), win.shape)
        cv2.circle(mask, (int(h - 40 + dx), int(ym - 250 + dy)), 70, 1, -1)
    return mask.astype(bool)


def ink_profile(grey_bin, a, b, y0, y1):
    return gaussian_filter1d((grey_bin[y0:y1, a:b] == 0).astype(np.float64).sum(1), 10)


def row_grid(sm, n):
    """An evenly spaced grid of n row centres fitted to a projection profile: the (first centre, pitch) maximising the
    summed profile at the n centres, ignoring the top and bottom 5% (leaf edge noise in the Sauvola map). Free
    peak-picking put boundaries mid-row, as the line-strips test also found."""
    H = len(sm); lo, hi = int(0.05 * H), int(0.95 * H)
    best = None
    for pitch in np.arange(0.5 * H / n, 0.95 * H / n, 1.0):
        span = pitch * (n - 1)
        for c0 in range(lo, int(hi - span)):
            v = sm[(c0 + pitch * np.arange(n)).astype(int)].sum()
            if best is None or v > best[0]: best = (v, c0, pitch)
    return best[1], best[2]


def row_bands(sm, c0, pitch, n, y0):
    """Per column piece: each leaf-grid centre nudged to this piece's ink maximum within +/-20 px; band edges halfway
    between centres, widened by 14 px."""
    H = len(sm); top = []
    for k in range(n):
        c = int(c0 + pitch * k); lo, hi = max(0, c - 20), min(H, c + 21)
        top.append(lo + int(np.argmax(sm[lo:hi])))
    half = int(pitch / 2)
    edges = [max(0, top[0] - half)] + [(top[i] + top[i + 1]) // 2 for i in range(n - 1)] + [min(H, top[-1] + half)]
    return [(int(y0 + max(0, edges[i] - 14)), int(y0 + min(H, edges[i + 1] + 14))) for i in range(n)], [int(y0 + c) for c in top]


def main():
    info = {}
    sheets = '--sheets' in sys.argv
    for leaf, p in P.items():
        im = cv2.imread(f"{S}/img/{p['page']}.jpg")
        box, holes, pieces = p['box'], p['holes'], p['pieces']
        rec = {}
        # exp 5
        cg = clahe_grey(im, box); write_pieces(cg, 'clahe', leaf, box, pieces)
        ch, pick, sc = best_channel(im, box); write_pieces(ch, 'channel', leaf, box, pieces); rec['channel'] = dict(pick=pick, separability=sc)
        sv = sauvola(cg, box); write_pieces(sv, 'sauvola', leaf, box, pieces)
        m = hole_mask(im, box, holes)
        hm = im.copy(); hm[m] = (128, 128, 128); write_pieces(hm, 'holes', leaf, box, pieces)
        rec['holes_masked_px'] = int(m[box[1]:box[3], box[0]:box[2]].sum())
        if sheets:
            os.makedirs(f'{S}/sheets', exist_ok=True)
            small = cv2.resize(hm[box[1]:box[3], box[0]:box[2]], None, fx=0.33, fy=0.33)
            cv2.imwrite(f'{S}/sheets/holes-{leaf}.jpg', small)
        # rows: same Sauvola ink map for the projection, cut from the plain colour image
        n = ROWS[leaf]
        c0, pitch = row_grid(ink_profile(sv, holes[0] + 100, holes[1] - 100, box[1], box[3]), n)
        bands = [row_bands(ink_profile(sv, a, b, box[1], box[3]), c0, pitch, n, box[1]) for a, b in pieces]
        rec['rows'] = dict(n=n, centres=[r[1] if r else None for r in bands])
        if all(bands):
            k = 0
            for r in range(n):
                for i, (a, b) in enumerate(pieces):
                    ya, yb = bands[i][0][r]; k += 1
                    save(im[ya:yb, a:b], 'rows', leaf, k)
            rec['rows']['files'] = k
            if sheets:
                vis = im[box[1]:box[3], box[0]:box[2]].copy()
                for i, (a, b) in enumerate(pieces):
                    for c in bands[i][1]: cv2.line(vis, (a - box[0], c - box[1]), (b - box[0], c - box[1]), (0, 255, 0), 4)
                    for ya, yb in bands[i][0]: cv2.line(vis, (a - box[0] + 10, ya - box[1]), (a - box[0] + 10, yb - box[1]), (255, 0, 0), 6)
                cv2.imwrite(f'{S}/sheets/rows-{leaf}.jpg', cv2.resize(vis, None, fx=0.33, fy=0.33))
        # exp 2 perturbations of the plain colour crop
        x0, y0, x1, y1 = box; W, H = x1 - x0, y1 - y0
        for name, s in (('shift+', 1), ('shift-', -1)):
            dx, dy = round(0.03 * W) * s, round(0.03 * H) * s
            nb = [max(0, x0 + dx), max(0, y0 + dy), min(im.shape[1], x1 + dx), min(im.shape[0], y1 + dy)]
            write_pieces(im, name, leaf, nb, cut_pieces(nb, *holes))
            rec[name] = nb
        for name, f in (('scale85', 0.85), ('scale115', 1.15)):
            for i, (a, b) in enumerate(pieces):
                c = im[y0:y1, a:b]
                save(cv2.resize(c, None, fx=f, fy=f, interpolation=cv2.INTER_AREA if f < 1 else cv2.INTER_CUBIC), name, leaf, i + 1)
        lut = np.array([255 * (v / 255) ** 0.7 for v in range(256)], np.uint8)
        write_pieces(cv2.LUT(im, lut), 'gamma', leaf, box, pieces)
        info[leaf] = rec
        print(leaf, pick, sc, 'mask px', rec['holes_masked_px'], 'rows', 'ok' if all(bands) else [bool(b) for b in bands])
    json.dump(info, open(f'{HERE}/variants.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
