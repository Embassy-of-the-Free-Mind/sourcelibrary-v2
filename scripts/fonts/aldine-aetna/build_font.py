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
if os.path.exists('y_glyphs.npz'):
    yd = np.load('y_glyphs.npz', allow_pickle=True)
    SETS['y'] = (yd['masks'], yd['meta'], json.load(open('y_clusters.json')))
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

NAMES = {'.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '-': 'hyphen', '(': 'parenleft', ')': 'parenright',
         'ſ': 'longs', 'æ': 'ae', 'Æ': 'AE', '?': 'question', '&': 'ampersand', '!': 'exclam', "'": 'quotesingle'}

def glyphname(ch):
    if ch in NAMES: return NAMES[ch]
    if len(ch) == 1: return ch if ch.isascii() and ch.isalpha() else 'uni%04X' % ord(ch)
    return ch  # ligature names like 'c_t', 'longs_t'

def trace(mask, pad=4):
    h, w = mask.shape
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

STRIP_SATELLITES = {'&', '(', ')', 'D'}
chosen = {}
for ch, cl in labels.items():
    if not cl: print('no cluster for', ch, file=sys.stderr); continue
    (masks_, meta_, clusters_), (kind, ci) = resolve(cl[0])
    idx = clusters_[ci]['medoid'] if kind == 'cluster' else ci
    nn = clusters_[ci]['n'] if kind == 'cluster' else 1
    mask = masks_[idx].astype(np.uint8); g = meta_[idx]
    if ch in STRIP_SATELLITES:   # keep only the largest connected component (drops specks glued on by the merge step)
        from scipy import ndimage as _nd
        lab, n = _nd.label(mask)
        if n > 1:
            sizes = _nd.sum(mask, lab, range(1, n + 1)); mask = (lab == (1 + int(np.argmax(sizes)))).astype(np.uint8)
    svgtxt, (tx, ty, sx, sy), pad = trace(mask)
    # svg user coords -> pixel (of upscaled canvas): px = X*sx + tx ; py = Y*sy + ty   (sy negative)
    # pixel (canvas) -> original pixel: /UPSCALE, minus pad
    # font: x = (px/UPSCALE - pad)*S + SB ; y = (base_crop - py/UPSCALE)*S  where base_crop = base - y0 + pad
    base_crop = g['base'] - g['y0'] + pad
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
    advances[name] = int(mask.shape[1] * S + 2 * SB)
    glyph_order.append(name)
    if len(ch) == 1: cmap[ord(ch)] = name
    chosen[ch] = int(idx)
    print(f'{ch!r:12} cluster {str(cl[0]):6} n={nn:3} {mask.shape[1]}x{mask.shape[0]}px adv {advances[name]}', file=sys.stderr)

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
if all(x in glyphs for x in ['f','f_i']) or lig_rules:
    lig_rules.sort(key=lambda r: -r[0])
    fea = 'feature liga {\n' + '\n'.join(r for _, r in lig_rules) + '\n} liga;\n'
    addOpenTypeFeaturesFromString(fb.font, fea)
fb.save(OUT)
json.dump(chosen, open('chosen.json', 'w'))
print('wrote', OUT, len(glyph_order), 'glyphs', file=sys.stderr)
