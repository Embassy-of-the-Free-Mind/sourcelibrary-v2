#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/fit_ocr_v0.py + report_ocr_v0.py — v0's fit driver and its in-sample PPC
# (fitted vs observed mean CER per chart x engine cell, median = the 0.064 level bias). This driver runs that same PPC
# for v1 with and without the hurdle, adds the did-not-read and number fits, and holds the #4763 rows out (#6740).
"""Fit OCR estimator v1 and check it (#6740).

  fit_ocr_v1.py --table $S/ocr-table-v1.jsonl --out-dir $S/fit-v1 --summary results/ocr-v1-fit.json

Writes posterior pickles to --out-dir (scratch; route_ocr_v1.py reads them) and a summary JSON with:
  hurdle_ppc     the v0 level-bias statistic, same rows, same inference, with and without the hurdle
  refusal_ppc    observed vs fitted did-not-read rate per chart x engine, and the #4763 targets by stratum
  numbers        misread / dropped / spurious per number printed, per engine x stratum, observed beside fitted
  holdout_4763   fit without any #4763 row, predict the gate's did-not-read rate and CER per stratum x engine
"""
import argparse, json, os, pickle, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_ocr_v1 import (load, fit_accuracy, fit_refusal, fit_numbers, row_eta, cell_cer, cell_fail,  # noqa: E402
                          number_rate, stratum_pages, NUM)

AGY, LITE, IA = 'gemini-3.8-flash+antigravity-cli', 'gemini-3.1-flash-lite', 'ia-djvu'
STRATA = {'S1': ('english-pre1880-prose', 0), 'S2': ('english-pre1880-dense', 1), 'S3': ('english-1880-1930-prose', 0),
          'S4': ('english-1880-1930-dense', 1)}
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
sig = lambda x: 1 / (1 + np.exp(-x))


def accuracy_ppc(df, ix, post, hurdle):
    s = df[df.scored].reset_index(drop=True)
    mu = sig(row_eta(post, 'mu_', ix, s))
    fitted = (sig(row_eta(post, 'h_', ix, s)) + (1 - sig(row_eta(post, 'h_', ix, s))) * mu) if hurdle else mu
    s['fitted'] = fitted.mean(0)
    cells = []
    for (chart, eng), g in s.groupby(['chart', 'engine']):
        if g.page.nunique() >= 5:
            cells.append(dict(chart=chart, engine=eng, observed=round(float(g.cer.mean()), 4),
                              fitted=round(float(g.fitted.mean()), 4), share_cer_1=round(float(g.z.mean()), 3)))
    bias = np.array([c['fitted'] - c['observed'] for c in cells])
    pairs = []
    for chart, g in s.groupby('chart'):
        pv, fv = g.pivot_table(index='page', columns='engine', values='cer'), g.pivot_table(index='page', columns='engine', values='fitted')
        meas = [x for x in pv.columns if pv[x].notna().sum() >= 5]
        for i in range(len(meas)):
            for j in range(i + 1, len(meas)):
                m = pv[meas[i]].notna() & pv[meas[j]].notna()
                if m.sum() >= 5:
                    pairs.append(((pv[meas[i]] - pv[meas[j]])[m].mean(), (fv[meas[i]] - fv[meas[j]])[m].mean()))
    err = np.array([f - o for o, f in pairs])
    big = [(o, f) for o, f in pairs if abs(o) >= 0.01]
    return dict(cells=len(cells), level_bias_median=round(float(np.median(bias)), 4),
                level_bias_p10_p90=[round(float(x), 4) for x in np.percentile(bias, [10, 90])],
                level_abs_median=round(float(np.median(np.abs(bias))), 4),
                pair_error_median_abs=round(float(np.median(np.abs(err))), 4), pairs=len(pairs),
                pair_sign_agrees=f"{sum(np.sign(o) == np.sign(f) for o, f in big)}/{len(big)}",
                by_cell=cells)


def refusal_ppc(df, ix, post):
    d = df.copy()
    d['fitted'] = sig(row_eta(post, 'q_', ix, d, refusal=True)).mean(0)
    cells = []
    for (chart, eng), g in d.groupby(['chart', 'engine']):
        if g.page.nunique() >= 5 and (g.fail.sum() > 0 or g.fitted.mean() > 0.02):
            cells.append(dict(chart=chart, engine=eng, pages=int(g.page.nunique()), observed=f"{int(g.fail.sum())}/{len(g)}",
                              observed_rate=round(float(g.fail.mean()), 3), fitted=round(float(g.fitted.mean()), 3)))
    gate = d[d.source == 'gate-4763']
    targets = []
    for eng in (AGY, LITE, IA):
        for st in ['ALL', 'S1', 'S2', 'S3', 'S4']:
            g = gate[(gate.engine == eng) & ((gate.stratum == st) if st != 'ALL' else True)]
            targets.append(dict(engine=eng, stratum=st, observed=f"{int(g.fail.sum())}/{len(g)}",
                                observed_rate=round(float(g.fail.mean()), 3), fitted=round(float(g.fitted.mean()), 3)))
    return dict(by_cell=cells, gate_4763=targets)


def gate_predictions(df, ixa, pa, ixq, pq, seed, holdout):
    """Per stratum x engine: predicted did-not-read rate and CER among reads, for NEW pages of the stratum's cell."""
    gate = df[df.source == 'gate-4763']
    out = []
    for eng, fam in ((AGY, 'gemini-cli'), (LITE, 'gemini-lite'), (IA, 'archive-text')):
        for st, (chart, dense) in STRATA.items():
            g = gate[(gate.engine == eng) & (gate.stratum == st)]
            era = '1880 on' if chart.startswith('english-1880') else '1700-1879'
            rng = np.random.default_rng(seed)
            cell = dict(engine=eng, family=fam, chart=chart, era=era, dense=dense, web=1)
            f = cell_fail(pq, ixq, rng=rng, panel=None, **cell)
            c = cell_cer(pa, ixa, rng=rng, panel='english-ia-5124', **cell)
            sc = g[g.scored]
            # posterior predictive COUNT of pages not read, so an observed 0 can sit inside the interval
            kf = rng.binomial(len(g), np.clip(f, 0, 1))
            row = dict(engine=eng, stratum=st, pages=len(g), observed_fail=f"{int(g.fail.sum())}/{len(g)}",
                       observed_fail_rate=round(float(g.fail.mean()), 3), pred_fail=q(f), pred_fail_count=q(kf),
                       fail_covered=bool(np.percentile(kf, 5) <= g.fail.sum() <= np.percentile(kf, 95)),
                       observed_cer=round(float(sc.cer.mean()), 4) if len(sc) else None, pred_cer=q(c))
            if len(sc):  # a level interval: it leaves out the sampling noise of a mean over these pages
                row['cer_covered'] = bool(np.percentile(c, 5) <= sc.cer.mean() <= np.percentile(c, 95))
            out.append(row)
    if holdout:  # the pooled agy number the brief names: 31/122 overall, 14/34 on S4
        rng = np.random.default_rng(seed)
        draws = []
        for st, (chart, dense) in STRATA.items():
            era = '1880 on' if chart.startswith('english-1880') else '1700-1879'
            n = int((gate.stratum == st).sum() / 3)
            draws.append(n * cell_fail(pq, ixq, rng=rng, panel=None, engine=AGY, family='gemini-cli', chart=chart,
                                       era=era, dense=dense, web=1))
        tot = np.sum(draws, 0) / 122
        kt = rng.binomial(122, np.clip(tot, 0, 1))
        obs = int(gate[gate.engine == AGY].fail.sum())
        out.append(dict(engine=AGY, stratum='ALL', pages=122, observed_fail=f'{obs}/122', observed_fail_rate=round(obs / 122, 3),
                        pred_fail=q(tot), pred_fail_count=q(kt), fail_covered=bool(np.percentile(kt, 5) <= obs <= np.percentile(kt, 95))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--summary', required=True)
    ap.add_argument('--steps', type=int, default=15000)
    ap.add_argument('--only', default='all', help='all | full | holdout | numbers | numbers-report | report')
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    df = load(a.table)
    summ = json.load(open(a.summary)) if os.path.exists(a.summary) else {}
    summ['table'] = dict(rows=len(df), scored=int(df.scored.sum()), pages=int(df.page.nunique()),
                         works=int(df.work.nunique()), engines=int(df.engine.nunique()),
                         gate_rows=int((df.source == 'gate-4763').sum()), share_cer_1=round(float(df[df.scored].z.mean()), 4))
    t0 = time.time()
    if a.only in ('all', 'full'):
        ixa, pa, da = fit_accuracy(df, hurdle=True, steps=a.steps)
        print('accuracy hurdle', round(time.time() - t0), 's', da, flush=True)
        ix0, p0, d0 = fit_accuracy(df, hurdle=False, steps=a.steps)
        print('accuracy no hurdle', round(time.time() - t0), 's', d0, flush=True)
        ixq, pq, dq = fit_refusal(df, steps=a.steps)
        print('refusal', round(time.time() - t0), 's', dq, flush=True)
        pickle.dump(dict(acc=(ixa, pa, da), acc0=(ix0, p0, d0), ref=(ixq, pq, dq)),
                    open(os.path.join(a.out_dir, 'full.pkl'), 'wb'))
        summ['hurdle_ppc'] = dict(with_hurdle=accuracy_ppc(df, ixa, pa, True), without_hurdle=accuracy_ppc(df, ix0, p0, False),
                                  diagnostics=dict(with_hurdle=da, without_hurdle=d0),
                                  hyper=dict({k: q(pa[k]) for k in ('phi', 'mu_tau_page', 'mu_tau_work', 'h_tau_page', 'h_tau_work', 'h_a')},
                                             **{f'phi_{c}': q(pa['phi_c'][:, i]) for i, c in enumerate(ixa.lv['chart'])},
                                             **{f'{p}spread_{c}': q(np.sqrt(pa[p + 'tau_work_c'][:, i] ** 2 + pa[p + 'tau_page_c'][:, i] ** 2))
                                                for p in ('mu_', 'h_') for i, c in enumerate(ixa.lv['chart'])}))
        summ['refusal_ppc'] = refusal_ppc(df, ixq, pq)
        summ['refusal_ppc']['diagnostics'] = dq
        summ['refusal_ppc']['terms'] = {k: q(pq[k]) for k in ('q_b_fame', 'q_b_dense', 'q_tau_fe', 'q_tau_bf', 'q_tau_bd', 'q_tau_page', 'q_tau_work')}
        summ['refusal_ppc']['era'] = {t: q(pq['q_T'][:, i]) for i, t in enumerate(ixq.lv['era'])}
        summ['refusal_ppc']['fame_by_family'] = {f: q(pq['q_b_fame'] + pq['q_BF'][:, i]) for i, f in enumerate(ixq.lv['fam'])}
        summ['refusal_ppc']['dense_by_family'] = {f: q(pq['q_b_dense'] + pq['q_BD'][:, i]) for i, f in enumerate(ixq.lv['fam'])}
        summ['gate_insample_cell'] = gate_predictions(df, ixa, pa, ixq, pq, 1, holdout=False)
        json.dump(summ, open(a.summary, 'w'), indent=1)
    if a.only in ('all', 'numbers', 'numbers-report'):
        if a.only == 'numbers-report':  # re-report a saved fit
            lv, pn, dn = pickle.load(open(os.path.join(a.out_dir, 'numbers.pkl'), 'rb'))
            s = df[df.scored & df.num_ref.fillna(0).gt(0)].reset_index(drop=True)
        else:
            lv, s, pn, dn = fit_numbers(df)
            print('numbers', round(time.time() - t0), 's', dn, flush=True)
            pickle.dump((lv, pn, dn), open(os.path.join(a.out_dir, 'numbers.pkl'), 'wb'))
        sp = stratum_pages(df, lv)
        rows = []
        for eng in lv['eng']:
            for st in lv['strat']:
                g = s[(s.engine == eng) & (s.stratum == st)]
                r = dict(engine=eng, stratum=st, pages_read=len(g), numbers_printed_on_pages_read=int(g.num_ref.sum()),
                         pages_in_stratum=len(sp[st][0]), numbers_in_stratum=int(sp[st][1].sum()))
                for o in NUM:
                    r[o] = dict(observed=f"{int(g[f'num_{o}'].sum())}/{int(g.num_ref.sum())}",
                                fitted_per_number=q(number_rate(lv, pn, o, eng, st, sp)))
                r['all_errors_per_number'] = q(sum(number_rate(lv, pn, o, eng, st, sp) for o in NUM))
                r['observed_all_per_number'] = round(float(sum(g[f'num_{o}'].sum() for o in NUM) / max(g.num_ref.sum(), 1)), 4)
                rows.append(r)
        summ['numbers'] = dict(diagnostics=dn, pages=int(s.page.nunique()), rows=len(s), cells=rows,
                               note='rates per number printed over ALL the stratum\'s number-bearing pages (number-'
                                    'weighted, page effects shared by engines), so an engine is also predicted on the '
                                    'pages it did not read; observed counts are on the pages it read')
        json.dump(summ, open(a.summary, 'w'), indent=1)
    if a.only == 'report':  # recompute the gate checks from saved fits
        f = pickle.load(open(os.path.join(a.out_dir, 'full.pkl'), 'rb'))
        summ['gate_insample_cell'] = gate_predictions(df, *f['acc'][:2], *f['ref'][:2], 1, holdout=False)
        h = pickle.load(open(os.path.join(a.out_dir, 'holdout.pkl'), 'rb'))
        cells = gate_predictions(df, *h['acc'][:2], *h['ref'][:2], 1, holdout=True)
        summ.setdefault('holdout_4763', {}).update(cells=cells, fail_covered=f"{sum(c['fail_covered'] for c in cells)}/{len(cells)}",
                                    cer_covered=f"{sum(c.get('cer_covered', False) for c in cells)}/{sum('cer_covered' in c for c in cells)}")
        json.dump(summ, open(a.summary, 'w'), indent=1)
    if a.only in ('all', 'holdout'):
        train = df[df.source != 'gate-4763'].reset_index(drop=True)
        ixa, pa, da = fit_accuracy(train, hurdle=True, steps=a.steps)
        ixq, pq, dq = fit_refusal(train, steps=a.steps)
        print('holdout fits', round(time.time() - t0), 's', flush=True)
        pickle.dump(dict(acc=(ixa, pa, da), ref=(ixq, pq, dq)), open(os.path.join(a.out_dir, 'holdout.pkl'), 'wb'))
        cells = gate_predictions(df, ixa, pa, ixq, pq, 1, holdout=True)
        summ['holdout_4763'] = dict(diagnostics=dict(accuracy=da, refusal=dq), train_rows=len(train), cells=cells,
                                    fail_covered=f"{sum(c['fail_covered'] for c in cells)}/{len(cells)}",
                                    cer_covered=f"{sum(c.get('cer_covered', False) for c in cells)}/{sum('cer_covered' in c for c in cells)}")
        json.dump(summ, open(a.summary, 'w'), indent=1)
    print('done', round(time.time() - t0), 's')


if __name__ == '__main__':
    sys.exit(main())
