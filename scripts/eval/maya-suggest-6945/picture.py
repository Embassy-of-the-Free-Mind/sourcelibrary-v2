# #6945 suggester, picture channel: for each test block, a ranked list of sign VALUES by visual similarity.
#   signs  : sign-sized pieces of the block vs the sign drawings (maya_signs: Stuart syllabary v2 + Wayeb 2025; "+twkm"
#            adds the Bonn TWKM drawings, CC BY 4.0). Score of a label = max over pieces and drawings; values in label order.
#   crops  : the whole block vs reference blocks with known readings (Palenque crops from maya_glyph_blocks). For Palenque
#            the reference is the NON-test blocks (same style); for the Dresden codex it is all 649 Palenque crops
#            (the cross-style test). The nearest blocks' reading tokens, in order of first appearance.
# DINOv2 and CLIP lists are fused by reciprocal rank (fixed before looking at results).
# Run with round 2's CPU venv: $R2/venv/bin/python picture.py  -> $MS/set/picture.json
# PRIOR ART: round 2's gate0.py / gate0_multi.py (l7a scratch): segmenter, ink normalisation, embeddings and the label
# index are imported from there unchanged; this adds Palenque queries, the crop-exemplar index and ranked output.
import json, os, re, sys, collections, importlib.util
import numpy as np, cv2
from common import MS, R1, R2, jl, jd, norm_tok, split_tokens, key_tokens
sys.argv = [sys.argv[0], 'dino']
ld = lambda n, f: (lambda s: (s.loader.exec_module(m := importlib.util.module_from_spec(s)), m)[1])(importlib.util.spec_from_file_location(n, f))
g0 = ld('g0', R2 + 'bin/gate0.py'); gm = ld('gm', R2 + 'bin/gate0_multi.py')
TOP = 60

def vals_of(tr): return [norm_tok(a) for t in split_tokens(tr) for a in t.split('/') if norm_tok(a)]

def rrf(lists, k0=10):
    s = collections.defaultdict(float)
    for L in lists:
        for r, v in enumerate(L): s[v] += 1 / (k0 + r + 1)
    return [v for v, _ in sorted(s.items(), key=lambda x: -x[1])]

def label_rank(Q, E, rows, sel):
    labels = sorted({rows[i][1] for i in sel}); lid = {l: k for k, l in enumerate(labels)}
    lv = collections.defaultdict(set)
    for i in sel: lv[rows[i][1]] |= {t for v in rows[i][2] for t in vals_of(v)}  # a word drawing (ba-la-ma) offers its signs
    Sim = Q @ E[sel].T; best = np.full((len(Q), len(labels)), -9.0)
    for j, i in enumerate(sel): k = lid[rows[i][1]]; best[:, k] = np.maximum(best[:, k], Sim[:, j])
    return labels, lv, best

def block_values(idx, labels, lv, best):
    agg = np.max(best[idx], 0); out = []
    for k in np.argsort(-agg):
        for v in sorted(lv[labels[k]]):
            if v and v not in out: out.append(v)
        if len(out) >= TOP: break
    return out

def palenque_pieces():
    items = jl(MS + 'set/items.json')
    os.makedirs(MS + 'set/pieces', exist_ok=True); rec = []
    for it in items:
        for b in it['blocks']:
            img = cv2.imread(MS + 'set/img/' + b['img']); m, pieces = g0.sign_pieces(img)
            # Palenque line drawings are one connected component (cartouche + signs), so the segmenter mostly returns the
            # whole block: add a fixed grid of windows (halves, quadrants, 3x3), as round 2's dense search did.
            H, W = m.shape
            for nx, ny in ((2, 1), (1, 2), (2, 2), (3, 3)):
                for gx in range(nx):
                    for gy in range(ny):
                        pieces.append((f'g{nx}{ny}{gx}{gy}', gx * W // nx, gy * H // ny, W // nx, H // ny))
            for name, px, py, pw, ph in pieces:
                f = f"{b['img'][:-4]}_{name}"; cv2.imwrite(MS + f'set/pieces/{f}.png', g0.to_square(m[py:py + ph, px:px + pw]))
                rec.append(dict(block=b['bid'], piece=name, file=f))
    return rec

def whole(path):
    img = cv2.imread(path); return g0.to_square(g0.ink_mask(img))

def main():
    rows = gm.index()
    out = {'dresden': {}, 'palenque': {}}
    # --- queries
    PP = palenque_pieces()
    DP = [p for p in jl(R2 + 'set/pieces.json') if p['role'] != 'fewshot']
    items = jl(MS + 'set/items.json'); tbids = {b['bid'] for it in items for b in it['blocks']}
    B = jl(MS + 'p/blocks.json')
    ref_all = [b for b in B if b.get('image')]
    ref_pool = [b for b in ref_all if f"{b['monument']}:{b['coord']}" not in tbids]
    for which in ('dino', 'clip'):
        gm.which = which
        E = gm.emb_index(rows)
        Qp = g0.embed([cv2.cvtColor(cv2.imread(MS + f"set/pieces/{p['file']}.png"), cv2.COLOR_BGR2RGB) for p in PP], which)
        Qd = np.load(R2 + f'set/pieces_emb_{which}.npy'); DPall = jl(R2 + 'set/pieces.json'); keep = [i for i, p in enumerate(DPall) if p['role'] != 'fewshot']; Qd = Qd[keep]
        Er = g0.embed([whole(MS + 'set/crops/' + b['image']['file']) for b in ref_all], which)
        for idx_name, srcs in (('signs', {'stuart', 'wayeb'}), ('signs+twkm', {'stuart', 'wayeb', 'twkm'})):
            sel = [i for i, r in enumerate(rows) if r[0] in srcs]
            for corpus, P, Q, keyf in (('palenque', PP, Qp, lambda p: p['block']), ('dresden', DP, Qd, lambda p: f"{p['item']}:{p['pos']}")):
                labels, lv, best = label_rank(Q, E, rows, sel)
                byb = collections.defaultdict(list)
                for i, p in enumerate(P): byb[keyf(p)].append(i)
                for k, idx in byb.items(): out[corpus].setdefault(k, {}).setdefault(idx_name, []).append(block_values(idx, labels, lv, best))
        # crop exemplars
        for corpus, P, Q, keyf, refs in (('palenque', PP, Qp, lambda p: p['block'], ref_pool), ('dresden', DP, Qd, lambda p: f"{p['item']}:{p['pos']}", ref_all)):
            ridx = [ref_all.index(b) for b in refs]; Er_ = Er[ridx]
            wholes = {keyf(p): i for i, p in enumerate(P) if p['piece'] == 'whole'}
            for k, i in wholes.items():
                sim = Q[i] @ Er_.T; L = []
                for j in np.argsort(-sim):
                    for v in vals_of(refs[j]['transliteration']):
                        if v not in L: L.append(v)
                    if len(L) >= TOP: break
                out[corpus].setdefault(k, {}).setdefault('crops', []).append(L)
    for corpus in out:
        for k, d in out[corpus].items():
            for ch in list(d): d[ch] = rrf(d[ch])[:TOP]
    jd(out, MS + 'set/picture.json'); print({c: len(v) for c, v in out.items()})

if __name__ == '__main__':
    main()
