#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/loo_v1.py — the translation fit/holdout driver; this is the same shape for the
# OCR accuracy model (model_ocr_v0.py), with an engine holdout instead of an experiment holdout (#6740).
"""Fit the OCR accuracy model, or hold one engine out and predict its chart cells.

  fit_ocr_v0.py --table T --out fit.pkl                                     full fit
  fit_ocr_v0.py --table T --holdout-engine gemini-4-argon-low+antigravity-cli --out O.json
"""
import argparse, json, pickle, sys, time
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator/ocr')
from model_ocr_v0 import load, fit, cell_accuracy  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--table', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--holdout-engine')
ap.add_argument('--warmup', type=int, default=500)
ap.add_argument('--samples', type=int, default=500)
ap.add_argument('--chains', type=int, default=3)
a = ap.parse_args()
df = load(a.table)
t = time.time()
train = df[df.engine != a.holdout_engine] if a.holdout_engine else df
ix, post, diag = fit(train, warmup=a.warmup, samples=a.samples, chains=a.chains)
print('fit', round(time.time() - t), 's', json.dumps(diag))
if not a.holdout_engine:
    pickle.dump((ix, post, diag), open(a.out, 'wb'))
    sys.exit(0)
rng = np.random.default_rng(1)
test = df[df.engine == a.holdout_engine]
fam = test.engine_family.iloc[0]
cells = []
for chart, g in test.groupby('chart'):
    if g.page.nunique() < 5:
        continue
    # the prediction is for THESE pages: the pages' own effects where the fit saw them (other engines read them)
    d = cell_accuracy(ix, post, a.holdout_engine, chart, rng, family=fam)
    pi, wi, si = ix.i('page'), ix.i('work'), ix.i('panel')
    shift = np.mean([post['P'][:, pi[p]] if p in pi else np.zeros(len(d)) for p in g.page], 0) + \
        np.mean([post['W'][:, wi[w]] if w in wi else np.zeros(len(d)) for w in g.work], 0) + \
        np.mean([post['S'][:, si[s]] if s in si else np.zeros(len(d)) for s in g.panel], 0)
    # first-order: move the average-page accuracy by the pages' mean logit shift
    cer = 1 - d
    cer2 = 1 / (1 + np.exp(-(np.log(cer / (1 - cer)) + shift)))
    lo, hi = np.percentile(1 - cer2, [5, 95])
    cells.append(dict(chart=chart, pages=int(g.page.nunique()), observed=round(float(1 - g.cer.mean()), 4),
                      pred=round(float((1 - cer2).mean()), 4), lo=round(float(lo), 4), hi=round(float(hi), 4)))
json.dump(dict(holdout=a.holdout_engine, family=fam, diagnostics=diag, cells=cells), open(a.out, 'w'), indent=1)
print(json.dumps(cells, indent=1))
