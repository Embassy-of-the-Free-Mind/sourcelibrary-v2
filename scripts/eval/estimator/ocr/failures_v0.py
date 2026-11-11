#!/usr/bin/env python3
# PRIOR ART: scripts/eval/lib/agreement-stats.mjs (kOfNBooks: Wilson intervals per source, one source at a time) and
# the per-experiment tables in each write-up. None pools the failure counts of different experiments per route, or
# reads a judge's verdict through that judge's measured catch rate. This does both (#6740).
"""OCR estimator v0, failure rates: a hierarchical binomial of the rates readers care about, per route (#6740).

Rates: not_of_leaf (wrong leaf, invented or recited text), failed_read (no usable transcription after the route's own
retries), made_worse (a write or correction judged worse than the text it replaced).

Inputs:
  failure-observations.jsonl  curated k-of-n counts with file + quote provenance (one row per committed count)
  ocr-table.jsonl             the Pareto charts' page x engine rows: failed reads per (engine, chart)

Book clustering. Pages of one book fail together (a whole Vitruvius volume served another leaf's text). A count over
n pages from b < n books enters as b effective trials with k*b/n successes: as if every page of a book shared one
outcome. That is conservative; the intervals are book-clustered in that sense. The charts' rows use works.

Judges are instruments. What a judge reports is s_j * rate + f_j * (1 - rate): s_j its catch rate on planted or
known-answer controls, f_j its false-positive rate on controls where nothing changed. Both are fitted from those
controls (judge_catch / judge_false_positive rows). A mechanical score against a reference, or a by-eye check, is
taken as exact (s = 1, f = 0). 'two-readers' (both readers had to agree) uses Opus's catch rate and no false positive.

  logit rate[cell] = mu[rate] + route[rate, route] + cell[cell]      cell = (rate, route, script)
  route ~ N(0, tau_route[rate]),  cell ~ N(0, tau_cell)

  failures_v0.py --obs failure-observations.jsonl --table ocr-table.jsonl --out results/failures-v0.json
"""
import argparse, collections, json, sys
import numpy as np
import pandas as pd

import numpyro
numpyro.set_host_device_count(3)
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
from jax.scipy.special import gammaln  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402
from numpyro.diagnostics import summary  # noqa: E402

RATES = ['not_of_leaf', 'failed_read', 'made_worse']
JUDGES = ['opus', 'gemini-3.8-flash-high', 'gemini-3.1-pro']
EXACT = {'mechanical', 'by-eye'}


def chart_failures(table):
    """failed reads per (engine, chart) from the Pareto rows, one effective trial per work."""
    df = pd.read_json(table, lines=True)
    rows = []
    for (eng, chart), g in df.groupby(['engine', 'chart']):
        pages, works = g.page.nunique(), g.work.nunique()
        k = int((~g.scored).sum())
        rows.append(dict(rate='failed_read', route=f'{eng} (benchmark read)', script=chart, judge='mechanical', k=k,
                         n=pages, books=works, unit='pages', source='Pareto charts (build-ocr-pareto.mjs)',
                         file='src/data/ocr-pareto.json via --dump-rows', note=''))
    return rows


def raw_by_judge(obs):
    """k/n summed per judge, judges listed apart: two judges reading the same pages are not twice the pages."""
    by = collections.defaultdict(lambda: [0, 0])
    for s in obs:
        by[s['judge']][0] += s['k']
        by[s['judge']][1] += s['n']
    return '; '.join(f'{j} {k}/{n}' for j, (k, n) in sorted(by.items()))


def effective(r):
    n, k, b = float(r['n']), float(r['k']), r.get('books')
    if isinstance(b, (int, float)) and 0 < b < n:
        return k * b / n, float(b)
    return k, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--obs', required=True)
    ap.add_argument('--table', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--samples', type=int, default=1000)
    a = ap.parse_args()
    obs = [json.loads(l) for l in open(a.obs) if not l.startswith('{"_doc"')]
    # per-language splits of a pooled row, and judges this model has no catch rate for, are estimator v2's (#6740)
    obs = [o for o in obs if not o.get('subset_of') and not o.get('chain_only')]
    rate_obs = [o for o in obs if o['rate'] in RATES and o['unit'].split(' ')[0] in ('pages', 'books')] + chart_failures(a.table)
    catch = [o for o in obs if o['rate'] == 'judge_catch']
    fpos = [o for o in obs if o['rate'] == 'judge_false_positive']
    cells = sorted({(o['rate'], o['route'], o['script']) for o in rate_obs})
    routes = sorted({(o['rate'], o['route']) for o in rate_obs})
    ci, ri = {c: i for i, c in enumerate(cells)}, {r: i for i, r in enumerate(routes)}
    route_rate = jnp.array([RATES.index(r[0]) for r in routes])
    cell_route = jnp.array([ri[(c[0], c[1])] for c in cells])
    cell_rate = jnp.array([RATES.index(c[0]) for c in cells])
    ke, ne = zip(*[effective(o) for o in rate_obs])
    K, N = jnp.array(ke), jnp.array(ne)
    C = jnp.array([ci[(o['rate'], o['route'], o['script'])] for o in rate_obs])
    jcode = {'opus': 0, 'gemini-3.8-flash-high': 1, 'gemini-3.1-pro': 2, 'two-readers': 3}
    J = jnp.array([jcode.get(o['judge'], -1) for o in rate_obs])
    assert all(o['judge'] in EXACT or o['judge'] in jcode for o in rate_obs), {o['judge'] for o in rate_obs}
    cK = jnp.array([o['k'] for o in catch], dtype=float)
    cN = jnp.array([o['n'] for o in catch], dtype=float)
    cJ = jnp.array([JUDGES.index(o['judge']) for o in catch])
    fK = jnp.array([o['k'] for o in fpos], dtype=float)
    fN = jnp.array([o['n'] for o in fpos], dtype=float)
    fJ = jnp.array([JUDGES.index(o['judge']) for o in fpos])

    def binom(k, n, p):
        p = jnp.clip(p, 1e-9, 1 - 1e-9)
        return gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1) + k * jnp.log(p) + (n - k) * jnp.log1p(-p)

    def model():
        mu = numpyro.sample('mu', dist.Normal(-2.5, 2.0).expand([len(RATES)]))
        tr = numpyro.sample('tau_route', dist.HalfNormal(1.5).expand([len(RATES)]))
        tc = numpyro.sample('tau_cell', dist.HalfNormal(1.0))
        zr = numpyro.sample('z_route', dist.Normal(0, 1).expand([len(routes)]))
        zc = numpyro.sample('z_cell', dist.Normal(0, 1).expand([len(cells)]))
        logit = mu[cell_rate] + (tr[route_rate] * zr)[cell_route] + tc * zc
        rate = numpyro.deterministic('rate', jax.nn.sigmoid(logit))
        s = numpyro.sample('catch', dist.Beta(1.0, 1.0).expand([len(JUDGES)]))
        f = numpyro.sample('false_pos', dist.Beta(1.0, 10.0).expand([len(JUDGES)]))
        s4, f4 = jnp.concatenate([s, s[:1]]), jnp.concatenate([f, jnp.zeros(1)])
        p = rate[C]
        jj = jnp.maximum(J, 0)
        pobs = jnp.where(J < 0, p, s4[jj] * p + f4[jj] * (1 - p))
        numpyro.factor('rates', binom(K, N, pobs).sum())
        numpyro.factor('catch_controls', binom(cK, cN, s[cJ]).sum())
        numpyro.factor('fp_controls', binom(fK, fN, f[fJ]).sum())

    mc = MCMC(NUTS(model, target_accept_prob=0.95), num_warmup=1000, num_samples=a.samples, num_chains=3,
              chain_method='parallel', progress_bar=False)
    mc.run(jax.random.PRNGKey(6740), extra_fields=('diverging',))
    by = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items()}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by.items()}
    rh = {k: float(np.nanmax(np.atleast_1d(summary({k: v}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items()}
    q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
    src = collections.defaultdict(list)
    for o, (k_, n_) in zip(rate_obs, zip(ke, ne)):
        src[(o['rate'], o['route'], o['script'])].append(dict(source=o['source'], judge=o['judge'], k=o['k'], n=o['n'],
                                                               books=o.get('books'), k_eff=round(k_, 2),
                                                               n_eff=round(n_, 1), file=o['file']))
    res = dict(
        diagnostics=dict(divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()),
                         max_rhat=round(max(rh.values()), 3), chains=3, draws_per_chain=a.samples),
        judges={j: dict(catch=q(post['catch'][:, i]), false_positive=q(post['false_pos'][:, i]),
                        catch_controls=[f"{o['k']}/{o['n']} {o['source']}" for o in catch if o['judge'] == j],
                        fp_controls=[f"{o['k']}/{o['n']} {o['source']}" for o in fpos if o['judge'] == j])
                for i, j in enumerate(JUDGES)},
        cells=[dict(rate=c[0], route=c[1], script=c[2], est=q(post['rate'][:, i]),
                    n_eff=round(max(sum(s['n_eff'] for s in src[c] if s['judge'] == j) for j in {s['judge'] for s in src[c]}), 1),
                    raw=raw_by_judge(src[c]), books_unrecorded=any(s['books'] is None for s in src[c]),
                    observations=src[c]) for i, c in enumerate(cells)])
    json.dump(res, open(a.out, 'w'), indent=1)
    print(json.dumps(res['diagnostics']), json.dumps(res['judges'], indent=0)[:1500])
    for c in sorted(res['cells'], key=lambda c: (c['rate'], -c['est'][1])):
        if c['route'].endswith('(benchmark read)') and c['raw'].startswith('mechanical 0/'):
            continue
        print(f"{c['rate']:<12} {c['est'][1]:.3f} [{c['est'][0]:.3f}, {c['est'][2]:.3f}]  n_eff {c['n_eff']:>6}  {c['raw']:<44} "
              f"{c['script']:<20} {c['route']}")


if __name__ == '__main__':
    sys.exit(main())
