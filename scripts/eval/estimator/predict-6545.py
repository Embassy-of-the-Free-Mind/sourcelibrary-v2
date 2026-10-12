#!/usr/bin/env python3
# PRIOR ART: none — no preregistered model-based prediction exists in scripts/eval/ (searched "predict", "prereg"
# in scripts/eval/pareto-6182/ and scripts/eval/experiments/); PREREG.md files fix designs, not predicted values.
"""Preregistered predictions for #6545 (Pro full thinking vs 3.8 Flash) from the #6557 estimator.

Reads the fitted posterior (fit_full.pkl) and the table, and prints per-cell predicted fidelity under the Opus
judge and under a Gemini Pro judge, with 90% intervals, plus P(Pro > 3.8), P(Opus > 3.8).

Priors for what the data cannot identify (stated in the output, not hidden):
  thinking   Pro default thinking vs thinking-128: N(+0.10, 0.10)   (xlref-t5 X2, Flash: +0.12 [-0.01, 0.25], n=68)
  new_model  a new engine variant's own deviation: N(0, tau_model)
  correction stored + lam*(engine - stored) + N(0, 0.20), lam ~ U(0, 1.1)
             (only analogue: xlref-t5 lite check-and-fix of its own output, +0.12 [0.02, 0.22], n=67)
  pro_judge  scale offset vs Opus judge N(0, 0.30); self-preference of each judge for its own family
             s_claude, s_gemini ~ N(0.15, 0.15) each. Every past judge was Opus, so none of these is measured.
"""
import argparse, json, pickle, sys
import numpy as np
import pandas as pd

sys.path.insert(0, 'scripts/eval/estimator')
from model import cell_draws  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--langs', default='fa,sa')
ap.add_argument('--out', required=True)
a = ap.parse_args()

ix, post = pickle.load(open(a.fit, 'rb'))
df = pd.read_json(a.table, lines=True)
S = post['mu'].shape[0]
rng = np.random.default_rng(6545)

thinking = rng.normal(0.10, 0.10, S)
new_dev = rng.normal(0, 1, S) * post['tau_model']
off_pro = rng.normal(0, 0.30, S)
s_c = rng.normal(0.15, 0.15, S)
s_g = rng.normal(0.15, 0.15, S)
lam38 = rng.uniform(0, 1.1, S)
lamO = rng.uniform(0, 1.1, S)
cn38 = rng.normal(0, 0.20, S)
cnO = rng.normal(0, 0.20, S)
round_opus = rng.normal(0, 1, S) * post['tau_round']
round_pro = rng.normal(0, 1, S) * post['tau_round']


def q(x):
    return [round(float(v), 2) for v in np.percentile(x, [5, 50, 95])]


report = {}
for lang in a.langs.split(','):
    panel = df[(df.experiment == '6331-cli38-xl') & (df.language == lang)][['page', 'work']].drop_duplicates()
    pages, works = list(panel.page), [f'{lang}:{w}' for w in panel.work]
    n = len(pages)
    prod_model = df[(df.experiment == '6331-cli38-xl') & (df.language == lang) & (df.arm == 'PROD')].model.mode()[0]
    lat = dict(
        c38=cell_draws(ix, post, 'gemini-3.8-flash', 'cli', lang, pages, works, new_round=False, rng=rng),
        pro=cell_draws(ix, post, 'gemini-3.1-pro-t128', 'cli', lang, pages, works, new_round=False, rng=rng)
        + thinking + new_dev,
        opus=cell_draws(ix, post, 'claude-opus-5.5', 'api', lang, pages, works, new_round=False, rng=rng),
        stored=cell_draws(ix, post, prod_model, 'stored', lang, pages, works, new_round=False, rng=rng),
    )
    lat['corr38'] = lat['stored'] + lam38 * (lat['c38'] - lat['stored']) + cn38
    lat['corrO'] = lat['stored'] + lamO * (lat['opus'] - lat['stored']) + cnO
    fam = dict(c38='g', pro='g', stored='g', corr38='g', opus='c', corrO='mix')
    sig = post['sigma']
    cells = {}
    obs_o, obs_p = {}, {}
    for k, v in lat.items():
        # Opus judge: as measured (self-preference already inside the Claude effects); two judges on every page
        obs_o[k] = v + round_opus + rng.normal(0, 1, S) * sig / np.sqrt(2 * n)
        pj = v + off_pro + round_pro + (s_g if fam[k] == 'g' else -s_c if fam[k] == 'c' else 0.5 * (s_g - s_c))
        obs_p[k] = pj + rng.normal(0, 1, S) * sig / np.sqrt(n)
        cells[k] = dict(opus_judge=q(obs_o[k]), pro_judge=q(obs_p[k]))
    for k in ('pro', 'opus', 'corr38', 'corrO'):
        cells[k]['P_beats_c38_opus_judge'] = round(float((obs_o[k] > obs_o['c38']).mean()), 2)
        cells[k]['P_beats_c38_pro_judge'] = round(float((obs_p[k] > obs_p['c38']).mean()), 2)
        cells[k]['delta_vs_c38_opus_judge'] = q(obs_o[k] - obs_o['c38'])
    cells['opus']['opus_minus_pro_judge_on_opus_arm'] = q(obs_o['opus'] - obs_p['opus'])
    cells['opus']['self_pref_diff_in_diff'] = q((obs_o['opus'] - obs_o['c38']) - (obs_p['opus'] - obs_p['c38']))
    meas = df[(df.language == lang) & df.scored].groupby('model').page.nunique().to_dict()
    report[lang] = dict(panel_pages=n, stored_engine=prod_model, cells=cells, measured_pages_by_model=meas)

json.dump(report, open(a.out, 'w'), indent=1)
print(json.dumps(report, indent=1))
