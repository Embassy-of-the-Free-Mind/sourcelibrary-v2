#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/report_v1.py — renders v1 beside v0. v2 needs v1 beside v2, the new cell-mean
# holdouts, the judge-family terms and the round x maker ablation (#6740).
"""Render the v2 estimator report: leave-one-out v1 → v2, the ablation, the judge-family terms, and the
'what we know' table the planner reads.

  report_v2.py --fit fit_full_v2.pkl --table T --summaries S --loo DIR --v1 results/report-v1-2026-10-12.json \
      --v1-loo DIR_V1 --out O.json
"""
import argparse, glob, json, os, pickle, sys
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator')
from model_v2 import (load, basis, cell_eta, marginal_score, JUDGE_FAMILY, MAKERS, maker,  # noqa: E402
                      INSTRUMENT_CLASS)

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--summaries', required=True)
ap.add_argument('--loo', required=True)
ap.add_argument('--v1', required=True)
ap.add_argument('--v1-loo', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--draws-out', help='npz of per-cell posterior draws for the planner')
a = ap.parse_args()

ix, post, diag = pickle.load(open(a.fit, 'rb'))
df, sm = load(a.table, a.summaries)
v1 = json.load(open(a.v1))
v1rows = {r['experiment']: r for r in v1['loo']['per_experiment']}
out = {}
inside = lambda c: c['lo'] <= c['observed'] <= c['hi']
cov = lambda cs: round(float(np.mean([inside(c) for c in cs])), 2) if cs else None
mae = lambda cs: round(float(np.mean([abs(c['pred'] - c['observed']) for c in cs])), 3) if cs else None
width = lambda cs: round(float(np.mean([c['hi'] - c['lo'] for c in cs])), 2) if cs else None


def contrasts_of(cells):
    res, by = [], {}
    for c in cells:
        by.setdefault((c['language'], c['judge']), []).append(c)
    for cs in by.values():
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                if (cs[i]['model'], cs[i]['route']) == (cs[j]['model'], cs[j]['route']):
                    continue      # two runs of one engine: not a routing contrast
                d = np.array(cs[i]['draws']) - np.array(cs[j]['draws'])
                lo, hi = np.percentile(d, [5, 95])
                obs = cs[i]['observed'] - cs[j]['observed']
                res.append(dict(cover=bool(lo <= obs <= hi), err=abs(float(d.mean()) - obs),
                                sign=bool(np.sign(d.mean()) == np.sign(obs)) if abs(obs) >= 0.1 else None,
                                cross_maker=maker(ix.fam_of.get(cs[i]['model'], 'x')) != maker(ix.fam_of.get(cs[j]['model'], 'x'))))
    return res


# ---------- 1. leave-one-out ----------
files = sorted(glob.glob(f'{a.loo}/*.json'))
skipped = [json.load(open(p))['skipped'] for p in files if 'skipped' in json.load(open(p))]
files = [p for p in files if 'skipped' not in json.load(open(p))]
loo = [json.load(open(p)) for p in files if not p.endswith('.nrm.json')]
nrm = {json.load(open(p))['holdout']: json.load(open(p)) for p in files if p.endswith('.nrm.json')}
rows = []
for r in loo:
    cells, exp = r['cells'], r['holdout']
    for c in cells:
        c['experiment'], c['iclass'] = exp, r['iclass']
    meas = [c for c in cells if c['basis'] == 'measured']
    pool = [c for c in cells if c['basis'] == 'pooled']
    cs = contrasts_of(cells)
    z = v1rows.get(exp, {})
    rows.append(dict(
        experiment=exp, iclass=r['iclass'], kind=cells[0]['kind'] if cells else None, cells=len(cells),
        v1_coverage90=z.get('v1_coverage90'), v2_coverage90=cov(cells), v1_mae=z.get('v1_mae'),
        v2_mae=round(mae(cells), 2) if cells else None, v1_width=z.get('v1_width'), v2_width=width(cells),
        measured_cells=len(meas), v2_coverage90_measured=cov(meas), pooled_cells=len(pool),
        v2_coverage90_pooled=cov(pool), v1_best=z.get('v1_best'),
        v2_best=f"{sum(b['match'] for b in r['best'])}/{len(r['best'])}",
        v1_contrast_coverage90=z.get('v1_contrast_coverage90'),
        v2_contrast_coverage90=round(float(np.mean([c['cover'] for c in cs])), 2) if cs else None,
        contrast_pairs=len(cs),
        nrm_coverage90=cov(nrm[exp]['cells']) if exp in nrm else None,
        nrm_mae=mae(nrm[exp]['cells']) if exp in nrm else None,
        divergences=r['diagnostics']['divergences'], max_rhat=r['diagnostics']['max_rhat'],
        min_ess=r['diagnostics']['min_ess'], secs=r['secs']))
allc = [c for r in loo for c in r['cells']]
old = [c for c in allc if c['experiment'] in v1rows]
new = [c for c in allc if c['experiment'] not in v1rows]
allb = [b for r in loo for b in r['best']]
allcs = [c for r in loo for c in contrasts_of(r['cells'])]
signed = [c['sign'] for c in allcs if c['sign'] is not None]


def block(cs):
    return dict(cells=len(cs), coverage90=cov(cs),
                coverage50=round(float(np.mean([c['q25'] <= c['observed'] <= c['q75'] for c in cs])), 2) if cs else None,
                mae=mae(cs), width=width(cs))


out['loo'] = dict(
    per_experiment=rows, skipped=skipped, all=block(allc), v1_experiments=block(old), new_experiments=block(new),
    v1_on_v1_experiments=v1['loo']['all'],
    by_basis={b: block([c for c in allc if c['basis'] == b]) for b in ('measured', 'pooled')},
    by_instrument_class={k: block([c for c in allc if c['iclass'] == k]) for k in ('panel', 'packet', 'canon-ref')},
    by_judge_family={f: block([c for c in allc if JUDGE_FAMILY.get(c['judge'], 'claude') == f]) for f in ('claude', 'gemini')},
    by_arm_maker={m: block([c for c in allc if maker(ix.fam_of.get(c['model'], 'x')) == m]) for m in MAKERS},
    best_match=f"{sum(b['match'] for b in allb)}/{len(allb)}",
    contrast=dict(pairs=len(allcs), coverage90=round(float(np.mean([c['cover'] for c in allcs])), 3),
                  cross_maker_pairs=sum(c['cross_maker'] for c in allcs),
                  cross_maker_coverage90=round(float(np.mean([c['cover'] for c in allcs if c['cross_maker']])), 3),
                  sign_right_when_obs_gap_ge_0_1=f'{sum(signed)}/{len(signed)}'),
    max_pred=max(c['hi'] for c in allc),
    misses=[{k: v for k, v in c.items() if k != 'draws'} for c in allc if not inside(c)])

# the experiment the brief names: xlref-t4, cell by cell, v1 → v2 (judge term only) → v2 (+ round x maker)
v1t4 = {(c['language'], c['model'], c['route']): c for c in json.load(open(f'{a.v1_loo}/xlref-t4.json'))['cells']}
t4 = next(r for r in loo if r['holdout'] == 'xlref-t4')['cells']
t4n = {(c['language'], c['model'], c['route']): c for c in nrm.get('xlref-t4', {'cells': []})['cells']}
out['xlref_t4'] = [dict(language=c['language'], model=c['model'], route=c['route'], observed=c['observed'],
                        v1=[v1t4[k]['pred'], v1t4[k]['lo'], v1t4[k]['hi']] if (k := (c['language'], c['model'], c['route'])) in v1t4 else None,
                        v2_judge_only=[t4n[k]['pred'], t4n[k]['lo'], t4n[k]['hi']] if k in t4n else None,
                        v2=[c['pred'], c['lo'], c['hi']]) for c in t4]

# ---------- 2. judge-family terms (score points at a typical cell) ----------
rng = np.random.default_rng(0)
qs = lambda x: [round(float(v), 3) for v in np.percentile(x, [5, 50, 95])]
ROUT = [('gemini-3.8-flash', 'cli'), ('claude-opus-5.5', 'api'), ('gemini-3-flash-preview', 'stored')]
eta0 = np.mean([cell_eta(ix, post, m, r, l, rng) for m, r in ROUT for l in ix.langs], 0)
slope = (marginal_score(eta0 + 0.05, post) - marginal_score(eta0 - 0.05, post)) / 0.1
fi = ix.ix(ix.fams)
out['judge_terms'] = dict(
    points_per_logit=qs(slope),
    judge_offset_points={j: qs(post['judge'][:, i] * slope) for i, j in enumerate(ix.judges)},
    gemini_judge_x_arm_family_points={f: qs(post['jfm'][:, fi[f]] * slope) for f in ix.fams},
    tau_jf_logit=qs(post['tau_jf']), tau_jfl_logit=qs(post['tau_jfl']),
    tau_rdm_logit={c: qs(post['tau_rdm'][:, i]) for i, c in enumerate(ix.classes)},
    round_x_gemini_maker_points={k: qs(post['rdm'][:, i] * slope) for i, k in enumerate(ix.rounds)},
    round_effect_points={k: qs(post['rd'][:, i] * slope) for i, k in enumerate(ix.rounds)},
    # self-preference as the design doc defines it: (Opus − Gemini arm) under a Claude judge minus the same under a
    # Gemini judge, per language, for Opus vs 3.8 Flash CLI and the 3.1 Pro judge
    self_preference_points={})
for lang in ix.langs:
    g = {}
    for j in ('claude-opus-5.5', 'gemini-3.1-pro'):
        o = marginal_score(cell_eta(ix, post, 'claude-opus-5.5', 'api', lang, rng, judge=j), post)
        f = marginal_score(cell_eta(ix, post, 'gemini-3.8-flash', 'cli', lang, rng, judge=j), post)
        g[j] = o - f
    out['judge_terms']['self_preference_points'][lang] = qs(g['claude-opus-5.5'] - g['gemini-3.1-pro'])

# ---------- 3. what we know: per language x engine, Opus judge, average page, no round ----------
ENGINES = [('gemini-3.1-flash-lite', 'api', 'Flash-Lite 3.1'), ('gemini-3-flash-preview', 'api', '3 Flash'),
           ('gemini-3.8-flash', 'cli', '3.8 Flash CLI'), ('gemini-3.1-pro-t128', 'api', '3.1 Pro t128'),
           ('gemini-3.1-pro-high', 'cli', '3.1 Pro high CLI'), ('claude-sonnet-5.5', 'api', 'Sonnet 5.5'),
           ('claude-opus-5.5', 'api', 'Opus 5.5'), ('gemini-4-argon-low', 'cli', 'G4L CLI')]   # G4L: #6729, added #6871
pages_of = {}
for r in df.itertuples(index=False):
    pages_of.setdefault((r.language, r.model), set()).add(r.pkey)
for r in sm.itertuples(index=False):
    pages_of.setdefault((r.language, r.model), set()).update(map(str, r.pages))
sfp = {}
for (lang, m), ps in pages_of.items():
    sfp.setdefault((ix.sf_of[lang], m), set()).update(ps)
table, D_all = [], {}
for lang in ix.langs:
    D = {e[2]: marginal_score(cell_eta(ix, post, e[0], e[1], lang, rng), post) for e in ENGINES}
    stack = np.stack([D[e[2]] for e in ENGINES])
    pbest = np.bincount(stack.argmax(0), minlength=len(ENGINES)) / stack.shape[1]
    for e in ENGINES:   # the same cells under the cross-family judge, for the planner's two-family difference
        D_all[f'{lang}|{e[2]}|gemini-3.1-pro'] = marginal_score(
            cell_eta(ix, post, e[0], e[1], lang, rng, judge='gemini-3.1-pro'), post)
    for k, e in enumerate(ENGINES):
        D_all[f'{lang}|{e[2]}'] = D[e[2]]
        n = len(pages_of.get((lang, e[0]), ()))
        nsf = len(sfp.get((ix.sf_of[lang], e[0]), ()))
        b = 'pooled' if nsf < 5 or n < 5 else 'thin' if n < 20 else 'measured'
        # "untested family": the model has no pages in this script family AND no sibling of its family does
        sib = any(len(sfp.get((ix.sf_of[lang], m2), ())) >= 5 for m2 in ix.models
                  if ix.fam_of.get(m2) == ix.fam_of.get(e[0], e[0]) and m2 != e[0])
        lo, hi = np.percentile(D[e[2]], [5, 95])
        table.append(dict(language=lang, engine=e[2], model=e[0], route=e[1], est=round(float(D[e[2]].mean()), 2),
                          lo=round(float(lo), 2), hi=round(float(hi), 2), p_best=round(float(pbest[k]), 2),
                          pages=n, script_family_pages=nsf, basis=b,
                          untested_family=bool(nsf < 5 and not sib)))
out['what_we_know'] = table
assert max(t['hi'] for t in table) <= 5
if a.draws_out:
    np.savez_compressed(a.draws_out, **{k: v.astype(np.float32) for k, v in D_all.items()})

out['fit'] = dict(diagnostics=diag, rows=len(df), summary_cells=len(sm))
out['loo_diagnostics'] = dict(
    fits=len(loo) + len(nrm), divergences_total=sum(r['diagnostics']['divergences'] for r in loo + list(nrm.values())),
    max_rhat=max(r['diagnostics']['max_rhat'] for r in loo + list(nrm.values())),
    min_ess=min(r['diagnostics']['min_ess'] for r in loo + list(nrm.values())))
json.dump(out, open(a.out, 'w'), indent=1)

# ---------- markdown ----------
f = lambda x: '—' if x is None else (f'{x:.2f}' if isinstance(x, float) else str(x))
print('| held out | class | kind | cells | 90% coverage v1 → v2 | MAE v1 → v2 | width v1 → v2 | measured: v2 | pooled: v2 | '
      'best v1 → v2 | contrasts v1 → v2 | v2 without round×maker |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|')
order = ['panel', 'canon-ref', 'packet']
for r in sorted(rows, key=lambda r: (r['experiment'] not in v1rows, order.index(r['iclass']), -r['cells'])):
    print(f"| {r['experiment']} | {r['iclass']} | {r['kind']} | {r['cells']} | {f(r['v1_coverage90'])} → {f(r['v2_coverage90'])} | "
          f"{f(r['v1_mae'])} → {f(r['v2_mae'])} | {f(r['v1_width'])} → {f(r['v2_width'])} | "
          f"{r['measured_cells']}: {f(r['v2_coverage90_measured'])} | {r['pooled_cells']}: {f(r['v2_coverage90_pooled'])} | "
          f"{r['v1_best'] or '—'} → {r['v2_best']} | {f(r['v1_contrast_coverage90'])} → {f(r['v2_contrast_coverage90'])} | "
          f"{f(r['nrm_coverage90'])} |")
print(json.dumps({k: out['loo'][k] for k in out['loo'] if k not in ('per_experiment', 'misses')}, indent=1))
print(json.dumps(out['xlref_t4'], indent=0))
print(json.dumps(out['judge_terms'], indent=0)[:6000])
print(json.dumps(out['loo_diagnostics']), json.dumps({k: v for k, v in diag.items() if k != 'hyper'}))
