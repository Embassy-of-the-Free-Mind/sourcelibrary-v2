#!/usr/bin/env python3
"""explore.py — NOT preregistered. Page-level readouts of image gain, written after the interim unit AUROC (#6871 row A).

PRIOR ART: score.py (this folder; the preregistered unit-level test, whose functions this imports unchanged). A
pre-screen routes PAGES to Opus, so the useful question after the unit test is whether a page-level summary of gain
finds the pages whose stored read holds invented or garbled text, or that Opus called seriously wrong.

  explore.py <items.jsonl> <ll.jsonl> [--out explore.json]
Page score = share of the page's units whose gain is below the pooled 10th-percentile unit gain (the "low-gain share").
Targets (each against all other real pages that have the target's complement):
  invented_or_garbled  page has a located invented/garbled span
  serious              Opus marked the stored read serious (stored_serious)
  invented             page has a located invented span
Reports page AUROC (bootstrap CI, 2,000, seed 6871) and, at a 10% / 20% page flag rate, precision and recall, pooled and
per group. Also the same with text-only perplexity (mean −log p_txt) and image surprisal (mean −log p_img) per page.
"""
import json, sys
import numpy as np

sys.argv, _argv = sys.argv[:1] + sys.argv[1:3], sys.argv
src = open(__file__.replace('explore.py', 'score.py')).read().split('real = [k for k')[0]
exec(src)   # items, LL, unit_scores, auroc — the preregistered definitions, unchanged
opt = lambda k: _argv[_argv.index(k) + 1] if k in _argv else None

real = [k for k, it in items.items() if not it.get('plant') and k in LL]
U = {k: unit_scores(items[k], LL[k]) for k in real}
allg = np.concatenate([[u['gain'] for u in U[k]] for k in real if U[k]])
thr = float(np.quantile(allg, 0.10))
pg = {}
for k in real:
    if not U[k]: continue
    g = np.array([u['gain'] for u in U[k]]); ll = LL[k]
    kinds = {s['kind'] for s in items[k]['spans']}
    pg[k] = {'group': items[k]['group'], 'low_share': float((g < thr).mean()), 'base': float(-np.mean(ll['txt'])), 'inll': float(-np.mean(ll['img'])),
             'gain_mean': float(np.mean(np.array(ll['img']) - np.array(ll['txt']))),
             'invented_or_garbled': bool(kinds & {'invented', 'garbled'}), 'invented': 'invented' in kinds,
             'serious': bool(items[k]['stored_serious']), 'n_errors': items[k]['n_errors']}


def page_metrics(keys, target, score, sign=1, B=2000):
    y = np.array([pg[k][target] for k in keys]); v = np.array([sign * pg[k][score] for k in keys])
    if y.sum() < 5 or (~y).sum() < 5: return {'n': len(keys), 'pos': int(y.sum())}
    out = {'n': len(keys), 'pos': int(y.sum()), 'auroc': round(auroc(v[y], v[~y]), 4)}
    rng = np.random.default_rng(6871); bs = []
    for _ in range(B):
        i = rng.integers(0, len(keys), len(keys)); yy, vv = y[i], v[i]
        if yy.any() and (~yy).any(): bs.append(auroc(vv[yy], vv[~yy]))
    out['ci'] = [round(float(np.quantile(bs, .025)), 4), round(float(np.quantile(bs, .975)), 4)]
    for rate in (0.10, 0.20):
        t = np.quantile(v, 1 - rate); f = v >= t
        out[f'prec@{int(rate*100)}'] = round(float(y[f].mean()), 4); out[f'rec@{int(rate*100)}'] = round(float(y[f].sum() / y.sum()), 4)
    out['base_rate'] = round(float(y.mean()), 4)
    return out


res = {'unit_gain_p10_threshold': round(thr, 4), 'pages': len(pg), 'targets': {}}
groups = sorted({p['group'] for p in pg.values()})
for target in ('invented_or_garbled', 'serious', 'invented'):
    res['targets'][target] = {}
    for gname, keys in [('all', list(pg))] + [(g, [k for k in pg if pg[k]['group'] == g]) for g in groups]:
        res['targets'][target][gname] = {
            'low_share': page_metrics(keys, target, 'low_share'),
            'neg_gain_mean': page_metrics(keys, target, 'gain_mean', -1),
            'base': page_metrics(keys, target, 'base'),
            'inll': page_metrics(keys, target, 'inll')}
js = json.dumps(res, indent=1)
if opt('--out'): open(opt('--out'), 'w').write(js)
print(js)
