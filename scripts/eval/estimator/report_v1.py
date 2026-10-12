#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/report.py — renders the v0 report from the Gaussian posterior. v1 needs the
# ordinal scale, the measured/pooled split, chain diagnostics and the v0 numbers side by side (#6557).
"""Render the v1 estimator report and the v0-vs-v1 calibration table.

  report_v1.py --fit fit_full_v1.pkl --table table.jsonl --loo DIR --v0 results/report-2026-10-12.json --out O.json
"""
import argparse, glob, json, pickle, sys
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator')
from model_v1 import load, basis, cell_eta, marginal_score, expected_score, INSTRUMENT_CLASS, MIN_SF_PAGES  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--loo', required=True)
ap.add_argument('--v0', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()

ix, post, diag = pickle.load(open(a.fit, 'rb'))
df = load(a.table)
v0 = json.load(open(a.v0))
out = {}
cov = lambda cs: round(float(np.mean([c['lo'] <= c['observed'] <= c['hi'] for c in cs])), 2) if cs else None
mae = lambda cs: round(float(np.mean([abs(c['pred'] - c['observed']) for c in cs])), 3) if cs else None


def contrasts_of(cells):
    res = []
    by = {}
    for c in cells:
        by.setdefault(c['language'], []).append(c)
    for cs in by.values():
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                d = np.array(cs[i]['draws']) - np.array(cs[j]['draws'])
                lo, hi = np.percentile(d, [5, 95])
                obs = cs[i]['observed'] - cs[j]['observed']
                res.append(dict(cover=bool(lo <= obs <= hi), err=abs(float(d.mean()) - obs),
                                both_measured=cs[i]['basis'] == cs[j]['basis'] == 'measured',
                                sign=bool(np.sign(d.mean()) == np.sign(obs)) if abs(obs) >= 0.1 else None))
    return res


# ---------- 1. leave-one-experiment-out, v1 beside v0 ----------
loo = [json.load(open(p)) for p in sorted(glob.glob(f'{a.loo}/*.json'))]
# v0 kept only its misses; the cells are the same (same table, same rule), so a v0 miss is matched to its
# experiment by (language, model, route, n, observed mean)
key = lambda c: (c['language'], c['model'], c['route'], c['n'], round(c['observed'], 3))
v0_miss = {key(c) for c in v0['loo']['misses']}
v0_rows = {r['experiment']: r for r in v0['loo']['per_experiment']}
rows = []
for r in loo:
    cells, exp = r['cells'], r['holdout']
    for c in cells:
        c['experiment'], c['iclass'], c['v0_miss'] = exp, r['iclass'], key(c) in v0_miss
    meas = [c for c in cells if c['basis'] == 'measured']
    pool = [c for c in cells if c['basis'] == 'pooled']
    cs = contrasts_of(cells)
    z = v0_rows.get(exp, {})
    assert not z or z['cells'] == len(cells), f'{exp}: v1 has {len(cells)} cells, v0 had {z.get("cells")}'
    assert not z or sum(c['v0_miss'] for c in cells) == round((1 - z['coverage90']) * len(cells)), exp
    rows.append(dict(
        experiment=exp, iclass=r['iclass'], pages=int(df[df.experiment == exp].pkey.nunique()), cells=len(cells),
        v0_coverage90=z.get('coverage90'), v1_coverage90=cov(cells),
        v0_mae=round(z['mae'], 2) if z else None, v1_mae=round(mae(cells), 2),
        v0_width=z.get('mean_width'), v1_width=round(float(np.mean([c['hi'] - c['lo'] for c in cells])), 2),
        measured_cells=len(meas), v1_coverage90_measured=cov(meas),
        v0_coverage90_measured=(round(1 - float(np.mean([c['v0_miss'] for c in meas])), 2) if meas else None),
        pooled_cells=len(pool), v1_coverage90_pooled=cov(pool),
        v0_coverage90_pooled=(round(1 - float(np.mean([c['v0_miss'] for c in pool])), 2) if pool else None),
        v1_mae_pooled=mae(pool),
        v0_best=z.get('best_match'), v1_best=f"{sum(b['match'] for b in r['best'])}/{len(r['best'])}",
        v0_contrast_coverage90=z.get('contrast_coverage90'),
        v1_contrast_coverage90=round(float(np.mean([c['cover'] for c in cs])), 2) if cs else None,
        contrast_pairs=len(cs),
        divergences=r['diagnostics']['divergences'], max_rhat=r['diagnostics']['max_rhat'],
        min_ess=r['diagnostics']['min_ess'], secs=r['secs']))
allc = [c for r in loo for c in r['cells']]
allb = [b for r in loo for b in r['best']]
allcs = [c for r in loo for c in contrasts_of(r['cells'])]


def block(cs):
    return dict(cells=len(cs), v1_coverage90=cov(cs),
                v0_coverage90=round(1 - float(np.mean([c['v0_miss'] for c in cs])), 2) if cs else None,
                v1_coverage50=round(float(np.mean([c['q25'] <= c['observed'] <= c['q75'] for c in cs])), 2) if cs else None,
                v1_mae=mae(cs), v1_width=round(float(np.mean([c['hi'] - c['lo'] for c in cs])), 2) if cs else None)


mb = [b for b in allb if b['pred_best'].split('|')[0] != b['obs_best'].split('|')[0]]
signed = [c['sign'] for c in allcs if c['sign'] is not None]
out['loo'] = dict(
    per_experiment=rows, all=block(allc),
    by_basis={b: block([c for c in allc if c['basis'] == b]) for b in ('measured', 'pooled')},
    by_instrument_class={k: block([c for c in allc if c['iclass'] == k]) for k in ('panel', 'packet', 'canon-ref')},
    by_instrument_class_measured={k: block([c for c in allc if c['iclass'] == k and c['basis'] == 'measured'])
                                  for k in ('panel', 'packet', 'canon-ref')},
    best_match=f"{sum(b['match'] for b in allb)}/{len(allb)}", best_model_level_miss=f'{len(mb)}/{len(allb)}',
    best_regret_mean=round(float(np.mean([b['obs_gap_best_vs_predbest'] for b in allb])), 3),
    contrast=dict(pairs=len(allcs), coverage90=round(float(np.mean([c['cover'] for c in allcs])), 3),
                  coverage90_both_measured=round(float(np.mean([c['cover'] for c in allcs if c['both_measured']])), 3),
                  pairs_both_measured=sum(c['both_measured'] for c in allcs),
                  mae=round(float(np.mean([c['err'] for c in allcs])), 3),
                  sign_right_when_obs_gap_ge_0_1=f'{sum(signed)}/{len(signed)}'),
    v0=dict(coverage90=v0['loo']['coverage90'], coverage50=v0['loo']['coverage50'], mae=v0['loo']['mae'],
            contrast_coverage90=v0['loo']['contrast']['coverage90'], best_match=v0['loo']['best_match'],
            best_model_level_miss=v0['loo']['best_model_level_miss']),
    max_pred=max(c['hi'] for c in allc),
    misses=[{k: v for k, v in c.items() if k != 'draws'} for c in allc if not (c['lo'] <= c['observed'] <= c['hi'])],
    pooled_cells=[{k: v for k, v in c.items() if k != 'draws'} for c in allc if c['basis'] == 'pooled'])

# ---------- 2. what we know (expected score for an average work and page, Opus judge, panel instrument) ----------
ENGINES = [('gemini-3.1-flash-lite', 'api', 'Flash-Lite 3.1'), ('gemini-3-flash-preview', 'api', '3 Flash'),
           ('gemini-3.8-flash', 'cli', '3.8 Flash (CLI)'), ('gemini-3.1-pro-t128', 'api', '3.1 Pro (thinking 128)'),
           ('claude-sonnet-5.5', 'api', 'Sonnet 5.5'), ('claude-opus-5.5', 'api', 'Opus (ceiling)')]
ROUTABLE = ENGINES[:5]
rng = np.random.default_rng(0)
npages = df.groupby(['language', 'model']).pkey.nunique().to_dict()
nworks = df.groupby(['language', 'model']).wkey.nunique().to_dict()
sfpages = df.groupby(['script_family', 'model']).pkey.nunique().to_dict()
table, draws = [], {}
for lang in ix.langs:
    D = {e[2]: marginal_score(cell_eta(ix, post, e[0], e[1], lang, rng), post) for e in ENGINES}
    draws[lang] = D
    stack = np.stack([D[e[2]] for e in ROUTABLE])
    pbest = np.bincount(stack.argmax(0), minlength=len(ROUTABLE)) / stack.shape[1]
    for k, e in enumerate(ENGINES):
        n = npages.get((lang, e[0]), 0)
        lo, med, hi = np.percentile(D[e[2]], [5, 50, 95])
        # measured needs the model read in this script family; inside that, the page count in the language
        # says how much: measured (>= 20 pages), thin (5–19), pooled (< 5, or the script family unread)
        b = basis(df, e[0], ix.sf_of[lang])
        b = 'pooled' if (b == 'pooled' or n < 5) else 'thin' if n < 20 else 'measured'
        table.append(dict(language=lang, engine=e[2], est=round(float(D[e[2]].mean()), 2), lo=round(float(lo), 2),
                          hi=round(float(hi), 2), p_best=(round(float(pbest[k]), 2) if k < len(ROUTABLE) else None),
                          pages=int(n), works=int(nworks.get((lang, e[0]), 0)),
                          script_family_pages=int(sfpages.get((ix.sf_of[lang], e[0]), 0)), basis=b))
out['what_we_know'] = table
out['max_estimate'] = max(t['hi'] for t in table)
assert out['max_estimate'] <= 5 and out['loo']['max_pred'] <= 5


def contrast(lang, a_, b_):
    d = draws[lang][a_] - draws[lang][b_]
    lo, med, hi = np.percentile(d, [5, 50, 95])
    return dict(language=lang, a=a_, b=b_, p=round(float((d > 0).mean()), 3), delta=round(float(med), 2),
                lo=round(float(lo), 2), hi=round(float(hi), 2))


out['contrasts'] = [contrast(l, x, y) for l in ix.langs for x, y in
                    [('3.8 Flash (CLI)', 'Flash-Lite 3.1'), ('3.8 Flash (CLI)', '3 Flash'),
                     ('3.1 Pro (thinking 128)', '3.8 Flash (CLI)'), ('Sonnet 5.5', '3.8 Flash (CLI)')]]

# ---------- 3. the fit itself ----------
qs = lambda x: [round(float(v), 3) for v in np.percentile(x, [5, 50, 95])]
# score points per logit for a typical cell: slope of the marginal expected score at the mean routable cell
eta0 = np.mean([cell_eta(ix, post, e[0], e[1], l, rng) for e in ROUTABLE for l in ix.langs], 0)
slope = (marginal_score(eta0 + 0.05, post) - marginal_score(eta0 - 0.05, post)) / 0.1
seen = {ix.class_of_round[k] for k in ix.rounds}
out['fit'] = dict(
    diagnostics=diag, rows=len(df), min_sf_pages=MIN_SF_PAGES,
    points_per_logit=qs(slope),
    tau_round_logit={c: qs(post['tau_round'][:, i]) for i, c in enumerate(ix.classes)},
    tau_round_points={c: qs(post['tau_round'][:, i] * slope) for i, c in enumerate(ix.classes)},
    rounds_per_class={c: sum(1 for k in ix.rounds if ix.class_of_round[k] == c) for c in ix.classes},
    round_effect_points={k: qs(post['rd'][:, i] * slope) for i, k in enumerate(ix.rounds)},
    hyper_logit={k: qs(post[k]) for k in ['tau_lang', 'tau_sf', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl',
                                         'tau_ml', 'tau_w', 'tau_p']},
    cut=[qs(post['cut'][:, i]) for i in range(4)],
    route_points={r: qs(post['route'][:, i] * slope) for i, r in enumerate(ix.routes)},
    sonnet_judge_points=qs(post['judge'][:, 1] * slope))
out['loo_diagnostics'] = dict(
    fits=len(loo), divergences_total=sum(r['diagnostics']['divergences'] for r in loo),
    max_rhat=max(r['diagnostics']['max_rhat'] for r in loo), min_ess=min(r['diagnostics']['min_ess'] for r in loo))
# ---------- 4. what a round effect cannot absorb: in-sample residual by round x language ----------
# observed mean minus fitted expected mean, per (round, language). A round effect moves every language of a
# round together; a residual that differs by language inside one round is an instrument x language shift.
e = {k: np.asarray(v) for k, v in ix.enc(df).items()}
fam_of_m, sf_of_l, _ = (np.asarray(x) for x in ix.maps())
sub = slice(None, None, 5)
eta = (post['lang'][sub][:, e['l']] + post['mod'][sub][:, e['m']] + post['route'][sub][:, e['r']]
       + post['fs'][sub][:, fam_of_m[e['m']], sf_of_l[e['l']]] + post['fl'][sub][:, fam_of_m[e['m']], e['l']]
       + post['ml'][sub][:, e['m'], e['l']] + post['wk'][sub][:, e['w']] + post['pg'][sub][:, e['p']]
       + post['rd'][sub][:, e['k']] + post['judge'][sub][:, e['j']])
df['fitted'] = expected_score(eta, post['cut'][sub]).mean(0)
res = []
for (rnd, lang), g in df.groupby(['round', 'language']):
    if g.pkey.nunique() >= 5:
        res.append(dict(round=rnd, iclass=ix.class_of_round[rnd], language=lang, pages=int(g.pkey.nunique()),
                        n=len(g), residual=round(float((g.score - g.fitted).mean()), 3)))
out['round_language_residual'] = dict(
    rows=res,
    sd_by_class={c: round(float(np.std([r['residual'] for r in res if r['iclass'] == c])), 3) for c in ix.classes},
    max_abs_by_class={c: max((abs(r['residual']), r['round'], r['language']) for r in res if r['iclass'] == c)
                      for c in ix.classes})

json.dump(out, open(a.out, 'w'), indent=1)

# ---------- markdown ----------
f = lambda x: '—' if x is None else (f'{x:.2f}' if isinstance(x, float) else str(x))
print('| held out | instrument | cells | 90% coverage v0 → v1 | MAE v0 → v1 | interval width v0 → v1 | '
      'measured cells: v1 coverage | pooled cells: v1 coverage | best model v0 → v1 | contrasts v0 → v1 |')
print('|---|---|---|---|---|---|---|---|---|---|')
for r in sorted(rows, key=lambda r: (['panel', 'canon-ref', 'packet'].index(r['iclass']), -r['cells'])):
    print(f"| {r['experiment']} | {r['iclass']} | {r['cells']} | {f(r['v0_coverage90'])} → {f(r['v1_coverage90'])} | "
          f"{f(r['v0_mae'])} → {f(r['v1_mae'])} | {f(r['v0_width'])} → {f(r['v1_width'])} | "
          f"{r['measured_cells']}: {f(r['v1_coverage90_measured'])} | {r['pooled_cells']}: {f(r['v1_coverage90_pooled'])} | "
          f"{r['v0_best']} → {r['v1_best']} | {f(r['v0_contrast_coverage90'])} → {f(r['v1_contrast_coverage90'])} |")
print(json.dumps({k: out['loo'][k] for k in ['all', 'by_basis', 'by_instrument_class', 'by_instrument_class_measured',
                                             'best_match', 'best_model_level_miss', 'best_regret_mean', 'contrast',
                                             'v0', 'max_pred']}, indent=1))
print(json.dumps(out['fit'], indent=1)[:5000])
print(json.dumps(out['loo_diagnostics']))
print(json.dumps({k: out['round_language_residual'][k] for k in ('sd_by_class', 'max_abs_by_class')}))
print([(r['round'], r['language'], r['residual']) for r in out['round_language_residual']['rows'] if r['iclass'] != 'panel'])
