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
    s = json.dumps(out, indent=1)
    if '--out' in sys.argv: open(sys.argv[sys.argv.index('--out') + 1], 'w').write(s + '\n')
    for g, f in out['fits'].items():
        if 'W' not in f: print(g, f); continue
        c = f['calibration']
        print(f"{g}: {f['n_routes']} routes, W = {f['W']:.3g} pages, profile 90% [{f['ci90'][0]:.3g}, {f['ci90'][1]:.3g}], bootstrap [{f['bootstrap_W'][0]:.3g}, {f['bootstrap_W'][2]:.3g}]; "
              f"MAE {f['mae']:.3f}; calibration alpha {c['alpha']:+.1f} beta {c['beta']:.2f} [{c['beta_ci90'][0]:.2f}, {c['beta_ci90'][1]:.2f}] (W then {c['W']:.3g})")
        print('   leave-one-out W:', {k: round(v, 3) for k, v in f['loo'].items()})
    for r in rows: print(f"   {r['cell']}/{r['route']} ({r['basis']}): prior {r['m']:.3f} -> observed {r['obs']:.3f} ({r['ke']:.1f} of {r['ne']:.1f} book-scaled; {r['k']}/{r['n']} pages)")


if __name__ == '__main__':
    main()
