#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/heldout/heldout.py (#7878) — its partially pooled logit (Design, fit_hyper, fit,
# predict) and factors.py are imported unchanged; this script only runs its additive model ('c-add': no engine x script
# interaction, which #7878 found unsupported) leave-one-base-out over a table and writes the means build.py reads.
# fit_prior.py fits one weight for the v1/v2 means over the ~15 routes they cover; it is kept (it fits the legacy prior
# the table now shows as a sensitivity).
"""The router's acceptance prior from the partially pooled logit of #7878 (#7263 V1). Stdlib only, no model calls, no DB.

  python3 scripts/eval/estimator/router-table/pooled_prior.py [<build.py table .json>] [--out <file.json>]   (repo root)

Data: every TESTED route of the table (build.py's book-scaled eff k of n, as #7878). Model: logit p = mu + engine +
draft + language + writing system + script type, each a Gaussian random effect, beta-binomial at concentration W;
hyperparameters by Laplace marginal likelihood on all routes (heldout.fit_hyper), once.

The mean for a route is the model's prediction with the route's whole BASE cell left out (its print / manuscript /
unknown splits share books; german-blank* are one base), refitted at the full-data hyperparameters. So the prior is what
the OTHER cells say, its own evidence is added once in build.py, and the mean is exactly the prediction #7878 scored
held out (leave one base out: log density -528.5 against the table prior's -614.6, ECE 0.014, worth 5.5 [4.5, 6.7]
pages). Untested routes get the same prediction, from their factors. build.py reads `means` (rules.json
inputs.pooled_prior); a route the file does not name gets the flat prior and a WARNING (refit after adding a route).
"""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'heldout'))
from factors import factors  # noqa: E402
from heldout import Design, fit, fit_hyper, predict  # noqa: E402

GROUPS = ('eng', 'draft', 'lang', 'wsys', 'stype')   # #7878 'c-add'
base_key = lambda b: 'german-blank' if b.startswith('german-blank') else b


def main():
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    path = next((a for a in sys.argv[1:] if a.endswith('.json') and a != out), None)
    if not path: sys.exit('usage: pooled_prior.py <table.json> [--out <file.json>]')
    T = json.load(open(path))
    allr, train = [], []
    for c in T['rows']:
        for x in c['routes']:
            r = dict(row=c['id'], base=base_key(c.get('base') or c['id'].split('/')[0]), route=x['id'], f=factors(dict(c, base=c.get('base') or c['id'].split('/')[0], script=c.get('script') or 'print'), x))
            if x['tested'] and x.get('eff') and x['eff'][1] > 0:
                r.update(k=x['eff'][0], n=x['eff'][1]); train.append(r)
            else:
                r.update(k=0, n=0)
            allr.append(r)
    D = Design(train, GROUPS)
    F = fit_hyper(D, train)
    sys.stderr.write(f"full fit: {len(train)} routes, sig {F['sig']}, W {F['W']}, LML {F['lml']:.2f}\n")
    means, full = {}, {}
    bases = sorted({r['base'] for r in allr})
    for i, b in enumerate(bases):
        tr = [r for r in train if r['base'] != b]
        Db = Design(tr, GROUPS)   # levels only the left-out base has are unseen: they keep their prior variance
        Fb = fit(Db, tr, F['sig'], F['W'])
        for r in allr:
            if r['base'] != b: continue
            p = predict(Db, Fb, r)
            means.setdefault(r['row'], {})[r['route']] = round(p['mean'], 4)
            full.setdefault(r['row'], {})[r['route']] = round(predict(D, F, r)['mean'], 4) if all((g, r['f'][g]) in D.index for g in GROUPS) else None
        sys.stderr.write(f'\r{i + 1}/{len(bases)} bases'); sys.stderr.flush()
    sys.stderr.write('\n')
    eff = {}
    for (g, lv), j in D.index.items():
        eff.setdefault(g, {})[lv] = round(F['theta'][j], 3)
    res = dict(_about=__doc__.split('\n\n')[0], table=path, model='#7878 c-add: logit p = mu + engine + draft + language + writing system + script type',
               fold='leave one base cell out, hyperparameters from the full fit', routes_fitted=len(train), routes=len(allr),
               hyper=dict(sig={g: F['sig'][g] for g in GROUPS}, W=F['W'], lml=round(F['lml'], 2)), effects=eff,
               means=means, means_full_fit=full)
    s = json.dumps(res, indent=1, ensure_ascii=False)
    if out: open(out, 'w').write(s + '\n')
    else: print(s)


if __name__ == '__main__':
    main()
