#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/loo_v1.py — the v1 holdout over page-level experiments. v2 keeps its cells and
# its prediction (fresh round of the held-out class, shared page effects, simulated ordinal scores) and adds the
# cell-mean experiments (#6545, #6690) and per-judge cells (#6740).
"""Leave-one-experiment-out validation of the v2 estimator (model_v2.py).

  loo_v2.py --table T --summaries S --holdout 6545-r1s1 --out O.json      refit without one experiment
  loo_v2.py --table T --summaries S --holdout none --out fit.pkl          the full fit
  --no-round-maker                                                        ablation: judge-family term only

Cells. A page-level experiment: (language, model, route), >= 5 pages, judges mixed as in v1 (each row keeps its
judge). A cell-mean experiment: each committed (language, arm, judge) mean is a cell; the prediction is the
simulated mean over the cell's own pages, one read per page.
"""
import argparse, json, pickle, sys, time, zlib
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator')
from model_v2 import load, fit, basis, cell_eta, Panel, INSTRUMENT_CLASS  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--table', required=True)
ap.add_argument('--summaries', required=True)
ap.add_argument('--holdout', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--warmup', type=int, default=500)
ap.add_argument('--samples', type=int, default=500)
ap.add_argument('--chains', type=int, default=4)
ap.add_argument('--min-pages', type=int, default=5)
ap.add_argument('--no-round-maker', action='store_true')
a = ap.parse_args()

df, sm = load(a.table, a.summaries)
fam_of = dict(df[['model', 'model_family']].drop_duplicates().itertuples(index=False))
fam_of.update(dict(sm[['model', 'model_family']].drop_duplicates().itertuples(index=False)))
t = time.time()
train, train_sm = df[df.experiment != a.holdout], sm[sm.experiment != a.holdout]
ix, post, diag = fit(train, train_sm, warmup=a.warmup, samples=a.samples, chains=a.chains,
                     seed=zlib.crc32(a.holdout.encode()) % 100000, round_maker=not a.no_round_maker)
if a.holdout == 'none':
    pickle.dump((ix, post, diag), open(a.out, 'wb'))
    print('full fit', round(time.time() - t), 's', json.dumps({k: v for k, v in diag.items() if k != 'hyper'}))
    sys.exit(0)

rng = np.random.default_rng(1)
panel = Panel(ix, post, rng, iclass=INSTRUMENT_CLASS[a.holdout])
cells = []


def summarise(d, **kw):
    lo, q25, q75, hi = np.percentile(d, [5, 25, 75, 95])
    return dict(kw, pred=round(float(d.mean()), 3), lo=round(float(lo), 3), hi=round(float(hi), 3),
                q25=round(float(q25), 3), q75=round(float(q75), 3), draws=d[::4].round(3).tolist())


test = df[df.experiment == a.holdout]
for (lang, model, route), g in test.groupby(['language', 'model', 'route']):
    if g.pkey.nunique() < a.min_pages:
        continue
    parts = []
    for jm, gj in g.groupby('judge_model'):
        ce = cell_eta(ix, post, model, route, lang, rng, family=fam_of[model], judge=jm)
        parts.append(panel.eta_rows(ce, list(gj.pkey), list(gj.wkey), fam_of[model]))
    eta = np.concatenate(parts, 1)
    d = panel.simulate_mean(eta, reads=2 if g.is_mean.all() else 1)
    cells.append(summarise(d, language=lang, model=model, route=route, judge='mixed' if g.judge_model.nunique() > 1
                           else g.judge_model.iloc[0], pages=int(g.pkey.nunique()), n=len(g),
                           observed=round(float(g.score.mean()), 3), model_seen=model in ix.models,
                           basis=basis(train, model, g.script_family.iloc[0]), kind='page-level'))

for row in sm[sm.experiment == a.holdout].itertuples(index=False):
    ce = cell_eta(ix, post, row.model, row.route, row.language, rng, family=row.model_family, judge=row.judge_model)
    eta = panel.eta_rows(ce, [str(p) for p in row.pages], [f'{row.language}:{w}' for w in row.works], row.model_family)
    d = panel.simulate_mean(eta)
    cells.append(summarise(d, language=row.language, model=row.model, route=row.route, arm=row.arm,
                           judge=row.judge_model, pages=len(row.pages), n=int(row.n), observed=float(row.mean),
                           model_seen=row.model in ix.models, basis=basis(train, row.model, row.script_family),
                           kind='cell-mean'))

best = []
for (lang, judge) in sorted({(c['language'], c['judge']) for c in cells}):
    cs = [c for c in cells if c['language'] == lang and c['judge'] == judge]
    by = {}
    for c in cs:   # one entry per (model, route): #6545's repeated 3.8 runs are averaged
        by.setdefault(f"{c['model']}|{c['route']}", []).append(c)
    if len(by) < 2:
        continue
    pm = {k: np.mean([c['pred'] for c in v]) for k, v in by.items()}
    om = {k: np.mean([c['observed'] for c in v]) for k, v in by.items()}
    pb, ob = max(pm, key=pm.get), max(om, key=om.get)
    best.append(dict(language=lang, judge=judge, pred_best=pb, obs_best=ob, match=pb == ob,
                     obs_gap_best_vs_predbest=round(om[ob] - om[pb], 3)))
json.dump(dict(holdout=a.holdout, iclass=INSTRUMENT_CLASS[a.holdout], round_maker=not a.no_round_maker,
               secs=round(time.time() - t), train_rows=len(train), train_cells=len(train_sm), diagnostics=diag,
               cells=cells, best=best,
               tau_round={c: [round(float(x), 3) for x in np.percentile(post['tau_round'][:, i], [5, 50, 95])]
                          for i, c in enumerate(ix.classes)}), open(a.out, 'w'))
print(a.holdout, 'cells', len(cells), 'covered', sum(c['lo'] <= c['observed'] <= c['hi'] for c in cells),
      'secs', round(time.time() - t), json.dumps({k: v for k, v in diag.items() if k != 'hyper'}))
