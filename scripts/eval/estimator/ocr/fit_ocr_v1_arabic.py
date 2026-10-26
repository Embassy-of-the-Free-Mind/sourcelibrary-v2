#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/fit_ocr_v1.py — v1's driver (hurdle PPC, did-not-read PPC, the #4763 holdout,
# the numbers fit). Its checks are reused from it; this driver adds the Arabic rows, fits with the script-family
# extension (model_ocr_v1 `ext`), and runs the two leave-one-source-out predictions of the #7341 gate (#7341, #6740).
"""OCR estimator v1 with the Arabic charts: refit, posterior predictive checks, leave-one-source-out (#7341).

  fit_ocr_v1_arabic.py --table $S/ocr-table-v1.jsonl --arabic results/arabic-rows.jsonl --out-dir $S/fit-ar \
      --summary results/ocr-v1-arabic-fit.json --only full|holdout-gate|holdout-arabic|expert-keys|report

Fits (each = accuracy with hurdle + did-not-read, SVI as v1, 15,000 steps, 400 draws):
  full            v1's table + every Arabic row
  holdout-gate    everything but the #7341 gate rows: what the pooled model said BEFORE the gate
  holdout-arabic  no Arabic row at all: what borrowing alone (script group, manuscript/print, engine terms) says
  expert-keys     accuracy only, Arabic rows restricted to expert references (RASAM): the key-type sensitivity
Report:
  ppc             v1's level-bias statistic over every chart x engine cell (did adding Arabic break the others?)
                  and observed beside fitted for each Arabic source x engine
  gate            per gate cell (chart x engine): predicted did-not-read count and CER among reads, under the gate's
                  own key (model key, the observed share of self-keyed reads), from each fit, beside the observed
  posterior       per Arabic cell x engine: E[CER] for an expert key, P(not read), new page of the cell
"""
import argparse, json, os, pickle, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_ocr_v1 import load, fit_accuracy, fit_refusal, row_eta, cell_cer, cell_fail  # noqa: E402
from fit_ocr_v1 import accuracy_ppc  # noqa: E402

q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
sig = lambda x: 1 / (1 + np.exp(-x))
ENGINES = [('gemini-3.1-flash-lite', 'gemini-lite'), ('gemini-3.8-flash+antigravity-cli', 'gemini-cli'),
           ('gemini-3.8-flash-high+antigravity-cli', 'gemini-cli'), ('gemini-3.1-pro+antigravity-cli', 'gemini-cli'),
           ('claude-opus-5-5', 'claude'), ('gemini-3-flash-preview', 'gemini-flash')]
ARABIC = ('gate-7341', 'kraus-7341', '6544-setA', '6544-setB', 'reocr-5700')  # kraus-7341: the 25-page follow-up


def arabic_ppc(df, ixa, pa, ixq, pq):
    s = df[df.scored].reset_index(drop=True)
    mu, h = sig(row_eta(pa, 'mu_', ixa, s)), sig(row_eta(pa, 'h_', ixa, s))
    s['fitted'] = (h + (1 - h) * mu).mean(0)
    d = df.copy()
    d['fitted_fail'] = sig(row_eta(pq, 'q_', ixq, d, refusal=True)).mean(0)
    out = []
    for (src, eng), g in d[d.source.isin(ARABIC)].groupby(['source', 'engine']):
        sc = s[(s.source == src) & (s.engine == eng)]
        out.append(dict(source=src, engine=eng, pages=len(g), observed_fail=f'{int(g.fail.sum())}/{len(g)}',
                        fitted_fail=round(float(g.fitted_fail.mean()), 3),
                        observed_cer=round(float(sc.cer.mean()), 4) if len(sc) else None,
                        fitted_cer=round(float(sc.fitted.mean()), 4) if len(sc) else None))
    return out


def predict_cell(pa, ixa, pq, ixq, engine, family, chart, kind, panel, alchemy, key_type='reference', key_self=0.0,
                 seed=7341):
    era = 'unknown'
    cell = dict(engine=engine, family=family, chart=chart, era=era, dense=0, web=0, kind=kind)
    cer = lambda ks: cell_cer(pa, ixa, rng=np.random.default_rng(seed), panel=panel, key_type=key_type, key_self=ks,
                              **cell)
    c = key_self * cer(1) + (1 - key_self) * cer(0) if 0 < key_self < 1 else cer(int(key_self))
    f = cell_fail(pq, ixq, rng=np.random.default_rng(seed + 1), panel=None, alchemy=alchemy, **cell)
    return c, f


def gate_check(df, pa, ixa, pq, ixq, label):
    """The gate's cells predicted as NEW pages and works (the gate's books are new to a holdout fit; in the full fit
    the cell value is still for a new page, so it is the router's quantity, not an in-sample fit)."""
    gate = df[df.source == 'gate-7341']
    panel = 'jabir-7341' if 'jabir-7341' in ixa.i('panel') else None  # a holdout fit never saw the gate's panel
    out = []
    for chart, kind in (('arabic-manuscript', 'manuscript'), ('arabic-print', 'print')):
        for eng, fam in ENGINES[:2] + ENGINES[4:5]:
            g = gate[(gate.chart == chart) & (gate.engine == eng)]
            if not len(g):
                continue
            sc = g[g.scored]
            ks = float(sc.key_self.mean()) if len(sc) else 0.0
            row = dict(fit=label, chart=chart, engine=eng, pages=len(g), observed_fail=f'{int(g.fail.sum())}/{len(g)}',
                       observed_cer=round(float(sc.cer.mean()), 4) if len(sc) else None, key_self_share=round(ks, 2))
            rng = np.random.default_rng(1)
            for alch in (0, 1):
                c, f = predict_cell(pa, ixa, pq, ixq, eng, fam, chart, kind, panel, alch, 'model', ks)
                kf = rng.binomial(len(g), np.clip(f, 0, 1))
                row[f'alchemy{alch}'] = dict(pred_fail=q(f), pred_fail_count=q(kf),
                                             fail_covered=bool(np.percentile(kf, 5) <= g.fail.sum() <= np.percentile(kf, 95)))
                if alch == 0:
                    row['pred_cer_gate_key'] = q(c)
                    if len(sc):  # a level interval; the mean over these few pages also carries sampling noise
                        row['cer_covered'] = bool(np.percentile(c, 5) <= sc.cer.mean() <= np.percentile(c, 95))
            out.append(row)
    return out


def posterior(df, pa, ixa, pq, ixq, label):
    """Per Arabic cell x engine, an expert key, a read the key did not come from, a new page."""
    out = []
    cells = [('arabic-manuscript', 'manuscript', 'jabir-7341', 1, 'Jabir manuscripts (alchemy)'),
             ('arabic-manuscript', 'manuscript', None, 0, 'other Arabic-script manuscripts'),
             ('arabic-print', 'print', 'jabir-7341', 1, 'Kraus 1935 (alchemy, print)'),
             ('arabic-print', 'print', None, 0, 'other Arabic print')]
    for chart, kind, panel, alch, name in cells:
        draws = {}
        for eng, fam in ENGINES:
            if not (df.engine == eng).any():
                continue
            c, f = predict_cell(pa, ixa, pq, ixq, eng, fam, chart, kind, panel if panel in ixa.i('panel') else None, alch)
            draws[eng] = (c, f)
            out.append(dict(fit=label, cell=name, chart=chart, engine=eng, cer=q(c), p_not_read=q(f),
                            pages_read_in_chart=int(df[(df.chart == chart) & (df.engine == eng) & df.scored].page.nunique()),
                            p_lowest_cer=None))
        # P(lowest CER) among engines MEASURED in the chart (>= 5 pages, the router's floor), as route_ocr_v1 does
        meas = [e for e in draws if df[(df.chart == chart) & (df.engine == e)].page.nunique() >= 5]
        win = np.argmin(np.array([draws[e][0] for e in meas]), 0)
        for j, eng in enumerate(meas):
            next(r for r in out if r['cell'] == name and r['engine'] == eng and r['fit'] == label)['p_lowest_cer'] = \
                round(float((win == j).mean()), 3)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table', required=True)
    ap.add_argument('--arabic', required=True)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--summary', required=True)
    ap.add_argument('--steps', type=int, default=15000)
    ap.add_argument('--only', required=True)
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    df = load(a.table, extra=a.arabic)
    t0 = time.time()
    trains = {'full': df,
              'holdout-gate': df[df.source != 'gate-7341'],
              'holdout-arabic': df[~df.source.isin(ARABIC)],
              'expert-keys': df[~df.source.isin(ARABIC) | (df.key_type == 'reference')]}
    if a.only in trains:
        tr = trains[a.only].reset_index(drop=True)
        ixa, pa, da = fit_accuracy(tr, hurdle=True, steps=a.steps, ext=True)
        print(a.only, 'accuracy', round(time.time() - t0), 's', da, flush=True)
        if a.only == 'expert-keys':  # did-not-read rows carry no key: the full fit's refusal part stands
            ref = None
        else:
            ixq, pq, dq = fit_refusal(tr, steps=a.steps, ext=True)
            print(a.only, 'refusal', round(time.time() - t0), 's', dq, flush=True)
            ref = (ixq, pq, dq)
        pickle.dump(dict(acc=(ixa, pa, da), ref=ref, rows=len(tr)), open(os.path.join(a.out_dir, f'{a.only}.pkl'), 'wb'))
        return
    assert a.only == 'report'
    summ = dict(table=dict(rows=len(df), arabic_rows=int(df.source.isin(ARABIC).sum()),
                           arabic_pages=int(df[df.source.isin(ARABIC)].page.nunique()),
                           arabic_by_source={s: int((df.source == s).sum()) for s in ARABIC}))
    fits = {k: pickle.load(open(os.path.join(a.out_dir, f'{k}.pkl'), 'rb'))
            for k in trains if os.path.exists(os.path.join(a.out_dir, f'{k}.pkl'))}
    full = fits['full']
    ixa, pa, da = full['acc']
    ixq, pq, dq = full['ref']
    summ['diagnostics'] = {k: dict(rows=f['rows'], accuracy=f['acc'][2], refusal=f['ref'][2] if f['ref'] else None)
                           for k, f in fits.items()}
    ppc = accuracy_ppc(df, ixa, pa, True)
    summ['ppc'] = dict({k: v for k, v in ppc.items() if k != 'by_cell'},
                       arabic_cells=[c for c in ppc['by_cell'] if c['chart'].startswith('arabic')],
                       arabic_by_source=arabic_ppc(df, ixa, pa, ixq, pq))
    summ['terms'] = dict(
        kt={k: q(pa['mu_KT'][:, i]) for i, k in enumerate(ixa.lv['ktype'])}, b_self_mu=q(pa['mu_b_self']),
        b_self_h=q(pa['h_b_self']), group_mu={g: q(pa['mu_G'][:, i]) for i, g in enumerate(ixa.lv['grp'])},
        kind_mu={k: q(pa['mu_K'][:, i]) for i, k in enumerate(ixa.lv['kind'])},
        b_alch=q(pq['q_b_alch']), alch_by_family={f: q(pq['q_b_alch'] + pq['q_BA'][:, i]) for i, f in enumerate(ixq.lv['fam'])},
        tau=dict({k: q(pa['mu_tau_' + k]) for k in ('grp', 'kind', 'eg', 'ek', 'chart', 'ec')},
                 q_eg=q(pq['q_tau_eg']), q_ek=q(pq['q_tau_ek'])))
    summ['gate'] = []
    for k in ('holdout-arabic', 'holdout-gate', 'full'):
        if k in fits:
            f = fits[k]
            summ['gate'] += gate_check(df, *f['acc'][:2][::-1], *f['ref'][:2][::-1], k)
    summ['posterior'] = []
    for k in ('holdout-arabic', 'holdout-gate', 'full', 'expert-keys'):
        if k in fits:
            f = fits[k]
            r = f['ref'] or full['ref']
            summ['posterior'] += posterior(df, *f['acc'][:2][::-1], *r[:2][::-1], k)
    json.dump(summ, open(a.summary, 'w'), indent=1)
    print(json.dumps(summ['gate'], indent=0)[:6000])


if __name__ == '__main__':
    sys.exit(main())
