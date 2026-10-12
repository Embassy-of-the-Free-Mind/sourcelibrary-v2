#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/loo.py — the v0 holdout. It predicts with the Gaussian model, draws fresh
# page effects per cell and has no measured/pooled label; v1 keeps the same cells so the two tables line up (#6557).
"""Leave-one-experiment-out validation of the v1 estimator (model_v1.py).

  loo_v1.py --table T --holdout 6182-xl --out O.json     refit without one experiment, predict its cells
  loo_v1.py --table T --holdout none --out fit.pkl       the full fit (for the report and the prediction)

A cell is (language, model, route) inside the held-out experiment, >= 5 pages: the same cells as v0. The
prediction is the posterior predictive of the cell's observed mean: a fresh round of the experiment's instrument
class, fresh page and work effects where the page is new (shared by every cell on that page), and simulated
ordinal scores for each judge. Each cell carries basis = measured | pooled (model_v1.basis).
"""
import argparse, json, pickle, sys, time, zlib
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator')
from model_v1 import load, fit, basis, cell_eta, Panel, INSTRUMENT_CLASS  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--table', required=True)
ap.add_argument('--holdout', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--warmup', type=int, default=500)
ap.add_argument('--samples', type=int, default=500)
ap.add_argument('--min-pages', type=int, default=5)
a = ap.parse_args()

df = load(a.table)
fam_of = dict(df[['model', 'model_family']].drop_duplicates().itertuples(index=False))
t = time.time()
train = df[df.experiment != a.holdout]
ix, post, diag = fit(train, warmup=a.warmup, samples=a.samples, seed=zlib.crc32(a.holdout.encode()) % 100000)
if a.holdout == 'none':
    pickle.dump((ix, post, diag), open(a.out, 'wb'))
    print('full fit', round(time.time() - t), 's', json.dumps({k: v for k, v in diag.items() if k != 'hyper'}))
    sys.exit(0)

test = df[df.experiment == a.holdout]
rng = np.random.default_rng(1)
panel = Panel(ix, post, rng, iclass=INSTRUMENT_CLASS[a.holdout])
cells = []
for (lang, model, route), g in test.groupby(['language', 'model', 'route']):
    if g.pkey.nunique() < a.min_pages:
        continue
    eta = panel.eta_rows(cell_eta(ix, post, model, route, lang, rng, family=fam_of[model]),
                         list(g.pkey), list(g.wkey), list(g.judge_model))
    d = panel.simulate_mean(eta, reads=2 if g.is_mean.all() else 1)
    lo, q25, med, q75, hi = np.percentile(d, [5, 25, 50, 75, 95])
    cells.append(dict(language=lang, model=model, route=route, pages=int(g.pkey.nunique()), n=len(g),
                      observed=round(float(g.score.mean()), 3), pred=round(float(d.mean()), 3),
                      lo=round(float(lo), 3), hi=round(float(hi), 3), q25=round(float(q25), 3),
                      q75=round(float(q75), 3), model_seen=model in ix.models,
                      basis=basis(train, model, g.script_family.iloc[0]),
                      draws=d[::4].round(3).tolist()))
best = []
for lang in sorted({c['language'] for c in cells}):
    cs = [c for c in cells if c['language'] == lang]
    if len(cs) < 2:
        continue
    pb = max(cs, key=lambda c: c['pred'])
    ob = max(cs, key=lambda c: c['observed'])
    best.append(dict(language=lang, pred_best=f"{pb['model']}|{pb['route']}", obs_best=f"{ob['model']}|{ob['route']}",
                     match=pb is ob, obs_gap_best_vs_predbest=round(ob['observed'] - pb['observed'], 3)))
json.dump(dict(holdout=a.holdout, iclass=INSTRUMENT_CLASS[a.holdout], secs=round(time.time() - t),
               train_rows=len(train), diagnostics=diag, cells=cells, best=best,
               tau_round={c: [round(float(x), 3) for x in np.percentile(post['tau_round'][:, i], [5, 50, 95])]
                          for i, c in enumerate(ix.classes)}), open(a.out, 'w'))
print(a.holdout, 'cells', len(cells), 'covered', sum(c['lo'] <= c['observed'] <= c['hi'] for c in cells),
      'secs', round(time.time() - t), json.dumps({k: v for k, v in diag.items() if k != 'hyper'}))
