#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/failures_v0.py (a hierarchical binomial of made-worse rates per route string x
# script, judges read through their catch rates; no draft engine, no page kind, no pages made better, so a corrector
# that helps on average and one that does nothing look the same) and planner_v0.py's correction block (a beta matched
# to failures_v0's intervals, two cells). Estimator v2 (#6740) makes correction a stage of a chained route, so a cell
# is draft engine x corrector x language x page kind and both outcomes are modelled. Same evidence file, same row format.
"""Estimator v2, correction stage: pages made worse and pages made better per chained-route cell (#6740).

  chain_v2.py fit   --obs scripts/eval/estimator/ocr/failure-observations.jsonl --out-draws $S/chain-v2.npz \
                    --out results/chain-v2-fit.json
  chain_v2.py loeo  --obs ... --out results/chain-v2-loeo.json        held-out check: leave one experiment out
  chain_v2.py sim   --obs ... --draws $S/chain-v2.npz --out results/chain-v2-sim.json   recover known effects

A cell is (draft engine, corrector, language, page kind). corrector 'redo:<engine>' re-reads the page and replaces the
draft; 'none' is the draft as served. Rates (rows of failure-observations.jsonl that carry a `corrector`):
  made_worse   the corrected page is worse than the draft it replaced
  made_better  the corrected page is better than the draft
  misleading   the served text misleads a reader on the page (#5924 reader rule; only Latin print measures it)

  logit p[r, cell] = mu[r] + corrector[r] + language[r] + kind[r] + draft[r] + cell[r]          (latent: what a
                     blind cross-family judge with the image would report)
  corrector[r, c]  ~ N(family[r, fam(c)], tau_corr[r])     families: claude, agy, lite (Batch), redo-claude, redo-agy
  language, kind, draft, cell ~ N(0, tau_*[r])
  observed rate    = sigmoid(logit p + instrument[r, i] + same_family[r] x 1{judge family = corrector family})
  instrument i     blind-judge (0, the reference), mechanical (score against a reference text), leaf-audit-tiles,
                   leaf-audit-frame (Opus span audit against the leaf, #6560 gate), by-eye
A mixed-language count (pages better over six languages, #6694) is a mixture over its cells, weighted by its pages.

Pages of one book move together. A count over n pages from b books enters with design effect 1 + (m - 1) rho,
m = n / b, rho = RHO: n_eff = n / deff and k_eff = k n_eff / n (a binomial likelihood in k_eff, continuous).
"""
import argparse, collections, json, os, sys
import numpy as np

import numpyro
numpyro.set_host_device_count(4)
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
from jax.scipy.special import gammaln  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402
from numpyro.diagnostics import summary  # noqa: E402

RATES = ['made_worse', 'made_better', 'misleading']
INSTR = ['blind-judge', 'mechanical', 'leaf-audit-tiles', 'leaf-audit-frame', 'by-eye']
RHO = 0.1
FAMILY = lambda c: ('redo-' if c.startswith('redo:') else '') + (
    'none' if c == 'none' else 'claude' if any(x in c for x in ('opus', 'sonnet', 'haiku')) else
    'lite' if 'flash-lite' in c else 'agy')
JUDGE_FAMILY = {'opus': 'claude', 'gemini-3.8-flash-high': 'agy', 'gemini-3.8-flash-low': 'agy', 'gemini-3.1-pro': 'agy'}
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]


def load(path, drop_experiment=None):
    rows = [json.loads(l) for l in open(path) if not l.startswith('{"_doc"')]
    rows = [r for r in rows if r.get('corrector') and r['rate'] in RATES]
    if drop_experiment:
        rows = [r for r in rows if r['experiment'] != drop_experiment]
    return rows


def effective(r):
    n, k, b = float(r['n']), float(r['k']), r.get('books') or r['n']
    m = n / max(float(b), 1.0)
    deff = 1 + (m - 1) * RHO
    return k / deff, n / deff


class Index:
    """Integer codes for every level the rows (and any extra routing cells) use."""

    def __init__(self, rows, extra_cells=()):
        cells = set(extra_cells)
        for r in rows:
            for lang in (r['mix'] if r.get('mix') else [r['language']]):
                cells.add((r['draft'], r['corrector'], lang, r['kind']))
        self.cells = sorted(cells)
        lv = lambda i: sorted({c[i] for c in self.cells})
        self.drafts, self.corrs, self.langs, self.kinds = lv(0), lv(1), lv(2), lv(3)
        self.fams = sorted({FAMILY(c) for c in self.corrs})
        self.ci = {c: i for i, c in enumerate(self.cells)}
        self.cell_d = np.array([self.drafts.index(c[0]) for c in self.cells])
        self.cell_c = np.array([self.corrs.index(c[1]) for c in self.cells])
        self.cell_l = np.array([self.langs.index(c[2]) for c in self.cells])
        self.cell_k = np.array([self.kinds.index(c[3]) for c in self.cells])
        self.corr_f = np.array([self.fams.index(FAMILY(c)) for c in self.corrs])


def design(rows, ix):
    """Per row: rate, instrument, same-family flag, effective k/n, and a (rows x cells) mixture weight matrix."""
    W = np.zeros((len(rows), len(ix.cells)))
    for j, r in enumerate(rows):
        mix = r.get('mix') or {r['language']: 1.0}
        for lang, w in mix.items():
            W[j, ix.ci[(r['draft'], r['corrector'], lang, r['kind'])]] = w
    W /= W.sum(1, keepdims=True)
    ke, ne = zip(*[effective(r) for r in rows])
    same = [float(r['instrument'] in ('blind-judge', 'leaf-audit-tiles', 'leaf-audit-frame')
                  and JUDGE_FAMILY.get(r['judge']) == FAMILY(r['corrector']).replace('redo-', '')) for r in rows]
    return dict(R=np.array([RATES.index(r['rate']) for r in rows]), I=np.array([INSTR.index(r['instrument']) for r in rows]),
                S=np.array(same), K=np.array(ke), N=np.array(ne), W=W)


def model(ix, d):
    nR = len(RATES)
    mu = numpyro.sample('mu', dist.Normal(jnp.array([-2.5, 0.0, -1.0]), 1.5))
    fam = numpyro.sample('fam', dist.Normal(0, 1.5).expand([nR, len(ix.fams)]))
    t_c = numpyro.sample('tau_corr', dist.HalfNormal(1.0).expand([nR]))
    t_l = numpyro.sample('tau_lang', dist.HalfNormal(0.7).expand([nR]))
    t_k = numpyro.sample('tau_kind', dist.HalfNormal(0.7).expand([nR]))
    t_d = numpyro.sample('tau_draft', dist.HalfNormal(0.7).expand([nR]))
    t_e = numpyro.sample('tau_cell', dist.HalfNormal(0.5).expand([nR]))
    z_c = numpyro.sample('z_corr', dist.Normal(0, 1).expand([nR, len(ix.corrs)]))
    z_l = numpyro.sample('z_lang', dist.Normal(0, 1).expand([nR, len(ix.langs)]))
    z_k = numpyro.sample('z_kind', dist.Normal(0, 1).expand([nR, len(ix.kinds)]))
    z_d = numpyro.sample('z_draft', dist.Normal(0, 1).expand([nR, len(ix.drafts)]))
    z_e = numpyro.sample('z_cell', dist.Normal(0, 1).expand([nR, len(ix.cells)]))
    inst = numpyro.sample('inst', dist.Normal(0, 1.0).expand([nR, len(INSTR) - 1]))
    same = numpyro.sample('same_family', dist.Normal(0, 1.0).expand([nR]))
    corr = fam[:, ix.corr_f] + t_c[:, None] * z_c
    eta = (mu[:, None] + corr[:, ix.cell_c] + (t_l[:, None] * z_l)[:, ix.cell_l] + (t_k[:, None] * z_k)[:, ix.cell_k]
           + (t_d[:, None] * z_d)[:, ix.cell_d] + t_e[:, None] * z_e)
    numpyro.deterministic('eta', eta)
    inst0 = jnp.concatenate([jnp.zeros((nR, 1)), inst], 1)
    off = inst0[d['R'], d['I']] + same[d['R']] * d['S']
    p = (jax.nn.sigmoid(eta[d['R']] + off[:, None]) * d['W']).sum(1)
    p = jnp.clip(p, 1e-9, 1 - 1e-9)
    K, N = d['K'], d['N']
    ll = gammaln(N + 1) - gammaln(K + 1) - gammaln(N - K + 1) + K * jnp.log(p) + (N - K) * jnp.log1p(-p)
    numpyro.factor('obs', ll.sum())


def fit(rows, ix, samples=1000, chains=4, seed=6740, warmup=1000):
    d = {k: jnp.array(v) for k, v in design(rows, ix).items()}
    mc = MCMC(NUTS(lambda: model(ix, d), target_accept_prob=0.95), num_warmup=warmup, num_samples=samples,
              num_chains=chains, chain_method='parallel', progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',))
    by = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items()}
    rh = {k: float(np.nanmax(np.atleast_1d(summary({k: v}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items()
          if k != 'eta'}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by.items()}
    return post, dict(divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()),
                      max_rhat=round(max(rh.values()), 3), chains=chains, draws_per_chain=samples)


def inst_offsets(post):
    S = post['mu'].shape[0]
    return np.concatenate([np.zeros((S, len(RATES), 1)), post['inst']], 2)


def predict_rows(post, ix, rows, rng):
    """Posterior predictive k_eff per row, for rows whose cells may be new to the fit (new cells: their cell effect
    is drawn from N(0, tau_cell); a new corrector, language, kind or draft level from its own population)."""
    S = post['mu'].shape[0]
    d = design(rows, ix)
    eta = np.asarray(post['eta'])
    off = inst_offsets(post)[:, d['R'], d['I']] + post['same_family'][:, d['R']] * d['S'][None, :]
    p = (1 / (1 + np.exp(-(eta[:, d['R'], :] + off[:, :, None]))) * d['W'][None]).sum(2)
    k = rng.binomial(np.maximum(np.round(d['N']).astype(int), 1)[None, :], p)
    return p, k, d


def extend(post, ix_fit, ix_all, rng):
    """Map a posterior fitted on ix_fit onto ix_all's cells (levels unseen in the fit drawn from their population)."""
    S = post['mu'].shape[0]
    nR = len(RATES)

    def level(z, names_fit, names_all, tau):
        out = np.empty((S, nR, len(names_all)))
        for j, n in enumerate(names_all):
            out[:, :, j] = (z[:, :, names_fit.index(n)] if n in names_fit else rng.normal(0, 1, (S, nR))) * tau
        return out
    fam = np.empty((S, nR, len(ix_all.fams)))
    for j, f in enumerate(ix_all.fams):
        fam[:, :, j] = post['fam'][:, :, ix_fit.fams.index(f)] if f in ix_fit.fams else rng.normal(0, 1.5, (S, nR))
    corr = np.empty((S, nR, len(ix_all.corrs)))
    for j, c in enumerate(ix_all.corrs):
        z = post['z_corr'][:, :, ix_fit.corrs.index(c)] if c in ix_fit.corrs else rng.normal(0, 1, (S, nR))
        corr[:, :, j] = fam[:, :, ix_all.fams.index(FAMILY(c))] + post['tau_corr'] * z
    L = level(post['z_lang'], ix_fit.langs, ix_all.langs, post['tau_lang'])
    K = level(post['z_kind'], ix_fit.kinds, ix_all.kinds, post['tau_kind'])
    D = level(post['z_draft'], ix_fit.drafts, ix_all.drafts, post['tau_draft'])
    E = np.empty((S, nR, len(ix_all.cells)))
    for j, c in enumerate(ix_all.cells):
        z = post['z_cell'][:, :, ix_fit.ci[c]] if c in ix_fit.ci else rng.normal(0, 1, (S, nR))
        E[:, :, j] = post['tau_cell'] * z
    eta = (post['mu'][:, :, None] + corr[:, :, ix_all.cell_c] + L[:, :, ix_all.cell_l] + K[:, :, ix_all.cell_k]
           + D[:, :, ix_all.cell_d] + E)
    out = dict(post)
    out['eta'] = eta
    return out


def cmd_fit(a):
    rows = load(a.obs)
    ix = Index(rows)
    post, diag = fit(rows, ix, a.samples, a.chains)
    np.savez_compressed(a.out_draws, cells=np.array(['|'.join(c) for c in ix.cells]), **{k: np.asarray(v) for k, v in post.items()})
    io = inst_offsets(post)
    res = dict(diagnostics=diag, rho=RHO, rows=len(rows), cells=len(ix.cells),
               instrument={r: {i: q(io[:, ri, ii]) for ii, i in enumerate(INSTR)} for ri, r in enumerate(RATES)},
               same_family={r: q(post['same_family'][:, ri]) for ri, r in enumerate(RATES)},
               corrector_family={r: {f: q(post['fam'][:, ri, fi]) for fi, f in enumerate(ix.fams)} for ri, r in enumerate(RATES)},
               taus={k: {r: q(post[k][:, ri]) for ri, r in enumerate(RATES)} for k in
                     ('tau_corr', 'tau_lang', 'tau_kind', 'tau_draft', 'tau_cell')},
               cell_rates=[dict(cell=dict(zip(('draft', 'corrector', 'language', 'kind'), c)),
                                **{r: q(1 / (1 + np.exp(-post['eta'][:, ri, j]))) for ri, r in enumerate(RATES)})
                           for j, c in enumerate(ix.cells)])
    # in-sample posterior predictive: every row's observed k_eff inside its 90% predictive interval?
    rng = np.random.default_rng(1)
    p, k, d = predict_rows(post, ix, rows, rng)
    lo, hi = np.percentile(k, [5, 95], 0)
    inside = (d['K'] >= lo - 0.5) & (d['K'] <= hi + 0.5)
    res['ppc_in_sample'] = dict(rows=len(rows), inside_90=int(inside.sum()),
                                misses=[dict(source=r['source'], rate=r['rate'], corrector=r['corrector'], judge=r['judge'],
                                             instrument=r['instrument'], k=r['k'], n=r['n'], k_eff=round(float(d['K'][j]), 1),
                                             pred_90=[float(lo[j]), float(hi[j])]) for j, r in enumerate(rows) if not inside[j]])
    json.dump(res, open(a.out, 'w'), indent=1)
    print(json.dumps(diag), f"in-sample 90% PPC: {inside.sum()}/{len(rows)}")


def cmd_loeo(a):
    rows = load(a.obs)
    ix_all = Index(rows)
    exps = sorted({r['experiment'] for r in rows})
    out, rng = [], np.random.default_rng(2)
    for e in exps:
        tr = [r for r in rows if r['experiment'] != e]
        te = [r for r in rows if r['experiment'] == e]
        ix = Index(tr)
        post, diag = fit(tr, ix, a.samples, a.chains, warmup=a.samples)
        post_all = extend(post, ix, ix_all, rng)
        p, k, d = predict_rows(post_all, ix_all, te, rng)
        lo, hi = np.percentile(k, [5, 95], 0)
        med = np.median(k, 0)
        # baseline: the pooled observed rate of that outcome in the training rows (what "assume the average" predicts)
        base = {r: sum(effective(x)[0] for x in tr if x['rate'] == r) / max(sum(effective(x)[1] for x in tr if x['rate'] == r), 1e-9)
                for r in RATES}
        for j, r in enumerate(te):
            kk, nn = d['K'][j], d['N'][j]
            # log predictive density of the observed k_eff (binomial, continuous k), model vs baseline
            from scipy.special import gammaln as gl
            lp = lambda pp: gl(nn + 1) - gl(kk + 1) - gl(nn - kk + 1) + kk * np.log(np.clip(pp, 1e-9, 1)) + (nn - kk) * np.log(np.clip(1 - pp, 1e-9, 1))
            lpd = float(np.log(np.mean(np.exp(lp(p[:, j])))))
            out.append(dict(experiment=os.path.basename(e), source=r['source'], rate=r['rate'], corrector=r['corrector'],
                            draft=r['draft'], language=r['language'], kind=r['kind'], instrument=r['instrument'],
                            judge=r['judge'], k=r['k'], n=r['n'], k_eff=round(float(kk), 2), n_eff=round(float(nn), 1),
                            pred_median=float(med[j]), pred_90=[float(lo[j]), float(hi[j])],
                            observed_rate=round(r['k'] / r['n'], 3), pred_rate=q(p[:, j]),
                            inside_90=bool(lo[j] - 0.5 <= kk <= hi[j] + 0.5), lpd_model=round(lpd, 3),
                            lpd_baseline=round(float(lp(base[r['rate']])), 3), fit=diag))
        print(os.path.basename(e), diag, sum(o['inside_90'] for o in out if o['experiment'] == os.path.basename(e)), '/', len(te), flush=True)
    summ = dict(rows=len(out), inside_90=sum(o['inside_90'] for o in out),
                lpd_model=round(sum(o['lpd_model'] for o in out), 2), lpd_baseline=round(sum(o['lpd_baseline'] for o in out), 2),
                by_experiment={e: dict(rows=sum(1 for o in out if o['experiment'] == e),
                                       inside_90=sum(o['inside_90'] for o in out if o['experiment'] == e),
                                       lpd_model=round(sum(o['lpd_model'] for o in out if o['experiment'] == e), 2),
                                       lpd_baseline=round(sum(o['lpd_baseline'] for o in out if o['experiment'] == e), 2))
                               for e in sorted({o['experiment'] for o in out})})
    json.dump(dict(summary=summ, rows=out), open(a.out, 'w'), indent=1)
    print(json.dumps(summ, indent=1))


def cmd_sim(a):
    """Simulate counts from KNOWN effects (the full fit's posterior medians) at the evidence's own design, refit, and
    check the 90% intervals cover the known cell rates and instrument offsets."""
    rows = load(a.obs)
    ix = Index(rows)
    full = dict(np.load(a.draws))
    truth = {k: np.median(v, 0) for k, v in full.items() if k != 'cells'}
    d = design(rows, ix)
    eta_t = truth['eta']
    io_t = np.concatenate([np.zeros((len(RATES), 1)), truth['inst']], 1)
    off = io_t[d['R'], d['I']] + truth['same_family'][d['R']] * d['S']
    p_t = ((1 / (1 + np.exp(-(eta_t[d['R']] + off[:, None])))) * d['W']).sum(1)
    used = sorted({int(c) for c in np.nonzero(d['W'].sum(0))[0]})
    rng = np.random.default_rng(3)
    reps = []
    for rep in range(a.reps):
        n_int = np.maximum(np.round(d['N']).astype(int), 1)
        k_sim = rng.binomial(n_int, p_t)
        sim_rows = [dict(r, k=int(k_sim[j]), n=int(n_int[j]), books=int(n_int[j])) for j, r in enumerate(rows)]
        post, diag = fit(sim_rows, ix, a.samples, a.chains, seed=100 + rep, warmup=a.samples)
        cov, err = [], []
        for ri in range(len(RATES)):
            for c in used:
                if not (d['W'][d['R'] == ri][:, c] > 0).any():
                    continue
                draws = post['eta'][:, ri, c]
                lo, hi = np.percentile(draws, [5, 95])
                cov.append(lo <= eta_t[ri, c] <= hi)
                err.append(float(np.median(1 / (1 + np.exp(-draws))) - 1 / (1 + np.exp(-eta_t[ri, c]))))
        io = inst_offsets(post)
        icov = {f'{RATES[ri]}:{INSTR[ii]}': bool(np.percentile(io[:, ri, ii], 5) <= io_t[ri, ii] <= np.percentile(io[:, ri, ii], 95))
                for ri in range(2) for ii in range(1, len(INSTR)) if (d['I'][d['R'] == ri] == ii).any()}
        reps.append(dict(rep=rep, fit=diag, cell_coverage_90=round(float(np.mean(cov)), 3), cells=len(cov),
                         median_abs_rate_error=round(float(np.median(np.abs(err))), 4), instrument_covered=icov))
        print(reps[-1], flush=True)
    io_t_out = {f'{RATES[ri]}:{INSTR[ii]}': round(float(io_t[ri, ii]), 3) for ri in range(2) for ii in range(len(INSTR))}
    json.dump(dict(known_instrument_offsets=io_t_out, reps=reps,
                   mean_cell_coverage_90=round(float(np.mean([r['cell_coverage_90'] for r in reps])), 3),
                   instrument_coverage={k: sum(r['instrument_covered'].get(k, False) for r in reps) for k in reps[0]['instrument_covered']}),
              open(a.out, 'w'), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['fit', 'loeo', 'sim'])
    ap.add_argument('--obs', default='scripts/eval/estimator/ocr/failure-observations.jsonl')
    ap.add_argument('--out', required=True)
    ap.add_argument('--out-draws')
    ap.add_argument('--draws')
    ap.add_argument('--samples', type=int, default=1000)
    ap.add_argument('--chains', type=int, default=4)
    ap.add_argument('--reps', type=int, default=8)
    a = ap.parse_args()
    {'fit': cmd_fit, 'loeo': cmd_loeo, 'sim': cmd_sim}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
