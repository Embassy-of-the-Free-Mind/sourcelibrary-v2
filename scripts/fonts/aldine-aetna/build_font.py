"""Build a facsimile TTF from labelled glyph clusters.

labels.json: {"char or glyphname": [cluster_index, ...]}  (first = preferred)
Uses the medoid of the first listed cluster that exists; traces with potrace.
"""
import json, os, re, subprocess, sys, tempfile, statistics
import numpy as np
from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.svgLib.path import SVGPath
from fontTools.pens.boundsPen import BoundsPen
from fontTools import feaLib
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else 'AldineAetna-Regular.ttf'
UPM = 1000
UPSCALE = 3

data = np.load('glyphs.npz', allow_pickle=True)
masks, meta = data['masks'], data['meta']
clusters = json.load(open('clusters.json'))
labels = json.load(open('labels.json'))
SETS = {'': (masks, meta, clusters)}
if os.path.exists('x_glyphs.npz'):
    xd = np.load('x_glyphs.npz', allow_pickle=True)
    SETS['x'] = (xd['masks'], xd['meta'], json.load(open('x_clusters.json')))
for _p in ['y', 'z', 'w', 'k', 'c', 'v']:
    if os.path.exists(f'{_p}_glyphs.npz'):
        _d = np.load(f'{_p}_glyphs.npz', allow_pickle=True)
        SETS[_p] = (_d['masks'], _d['meta'], json.load(open(f'{_p}_clusters.json')))
def resolve(ref):
    # ref: int (main set) or 'x:123'
    # 'x:123' = cluster 123 of set x ; 'x#456' = glyph index 456 of set x directly
    if isinstance(ref, str) and '#' in ref:
        p, i = ref.split('#'); return SETS[p], ('glyph', int(i))
    if isinstance(ref, str) and ':' in ref:
        p, i = ref.split(':'); return SETS[p], ('cluster', int(i))
    return SETS[''], ('cluster', int(ref))

# --- metrics from the page: baseline pitch = body size (em), x-height
pitch = []
by_page = {}
for g in meta:
    by_page.setdefault(g['page'], {}).setdefault(g['line'], g['base'])
for p, lines in by_page.items():
    bs = [lines[k] for k in sorted(lines)]
    pitch += [b - a for a, b in zip(bs, bs[1:]) if 80 < b - a < 300]
PITCH = statistics.median(pitch)
XH = statistics.median([g['base'] - g['xtop'] for g in meta])
S = UPM / PITCH          # font units per pixel; one em = one line of type
def xheight_mode(m):
    # the most common glyph height on a page is the x-height (a c e m n o r s u dominate)
    hs = np.array([g['y1'] - g['y0'] for g in m]); hs = hs[(hs >= 30) & (hs <= 100)]
    hist, edges = np.histogram(hs, bins=np.arange(30, 102, 2))
    return float(edges[int(np.argmax(hist))] + 1)
print(f'main x-height mode {xheight_mode(meta):.0f}px (line-based {XH:.0f})', file=sys.stderr)
SET_SCALE = {'': S}
for _p, (_m, _meta, _c) in SETS.items():
    if _p == '': continue
    SET_SCALE[_p] = S * float(json.load(open('set_scales.json')).get(_p, 1.0))
    print(f'set {_p}: scale x{SET_SCALE[_p]/S:.2f} (set_scales.json; mode-of-heights estimate would be {xheight_mode(meta)/xheight_mode(_meta):.2f}, unreliable on fragment-heavy sets)', file=sys.stderr)
print(f'baseline pitch {PITCH:.1f}px  x-height {XH:.1f}px  ({XH*S:.0f} units)', file=sys.stderr)

# typical inter-glyph gap on a line -> sidebearings
gaps = []
for p in by_page:
    gl = [g for g in meta if g['page'] == p]
    lines = {}
    for i, g in enumerate(gl): lines.setdefault(g['line'], []).append(g)
    for L in lines.values():
        L.sort(key=lambda g: g['x0'])
        gaps += [b['x0'] - a['x1'] for a, b in zip(L, L[1:]) if 0 < b['x0'] - a['x1'] < XH * 0.6]
GAP = statistics.median(gaps)
SB = GAP / 2 * S
print(f'median gap {GAP:.1f}px -> sidebearing {SB:.0f} units', file=sys.stderr)

def vertical_anchor(ch, mask, g, S, pad):
    """Row (in the padded crop) that is the baseline, in this glyph's own pixels."""
    main_px = S / SET_SCALE['']             # this set's px -> main-set px
    h = mask.shape[0]
    if ch in LINE_ANCHOR: return g['base'] - g['y0'] + pad
    if ch in TOP_ANCHOR: return TOP_ANCHOR[ch] / main_px + pad
    over = (0.03 * (CAP_PX if ch.isupper() or ch in ('&',) else 67.0)) / main_px if ch in ROUND_BOTTOM else 0.0
    return h + pad - over                    # stands on the baseline

NAMES = {'.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '-': 'hyphen', '(': 'parenleft', ')': 'parenright',
         'ſ': 'longs', 'æ': 'ae', 'Æ': 'AE', '?': 'question', '&': 'ampersand', '!': 'exclam', "'": 'quotesingle'}

def glyphname(ch):
    if ch in NAMES: return NAMES[ch]
    if len(ch) == 1: return ch if ch.isascii() and ch.isalpha() else 'uni%04X' % ord(ch)
    return ch  # ligature names like 'c_t', 'longs_t'

def trace(mask, pad=4):
    global UPSCALE
    h, w = mask.shape
    UPSCALE = 6 if h < 50 else 3          # tiny sorts (the figures) need more magnification for potrace
    canvas = np.zeros((h + 2 * pad, w + 2 * pad), np.uint8); canvas[pad:pad + h, pad:pad + w] = mask * 255; canvas = 255 - canvas
    im = Image.fromarray(canvas).resize((canvas.shape[1] * UPSCALE, canvas.shape[0] * UPSCALE), Image.BICUBIC)
    bw = im.point(lambda v: 255 if v > 128 else 0)
    with tempfile.TemporaryDirectory() as d:
        pbm = os.path.join(d, 'g.pbm'); svg = os.path.join(d, 'g.svg')
        bw.convert('1').save(pbm)
        subprocess.run(['potrace', '-b', 'svg', '-a', '1.2', '-O', '0.3', '-t', str(UPSCALE * 3), '-o', svg, pbm], check=True)
        txt = open(svg).read()
    m = re.search(r'translate\(([-\d.]+),([-\d.]+)\) scale\(([-\d.]+),([-\d.]+)\)', txt)
    tx, ty, sx, sy = map(float, m.groups())
    return txt, (tx, ty, sx, sy), pad

glyph_order = ['.notdef', 'space']
glyphs, advances, cmap = {}, {}, {}
pen = TTGlyphPen(None); glyphs['.notdef'] = pen.glyph(); advances['.notdef'] = int(XH * S)
pen = TTGlyphPen(None); glyphs['space'] = pen.glyph(); advances['space'] = int(GAP * S * 2.2 + XH * S * 0.4); cmap[0x20] = 'space'

STRIP_SATELLITES = {'&', '(', ')', 'D', 'T', 'C'}
CAPS_ON_BASELINE = set('ABCDEFGHIKLMNOPRSTVXYZ')
CAP_PX, ASC_PX = 104.0, 113.0                      # measured on the main set (C/H/A; l)
ROUND_BOTTOM = set('CGOQSUJcoesuagq0369') | {'Q_u', 'ae', 'æ', 'ę', '&'}
# glyphs whose TOP is the reliable anchor (they descend); value = top height in main-set px
TOP_ANCHOR = {'Q': CAP_PX, 'Q_u': CAP_PX, 'g': 67.0, 'p': 67.0, 'q': 67.0, 'y': 67.0, 'ę': 67.0,
              '3': 67.0, '4': 67.0, '5': 67.0, '7': 67.0, '9': 67.0, ';': 67.0, 'J': CAP_PX}
LINE_ANCHOR = {',', '(', ')', '-', '.', ':', '?', 'ı'}   # keep the measured line baseline
RECONSTRUCT = True
ERODE = {'K': 1, 'C': 1}            # over-inked impressions: erode N px before tracing
ALT_LETTERS = 'aceimnorstudlhpgbfq'   # letters that get 2 extra impressions rotated by calt
ACCENT_SOURCES = {'acute': 114, 'grave': 163, 'tilde': 215}      # á è ã impressions from the main set
COMPOSITES = {'á': ('a','acute'), 'é': ('e','acute'), 'í': ('i','acute'), 'ó': ('o','acute'), 'ú': ('u','acute'),
              'à': ('a','grave'), 'è': ('e','grave'), 'ì': ('i','grave'), 'ò': ('o','grave'), 'ù': ('u','grave'),
              'ã': ('a','tilde'), 'ẽ': ('e','tilde'), 'ĩ': ('i','tilde'), 'õ': ('o','tilde'), 'ũ': ('u','tilde')}
# In metal the hook of f / long s projects past the body and sits over the next sort; shorten the advance.
OVERHANG = {'f': 0.30, 'ſ': 0.28, 'f_f': 0.18, 'longs_longs': 0.16}
chosen = {}
for ch, cl in labels.items():
    if not cl: print('no cluster for', ch, file=sys.stderr); continue
    (masks_, meta_, clusters_), (kind, ci) = resolve(cl[0])
    _setkey = str(cl[0]).split(':')[0].split('#')[0] if isinstance(cl[0], str) else ''
    S = SET_SCALE[_setkey]; SB = GAP / 2 * SET_SCALE['']
    idx = clusters_[ci]['medoid'] if kind == 'cluster' else ci
    nn = clusters_[ci]['n'] if kind == 'cluster' else 1
    mask = masks_[idx].astype(np.uint8); g = meta_[idx]
    if ch in ERODE:
        from scipy import ndimage as _nd2
        mask = _nd2.binary_erosion(mask, iterations=ERODE[ch]).astype(np.uint8)
    if ch in STRIP_SATELLITES:   # keep only the largest connected component (drops specks glued on by the merge step)
        from scipy import ndimage as _nd
        lab, n = _nd.label(mask)
        if n > 1:
            sizes = _nd.sum(mask, lab, range(1, n + 1)); mask = (lab == (1 + int(np.argmax(sizes)))).astype(np.uint8)
            ys, xs = np.where(mask); mask = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]   # re-crop: anchoring uses the box
    svgtxt, (tx, ty, sx, sy), pad = trace(mask)
    # svg user coords -> pixel (of upscaled canvas): px = X*sx + tx ; py = Y*sy + ty   (sy negative)
    # pixel (canvas) -> original pixel: /UPSCALE, minus pad
    # font: x = (px/UPSCALE - pad)*S + SB ; y = (base_crop - py/UPSCALE)*S  where base_crop = base - y0 + pad
    base_crop = vertical_anchor(ch, mask, g, S, pad)
    k = S / UPSCALE
    a = sx * k; d = -sy * k
    e = tx * k - pad * S + SB
    f = -(ty * k) + base_crop * S
    pen = TTGlyphPen(None)
    cpen = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
    path = SVGPath.fromstring(svgtxt.encode(), transform=(a, 0, 0, d, e, f))
    path.draw(cpen)
    glyph = pen.glyph()
    bp = BoundsPen(None); glyph.draw(bp, None) if False else None
    name = glyphname(ch)
    glyphs[name] = glyph
    advances[name] = int(mask.shape[1] * S * (1 - OVERHANG.get(ch, 0)) + 2 * SB)
    glyph_order.append(name)
    if len(ch) == 1: cmap[ord(ch)] = name
    chosen[ch] = int(idx)
    print(f'{ch!r:12} cluster {str(cl[0]):6} n={nn:3} {mask.shape[1]}x{mask.shape[0]}px adv {advances[name]}', file=sys.stderr)

# ---- accents ----------------------------------------------------------------
from scipy import ndimage as _nd
def split_mark(mask):
    # returns (mark_mask, base_mask, gap_px, dx_px): mark = topmost component
    lab, n = _nd.label(mask)
    objs = _nd.find_objects(lab)
    comps = sorted([(sl[0].start, i + 1, sl) for i, sl in enumerate(objs) if sl is not None])
    top, tid, tsl = comps[0]
    mark = (lab == tid)[tsl]
    base = mask.copy(); base[lab == tid] = 0
    bys, bxs = np.where(base)
    base = base[bys.min():bys.max() + 1, bxs.min():bxs.max() + 1]
    gap = bys.min() - tsl[0].stop
    dx = (tsl[1].start + tsl[1].stop) / 2 - (bxs.min() + bxs.max()) / 2
    return mark, base, int(gap), dx
MARKS = {}
for mname, ref in ACCENT_SOURCES.items():
    (m_, me_, c_), (kind, ci) = resolve(ref)
    idx = c_[ci]['medoid'] if kind == 'cluster' else ci
    MARKS[mname] = split_mark(m_[idx].astype(np.uint8))
    print(f'mark {mname}: {MARKS[mname][0].shape[1]}x{MARKS[mname][0].shape[0]}px gap {MARKS[mname][2]} dx {MARKS[mname][3]:.0f}', file=sys.stderr)

BASES = {'a': 'a', 'e': 'e', 'o': 'o', 'u': 'u', 'i': 'ı'}   # ı = dotless stem (labels key)
for ch, (bch, mname) in COMPOSITES.items():
    mark, _, gap, dx = MARKS[mname]
    bref = labels[BASES[bch]][0]
    (m_, me_, c_), (kind, ci) = resolve(bref)
    bidx = c_[ci]['medoid'] if kind == 'cluster' else ci
    bmask = m_[bidx].astype(np.uint8); bg = me_[bidx]
    bh, bw = bmask.shape; mh, mw = mark.shape
    W = max(bw, mw + abs(int(dx)) * 2 + 2); H = bh + gap + mh
    canvas = np.zeros((H, W), np.uint8)
    bx0 = (W - bw) // 2; canvas[gap + mh:, bx0:bx0 + bw] = bmask
    mx0 = int(round(bx0 + bw / 2 + dx - mw / 2)); mx0 = max(0, min(W - mw, mx0))
    canvas[0:mh, mx0:mx0 + mw] = np.maximum(canvas[0:mh, mx0:mx0 + mw], mark.astype(np.uint8))
    g = dict(bg); g['y0'] = bg['y0'] - (gap + mh)
    _setkey = str(bref).split(':')[0].split('#')[0] if isinstance(bref, str) else ''
    S = SET_SCALE[_setkey]; SB = GAP / 2 * SET_SCALE['']
    svgtxt, (tx, ty, sx, sy), pad = trace(canvas)
    base_crop = vertical_anchor(bch, bmask, bg, S, pad) + (gap + mh)   # base letter stands on the baseline; accent rides above
    k = S / UPSCALE; a = sx * k; d = -sy * k; e = tx * k - pad * S + SB; f = -(ty * k) + base_crop * S
    pen = TTGlyphPen(None); cpen = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
    SVGPath.fromstring(svgtxt.encode(), transform=(a, 0, 0, d, e, f)).draw(cpen)
    name = 'uni%04X' % ord(ch)
    glyphs[name] = pen.glyph(); advances[name] = int(bw * S + 2 * SB)
    glyph_order.append(name); cmap[ord(ch)] = name
    print(f'{ch!r:12} composed {bch}+{mname}', file=sys.stderr)

# ---- alternates: two more impressions per common letter, rotated by calt so neighbours differ ----
ALTS = {}
for ch in ALT_LETTERS:
    if ch not in labels: continue
    (m_, me_, c_), (kind, ci) = resolve(labels[ch][0])
    if kind != 'cluster': continue
    members = [i for i in c_[ci]['members'] if i != c_[ci]['medoid']]
    med = m_[c_[ci]['medoid']]
    # prefer members whose bbox matches the medoid's (whole, undamaged impressions)
    members.sort(key=lambda i: abs(m_[i].shape[0] - med.shape[0]) + abs(m_[i].shape[1] - med.shape[1]))
    picks = members[:2]
    for n, idx in enumerate(picks, 1):
        mask = m_[idx].astype(np.uint8); g = me_[idx]
        key = str(labels[ch][0]).split(':')[0].split('#')[0] if isinstance(labels[ch][0], str) else ''
        name = f'{glyphname(ch)}.alt{n}'
        emit_mask = mask
        S = SET_SCALE[key]; SB = GAP / 2 * SET_SCALE['']
        svgtxt, (tx, ty, sx, sy), pad = trace(emit_mask)
        base_crop = vertical_anchor(ch, emit_mask, g, S, pad)
        k = S / UPSCALE; a = sx * k; d = -sy * k; e = tx * k - pad * S + SB; f = -(ty * k) + base_crop * S
        pen = TTGlyphPen(None); cpen = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
        SVGPath.fromstring(svgtxt.encode(), transform=(a, 0, 0, d, e, f)).draw(cpen)
        glyphs[name] = pen.glyph(); advances[name] = int(emit_mask.shape[1] * S * (1 - OVERHANG.get(ch, 0)) + 2 * SB)
        glyph_order.append(name); ALTS.setdefault(glyphname(ch), []).append(name)
print(f'alternates: {sum(len(v) for v in ALTS.values())} for {len(ALTS)} letters', file=sys.stderr)

# ---- reconstructed sorts (never existed in 1490s roman type; built from real sorts, flagged on the page) ----
def glyph_mask(ch):
    ref = labels[ch][0]
    (m_, me_, c_), (kind, ci) = resolve(ref)
    idx = c_[ci]['medoid'] if kind == 'cluster' else ci
    key = str(ref).split(':')[0].split('#')[0] if isinstance(ref, str) else ''
    return m_[idx].astype(np.uint8), me_[idx], key
def emit(ch, canvas, g, key, name=None, base_crop_override=None):
    S = SET_SCALE[key]; SB = GAP / 2 * SET_SCALE['']
    svgtxt, (tx, ty, sx, sy), pad = trace(canvas)
    base_crop = (base_crop_override if base_crop_override is not None else g['base'] - g['y0']) + pad
    k = S / UPSCALE; a = sx * k; d = -sy * k; e = tx * k - pad * S + SB; f = -(ty * k) + base_crop * S
    pen = TTGlyphPen(None); cpen = Cu2QuPen(pen, max_err=1.0, reverse_direction=True)
    SVGPath.fromstring(svgtxt.encode(), transform=(a, 0, 0, d, e, f)).draw(cpen)
    name = name or ch
    glyphs[name] = pen.glyph(); advances[name] = int(canvas.shape[1] * S + 2 * SB)
    glyph_order.append(name); cmap[ord(ch)] = name
    print(f'{ch!r:12} reconstructed -> {name}', file=sys.stderr)
if RECONSTRUCT:
    # W = VV, as the shop itself set it
    V, gV, kV = glyph_mask('V'); h, w = V.shape; ov = int(w * 0.28)
    W = np.zeros((h, 2 * w - ov), np.uint8); W[:, :w] = V; W[:, w - ov:] = np.maximum(W[:, w - ov:], V)
    emit('W', W, gV, kV, base_crop_override=h)
    # U = the lowercase u raised to cap height (Monotype's solution for Bembo)
    u, gu, ku = glyph_mask('u'); H_cap = glyph_mask('V')[0].shape[0] * SET_SCALE[kV] / SET_SCALE[ku]
    fy = H_cap / u.shape[0]; fx = 1 + (fy - 1) * 0.55
    U = np.asarray(Image.fromarray(u * 255).resize((int(u.shape[1] * fx), int(H_cap)), Image.BICUBIC)) > 127
    emit('U', U.astype(np.uint8), gu, ku, base_crop_override=U.shape[0])
    # J = the long s turned through 180 degrees and stretched: the stem becomes a J with a left-curling tail,
    #     the nub of the crossbar becomes the right-hand top serif; the I's top serif is laid over the top.
    I, gI, kI = glyph_mask('I'); ls, gls, kls = glyph_mask('ſ')
    sc = SET_SCALE[kls] / SET_SCALE[kI]
    capH = I.shape[0]; targetH = int(capH * 1.32)                      # descends ~1/3 below the line
    r = ls[::-1, ::-1].astype(np.uint8) * 255
    r = np.asarray(Image.fromarray(r).resize((max(1, int(ls.shape[1] * sc * 0.95)), targetH), Image.BICUBIC)) > 127
    J = r.astype(np.uint8)
    # lay the I's top serif (upper 16%) across the stem top
    top = I[: int(capH * 0.16), :]
    stem_cols = np.where(J[int(capH * 0.3):int(capH * 0.5), :].any(0))[0]
    cx = int(stem_cols.mean()) if len(stem_cols) else J.shape[1] // 2
    tw = top.shape[1]; x0 = cx - tw // 2
    canvas = np.zeros((J.shape[0], max(J.shape[1], x0 + tw) + max(0, -x0)), np.uint8)
    off = max(0, -x0); canvas[:, off:off + J.shape[1]] = J
    canvas[:top.shape[0], off + x0:off + x0 + tw] = np.maximum(canvas[:top.shape[0], off + x0:off + x0 + tw], top)
    emit('J', canvas, gI, kI, base_crop_override=capH)
    # lowercase v = V brought down to the x-height and re-weighted; w = vv; j = dotless i + the J tail, with the dot
    xh_px = 67.0 * SET_SCALE[''] / SET_SCALE[kV]
    fv = xh_px / V.shape[0]
    v = np.asarray(Image.fromarray(V * 255).resize((max(1, int(V.shape[1] * fv * 1.08)), int(xh_px)), Image.BICUBIC)) > 110
    from scipy import ndimage as _nd3
    v = _nd3.binary_dilation(v, iterations=1).astype(np.uint8)
    emit('v', v, gV, kV, base_crop_override=v.shape[0])
    hv, wv = v.shape; ovv = int(wv * 0.26)
    w = np.zeros((hv, 2 * wv - ovv), np.uint8); w[:, :wv] = v; w[:, wv - ovv:] = np.maximum(w[:, wv - ovv:], v)
    emit('w', w, gV, kV, base_crop_override=hv)
    # j = the long s turned through 180 degrees at lowercase scale (stem + left-curling tail), with the i's dot
    i_, gi_, ki_ = glyph_mask('i'); ih, iw = i_.shape
    xh_i = 67.0 * SET_SCALE[''] / SET_SCALE[ki_]
    r = ls[::-1, ::-1].astype(np.uint8) * 255
    sc_ls = SET_SCALE[kls] / SET_SCALE[ki_]
    jh = int(xh_i * 1.42)                                     # x-height plus a descender of ~0.42 x-height
    jw = max(1, int(ls.shape[1] * sc_ls * 0.78))
    body = np.asarray(Image.fromarray(r).resize((jw, jh), Image.BICUBIC)) > 120
    # the i's dot: its topmost component, and the gap between dot and stem
    lab, n = _nd3.label(i_); objs = _nd3.find_objects(lab)
    comps = sorted([(sl[0].start, k + 1, sl) for k, sl in enumerate(objs) if sl is not None])
    if len(comps) >= 2:
        dot = (lab == comps[0][1])[comps[0][2]]; dot_gap = comps[1][0] - comps[0][2][0].stop
    else:
        dot = np.ones((6, 6), bool); dot_gap = 8
    dh, dw = dot.shape
    jc = np.zeros((dh + dot_gap + jh, max(jw, dw) + 2), np.uint8)
    jc[dh + dot_gap:, :jw] = body
    stem_cols = np.where(body[int(jh * 0.2):int(jh * 0.5), :].any(0))[0]
    cx = int(stem_cols.mean()) if len(stem_cols) else jw // 2
    dx0 = max(0, min(jc.shape[1] - dw, cx - dw // 2)); jc[:dh, dx0:dx0 + dw] = dot
    emit('j', jc, gi_, ki_, base_crop_override=dh + dot_gap + int(xh_i))
    # k = the cap K brought down to the x-height, with the l's ascender grafted on top of its stem
    K, gK, kK = glyph_mask('K')
    if 'K' in ERODE:
        from scipy import ndimage as _nd4
        K = _nd4.binary_erosion(K, iterations=ERODE['K']).astype(np.uint8)
    l_, gl_, kl_ = glyph_mask('l'); lh, lw = l_.shape
    xh_l = 67.0 * SET_SCALE[''] / SET_SCALE[kl_]
    fk = xh_l / K.shape[0]; fkx = fk * SET_SCALE[kK] / SET_SCALE[kl_] * 1.0
    Ks = np.asarray(Image.fromarray(K * 255).resize((max(1, int(K.shape[1] * fkx)), int(xh_l)), Image.BICUBIC)) > 115
    from scipy import ndimage as _nd5
    Ks = _nd5.binary_dilation(Ks, iterations=1)
    kh, kw = Ks.shape
    # stem column of the small K and of the l
    kstem = np.where(Ks[int(kh * 0.3):int(kh * 0.7), : int(kw * 0.45)].any(0))[0]; kcx = int(kstem.mean()) if len(kstem) else int(kw * 0.2)
    lstem = np.where(l_[int(lh * 0.5):int(lh * 0.9), :].any(0))[0]; lcx = int(lstem.mean()) if len(lstem) else lw // 2
    top = l_[: lh - int(xh_l) + 6, :]                           # the l above the x-height (plus a little overlap)
    off = max(0, lcx - kcx)
    kk = np.zeros((lh, max(kw + off, lw) + 1), np.uint8)
    kk[lh - kh:, off:off + kw] = np.maximum(kk[lh - kh:, off:off + kw], Ks.astype(np.uint8))
    x0 = off + kcx - lcx
    kk[:top.shape[0], x0:x0 + lw] = np.maximum(kk[:top.shape[0], x0:x0 + lw], top)
    emit('k', kk, gl_, kl_, base_crop_override=lh)
    # 9 = the 6 turned through 180 degrees: in old-style figures they are the same sort, and compositors
    #     short of 9s turned their 6s. The Cornucopiae 9s are too small (23x35 px) for the counter to survive tracing.
    six, g6, k6 = glyph_mask('6')
    nine = six[::-1, ::-1].copy()
    # old-style 6 stands on the baseline with its loop above; turned, its loop sits on the x-height band and the
    # tail descends: anchor by TOP at x-height (same rule as the other descending figures)
    emit('9', nine, g6, k6, base_crop_override=67.0 * SET_SCALE[''] / SET_SCALE[k6])

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(glyph_order)
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({n: (advances[n], 0) for n in glyph_order})
asc = int(XH * S * 2.0); desc = -int(XH * S * 0.75)
fb.setupHorizontalHeader(ascent=asc, descent=desc)
fb.setupOS2(sTypoAscender=asc, sTypoDescender=desc, usWinAscent=asc, usWinDescent=-desc, sxHeight=int(XH * S))
fb.setupNameTable(dict(familyName='Aldine Aetna', styleName='Regular',
    uniqueFontIdentifier='SourceLibrary;AldineAetna-Regular;0.1', fullName='Aldine Aetna Regular',
    psName='AldineAetna-Regular', version='Version 0.1',
    copyright='Letterforms: Francesco Griffo for Aldus Manutius, Venice 1496 (Bembo, De Aetna). Digitised from the BNCF copy via Source Library.',
    description='Facsimile type traced from the 1496 Aldine De Aetna, Source Library.',
    licenseDescription='Public domain (CC0 1.0). Letterforms by Francesco Griffo, 1496; mechanical tracing by Source Library.', manufacturer='Source Library'))
fb.setupPost()
fb.setupDummyDSIG() if hasattr(fb, 'setupDummyDSIG') else None

# ligatures
lig_rules = []
for ch, n in [('fi', 'f_i'), ('ct', 'c_t'), ('ſt', 'longs_t'), ('ſi', 'longs_i'), ('ſſ', 'longs_longs'), ('ſſi', 'longs_longs_i'), ('ta','t_a'), ('tu','t_u'), ('Qu','Q_u')]:
    if n in glyphs and all(glyphname(c) in glyphs for c in ch):
        comps = ' '.join(glyphname(c) for c in ch)
        lig_rules.append((len(ch), f'    sub {comps} by {n};'))
fea = ''
if lig_rules:
    lig_rules.sort(key=lambda r: -r[0])
    fea += 'feature liga {\n' + '\n'.join(r for _, r in lig_rules) + '\n} liga;\n'
if ALTS:
    base = [n for n in ALTS]; a1 = [ALTS[n][0] for n in base]; a2 = [ALTS[n][1] if len(ALTS[n]) > 1 else ALTS[n][0] for n in base]
    fea += '@s0 = [' + ' '.join(base) + '];\n@s1 = [' + ' '.join(a1) + '];\n@s2 = [' + ' '.join(a2) + '];\n'
    # rotate through the three impressions along any run of these letters: 0 1 2 0 1 2 ...
    fea += 'feature calt {\n    sub @s0 @s0\' by @s1;\n    sub @s1 @s0\' by @s2;\n} calt;\n'
if fea:
    addOpenTypeFeaturesFromString(fb.font, fea)
fb.save(OUT)
json.dump(chosen, open('chosen.json', 'w'))
print('wrote', OUT, len(glyph_order), 'glyphs', file=sys.stderr)
