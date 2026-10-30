#!/usr/bin/env python3
# PRIOR ART: build.py's "Prior against the pilot" list (prior mean, weight -> k/n per tested route) shows the comparison
# by eye and fits nothing; rules.json prior.pages_measured = 4 / pages_pooled = 2 were set by hand (#7417).
# scripts/eval/estimator/loo_v1.py / loo_v2.py score the v1 / v2 models against their OWN held-out references (CER,
# 1-5 fidelity), not against acceptance judged on the image, so they cannot say what a v1/v2 mean is worth here.
"""Learn the router prior's weight from the routes that have both a model prior and judged pages (#7263). Stdlib only.

  python3 scripts/eval/estimator/router-table/fit_prior.py <a build.py table .json> [--out <file.json>]   (repo root)

Data: every tested route whose prior comes from v1 / v2 (prior_model.basis measured or pooled; flat priors carry no
model information), with its book-scaled evidence (eff = accepted, judged, wrong-text pages after build.py's book
scaling: the same numbers the posterior uses).

Model (empirical Bayes, beta-binomial): route i's acceptance p_i ~ Beta(m_i W, (1 - m_i) W), its k_i of n_i ~ Bin(n_i, p_i),
m_i = the prior mean the table uses. W is the prior's worth in pages: the larger the routes' scatter around their
prior means beyond binomial noise, the smaller W. W is fitted by maximum marginal likelihood (a log grid), with a
profile-likelihood 90% interval and a route bootstrap. Calibration: the same likelihood with the mean
logistic(alpha + beta x logit m_i); beta = 1, alpha = 0 is a calibrated prior, beta near 0 a prior that predicts
nothing. Fitted separately for measured and pooled priors where each has >= 4 routes.

Calibration (#7263 router-next, Derek 2026-10-28 "recalibrate the estimates, not only the weight"): alpha, beta and W
over all routes on a fine grid; rules.json prior.calibration carries them and build.py maps every v1/v2 mean through
logistic(alpha + beta x logit m). Held-out check: leave one CELL out (a cell's routes share books and a v2 cell), the
held-out cell's beta-binomial log likelihood and |prior mean - observed| under the calibrated and the uncalibrated prior,
each refitted without that cell; again without Latin Flash-Lite's draft (v1 0.035, the one route with most misfit).
"""
import json, math, random, sys

lg = math.lgamma
lbeta = lambda a, b: lg(a) + lg(b) - lg(a + b)
logit = lambda p: math.log(p / (1 - p))
expit = lambda x: 1 / (1 + math.exp(-x))
W_GRID = [math.exp(x / 40) for x in range(-200, 461)]  # 0.0067 .. 100 pages


def ll(data, W, mean=lambda m: m):
    """Beta-binomial marginal log likelihood (the n-choose-k term dropped: constant in W, alpha, beta)."""
    s = 0.0
    for m, k, n in data:
        mu = min(max(mean(m), 1e-4), 1 - 1e-4); a, b = mu * W, (1 - mu) * W
        s += lbeta(k + a, n - k + b) - lbeta(a, b)
    return s


def fit_w(data):
    lls = [ll(data, W) for W in W_GRID]; i = max(range(len(lls)), key=lls.__getitem__)
    ok = [W for W, v in zip(W_GRID, lls) if v >= lls[i] - 1.353]  # profile likelihood, chi2(1) 90% = 2.706 / 2
    return dict(W=W_GRID[i], ll=lls[i], ci90=[ok[0], ok[-1]], at_grid_edge=i in (0, len(W_GRID) - 1))


def fit_calibration(data):
    best = None
    for al in [x / 10 for x in range(-30, 31, 2)]:
        for be in [x / 20 for x in range(-20, 61, 2)]:
            mean = lambda m, al=al, be=be: expit(al + be * logit(min(max(m, 1e-3), 1 - 1e-3)))
            for W in W_GRID[::10]:
                v = ll(data, W, mean)
                if best is None or v > best[0]: best = (v, al, be, W)
    v0, al, be, W = best
    prof = {}
    for be2 in [x / 20 for x in range(-20, 61, 2)]:
        prof[be2] = max(ll(data, W2, lambda m, al2=al2: expit(al2 + be2 * logit(min(max(m, 1e-3), 1 - 1e-3))))
                        for al2 in [x / 10 for x in range(-30, 31, 2)] for W2 in W_GRID[::10])
    ok = [b for b, v in prof.items() if v >= v0 - 1.353]
    return dict(alpha=al, beta=be, W=W, beta_ci90=[min(ok), max(ok)], ll=v0)


def fit_cal(data, W_fixed=None):
    """(alpha, beta, W) by maximum marginal likelihood, a coarse grid then a fine one around its best (#7263 router-next:
    the calibration build.py applies). W_fixed: alpha and beta only."""
    Ws = [W_fixed] if W_fixed else W_GRID[::5]
    def best_on(als, bes, ws):
        b = None
        for al in als:
            for be in bes:
                mean = lambda m, al=al, be=be: expit(al + be * logit(min(max(m, 1e-3), 1 - 1e-3)))
                for W in ws:
                    v = ll(data, W, mean)
                    if b is None or v > b[0]: b = (v, al, be, W)
        return b
    v, al, be, W = best_on([x / 5 for x in range(-20, 21)], [x / 10 for x in range(-10, 31)], Ws)
    v, al, be, W = best_on([al + x / 50 for x in range(-10, 11)], [be + x / 100 for x in range(-10, 11)],
                           [W] if W_fixed else [w for w in W_GRID if W / 1.2 <= w <= W * 1.2])
    return dict(alpha=round(al, 3), beta=round(be, 3), W=W, ll=v)


def cal_mean(m, c):
    return expit(c['alpha'] + c['beta'] * logit(min(max(m, 1e-3), 1 - 1e-3)))


def loco(rows):
    """Leave one CELL out: fit the calibrated prior (alpha, beta, W) and the uncalibrated one (W) on the other cells,
    score the held-out cell's routes. Held-out log marginal likelihood (beta-binomial, book-scaled k of n) and the
    absolute error of the prior mean against the observed rate, per cell and summed."""
    out, tot = {}, dict(ll_cal=0.0, ll_unc=0.0, ae_cal=0.0, ae_unc=0.0, n=0)
    for c in sorted({r['cell'] for r in rows}):
        tr = [(r['m'], r['ke'], r['ne']) for r in rows if r['cell'] != c]; te = [r for r in rows if r['cell'] == c]
        cf, wf = fit_cal(tr), fit_w(tr)['W']
        d = [(r['m'], r['ke'], r['ne']) for r in te]
        o = dict(alpha=cf['alpha'], beta=cf['beta'], W_cal=cf['W'], W_unc=wf,
                 ll_cal=ll(d, cf['W'], lambda m: cal_mean(m, cf)), ll_unc=ll(d, wf),
                 routes={r['route']: dict(obs=round(r['obs'], 3), unc=round(r['m'], 3), cal=round(cal_mean(r['m'], cf), 3)) for r in te})
        o['ae_cal'] = sum(abs(cal_mean(r['m'], cf) - r['obs']) for r in te); o['ae_unc'] = sum(abs(r['m'] - r['obs']) for r in te)
        for k in ('ll_cal', 'll_unc', 'ae_cal', 'ae_unc'): tot[k] += o[k]
        tot['n'] += len(te); out[c] = o
    tot['mae_cal'], tot['mae_unc'] = tot.pop('ae_cal') / tot['n'], tot.pop('ae_unc') / tot['n']
    return dict(cells=out, total=tot)


def boot(data, B=2000, seed=7263):
    rng = random.Random(seed); ws = []
    for _ in range(B):
        ws.append(fit_w([rng.choice(data) for _ in data])['W'])
    ws.sort(); return [ws[int(0.05 * B)], ws[int(0.5 * B)], ws[int(0.95 * B)]]


def main():
    T = json.load(open(sys.argv[1]))
    rows = [dict(cell=r['id'], route=x['id'], m=x['prior_model']['mean'], basis=x['prior_model']['basis'], k=x['k'], n=x['n'],
                 ke=x['eff'][0], ne=x['eff'][1], obs=x['eff'][0] / x['eff'][1])
            for r in T['rows'] for x in r['routes'] if x['tested'] and x['prior_model']['basis'] != 'flat']
    out = dict(table=sys.argv[1], routes=rows, fits={})
    groups = {'all': rows, 'measured': [r for r in rows if r['basis'] == 'measured'], 'pooled': [r for r in rows if r['basis'] == 'pooled']}
    for g, rs in groups.items():
        data = [(r['m'], r['ke'], r['ne']) for r in rs]
        if len(data) < 4: out['fits'][g] = dict(n_routes=len(data), skipped='fewer than 4 routes'); continue
        f = fit_w(data); f.update(n_routes=len(data), bootstrap_W=boot(data), calibration=fit_calibration(data),
                                 loo={f"{r['cell']}/{r['route']}": fit_w([(q['m'], q['ke'], q['ne']) for q in rs if q is not r])['W'] for r in rs},
                                 ll_at={str(w): ll(data, w) for w in (0.1, 0.5, 1, 2, 4)})
        # mean absolute error of the prior mean against the observed rate, and what a Beta(m W, (1-m) W) predicts for it
        f['mae'] = sum(abs(r['m'] - r['obs']) for r in rs) / len(rs)
        out['fits'][g] = f
    data = [(r['m'], r['ke'], r['ne']) for r in rows]
    out['calibration'] = dict(fit=fit_cal(data), loco=loco(rows), loco_without_latin_lite_draft=loco([r for r in rows if (r['cell'].split('/')[0], r['route']) != ('latin-lite', 'lite')]))
    s = json.dumps(out, indent=1)
    if '--out' in sys.argv: open(sys.argv[sys.argv.index('--out') + 1], 'w').write(s + '\n')
    for g, f in out['fits'].items():
        if 'W' not in f: print(g, f); continue
        c = f['calibration']
        print(f"{g}: {f['n_routes']} routes, W = {f['W']:.3g} pages, profile 90% [{f['ci90'][0]:.3g}, {f['ci90'][1]:.3g}], bootstrap [{f['bootstrap_W'][0]:.3g}, {f['bootstrap_W'][2]:.3g}]; "
              f"MAE {f['mae']:.3f}; calibration alpha {c['alpha']:+.1f} beta {c['beta']:.2f} [{c['beta_ci90'][0]:.2f}, {c['beta_ci90'][1]:.2f}] (W then {c['W']:.3g})")
        print('   leave-one-out W:', {k: round(v, 3) for k, v in f['loo'].items()})
    C = out['calibration']; c = C['fit']
    print(f"calibration (build.py applies it): logit(mean) = {c['alpha']:+.2f} + {c['beta']:.2f} x logit(v1/v2 mean), W = {c['W']:.3g} pages, ll {c['ll']:.2f}")
    for k in ('loco', 'loco_without_latin_lite_draft'):
        t = C[k]['total']
        print(f"   {k}: held-out log lik calibrated {t['ll_cal']:.2f} vs uncalibrated {t['ll_unc']:.2f}; MAE {t['mae_cal']:.3f} vs {t['mae_unc']:.3f} ({t['n']} routes)")
        for cid, o in C[k]['cells'].items():
            print(f"      {cid}: a {o['alpha']:+.2f} b {o['beta']:.2f} W {o['W_cal']:.3g} | ll {o['ll_cal']:.2f} vs {o['ll_unc']:.2f} | " + ', '.join(f"{rt} {v['unc']:.2f}->{v['cal']:.2f} obs {v['obs']:.2f}" for rt, v in o['routes'].items()))
    for r in rows: print(f"   {r['cell']}/{r['route']} ({r['basis']}): prior {r['m']:.3f} -> observed {r['obs']:.3f} ({r['ke']:.1f} of {r['ne']:.1f} book-scaled; {r['k']}/{r['n']} pages)")


if __name__ == '__main__':
    main()
