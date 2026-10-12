#!/usr/bin/env python3
# PRIOR ART: none — no cross-experiment holdout exists in scripts/eval/ (lib/ INDEX.md has within-experiment
# bootstrap CIs only); this validates the #6557 estimator before anything routes on it.
"""Leave-one-experiment-out validation of the #6557 estimator.

  loo.py --table T --holdout 6182-xl --out O.json      refit without one experiment, predict its cells
  loo.py --table T --holdout none --out fit.pkl        the full fit (for the report)

A cell is (language, model, route) inside the held-out experiment. The prediction includes a fresh round effect
and the cell's own sampling noise, so a calibrated model covers the observed mean ~90% of the time.
"""
import argparse, json, pickle, sys, time
import numpy as np
import pandas as pd

sys.path.insert(0, 'scripts/eval/estimator')
from model import load, fit, cell_draws  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--table', required=True)
ap.add_argument('--holdout', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--warmup', type=int, default=400)
ap.add_argument('--samples', type=int, default=400)
ap.add_argument('--min-pages', type=int, default=5)
a = ap.parse_args()

df = load(a.table)
fam_of = dict(df[['model', 'model_family']].drop_duplicates().itertuples(index=False))
t = time.time()
train = df[df.experiment != a.holdout]
ix, post = fit(train, warmup=a.warmup, samples=a.samples, seed=hash(a.holdout) % 1000)
if a.holdout == 'none':
    pickle.dump((ix, post), open(a.out, 'wb'))
    print('full fit', round(time.time() - t), 's')
    sys.exit(0)

test = df[df.experiment == a.holdout]
rng = np.random.default_rng(1)
round_draw = rng.normal(0, 1, post['mu'].shape[0]) * post['tau_round']   # one round shared by the experiment
cells = []
for (lang, model, route), g in test.groupby(['language', 'model', 'route']):
    pages = g[['pkey', 'wkey']].drop_duplicates()
    if len(pages) < a.min_pages:
        continue
    jm = g.judge_model.mode()[0]
    d = cell_draws(ix, post, model, route, lang, list(pages.pkey), list(pages.wkey), new_round=False, rng=rng,
                   n_obs=len(g), family=fam_of[model], judge=jm) + round_draw
    lo, med, hi = np.percentile(d, [5, 50, 95])
    cells.append(dict(language=lang, model=model, route=route, pages=len(pages), n=len(g),
                      observed=round(float(g.score.mean()), 3), pred=round(float(med), 3),
                      lo=round(float(lo), 3), hi=round(float(hi), 3),
                      model_seen=model in ix.models, draws=d[::4].round(3).tolist()))
# best engine per language: predicted vs observed, among engines in this experiment for that language
best = []
for lang in {c['language'] for c in cells}:
    cs = [c for c in cells if c['language'] == lang]
    if len(cs) < 2:
        continue
    pb = max(cs, key=lambda c: c['pred'])
    ob = max(cs, key=lambda c: c['observed'])
    best.append(dict(language=lang, pred_best=f"{pb['model']}|{pb['route']}", obs_best=f"{ob['model']}|{ob['route']}",
                     match=pb is ob, obs_gap_best_vs_predbest=round(ob['observed'] - pb['observed'], 3)))
json.dump(dict(holdout=a.holdout, secs=round(time.time() - t), train_rows=len(train), cells=cells, best=best),
          open(a.out, 'w'))
print(a.holdout, 'cells', len(cells), 'covered', sum(c['lo'] <= c['observed'] <= c['hi'] for c in cells),
      'secs', round(time.time() - t))
