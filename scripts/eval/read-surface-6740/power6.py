#!/usr/bin/env python3
"""#6740 read-surface, Amendment 6 third form, item 4: the power gate.

From the existing runs (score.json, frozen exclusions): the book variance and the residual variance of per-page CER
and of log quota cost a page (a book's block cost), by an additive book + run fit. Then 500 simulated incomplete-block
screens a language (each book: live + 3 of the DSD settings, cyclic allocation) analysed by the model the screen will
use (book as a block, coded main effects + a live indicator; book fixed effects stand in for the random intercept,
which gives the same within-book contrasts), and the smallest high-minus-low main effect each factor's test detects
with 80 % power at two-sided alpha 0.05. Plausible effects: the same contrasts measured in the existing runs.

PRIOR ART: fit.mjs / surface6.mjs (this directory: the run-level bootstrap; no simulation); scripts/eval/lib/
  paired-stats.mjs (paired bootstrap; no power). Nothing in the repo simulates a design's power.

    py/bin/python scripts/eval/read-surface-6740/power6.py --score=WORK/score.json --design=design-dsd3.json \
        --books=de:61,la:84,en:140 [--sims=500] > power.json
"""
import argparse, json, math, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--score'); ap.add_argument('--design'); ap.add_argument('--books', default='de:61,la:84,en:140')
ap.add_argument('--sims', type=int, default=500); ap.add_argument('--drop', default='')
a = ap.parse_args()
S = json.load(open(a.score))
D = json.load(open(a.design))
RATE = {'input': 0.75e-6, 'cached': 0.075e-6, 'output': 3.75e-6}
usd = lambda t: (t['input'] - t['cache_read']) * RATE['input'] + t['cache_read'] * RATE['cached'] + t['output'] * RATE['output']
rng = np.random.default_rng(6740)
out = {'method': __doc__.strip().split('\n\n')[1], 'alpha': 0.05, 'power': 0.8, 'sims': a.sims, 'langs': {}}

def additive(rows):
    """rows: (book, run, y). Residual SD and book SD of an additive book + run fit (alternating means)."""
    books = sorted({r[0] for r in rows}); runs = sorted({r[1] for r in rows})
    bi = {b: i for i, b in enumerate(books)}; ri = {r: i for i, r in enumerate(runs)}
    y = np.array([r[2] for r in rows]); B = np.array([bi[r[0]] for r in rows]); R = np.array([ri[r[1]] for r in rows])
    bb = np.zeros(len(books)); rr = np.zeros(len(runs)); mu = y.mean()
    for _ in range(200):
        bb = np.bincount(B, y - mu - rr[R], len(books)) / np.bincount(B, minlength=len(books))
        rr = np.bincount(R, y - mu - bb[B], len(runs)) / np.bincount(R, minlength=len(runs))
    res = y - mu - bb[B] - rr[R]
    dof = len(y) - len(books) - len(runs) + 1
    return float(math.sqrt((res ** 2).sum() / dof)), float(bb.std(ddof=1)), dict(zip(runs, rr + mu))

for lang, L in S['langs'].items():
    ex = {e['slug'] for e in L['excluded']}
    runs = [r for r in L['runs'] if r.get('finished') or r['id'] in ('B02', 'B12')]
    if not runs: continue
    one = [r for r in runs if r['ppc'] == 1]
    u1 = {}
    for th in ('low', 'medium', 'high'):
        rs = [r for r in one if r['think'] == th]
        if rs: u1[th] = sum(usd(r['tokens']) for r in rs) / sum(r['pages_in_run'] for r in rs)
    cer, cost = [], []
    for r in runs:
        for t in r['targets']:
            if t['slug'] in ex: continue
            if t['status'] == 'read': cer.append((t['book_id'], r['id'], 100 * t['cer']))
            bb = r['by_book'].get(t['book_id'])
            if bb and bb['pages']:
                c = usd(bb['tokens']) + bb['unread'] * u1.get(r['think'], u1.get('low'))
                if c > 0: cost.append((t['book_id'], r['id'], math.log(c / bb['pages'])))
    se_cer, sb_cer, m_cer = additive(cer)
    se_cost, sb_cost, m_cost = additive(cost)
    by = {r['id']: r for r in runs}
    def contrast(m, key, hi, lo):
        h = [m[r] for r in m if r in by and by[r][key] == hi and not by[r]['live']]
        l = [m[r] for r in m if r in by and by[r][key] == lo and not by[r]['live']]
        return (float(np.mean(h) - np.mean(l)), len(h), len(l)) if h and l else (None, len(h), len(l))
    # Plausible effects, second estimate: linear main effects of the coded factors on the run means (least squares over
    # every non-live run), high − low = 2b. The marginal contrasts above mix thinking into pages a call (unbalanced runs).
    def regress(m):
        rs = [r for r in m if r in by and not by[r]['live'] and by[r]['x2'] is not None]
        Xm = np.array([[1, by[r]['x1'], by[r]['x2'], by[r]['x3']] for r in rs], float); ym = np.array([m[r] for r in rs])
        b, *_ = np.linalg.lstsq(Xm, ym, rcond=None)
        return {'ppc': 2 * b[1], 'edge': 2 * b[2], 'think': 2 * b[3], 'runs': len(rs)}
    reg = {'cer_pp': regress(m_cer), 'log_cost': regress(m_cost)}
    plaus = {
        'ppc': {'cer_pp': contrast(m_cer, 'ppc', 8, 1), 'log_cost': contrast(m_cost, 'ppc', 8, 1)},
        'edge': {'cer_pp': contrast(m_cer, 'edge', 2400, 1024), 'log_cost': contrast(m_cost, 'edge', 2400, 1024)},
        'think': {'cer_pp': contrast(m_cer, 'think', 'high', 'low'), 'log_cost': contrast(m_cost, 'think', 'high', 'low')},
        'prompt': {'cer_pp': (None, 0, 0), 'log_cost': (None, 0, 0), 'note': 'not run; prior prompt levers measured as noise (eval-design §10.2: v14, v16, seam lines, v20, glossary); the line adds ~40 input tokens to ~15,000 a page (log cost ~ +0.003)'},
    }
    out['langs'][lang] = {'variance_from_runs': len(runs), 'cer_pp': {'residual_sd': se_cer, 'book_sd': sb_cer}, 'log_cost': {'residual_sd': se_cost, 'book_sd': sb_cost}, 'plausible_high_minus_low': plaus, 'plausible_main_effects_ls': reg}

drop = set(filter(None, a.drop.split(',')))
keys = [f['key'] for f in D['factors'] if f['key'] not in drop]
cols = [i for i, f in enumerate(D['factors']) if f['key'] not in drop]
X = np.array([[r['x'][i] for i in cols] for r in D['runs']], float)
X = np.unique(X, axis=0)            # dropping a factor can merge two settings
K = len(X)

def allocate(nb, k=3):
    """Each book: live + k of the K settings, cyclic with a seeded shuffle of the start, near-balanced in pairs."""
    blocks = []
    steps = [s for s in range(1, K) if math.gcd(s, K) == 1] or [1]
    for b in range(nb):
        s0 = b % K; st = steps[(b // K) % len(steps)]
        blocks.append([(s0 + j * st) % K for j in range(k)])
    return blocks

def detect(nb, sd_e, sd_b, sims):
    blocks = allocate(nb)
    rows = [(b, None) for b in range(nb)] + [(b, s) for b, bl in enumerate(blocks) for s in bl]
    book = np.array([r[0] for r in rows]); live = np.array([1.0 if r[1] is None else 0.0 for r in rows])
    Xr = np.array([[0.0] * X.shape[1] if r[1] is None else X[r[1]] for r in rows])
    # within-book design: demean every column by book
    Z = np.column_stack([Xr, live])
    def wb(M):
        M = M.copy()
        for b in range(nb): idx = book == b; M[idx] -= M[idx].mean(0)
        return M
    Zw = wb(Z); ZtZi = np.linalg.pinv(Zw.T @ Zw)
    dof = len(rows) - nb - Z.shape[1]
    tcrit = 1.96 + 2.4 / max(dof, 1)        # ≈ t_{0.975, dof}
    res = {}
    for j, k in enumerate(keys):
        lo, hi = 0.0, 8 * sd_e
        for _ in range(14):
            eff = (lo + hi) / 2; beta = np.zeros(Z.shape[1]); beta[j] = eff / 2
            hits = 0
            for _s in range(sims):
                y = Z @ beta + rng.normal(0, sd_b, nb)[book] + rng.normal(0, sd_e, len(rows))
                yw = y.copy()
                for b in range(nb): idx = book == b; yw[idx] -= yw[idx].mean()
                bhat = ZtZi @ Zw.T @ yw; r = yw - Zw @ bhat
                s2 = (r @ r) / dof; se = math.sqrt(s2 * ZtZi[j, j])
                hits += abs(bhat[j] / se) > tcrit
            if hits / sims >= 0.8: hi = eff
            else: lo = eff
        res[k] = hi
    return res, {'books': nb, 'settings': K, 'reads_per_book': 4, 'rows': len(rows), 'dof': dof}

for spec in a.books.split(','):
    lang, nb = spec.split(':'); nb = int(nb)
    src = out['langs'].get(lang) or out['langs']['de']   # English has no runs yet: German's variances stand in
    mde_cer, info = detect(nb, src['cer_pp']['residual_sd'], src['cer_pp']['book_sd'], a.sims)
    mde_cost, _ = detect(nb, src['log_cost']['residual_sd'], src['log_cost']['book_sd'], a.sims)
    out['langs'].setdefault(lang, {})['screen'] = {**info, 'variances_from': lang if lang in S['langs'] else 'de (no English runs yet)',
        'mde_high_minus_low': {'cer_pp': mde_cer, 'log_cost': mde_cost}}
out['factors_tested'] = keys
json.dump(out, sys.stdout, indent=1, default=lambda o: None)
