#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/predict-6545.py — the v0 prediction pinned on #6545 (kept, and still the
# prediction of record for v0). This is the same prediction from the v1 ordinal model, pinned beside it (#6557).
"""Preregistered predictions for #6545 stage 1 from the v1 estimator (model_v1.py).

The cells and the priors are v0's (predict-6545.py). Two things differ:
  - the observed panel mean is simulated from the ordinal model (two Opus judges per page, or one Pro judge),
    with a fresh round of the PANEL instrument class, so no number can leave 1–5;
  - the priors, which v0 states in score points, are applied as that many points of expected panel mean on
    these pages (the latent is moved by bisection until the expected mean has moved by the stated amount),
    so +0.10 still means +0.10 points, and a shift that would leave the scale stops at its edge.

Priors for what the data cannot identify (unchanged from v0):
  thinking   Pro default thinking vs thinking-128: N(+0.10, 0.10) points
  new_model  a new engine variant's own deviation: N(0, tau_model) (logit scale, from the fit)
  correction stored + lam*(engine - stored) + N(0, 0.20) points, lam ~ U(0, 1.1)
  pro_judge  scale offset vs Opus judge N(0, 0.30) points; self-preference of each judge for its own family
             s_claude, s_gemini ~ N(0.15, 0.15) points each. Every past judge was Claude: none is measured.
"""
import argparse, json, pickle, sys
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator')
from model_v1 import cell_eta, expected_score, Panel, basis, load  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--langs', default='fa,sa')
ap.add_argument('--out', required=True)
# the pin used the defaults; the other values are for the sensitivity runs in score-6545.py's report
ap.add_argument('--iclass', default='panel', help='instrument class of the new round')
ap.add_argument('--opus-reads', type=int, default=2, help='Opus judges per page')
a = ap.parse_args()

ix, post, diag = pickle.load(open(a.fit, 'rb'))
fitted = load(a.table)
S = post['cut'].shape[0]
rng = np.random.default_rng(6545)

thinking = rng.normal(0.10, 0.10, S)
new_dev = rng.normal(0, 1, S) * post['tau_model']
off_pro = rng.normal(0, 0.30, S)
s_c = rng.normal(0.15, 0.15, S)
s_g = rng.normal(0.15, 0.15, S)
lam38, lamO = rng.uniform(0, 1.1, S), rng.uniform(0, 1.1, S)
cn38, cnO = rng.normal(0, 0.20, S), rng.normal(0, 0.20, S)


def q(x):
    return [round(float(v), 2) for v in np.percentile(x, [5, 50, 95])]


report = {}
for lang in a.langs.split(','):
    sub = fitted[(fitted.experiment == '6331-cli38-xl') & (fitted.language == lang)]
    pw = sub[['pkey', 'wkey']].drop_duplicates()
    pages, works = list(pw.pkey), list(pw.wkey)
    n = len(pages)
    prod_model = sub[sub.arm == 'PROD'].model.mode()[0]
    # one fresh panel-class round per judge; the page and work effects are the fitted ones (same pages)
    opus_round, pro_round = Panel(ix, post, rng, iclass=a.iclass), Panel(ix, post, rng, iclass=a.iclass)
    base = Panel(ix, post, rng)                       # no round: for moving a prior stated in points

    def shifted(cell, points):
        """The cell's latent, moved so that its expected panel mean changes by `points` score points (exact, by
        bisection per draw; a target outside the scale is held just inside it)."""
        f = lambda c: expected_score(base.eta_rows(c, pages, works), post['cut']).mean(1)
        target = np.clip(f(cell) + points, 1.005, 4.995)
        lo, hi = cell - 20.0, cell + 20.0
        for _ in range(40):
            mid = (lo + hi) / 2
            up = f(mid) < target
            lo, hi = np.where(up, mid, lo), np.where(up, hi, mid)
        return (lo + hi) / 2

    c38 = cell_eta(ix, post, 'gemini-3.8-flash', 'cli', lang, rng)
    pro128 = cell_eta(ix, post, 'gemini-3.1-pro-t128', 'cli', lang, rng)
    opus = cell_eta(ix, post, 'claude-opus-5.5', 'api', lang, rng)
    stored = cell_eta(ix, post, prod_model, 'stored', lang, rng)
    lat = dict(c38=c38, pro=shifted(pro128 + new_dev, thinking), opus=opus, stored=stored)
    lat['corr38'] = shifted(stored + lam38 * (c38 - stored), cn38)
    lat['corrO'] = shifted(stored + lamO * (opus - stored), cnO)
    fam = dict(c38='g', pro='g', stored='g', corr38='g', opus='c', corrO='mix')
    sf = ix.sf_of[lang]
    n_opus = fitted[(fitted.model == 'claude-opus-5.5') & (fitted.language == lang)].pkey.nunique()
    label = dict(
        c38='measured: the same pages, same stored output',
        pro='pooled: full thinking was never read; Pro at thinking 128 is ' + basis(fitted, 'gemini-3.1-pro-t128', sf)
            + ' in this script family, the thinking step is a prior',
        opus=basis(fitted, 'claude-opus-5.5', sf) + f', thin: Opus was read on {n_opus} pages of this language',
        stored='measured: the same pages, same stored output',
        corr38='pooled: correction arms were never fitted; prior only',
        corrO='pooled: correction arms were never fitted; prior only')
    cells, obs_o, obs_p = {}, {}, {}
    for k, v in lat.items():
        obs_o[k] = opus_round.simulate_mean(opus_round.eta_rows(v, pages, works), reads=a.opus_reads)
        shift = off_pro + (s_g if fam[k] == 'g' else -s_c if fam[k] == 'c' else 0.5 * (s_g - s_c))
        obs_p[k] = pro_round.simulate_mean(pro_round.eta_rows(shifted(v, shift), pages, works), reads=1)
        cells[k] = dict(opus_judge=q(obs_o[k]), pro_judge=q(obs_p[k]), basis=label[k])
    for k in ('pro', 'opus', 'corr38', 'corrO'):
        cells[k]['P_beats_c38_opus_judge'] = round(float((obs_o[k] > obs_o['c38']).mean()
                                                         + 0.5 * (obs_o[k] == obs_o['c38']).mean()), 2)
        cells[k]['P_beats_c38_pro_judge'] = round(float((obs_p[k] > obs_p['c38']).mean()
                                                        + 0.5 * (obs_p[k] == obs_p['c38']).mean()), 2)
        cells[k]['delta_vs_c38_opus_judge'] = q(obs_o[k] - obs_o['c38'])
    cells['opus']['opus_minus_pro_judge_on_opus_arm'] = q(obs_o['opus'] - obs_p['opus'])
    cells['opus']['self_pref_diff_in_diff'] = q((obs_o['opus'] - obs_o['c38']) - (obs_p['opus'] - obs_p['c38']))
    report[lang] = dict(panel_pages=n, stored_engine=prod_model, cells=cells)
    assert all(c[j][2] <= 5 and c[j][0] >= 1 for c in cells.values() for j in ('opus_judge', 'pro_judge'))

report['_model'] = dict(version='v1', likelihood='ordered logistic', instrument_class=a.iclass,
                        diagnostics={k: v for k, v in diag.items() if k != 'hyper'})
json.dump(report, open(a.out, 'w'), indent=1)
print(json.dumps(report, indent=1))
