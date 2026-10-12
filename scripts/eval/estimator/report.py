#!/usr/bin/env python3
# PRIOR ART: none — scripts/eval/pareto-6182/score-xl.py writes per-instrument tables; nothing renders a pooled
# posterior or a leave-one-out calibration (#6557).
"""Render the #6557 estimator report: LOO calibration, the "what we know" table, plain sentences, uncertainty list.

  report.py --fit fit_full2.pkl --table table.jsonl --loo DIR --out report.json  (prints markdown to stdout)
"""
import argparse, glob, json, pickle, sys
import numpy as np
import pandas as pd

sys.path.insert(0, 'scripts/eval/estimator')
from model import load  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--loo', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()

ix, post = pickle.load(open(a.fit, 'rb'))
df = load(a.table)
out = {}

# ---------- 1. leave-one-experiment-out ----------
loo = [json.load(open(p)) for p in sorted(glob.glob(f'{a.loo}/*.json'))]
rows = []
for r in loo:
    pages = df[df.experiment == r['holdout']].pkey.nunique()
    cells = r['cells']
    if pages < 30 or not cells:
        continue
    cov = np.mean([c['lo'] <= c['observed'] <= c['hi'] for c in cells])
    mae = np.mean([abs(c['pred'] - c['observed']) for c in cells])
    width = np.mean([c['hi'] - c['lo'] for c in cells])
    unseen = [c for c in cells if not c['model_seen']]
    best = r['best']
    rows.append(dict(experiment=r['holdout'], pages=int(pages), cells=len(cells), coverage90=round(float(cov), 2),
                     mae=round(float(mae), 3), mean_width=round(float(width), 2), unseen_model_cells=len(unseen),
                     best_match=f"{sum(b['match'] for b in best)}/{len(best)}",
                     best_regret=round(float(np.mean([b['obs_gap_best_vs_predbest'] for b in best])), 3) if best else None))
allc = [c for r in loo for c in r['cells']]
allb = [b for r in loo for b in r['best']]
out['loo'] = dict(per_experiment=rows, cells=len(allc),
                  coverage90=round(float(np.mean([c['lo'] <= c['observed'] <= c['hi'] for c in allc])), 3),
                  coverage50=round(float(np.mean([np.percentile(c['draws'], 25) <= c['observed'] <= np.percentile(c['draws'], 75) for c in allc])), 3),
                  mae=round(float(np.mean([abs(c['pred'] - c['observed']) for c in allc])), 3),
                  mae_seen=round(float(np.mean([abs(c['pred'] - c['observed']) for c in allc if c['model_seen']])), 3),
                  mae_unseen=(round(float(np.mean([abs(c['pred'] - c['observed']) for c in allc if not c['model_seen']])), 3)
                              if any(not c['model_seen'] for c in allc) else None),
                  coverage_unseen=(round(float(np.mean([c['lo'] <= c['observed'] <= c['hi'] for c in allc if not c['model_seen']])), 3)
                                   if any(not c['model_seen'] for c in allc) else None),
                  best_match=f"{sum(b['match'] for b in allb)}/{len(allb)}",
                  best_regret_mean=round(float(np.mean([b['obs_gap_best_vs_predbest'] for b in allb])), 3),
                  misses=[c | {'draws': None} for c in allc if not (c['lo'] <= c['observed'] <= c['hi'])])
# contrasts inside a held-out experiment (cell minus cell, same language): the round's level cancels, and
# differences are what a routing decision uses
def contrasts_of(r):
    res = []
    by = {}
    for c in r['cells']:
        by.setdefault(c['language'], []).append(c)
    for lang, cs in by.items():
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                d = np.array(cs[i]['draws']) - np.array(cs[j]['draws'])
                lo, hi = np.percentile(d, [5, 95])
                obs = cs[i]['observed'] - cs[j]['observed']
                res.append(dict(cover=bool(lo <= obs <= hi), err=abs(float(np.median(d)) - obs),
                                sign=bool(np.sign(np.median(d)) == np.sign(obs)) if abs(obs) >= 0.1 else None))
    return res


for row in rows:
    r = next(x for x in loo if x['holdout'] == row['experiment'])
    cs = contrasts_of(r)
    row['contrast_pairs'] = len(cs)
    row['contrast_coverage90'] = round(float(np.mean([c['cover'] for c in cs])), 2) if cs else None
    row['contrast_mae'] = round(float(np.mean([c['err'] for c in cs])), 3) if cs else None
allcs = [c for r in loo for c in contrasts_of(r)]
signed = [c['sign'] for c in allcs if c['sign'] is not None]
out['loo']['contrast'] = dict(pairs=len(allcs), coverage90=round(float(np.mean([c['cover'] for c in allcs])), 3),
                              mae=round(float(np.mean([c['err'] for c in allcs])), 3),
                              sign_right_when_obs_gap_ge_0_1=f"{sum(signed)}/{len(signed)}")
# model-level best (api vs cli of the same model is not a routing miss)
mb = [b for b in allb if b['pred_best'].split('|')[0] != b['obs_best'].split('|')[0]]
out['loo']['best_model_level_miss'] = f"{len(mb)}/{len(allb)}"
out['loo']['best_model_level_misses'] = mb
for m in out['loo']['misses']:
    m.pop('draws', None)

# ---------- 2. what we know ----------
ENGINES = [('gemini-3.1-flash-lite', 'api', 'Flash-Lite 3.1'), ('gemini-3-flash-preview', 'api', '3 Flash'),
           ('gemini-3.8-flash', 'cli', '3.8 Flash (CLI)'), ('gemini-3.1-pro-t128', 'api', '3.1 Pro (thinking 128)'),
           ('claude-sonnet-5.5', 'api', 'Sonnet 5.5'), ('claude-opus-5.5', 'api', 'Opus (ceiling)')]
ROUTABLE = ENGINES[:5]
li = {x: i for i, x in enumerate(ix.langs)}
fi = {f: i for i, f in enumerate(ix.fams)}
si = {s: i for i, s in enumerate(ix.sfs)}


def latent(model, route, lang):
    l, mi = li[lang], ix.models.index(model)
    f, s = fi[ix.fam_of[model]], si[ix.sf_of[lang]]
    return (post['mu'] + post['lang'][:, l] + post['mod'][:, mi] + post['route'][:, ix.routes.index(route)]
            + post['fs'][:, f, s] + post['fl'][:, f, l] + post['ml'][:, mi, l])


npages = df.groupby(['language', 'model']).pkey.nunique().to_dict()
nworks = df.groupby(['language', 'model']).wkey.nunique().to_dict()
table, draws = [], {}
for lang in ix.langs:
    D = {e[2]: latent(e[0], e[1], lang) for e in ENGINES}
    draws[lang] = D
    stack = np.stack([D[e[2]] for e in ROUTABLE])
    pbest = np.bincount(stack.argmax(0), minlength=len(ROUTABLE)) / stack.shape[1]
    for k, e in enumerate(ENGINES):
        n = npages.get((lang, e[0]), 0)
        lo, med, hi = np.percentile(D[e[2]], [5, 50, 95])
        table.append(dict(language=lang, engine=e[2], est=round(float(med), 2), lo=round(float(lo), 2),
                          hi=round(float(hi), 2), p_best=(round(float(pbest[k]), 2) if k < len(ROUTABLE) else None),
                          pages=int(n), works=int(nworks.get((lang, e[0]), 0)),
                          basis='measured' if n >= 20 else 'thin' if n >= 5 else 'pooled'))
out['what_we_know'] = table


def contrast(lang, a_, b_):
    d = draws[lang][a_] - draws[lang][b_]
    lo, med, hi = np.percentile(d, [5, 50, 95])
    return dict(language=lang, a=a_, b=b_, p=round(float((d > 0).mean()), 3), delta=round(float(med), 2),
                lo=round(float(lo), 2), hi=round(float(hi), 2))


out['contrasts'] = [contrast(l, x, y) for l in ix.langs for x, y in
                    [('3.8 Flash (CLI)', 'Flash-Lite 3.1'), ('3.8 Flash (CLI)', '3 Flash'),
                     ('3.1 Pro (thinking 128)', '3.8 Flash (CLI)'), ('Sonnet 5.5', '3.8 Flash (CLI)')]]

# ---------- 3. where more data would most change a routing decision ----------
# expected value of perfect information on the routable set, per language: E[max] - max E
voi = []
for lang in ix.langs:
    stack = np.stack([draws[lang][e[2]] for e in ROUTABLE])
    evpi = float(stack.max(0).mean() - stack.mean(1).max())
    lead = ROUTABLE[int(stack.mean(1).argmax())][2]
    order = np.argsort(-stack.mean(1))
    runner = ROUTABLE[int(order[1])][2]
    voi.append(dict(language=lang, evpi=round(evpi, 3), leader=lead, runner_up=runner,
                    p_leader_best=round(float((stack.argmax(0) == order[0]).mean()), 2)))
out['voi'] = sorted(voi, key=lambda v: -v['evpi'])

# ---------- 4. self-preference, judge ----------
out['judge'] = dict(sonnet_judge_offset=[round(float(x), 3) for x in np.percentile(post['judge'][:, 1], [5, 50, 95])],
                    note='Sonnet judged #5606 only (57 pages). No Gemini judge anywhere: self-preference is a prior.')
out['hyper'] = {k: [round(float(x), 3) for x in np.percentile(post[k], [5, 50, 95])]
                for k in ['sigma', 'tau_lang', 'tau_sf', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl', 'tau_ml',
                          'tau_w', 'tau_p', 'tau_round']}
out['route'] = {r: [round(float(x), 3) for x in np.percentile(post['route'][:, i], [5, 50, 95])]
                for i, r in enumerate(ix.routes)}
json.dump(out, open(a.out, 'w'), indent=1)
print(json.dumps({k: out[k] for k in ['loo', 'judge', 'hyper', 'route']}, indent=1)[:6000])
print(json.dumps(out['voi'], indent=0)[:3000])
