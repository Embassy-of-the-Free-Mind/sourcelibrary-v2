#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/report_v1.py (the translation 'what we know' table). Same table for OCR accuracy:
# per chart x engine, the posterior for an average page, its basis, and P(best) among the measured engines (#6740).
"""Posterior summary of the OCR accuracy model and the held-out-engine check.

  report_ocr_v0.py --fit ocr-fit-v0.pkl --table ocr-table.jsonl [--holdout ocr-holdout-g4.json] --out results/ocr-v0.json \
      [--draws-out draws.npz]
"""
import argparse, json, pickle, sys
import numpy as np

sys.path.insert(0, 'scripts/eval/estimator/ocr')
from model_ocr_v0 import load, cell_accuracy, basis  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--fit', required=True)
ap.add_argument('--table', required=True)
ap.add_argument('--holdout')
ap.add_argument('--out', required=True)
ap.add_argument('--draws-out')
a = ap.parse_args()
ix, post, diag = pickle.load(open(a.fit, 'rb'))
df = load(a.table)
pareto = json.load(open('src/data/ocr-pareto.json'))
prod = {c['id']: c['production_engine'] for c in pareto['charts']}
rng = np.random.default_rng(0)
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
table, draws = [], {}
for chart in ix.lv['chart']:
    engines = sorted(set(df[df.chart == chart].engine))
    # the chart's own period mix (its pages, any engine), not an unweighted average over every period
    w = df[df.chart == chart].drop_duplicates('page').period.value_counts(normalize=True)
    D = {e: sum(float(wt) * cell_accuracy(ix, post, e, chart, np.random.default_rng(hash((chart, e)) % 2**32), period=t)
                for t, wt in w.items()) for e in engines}
    meas = [e for e in engines if basis(df, e, chart) == 'measured']
    st = np.stack([D[e] for e in meas])
    pbest = dict(zip(meas, np.bincount(st.argmax(0), minlength=len(meas)) / st.shape[1]))
    for e in engines:
        draws[f'{chart}|{e}'] = D[e]
        g = df[(df.chart == chart) & (df.engine == e)]
        table.append(dict(chart=chart, engine=e, family=ix.fam_of[e], production=(prod.get(chart) == e),
                          accuracy=q(D[e]), basis=basis(df, e, chart), pages=int(g.page.nunique()),
                          works=int(g.work.nunique()), observed_mean_accuracy=round(float(1 - g.cer.mean()), 4),
                          p_best=round(float(pbest.get(e, 0.0)), 3)))
slope_note = 'accuracy = 1 - E[CER] for an average page and work of the chart, weighted by the chart\'s own period mix, no panel effect'
out = dict(diagnostics=diag, rows=len(df), pages=int(df.page.nunique()), works=int(df.work.nunique()),
           note=slope_note, production=prod, table=table,
           hyper={k: q(post[k]) for k in ['phi', 'tau_fam', 'tau_eng', 'tau_chart', 'tau_fc', 'tau_ec', 'tau_period',
                                          'tau_panel', 'tau_work', 'tau_page']},
           kind_manuscript_logit=q(post['K'][:, ix.i('kind')['print']] - post['K'][:, ix.i('kind')['manuscript']]) if 'print' in ix.lv['kind'] else None,
           period_logit={t: q(post['T'][:, i]) for i, t in enumerate(ix.lv['period'])},
           panel_logit={s: q(post['S'][:, i]) for i, s in enumerate(ix.lv['panel'])})
# posterior predictive check, in sample: fitted mean CER (every effect, incl. page, work, panel) vs observed, per cell,
# and the same for within-chart differences between measured engines on their shared pages
e_ = {k: np.asarray(v) for k, v in ix.enc(df).items()}
sub = slice(None, None, 10)
eta = (post['a'][sub, None] + post['E'][sub][:, e_['eng']] + post['C'][sub][:, e_['chart']]
       + post['FC'][sub][:, e_['fam'], e_['chart']] + post['EC'][sub][:, e_['eng'], e_['chart']] + post['K'][sub][:, e_['kind']]
       + post['T'][sub][:, e_['period']] + post['S'][sub][:, e_['panel']] + post['W'][sub][:, e_['work']] + post['P'][sub][:, e_['page']])
df['fitted'] = (1 / (1 + np.exp(-eta))).mean(0)
ppc, pairs = [], []
for (chart, eng), g in df.groupby(['chart', 'engine']):
    if g.page.nunique() >= 5:
        ppc.append(dict(chart=chart, engine=eng, observed_cer=round(float(g.cer.mean()), 4),
                        fitted_cer=round(float(g.fitted.mean()), 4), share_cer_1=round(float((g.cer >= 0.999).mean()), 3)))
for chart, g in df.groupby('chart'):
    pv, fv = g.pivot_table(index='page', columns='engine', values='cer'), g.pivot_table(index='page', columns='engine', values='fitted')
    meas = [x for x in pv.columns if pv[x].notna().sum() >= 5]
    for i in range(len(meas)):
        for j in range(i + 1, len(meas)):
            m = pv[meas[i]].notna() & pv[meas[j]].notna()
            if m.sum() >= 5:
                pairs.append(dict(chart=chart, a=meas[i], b=meas[j], pages=int(m.sum()),
                                  observed=float((pv[meas[i]] - pv[meas[j]])[m].mean()),
                                  fitted=float((fv[meas[i]] - fv[meas[j]])[m].mean())))
err = np.array([p['fitted'] - p['observed'] for p in pairs])
out['ppc'] = dict(cells=ppc, level_bias_cer=dict(median=round(float(np.median([c['fitted_cer'] - c['observed_cer'] for c in ppc])), 4),
                                                 p10_p90=[round(float(x), 4) for x in np.percentile([c['fitted_cer'] - c['observed_cer'] for c in ppc], [10, 90])]),
                  pair_difference_error=dict(pairs=len(pairs), median_abs=round(float(np.median(np.abs(err))), 4),
                                             p90_abs=round(float(np.percentile(np.abs(err), 90)), 4),
                                             sign_agrees=f"{int(sum(np.sign(p['fitted']) == np.sign(p['observed']) for p in pairs if abs(p['observed']) >= 0.01))}/"
                                                         f"{sum(abs(p['observed']) >= 0.01 for p in pairs)}"),
                  share_rows_cer_1=round(float((df.cer >= 0.999).mean()), 3))
json.dump(out, open(a.out, 'w'), indent=1)
print(json.dumps({k: v for k, v in out['ppc'].items() if k != 'cells'}))
if a.holdout:
    h = json.load(open(a.holdout))
    out['holdout'] = dict(engine=h['holdout'], cells=h['cells'], diagnostics=h['diagnostics'],
                          covered=f"{sum(c['lo'] <= c['observed'] <= c['hi'] for c in h['cells'])}/{len(h['cells'])}")
json.dump(out, open(a.out, 'w'), indent=1)
if a.draws_out:
    np.savez_compressed(a.draws_out, **{k: v.astype(np.float32) for k, v in draws.items()})
print(json.dumps(diag))
print('| chart | engine | accuracy [90%] | basis | pages | works | P(best) |')
print('|---|---|---|---|---|---|---|')
for chart in ix.lv['chart']:
    rows = sorted([t for t in table if t['chart'] == chart], key=lambda t: -t['accuracy'][1])
    for t in rows[:6] + [t for t in rows[6:] if t['production']]:
        tag = ' **(in use)**' if t['production'] else ''
        print(f"| {chart} | {t['engine']}{tag} | {t['accuracy'][1]:.3f} [{t['accuracy'][0]:.3f}, {t['accuracy'][2]:.3f}] | "
              f"{t['basis']} | {t['pages']} | {t['works']} | {t['p_best']:.2f} |")
if a.holdout:
    print(json.dumps(out['holdout'], indent=0))
