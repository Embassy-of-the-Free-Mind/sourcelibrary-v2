#!/usr/bin/env python3
"""score-6871a.py — the grounding-6871a amendment's scorer (#6871 row A): the brief's span-recall-at-precision bar, the
phrase plants, the SKQS cell, and a repeat-noise test, on top of score.py's unchanged definitions.

PRIOR ART: score.py (preregistered unit AUROC + CIs; imported unchanged, the way explore.py does) and explore.py.
Committed with PREREGISTRATION-AMENDMENT-6871a.md before any of these items was scored.

  score-6871a.py <items.jsonl> <ll.jsonl> [--rerun ll-rerun.jsonl] [--out out.json]
<items.jsonl> may hold any mix of #6420 real items, plant items and SKQS items; every cell is reported.

Per cell, flag score s (gain: −gain; base: text-only perplexity; inll: image surprisal), threshold swept over all values:
  precision(t) = flagged units that are positive / flagged units
  span_recall(t) = located bad spans with >= 1 flagged unit / located bad spans
  R@P50 = max span_recall over thresholds with precision >= 0.5 (0 if none); also unit recall at that threshold.
95% CI of R@P50 (gain) from 500 page-cluster bootstrap resamples, seed 6871.
Repeat noise, on items scored twice: per unit |gain_main − gain_rerun|; the cell's separation = median gain of negative
units − median gain of positive units; it beats repeat noise when separation > 2 × the median |Δgain| AND the rerun's
unit AUROC is inside the main pass's 95% CI.
"""
import json, sys
import numpy as np

sys.argv, _argv = sys.argv[:1] + sys.argv[1:3], sys.argv
src = open(__file__.replace('score-6871a.py', 'score.py')).read().split('real = [k for k')[0]
exec(src)   # items, LL, units, unit_scores, label, auroc, collect, metrics — the preregistered definitions, unchanged
opt = lambda k: _argv[_argv.index(k) + 1] if k in _argv else None
RR = load(opt('--rerun'))
REAL = REAL_KINDS | {'zh_sub', 'zh_ins'}
PLANT = {'plant_word', 'plant_sentence', 'plant_phrase'}


def unit_rows(ids, kinds, LLx):
    """per page: arrays of (−gain, base, inll, y, span index or −1)"""
    pages = {}
    for k in ids:
        it, ll = items[k], LLx.get(k)
        if not ll: continue
        sp = [s for s in it['spans'] if s['kind'] in kinds]
        rows = []
        for u in unit_scores(it, ll):
            y = label(it, u, kinds)
            if y is None: continue
            j = next((i for i, s in enumerate(sp) if s['s'] < u['e'] and s['e'] > u['s']), -1) if y else -1
            rows.append((-u['gain'], u['base'], u['inll'], y, j))
        if rows: pages[k] = (np.asarray(rows, float), len(sp))
    return pages


def r_at_p50(pages, col):
    keys = list(pages)
    if not keys: return None
    flat = np.concatenate([pages[k][0] for k in keys])
    sid = np.concatenate([np.where(pages[k][0][:, 4] >= 0, i * 10000 + pages[k][0][:, 4], -1) for i, k in enumerate(keys)])
    n_spans = sum(pages[k][1] for k in keys)
    located = len(set(sid[sid >= 0].tolist()))   # spans with >= 1 scorable unit
    y = flat[:, 3] == 1
    if not y.sum() or not n_spans: return {'spans': n_spans, 'spans_scorable': located, 'R@P50': None}
    o = np.argsort(-flat[:, col], kind='stable'); yo, so = y[o], sid[o]
    tp = np.cumsum(yo); prec = tp / np.arange(1, len(yo) + 1)
    first = np.zeros(len(yo), int); pos = np.flatnonzero(so >= 0)
    _, fi = np.unique(so[pos], return_index=True); first[pos[fi]] = 1   # the first (highest-scored) unit of each span
    srec = np.cumsum(first) / located
    ok = prec >= 0.5
    best = int(np.argmax(np.where(ok, srec, -1))) if ok.any() else None
    return {'spans': n_spans, 'spans_scorable': located, 'R@P50': round(float(srec[best]), 4) if best is not None else 0.0,
            'unit_recall_at_it': round(float(tp[best] / y.sum()), 4) if best is not None else 0.0,
            'flagged_at_it': int(best + 1) if best is not None else 0, 'base_rate': round(float(y.mean()), 4)}


def r_ci(pages, B=500, seed=6871):
    keys = list(pages); rnd = np.random.default_rng(seed); v = []
    for _ in range(B):
        d = [keys[i] for i in rnd.integers(0, len(keys), len(keys))]
        # a page drawn twice counts twice: re-key the copies so their spans stay distinct
        r = r_at_p50({f'{k}#{n}': pages[k] for n, k in enumerate(d)}, 0)
        if r and r['R@P50'] is not None: v.append(r['R@P50'])
    return [round(float(np.quantile(v, .025)), 4), round(float(np.quantile(v, .975)), 4)] if v else None


def cell(ids, kinds, B=2000):
    m = metrics(collect(ids, kinds), B=B)
    pages = unit_rows(ids, kinds, LL)
    for c, name in ((0, 'gain'), (1, 'base'), (2, 'inll')):
        m[f'rp50_{name}'] = r_at_p50(pages, c)
    m['rp50_gain_ci'] = r_ci(pages)
    if RR:
        sub = [k for k in ids if k in RR and k in LL]
        if sub:
            d, gp, gn = [], [], []
            for k in sub:
                u2 = {(u['s'], u['e']): u['gain'] for u in unit_scores(items[k], RR[k])}
                for u in unit_scores(items[k], LL[k]):
                    y = label(items[k], u, kinds)
                    if y is None: continue
                    (gp if y else gn).append(u['gain'])
                    if (u['s'], u['e']) in u2: d.append(abs(u['gain'] - u2[(u['s'], u['e'])]))
            mr = metrics(collect(sub, kinds, RR), B=300)
            sep = float(np.median(gn) - np.median(gp)) if gp and gn else None
            noise = float(np.median(d)) if d else None
            m['noise'] = {'pages': len(sub), 'units': len(d), 'median_abs_dgain': round(noise, 4) if noise is not None else None,
                          'separation': round(sep, 4) if sep is not None else None, 'auroc_rerun': mr.get('auroc_gain'),
                          'beats_noise': bool(sep is not None and noise is not None and sep > 2 * noise and 'ci_gain' in m and mr.get('auroc_gain') is not None
                                              and m['ci_gain'][0] <= mr['auroc_gain'] <= m['ci_gain'][1])}
    m['bar_auroc'] = bool('ci_gain' in m and m['auroc_gain'] >= 0.75 and m['ci_gain'][0] > 0.5 and m['ci_diff'][0] > 0)
    m['bar_rp50'] = bool(m['rp50_gain'] and m['rp50_gain'].get('R@P50') is not None and m['rp50_gain']['R@P50'] >= 0.6)
    return m


ids = [k for k in items if k in LL]
cells = {}
real6420 = [k for k in ids if not items[k].get('plant') and items[k]['group'] != 'skqs']
if real6420:
    cells['real6420/all'] = cell(real6420, REAL_KINDS)
    for g in sorted({items[k]['group'] for k in real6420}):
        cells[f'real6420/{g}'] = cell([k for k in real6420 if items[k]['group'] == g], REAL_KINDS)
skqs = [k for k in ids if items[k]['group'] == 'skqs' and not items[k].get('plant')]
if skqs:
    cells['skqs-real/all'] = cell(skqs, {'zh_sub', 'zh_ins'})
    for r in ('paddleocr-vl-1.6', 'gemini-3.1-flash-lite'):
        cells[f'skqs-real/{r}'] = cell([k for k in skqs if items[k].get('reader') == r], {'zh_sub', 'zh_ins'}, B=500)
for p in ('phrase', 'word', 'sentence'):
    pk = [k for k in ids if items[k].get('plant') == p]
    if not pk: continue
    cells[f'plant-{p}/all'] = cell(pk, PLANT)
    for g in sorted({items[k]['group'] for k in pk}):
        cells[f'plant-{p}/{g}'] = cell([k for k in pk if items[k]['group'] == g], PLANT, B=500)
for kd in ('zh_sub', 'zh_ins'):
    if skqs: cells[f'skqs-real/kind:{kd}'] = cell(skqs, {kd}, B=300)
res = {'scored_items': len(ids), 'cells': cells}
js = json.dumps(res, indent=1, ensure_ascii=False)
if opt('--out'): open(opt('--out'), 'w').write(js)
print(js)
