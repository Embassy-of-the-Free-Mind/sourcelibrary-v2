#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/fit_ocr_v1.py + model_ocr_v1.py (v1's accuracy-with-hurdle and did-not-read
# models, fitted by SVI AutoNormal only: "SVI intervals run narrow", NUTS left undone because v0's NUTS took 5.9 h on 3
# cores). This fits the SAME models on the SAME rows both ways and reports the interval widths side by side (#6740,
# Derek's 2026-10-25 note B). No model calls; CPU only.
"""v1's accuracy and did-not-read models, SVI against NUTS on one table (#6740).

  nuts_v1.py fit --table T [--extra results/arabic-rows.jsonl --ext] --part acc-svi|acc-nuts|ref-svi|ref-nuts --out-dir D
      [--warmup 500 --samples 500]
  (--ext --extra: v1 as #7341 left it, script-family extension and the Arabic rows; build on it, not a second v1)
  nuts_v1.py report --table T --out-dir D --out results/ocr-v1-nuts-vs-svi.json

Each part pickles (ix, post, diag) to D/<part>.pkl, so the four can run on separate cores. The report gives, per
chart x engine cell with >= 5 pages: E[CER] among reads and P(did not read) for a new page of the cell, 90% interval
under each inference, and the NUTS/SVI width ratio (above 1 = SVI was overconfident there).
"""
import argparse, json, os, pickle, sys, time
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_ocr_v1 as m  # noqa: E402
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
from numpyro.infer import MCMC, NUTS, Predictive  # noqa: E402
from numpyro.diagnostics import summary  # noqa: E402

q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]


def nuts_fit(model, seed, warmup, samples, chains, **kw):
    mc = MCMC(NUTS(model, target_accept_prob=0.9), num_warmup=warmup, num_samples=samples, num_chains=chains,
              chain_method='parallel', progress_bar=bool(os.environ.get('NUTS_PROGRESS')))
    t0 = time.time()
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',), **kw)
    by = mc.get_samples(group_by_chain=True)
    per = {k: float(np.nanmax(np.atleast_1d(summary({k: np.asarray(v)}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items()}
    rh = max(per.values())
    worst = dict(sorted(per.items(), key=lambda kv: -kv[1])[:6])
    lat = mc.get_samples()
    det = Predictive(model, posterior_samples=lat)(jax.random.PRNGKey(seed + 2), **kw)
    post = {k: np.asarray(v) for k, v in {**lat, **det}.items() if k not in ('y', 'z', 'fail')}
    diag = dict(method='NUTS', chains=chains, warmup=warmup, draws_per_chain=samples, max_rhat=round(rh, 3),
                divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()), seconds=round(time.time() - t0),
                worst_rhat={k: round(v, 3) for k, v in worst.items()})
    return post, diag


def fit(a):
    df = m.load(a.table, extra=a.extra)
    kind, how = a.part.split('-')
    t0 = time.time()
    if kind == 'acc':
        s = df[df.scored].reset_index(drop=True)
        ix = m.Index(s, a.ext)
        kw = dict(ix=ix, x=ix.enc(s), n=jnp.array(s.n.values), k=jnp.array(s.k.values), z=jnp.array(s.z.values), hurdle=True)
        model = m.accuracy_model
    else:
        ix = m.Index(df, a.ext)
        kw = dict(ix=ix, x=ix.enc(df), fail=jnp.array(df.fail.values))
        model = m.refusal_model
    if how == 'svi':
        post, diag = m.svi_fit(model, 0, a.steps, **kw)
        diag['seconds'] = round(time.time() - t0)
    else:
        post, diag = nuts_fit(model, 0, a.warmup, a.samples, a.chains, **kw)
    pickle.dump((ix, post, diag), open(os.path.join(a.out_dir, f'{a.part}.pkl'), 'wb'))
    print(a.part, diag, flush=True)


def report(a):
    df = m.load(a.table, extra=a.extra)
    L = {p: pickle.load(open(os.path.join(a.out_dir, f'{p}.pkl'), 'rb')) for p in ('acc-svi', 'acc-nuts', 'ref-svi', 'ref-nuts')
         if os.path.exists(os.path.join(a.out_dir, f'{p}.pkl'))}
    fam = dict(df[['engine', 'engine_family']].drop_duplicates().itertuples(index=False))
    cells = []
    for (chart, eng), g in df.groupby(['chart', 'engine']):
        if g.page.nunique() < 5:
            continue
        mode = lambda s: s.value_counts().index[0]
        cell = dict(engine=eng, family=fam[eng], chart=chart, era=mode(g.era), dense=int(chart.endswith('-dense')),
                    web=int(round(g.fame_web.mean())))
        if a.ext:
            cell['kind'] = mode(g.kind)
        row = dict(chart=chart, engine=eng, pages=int(g.page.nunique()), observed_cer=round(float(g[g.scored].cer.mean()), 4)
                   if g.scored.any() else None, observed_fail=f"{int(g.fail.sum())}/{len(g)}")
        for kind, fn, extra in (('cer', m.cell_cer, dict(panel=mode(g.panel))), ('fail', m.cell_fail, dict(panel=None))):
            for how in ('svi', 'nuts'):
                key = f"{'acc' if kind == 'cer' else 'ref'}-{how}"
                if key not in L:
                    continue
                ix, post, _ = L[key]
                d = fn(post, ix, rng=np.random.default_rng(1), **cell, **extra)
                row[f'{kind}_{how}'] = q(d)
            if f'{kind}_svi' in row and f'{kind}_nuts' in row:
                ws, wn = row[f'{kind}_svi'][2] - row[f'{kind}_svi'][0], row[f'{kind}_nuts'][2] - row[f'{kind}_nuts'][0]
                row[f'{kind}_width_ratio'] = round(wn / ws, 2) if ws > 0 else None
        cells.append(row)
    rat = lambda k: [c[k] for c in cells if c.get(k)]
    res = dict(table=dict(rows=len(df), gate_rows=int((df.source == 'gate-4763').sum()),
                          gate_engines=sorted(df[df.source == 'gate-4763'].engine.unique())),
               diagnostics={k: v[2] for k, v in L.items()},
               width_ratio_nuts_over_svi=dict(cer=dict(median=float(np.median(rat('cer_width_ratio'))), p10_p90=[float(x) for x in np.percentile(rat('cer_width_ratio'), [10, 90])], cells=len(rat('cer_width_ratio'))) if rat('cer_width_ratio') else None,
                                              fail=dict(median=float(np.median(rat('fail_width_ratio'))), p10_p90=[float(x) for x in np.percentile(rat('fail_width_ratio'), [10, 90])], cells=len(rat('fail_width_ratio'))) if rat('fail_width_ratio') else None),
               cells=cells)
    json.dump(res, open(a.out, 'w'), indent=1)
    print(json.dumps({k: res[k] for k in ('table', 'diagnostics', 'width_ratio_nuts_over_svi')}, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['fit', 'report'])
    ap.add_argument('--table', required=True)
    ap.add_argument('--part')
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--out')
    ap.add_argument('--steps', type=int, default=15000)
    ap.add_argument('--warmup', type=int, default=500)
    ap.add_argument('--samples', type=int, default=500)
    ap.add_argument('--chains', type=int, default=4)
    ap.add_argument('--extra', help='extra rows in the table format, e.g. results/arabic-rows.jsonl (#7341)')
    ap.add_argument('--ext', action='store_true', help="model_ocr_v1's script-family extension (#7341): v1 as it now stands")
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)
    (fit if a.cmd == 'fit' else report)(a)


if __name__ == '__main__':
    sys.exit(main())
