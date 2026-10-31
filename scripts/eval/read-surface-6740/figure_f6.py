#!/usr/bin/env python3
"""#6740 read-surface, figure F6: what the corners look like. For a page, a crop of its first lines beside the reading
each chosen setting gave of the same lines, words that differ from the typed edition highlighted (a missing word shown
struck through in grey). Public-domain scans only (the book's image_source licence is checked by the caller).

PRIOR ART: figures6.py (this directory: the charts); scripts/eval/lib/metrics.mjs (the scorer; this draws a word diff for
  the eye, it scores nothing). Nothing in the repo draws a reading beside its page.

    py/bin/python figure_f6.py --spec=spec.json --out=figures/f6-corners
    spec: {"pages": [{"label": ..., "image": path, "crop": [top_frac, bottom_frac], "ref": text, "words": N,
            "reads": [{"label": "4 a call, low (live)", "text": ...}, ...]}]}
"""
import argparse, json, re, difflib, unicodedata
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('--spec'); ap.add_argument('--out'); a = ap.parse_args()
S = json.load(open(a.spec))
INK, SEC, MUTED, HL = '#0b0b0b', '#52514e', '#898781', '#fde7b0'
plt.rcParams.update({'font.family': 'DejaVu Serif', 'svg.fonttype': 'none'})
fold = lambda w: unicodedata.normalize('NFD', w.replace('ſ', 's').lower().replace('æ', 'ae').replace('œ', 'oe')).encode('ascii', 'ignore').decode()
# A token that is only punctuation joins the word before it (spacing before a comma is not a reading).
def words(t):
    out = []
    for w in t.split():
        if out and not re.sub(r'[^\w]', '', fold(w)): out[-1] += w
        else: out.append(w)
    return out
key = lambda w: re.sub(r'[^\w]', '', fold(w))

def aligned(ref_words, read_words):
    """Tokens of the read aligned to the reference window: (word, kind) with kind ok | wrong | missing."""
    sm = difflib.SequenceMatcher(a=[key(w) for w in ref_words], b=[key(w) for w in read_words], autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal': out += [(w, 'ok') for w in read_words[j1:j2]]
        elif op == 'replace': out += [(w, 'wrong') for w in read_words[j1:j2]]
        elif op == 'insert': out += [(w, 'wrong') for w in read_words[j1:j2]]
        elif op == 'delete': out += [(w, 'missing') for w in ref_words[i1:i2]]
    return out

def window(ref, read, n):
    rw = words(ref)[:n]
    full = words(read)
    sm = difflib.SequenceMatcher(a=[key(w) for w in rw], b=[key(w) for w in full], autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size]
    end = (blocks[-1].b + blocks[-1].size) if blocks else n
    start = max(0, blocks[0].b - blocks[0].a) if blocks else 0
    return rw, full[start:end + 2]

P = S['pages']
fig = plt.figure(figsize=(12, 4.2 * len(P)))
for pi, pg in enumerate(P):
    im = Image.open(pg['image']); W, H = im.size
    t, b = pg['crop']; crop = im.crop((0, int(t * H), W, int(b * H)))
    ax = fig.add_axes([0.0, 1 - (pi + 1) / len(P) + 0.03 / len(P), 0.3, 0.94 / len(P)]); ax.imshow(crop); ax.axis('off')
    ax.set_title(pg['label'], loc='left', fontsize=9, color=SEC, family='DejaVu Sans')
    k = len(pg['reads'])
    for ri, rd in enumerate(pg['reads']):
        tx = fig.add_axes([0.32 + ri * (0.68 / k), 1 - (pi + 1) / len(P) + 0.03 / len(P), 0.68 / k - 0.01, 0.94 / len(P)]); tx.axis('off')
        tx.set_xlim(0, 1); tx.set_ylim(0, 1)
        rw, win = window(pg['ref'], rd['text'], pg['words'])
        toks = aligned(rw, win)
        nerr = sum(1 for _, kd in toks if kd != 'ok')
        tx.text(0, 1, parse_math=False, s=f"{rd['label']}\n{nerr} of {len(rw)} words differ", fontsize=8.5, color=INK, family='DejaVu Sans', va='top', weight='bold')
        fig.canvas.draw(); r = fig.canvas.get_renderer()
        x, y, lh = 0.0, 0.86, 0.075
        for w, kd in toks:
            t_ = tx.text(x, y, w, parse_math=False, fontsize=8.5, color=MUTED if kd == 'missing' else INK, va='top',
                         bbox=dict(boxstyle='square,pad=0.05', fc=HL, ec='none') if kd == 'wrong' else None)
            if kd == 'missing': t_.set_text(w); t_.set_fontstyle('italic')
            bb = t_.get_window_extent(renderer=r).transformed(tx.transData.inverted())
            if bb.x1 > 1.0 and x > 0:
                x = 0.0; y -= lh; t_.set_position((x, y)); bb = t_.get_window_extent(renderer=r).transformed(tx.transData.inverted())
            if kd == 'missing': tx.plot([bb.x0, bb.x1], [(bb.y0 + bb.y1) / 2] * 2, color=MUTED, lw=0.8)
            x = bb.x1 + 0.012
            if y < 0.02: break
fig.savefig(a.out + '.svg', bbox_inches='tight'); fig.savefig(a.out + '.png', dpi=200, bbox_inches='tight'); print(a.out)
