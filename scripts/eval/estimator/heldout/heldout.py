#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/fit_prior.py fits ONE weight W (and a calibration slope) for the v1/v2
# prior means over the ~15 routes those models cover, with a leave-one-cell-out check of that calibration; it never asks
# whether acceptance in one cell predicts another's, and it cannot score the 230 flat-prior routes. build.py's eff
# (accepted, judged, wrong-text pages after its book scaling) is reused as the outcome unchanged; its x['prior'] (a, b)
# is model (b) here. loo_v1.py / loo_v2.py score v1 / v2 against their own references (CER, 1-5), not acceptance.
"""Held-out test of a hierarchical acceptance model across router cells (#7263, step 1 of the 2026-11-01 R&D plan).
Stdlib only, no model calls, no DB.

  python3 scripts/eval/estimator/heldout/heldout.py [<build.py table .json>] [--out <file.json>]   (repo root)
  HELDOUT_PROCS=8 (folds in parallel; about 25 minutes at 8)

Data: every TESTED route of the table, outcome = build.py's book-scaled eff k of n (accepted, judged), so a book counts
once whatever its pages. Each route is described by its factors (factors.py): engine (the stage that writes the text),
draft (what a corrector corrected), language, writing system, script type (print / manuscript / unknown).

Models, each scored on routes it did not see:
  (a) flat: Beta(1, 1), what an untested route gets today;
  (a') grand: one Beta(m W, (1 - m) W) for every route, m and W by maximum marginal likelihood on the training folds;
  (b) table: the table's own prior x['prior'] (v1/v2 mean worth rules.json pages, else flat). Not refitted per fold (its W
      was fitted on these routes in #7263 backfill-all, so it is, if anything, flattered);
  (c) hier: logit p = mu + engine + draft + language + writing system + script type + engine x writing system
      + engine x script type, every group a Gaussian random effect N(0, s_g^2) (engine s fixed at 2.5, nearly a fixed
      effect), the route's p beta-binomial around it with concentration W. s_g and W by Laplace-approximate marginal
      likelihood (coordinate ascent on a log grid), refitted in every fold. A level no training route has keeps its
      prior: the held-out cell's unseen language or interaction adds s_g^2 to the predictive variance.
  (c-eng) engine + draft only; (c-add) (c) without the two interactions: ablations.

Folds: leave one ROW out (cell x script type, the 109-cell grain), leave one BASE cell out (its print / manuscript /
unknown splits share books, so they leave together; german-blank* are one base), leave one LANGUAGE out.

Scores: held-out log predictive density of the book-scaled k of n (binomial coefficient included), summed and per book;
calibration (predicted mean vs observed acceptance in bins, book-weighted, and ECE); and the prior's worth in pages: the
W that maximises the held-out beta-binomial likelihood around (c)'s predicted mean (profile 90%), against the same for
(b)'s v1/v2 means and the grand mean.
"""
import json, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from factors import factors

lg = math.lgamma
lbeta = lambda a, b: lg(a) + lg(b) - lg(a + b)
expit = lambda x: 1 / (1 + math.exp(-x)) if x > -700 else 0.0
logC = lambda k, n: lg(n + 1) - lg(k + 1) - lg(n - k + 1)
SGRID = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]
WGRID = [2, 3, 5, 8, 13, 20, 35, 60, 100, 300, 1000]
W_FINE = [math.exp(x / 20) for x in range(-20, 141)]  # 0.37 .. 1100 pages
GROUPS_FULL = ('eng', 'draft', 'lang', 'wsys', 'stype', 'eng:wsys', 'eng:stype')
SIG_FIXED = {'mu': 2.0, 'eng': 2.5}
# Gauss-Hermite-like grid: z in [-6, 6], normal weights
ZS = [i / 10 for i in range(-60, 61)]
ZW = [math.exp(-z * z / 2) for z in ZS]; _s = sum(ZW); ZW = [w / _s for w in ZW]


def bb(k, n, m, W):
    m = min(max(m, 1e-6), 1 - 1e-6); a, b = m * W, (1 - m) * W
    return lbeta(k + a, n - k + b) - lbeta(a, b)


# ---------- the hierarchical model ----------
class Design:
    def __init__(self, rows, groups):
        self.groups = groups
        self.levels = {'mu': ['mu']}
        for g in groups:
            self.levels[g] = sorted({r['f'][g] for r in rows if r['f'][g] is not None})
        self.index, self.group_of = {}, []
        for g in ('mu',) + tuple(groups):
            for lv in self.levels[g]:
                self.index[(g, lv)] = len(self.group_of); self.group_of.append(g)
        self.p = len(self.group_of)

    def x(self, r):
        return [self.index[('mu', 'mu')]] + [self.index[(g, r['f'][g])] for g in self.groups if r['f'][g] is not None and (g, r['f'][g]) in self.index]


def chol(A):
    n = len(A); L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = A[i][j] - sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                if s <= 0: return None
                L[i][i] = math.sqrt(s)
            else:
                L[i][j] = s / L[j][j]
    return L


def solve_chol(L, b):
    n = len(L); y = [0.0] * n
    for i in range(n): y[i] = (b[i] - sum(L[i][k] * y[k] for k in range(i))) / L[i][i]
    x = [0.0] * n
    for i in reversed(range(n)): x[i] = (y[i] - sum(L[k][i] * x[k] for k in range(i + 1, n))) / L[i][i]
    return x


def fwd(L, b):
    n = len(L); y = [0.0] * n
    for i in range(n): y[i] = (b[i] - sum(L[i][k] * y[k] for k in range(i))) / L[i][i]
    return y


def fit(D, rows, sig, W, theta0=None, iters=60):
    """MAP of theta (Newton, line search) and the Laplace log marginal likelihood. sig: group -> s."""
    prec = [1 / sig[g] ** 2 for g in D.group_of]
    X = [D.x(r) for r in rows]
    th = list(theta0) if theta0 else [0.0] * D.p

    def obj(th):
        s = -0.5 * sum(t * t * q for t, q in zip(th, prec))
        for xi, r in zip(X, rows): s += bb(r['k'], r['n'], expit(sum(th[j] for j in xi)), W)
        return s

    def derivs(th):
        g = [-t * q for t, q in zip(th, prec)]; H = [[0.0] * D.p for _ in range(D.p)]
        for j in range(D.p): H[j][j] = prec[j]
        h = 1e-3
        for xi, r in zip(X, rows):
            e = sum(th[j] for j in xi)
            f0, fp, fm = bb(r['k'], r['n'], expit(e), W), bb(r['k'], r['n'], expit(e + h), W), bb(r['k'], r['n'], expit(e - h), W)
            d1, d2 = (fp - fm) / (2 * h), (fp - 2 * f0 + fm) / h / h
            d2 = min(d2, -1e-8)
            for a in xi:
                g[a] += d1
                for b in xi: H[a][b] -= d2
        return g, H  # H = negative Hessian (positive definite)

    cur = obj(th)
    for _ in range(iters):
        g, H = derivs(th); L = chol(H)
        step = solve_chol(L, g); t = 1.0
        while t > 1e-4:
            nt = [a + t * b for a, b in zip(th, step)]; v = obj(nt)
            if v >= cur - 1e-12: break
            t /= 2
        th, done = nt, abs(v - cur) < 1e-8; cur = v
        if done: break
    g, H = derivs(th); L = chol(H)
    logdet = 2 * sum(math.log(L[i][i]) for i in range(D.p))
    lml = cur - 0.5 * sum(math.log(2 * math.pi * sig[gg] ** 2) for gg in D.group_of) - 0.5 * logdet + 0.5 * D.p * math.log(2 * math.pi)
    lml += sum(logC(r['k'], r['n']) for r in rows)
    return dict(theta=th, L=L, lml=lml, sig=dict(sig), W=W)


def fit_hyper(D, rows, start=None):
    """Coordinate ascent over the free group scales and W on log grids, Laplace marginal likelihood."""
    free = [g for g in D.groups if g not in SIG_FIXED]
    sig = dict(SIG_FIXED); sig.update(start['sig'] if start else {g: 0.5 for g in free})
    W = start['W'] if start else 20
    best = fit(D, rows, sig, W); cache = {}
    for _ in range(3):
        moved = False
        for name in free + ['W']:
            grid = WGRID if name == 'W' else SGRID
            for v in grid:
                s2, W2 = dict(sig), W
                if name == 'W': W2 = v
                else: s2[name] = v
                key = (tuple(sorted(s2.items())), W2)
                if key not in cache: cache[key] = fit(D, rows, s2, W2, best['theta'])
                if cache[key]['lml'] > best['lml'] + 1e-6: best, sig, W, moved = cache[key], s2, W2, True
        if not moved: break
    return best


def predict(D, F, r):
    """Predictive for a route: eta ~ N(x theta, x Sigma x'), p | eta beta-binomial at concentration W."""
    xi = D.x(r); xv = [0.0] * D.p
    for j in xi: xv[j] += 1
    mu = sum(F['theta'][j] for j in xi); v = sum(y * y for y in fwd(F['L'], xv))
    sd = math.sqrt(v)
    ps = [expit(mu + sd * z) for z in ZS]
    mean = sum(w * p for w, p in zip(ZW, ps))
    ep2 = sum(w * p * p for w, p in zip(ZW, ps))
    var_p = ep2 - mean * mean + sum(w * p * (1 - p) for w, p in zip(ZW, ps)) / (F['W'] + 1)  # + beta spread at W
    terms = [math.log(w) + bb(r['k'], r['n'], p, F['W']) for w, p in zip(ZW, ps) if w > 1e-300]
    mx = max(terms); lpd = mx + math.log(sum(math.exp(t - mx) for t in terms)) + logC(r['k'], r['n'])
    W_eff = mean * (1 - mean) / max(var_p, 1e-12) - 1
    return dict(mean=mean, lpd=lpd, eta=mu, eta_sd=sd, W_eff=W_eff)


# ---------- baselines ----------
def grand_fit(rows):
    best = None
    for i in range(1, 100):
        m = i / 100
        for W in W_FINE[::4]:
            v = sum(bb(r['k'], r['n'], m, W) for r in rows)
            if best is None or v > best[0]: best = (v, m, W)
    return best[1], best[2]


def lpd_beta(r, a, b):
    return logC(r['k'], r['n']) + lbeta(r['k'] + a, r['n'] - r['k'] + b) - lbeta(a, b)


# ---------- scoring ----------
def worth(pairs):
    """pairs: (predicted mean, k, n). The W maximising the beta-binomial likelihood around the predicted means, profile 90%."""
    lls = [sum(bb(k, n, m, W) for m, k, n in pairs) for W in W_FINE]
    i = max(range(len(lls)), key=lls.__getitem__)
    ok = [W for W, v in zip(W_FINE, lls) if v >= lls[i] - 1.353]
    at = {str(w): round(sum(bb(k, n, m, w) for m, k, n in pairs) - lls[i], 2) for w in (2, 5, 7, 10, 20, 50)}
    return dict(W=round(W_FINE[i], 2), ci90=[round(ok[0], 2), round(ok[-1], 2)], at_edge=i in (0, len(W_FINE) - 1), dll_at=at)


def calib(pairs, edges=(0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0001)):
    """pairs: (predicted mean, k, n); book-weighted bins (n is book-scaled)."""
    out, tot, ece = [], sum(n for _, _, n in pairs), 0.0
    for lo, hi in zip(edges, edges[1:]):
        b = [(m, k, n) for m, k, n in pairs if lo <= m < hi]
        if not b: continue
        N = sum(n for _, _, n in b); pm = sum(m * n for m, _, n in b) / N; ob = sum(k for _, k, _ in b) / N
        out.append(dict(bin=f'{lo:.2f}-{min(hi, 1):.2f}', routes=len(b), books=round(N, 1), predicted=round(pm, 3), observed=round(ob, 3)))
        ece += N / tot * abs(pm - ob)
    return dict(bins=out, ece=round(ece, 4))


_CV = {}  # rows, fold key, warm starts: set before the pool forks


def one_fold(fk):
    rows, foldkey, start = _CV['rows'], _CV['key'], _CV['start']
    tr = [r for r in rows if foldkey(r) != fk]; te = [r for r in rows if foldkey(r) == fk]
    preds, hyper = {r['uid']: {} for r in te}, None
    m, W = grand_fit(tr)
    for r in te:
        preds[r['uid']]['flat'] = dict(lpd=lpd_beta(r, 1, 1), mean=0.5)
        preds[r['uid']]['grand'] = dict(lpd=lpd_beta(r, m * W, (1 - m) * W), mean=m)
        a, b = r['prior']
        preds[r['uid']]['table'] = dict(lpd=lpd_beta(r, a, b), mean=a / (a + b))
    for name, groups in MODELS.items():
        D = Design(rows, groups)
        F = fit_hyper(D, tr, start.get(name))
        if name == 'hier': hyper = dict(fold=fk, sig={g: F['sig'][g] for g in groups}, W=F['W'])
        for r in te: preds[r['uid']][name] = predict(D, F, r)
    return preds, hyper


def run_cv(rows, foldkey, label, start, procs):
    import multiprocessing as mp
    _CV.update(rows=rows, key=foldkey, start=start)
    folds = sorted({foldkey(r) for r in rows})
    preds, hyper = {}, []
    with mp.get_context('fork').Pool(procs) as pool:
        for i, (p, h) in enumerate(pool.imap_unordered(one_fold, folds)):
            preds.update(p); hyper.append(h)
            sys.stderr.write(f'\r{label}: {i + 1}/{len(folds)}'); sys.stderr.flush()
    sys.stderr.write('\n')
    return preds, hyper


MODELS = {'hier': GROUPS_FULL, 'c-add': ('eng', 'draft', 'lang', 'wsys', 'stype'), 'c-eng': ('eng', 'draft')}
PROCS = int(os.environ.get('HELDOUT_PROCS', '8'))
ALL = ('flat', 'grand', 'table', 'c-eng', 'c-add', 'hier')


def summarize(rows, preds, hyper, label):
    books = sum(r['n'] for r in rows); out = dict(folds=label, routes=len(rows), books=round(books, 1), models={})
    for mname in ALL:
        lp = sum(preds[r['uid']][mname]['lpd'] for r in rows)
        pairs = [(preds[r['uid']][mname]['mean'], r['k'], r['n']) for r in rows]
        mae = sum(abs(m - k / n) * n for m, k, n in pairs) / books
        out['models'][mname] = dict(lpd=round(lp, 2), lpd_per_book=round(lp / books, 4), mae_book_weighted=round(mae, 4), calibration=calib(pairs))
    # paired: hier vs each baseline, per-fold differences (folds are the unit), sign count
    for base in ('flat', 'grand', 'table', 'c-add'):
        d = [preds[r['uid']]['hier']['lpd'] - preds[r['uid']][base]['lpd'] for r in rows]
        out['models']['hier'][f'routes_better_than_{base}'] = f"{sum(1 for x in d if x > 0)}/{len(d)}"
    hp = [(preds[r['uid']]['hier']['mean'], r['k'], r['n']) for r in rows]
    out['worth'] = dict(hier=worth(hp), grand=worth([(preds[r['uid']]['grand']['mean'], r['k'], r['n']) for r in rows]))
    cov = [r for r in rows if r['basis'] != 'flat']
    if cov:
        out['worth']['table_v1v2_on_its_routes'] = worth([(r['prior'][0] / sum(r['prior']), r['k'], r['n']) for r in cov])
        out['worth']['hier_on_the_same_routes'] = worth([(preds[r['uid']]['hier']['mean'], r['k'], r['n']) for r in cov])
        out['covered'] = dict(routes=len(cov), **{m: round(sum(preds[r['uid']][m]['lpd'] for r in cov), 2) for m in ALL})
    we = sorted(preds[r['uid']]['hier']['W_eff'] for r in rows)
    out['hier_predictive_W_eff'] = dict(q10=round(we[len(we) // 10], 2), median=round(we[len(we) // 2], 2), q90=round(we[9 * len(we) // 10], 2))
    if hyper:
        out['hyper_by_fold'] = dict(W=sorted(h['W'] for h in hyper), **{g: sorted(h['sig'][g] for h in hyper) for g in hyper[0]['sig']})
    return out


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    path = next((a for a in sys.argv[1:] if a.endswith('.json') and a != out), 'scripts/eval/estimator/router-table/2026-10-31-correction-pass-7818.json')
    T = json.load(open(path))
    rows = []
    for c in T['rows']:
        for x in c['routes']:
            if not x['tested'] or not x['eff'] or x['eff'][1] <= 0: continue
            rows.append(dict(uid=f"{c['id']}|{x['id']}", row=c['id'], base=c['base'], route=x['id'], stage=x['stage'], k=x['eff'][0], n=x['eff'][1],
                             pages=f"{x['k']}/{x['n']}", prior=x['prior'], basis=x['prior_model']['basis'], f=factors(c, x)))
    # full-data fit: the hyperparameters every fold starts from, and the effects table
    full = {}
    for name, groups in MODELS.items():
        D = Design(rows, groups); full[name] = (D, fit_hyper(D, rows))
    D, F = full['hier']
    eff = {}
    for (g, lv), j in D.index.items():
        sd = math.sqrt(sum(y * y for y in fwd(F['L'], [1.0 if i == j else 0.0 for i in range(D.p)])))
        eff.setdefault(g, {})[lv] = [round(F['theta'][j], 3), round(sd, 3)]
    res = dict(table=path, routes=len(rows), books=round(sum(r['n'] for r in rows), 1),
               full_fit=dict(sig={g: F['sig'][g] for g in D.groups}, W=F['W'], lml=round(F['lml'], 2),
                             lml_by_model={n: round(full[n][1]['lml'], 2) for n in full}, effects=eff),
               cv={}, rows=[])
    start = {n: full[n][1] for n in full}
    keys = {'row': lambda r: r['row'], 'base': lambda r: 'german-blank' if r['base'].startswith('german-blank') else r['base'],
            'language': lambda r: r['f']['lang']}
    allpreds = {}
    for k, fk in keys.items():
        p, h = run_cv(rows, fk, k, start, PROCS); allpreds[k] = p
        res['cv'][k] = summarize(rows, p, h, k)
    for r in rows:
        res['rows'].append(dict(uid=r['uid'], factors=r['f'], k=round(r['k'], 3), n=round(r['n'], 3), pages=r['pages'], basis=r['basis'],
                                pred={k: {m: [round(allpreds[k][r['uid']][m]['mean'], 3), round(allpreds[k][r['uid']][m]['lpd'], 3)] for m in ALL} for k in keys}))
    s = json.dumps(res, indent=1)
    if out: open(out, 'w').write(s + '\n')
    print(f"{len(rows)} routes, {res['books']} books (book-scaled). Full fit: sig {res['full_fit']['sig']}, W {F['W']}; LML {res['full_fit']['lml_by_model']}")
    for k, c in res['cv'].items():
        print(f"\n== leave one {k} out ==")
        for m, v in c['models'].items():
            print(f"  {m:6s} lpd {v['lpd']:9.2f}  per book {v['lpd_per_book']:+.4f}  MAE {v['mae_book_weighted']:.3f}  ECE {v['calibration']['ece']:.3f}"
                  + (f"  better than flat/grand/table/c-add on {v['routes_better_than_flat']}, {v['routes_better_than_grand']}, {v['routes_better_than_table']}, {v['routes_better_than_c-add']} routes" if m == 'hier' else ''))
        print('  hier calibration:', ' | '.join(f"{b['bin']}: pred {b['predicted']:.2f} obs {b['observed']:.2f} ({b['books']} bk)" for b in c['models']['hier']['calibration']['bins']))
        print('  worth (pages):', json.dumps(c['worth']))
        print('  covered routes lpd:', c.get('covered'), ' hier predictive W_eff:', c['hier_predictive_W_eff'])
        print('  hyper by fold:', {g: (v[0], v[len(v) // 2], v[-1]) for g, v in c.get('hyper_by_fold', {}).items()})


if __name__ == '__main__':
    main()
