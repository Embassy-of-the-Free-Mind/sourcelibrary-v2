#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/model_v1.py — the translation estimator (ordinal judge scores). Same hierarchy and
# the same measured/pooled rule; the OCR outcome is characters wrong out of characters, so the likelihood is the
# beta-binomial .claude/docs/quality-research-system.md §3 names. build-ocr-pareto.mjs reports each chart's means
# with a by-work interval and no pooling across charts or engines (#6740).
"""OCR estimator v0, accuracy: hierarchical beta-binomial over the Pareto charts' page x engine CER (#6740).

For page p (work w, panel s, chart c, kind k, period t) read by engine e of family F:

  errors ~ BetaBinomial(n_ref, mu * phi, (1 - mu) * phi)
  logit(mu) = a + fam[F] + eng[e] + chart[c] + fc[F, c] + ec[e, c] + kind[k] + period[t] + panel[s] + work[w] + page[p]

  eng ~ N(0, tau_eng) inside its family; fc, ec ~ N(0, tau_fc), N(0, tau_ec): engine x script, shrunk toward the
  family and the engine's average, moved only by evidence. errors = round(CER * n_ref); a failed read is not here.
  Accuracy is 1 - mu, reported for an average page and work of the chart, print or manuscript as the chart is.

A cell (chart, engine) is MEASURED when the engine read at least 5 pages of that chart; otherwise POOLED (the
estimate leans on the engine elsewhere and the family in this chart). An engine family with no measured member in a
chart is UNTESTED there: reported, never used to route (rule 2 of estimator v1).
"""
import numpy as np
import pandas as pd

import numpyro
numpyro.set_host_device_count(4)
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.diagnostics import summary  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402

MIN_PAGES = 5
FACTORS = ['fam', 'eng', 'chart', 'kind', 'period', 'panel', 'work', 'page']


def load(path):
    df = pd.read_json(path, lines=True)
    df = df[df.scored].copy()
    df['n'] = df.n_ref.clip(lower=20).astype(int)
    df['k'] = np.minimum(df.n, np.round(df.cer.clip(0, 1) * df.n)).astype(int)
    return df


class Index:
    def __init__(self, df):
        self.lv = {'fam': sorted(set(df.engine_family)), 'eng': sorted(set(df.engine)), 'chart': sorted(set(df.chart)),
                   'kind': sorted(set(df.kind)), 'period': sorted(set(df.period)), 'panel': sorted(set(df.panel)),
                   'work': sorted(set(df.work)), 'page': sorted(set(df.page))}
        self.fam_of = dict(df[['engine', 'engine_family']].drop_duplicates().itertuples(index=False))
        self.kind_of_chart = df.groupby('chart').kind.agg(lambda s: s.value_counts().index[0]).to_dict()

    def i(self, f):
        return {x: j for j, x in enumerate(self.lv[f])}

    def enc(self, df):
        col = {'fam': 'engine_family', 'eng': 'engine', 'chart': 'chart', 'kind': 'kind', 'period': 'period',
               'panel': 'panel', 'work': 'work', 'page': 'page'}
        return {f: jnp.array(df[col[f]].map(self.i(f)).values) for f in FACTORS}


def model_fn(ix, eng, chart, kind, period, panel, work, page, fam, n, k):
    N = {f: len(ix.lv[f]) for f in FACTORS}
    fam_of_e = jnp.array([ix.i('fam')[ix.fam_of[e]] for e in ix.lv['eng']])
    hn = lambda name, s: numpyro.sample(name, dist.HalfNormal(s))
    z = lambda name, shape: numpyro.sample(name, dist.Normal(0, 1).expand(shape))
    a = numpyro.sample('a', dist.Normal(-3.0, 2.0))
    t = {x: hn(f'tau_{x}', s) for x, s in [('fam', 1.5), ('eng', 1.0), ('chart', 1.5), ('fc', 1.0), ('ec', 0.7),
                                           ('period', 1.0), ('panel', 1.0), ('work', 1.5), ('page', 1.5)]}
    F = numpyro.deterministic('F', t['fam'] * z('z_fam', (N['fam'],)))
    Eg = numpyro.deterministic('E', F[fam_of_e] + t['eng'] * z('z_eng', (N['eng'],)))
    C = numpyro.deterministic('C', t['chart'] * z('z_chart', (N['chart'],)))
    FC = numpyro.deterministic('FC', t['fc'] * z('z_fc', (N['fam'], N['chart'])))
    EC = numpyro.deterministic('EC', t['ec'] * z('z_ec', (N['eng'], N['chart'])))
    K = numpyro.deterministic('K', jnp.concatenate([jnp.zeros(1), 1.0 * z('z_kind', (N['kind'] - 1,))]))
    T = numpyro.deterministic('T', t['period'] * z('z_period', (N['period'],)))
    S = numpyro.deterministic('S', t['panel'] * z('z_panel', (N['panel'],)))
    W = numpyro.deterministic('W', t['work'] * z('z_work', (N['work'],)))
    P = numpyro.deterministic('P', t['page'] * z('z_page', (N['page'],)))
    phi = numpyro.sample('phi', dist.LogNormal(3.0, 1.5))
    eta = (a + Eg[eng] + C[chart] + FC[fam, chart] + EC[eng, chart] + K[kind] + T[period] + S[panel] + W[work]
           + P[page])
    mu = jnp.clip(jax.nn.sigmoid(eta), 1e-6, 1 - 1e-6)
    numpyro.sample('y', dist.BetaBinomial(mu * phi, (1 - mu) * phi, total_count=n), obs=k)


SITES = ['a', 'phi', 'tau_fam', 'tau_eng', 'tau_chart', 'tau_fc', 'tau_ec', 'tau_period', 'tau_panel', 'tau_work',
         'tau_page', 'F', 'E', 'C', 'FC', 'EC', 'K', 'T', 'S', 'W', 'P']


def fit(df, seed=0, warmup=500, samples=500, chains=3):
    ix = Index(df)
    e = ix.enc(df)
    kern = NUTS(lambda **kw: model_fn(ix, **kw), target_accept_prob=0.9)
    mc = MCMC(kern, num_warmup=warmup, num_samples=samples, num_chains=chains, chain_method='parallel',
              progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',), n=jnp.array(df.n.values), k=jnp.array(df.k.values),
           **e)
    by_chain = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items() if k in SITES}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by_chain.items()}
    worst_r, worst_e = (0.0, ''), (np.inf, '')
    for name, v in by_chain.items():
        st = summary({name: v}, group_by_chain=True)[name]
        r, s = np.atleast_1d(st['r_hat']).ravel(), np.atleast_1d(st['n_eff']).ravel()
        keep = np.atleast_1d(v.std((0, 1))).ravel() > 1e-9
        if not keep.any():
            continue
        i, j = np.nanargmax(np.where(keep, r, -np.inf)), np.nanargmin(np.where(keep, s, np.inf))
        if r[i] > worst_r[0]:
            worst_r = (float(r[i]), f'{name}[{i}]')
        if s[j] < worst_e[0]:
            worst_e = (float(s[j]), f'{name}[{j}]')
    diag = dict(chains=chains, draws_per_chain=samples,
                divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()),
                max_rhat=round(worst_r[0], 3), max_rhat_at=worst_r[1], min_ess=int(worst_e[0]), min_ess_at=worst_e[1])
    return ix, post, diag


_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(21)


def cell_accuracy(ix, post, engine, chart, rng, family=None, period=None):
    """Draws of 1 - E[CER] for an average page and work of `chart` (its usual kind; period averaged unless given),
    no panel effect. An engine not in the fit is a fresh draw from its family."""
    Sd = post['a'].shape[0]
    fi, ci = ix.i('fam'), ix.i('chart')
    fam = family or ix.fam_of.get(engine)
    f, c = fi.get(fam), ci.get(chart)
    Fe = post['F'][:, f] if f is not None else rng.normal(0, 1, Sd) * post['tau_fam']
    if engine in ix.lv['eng']:
        j = ix.i('eng')[engine]
        E, EC = post['E'][:, j], (post['EC'][:, j, c] if c is not None else rng.normal(0, 1, Sd) * post['tau_ec'])
    else:
        E, EC = Fe + rng.normal(0, 1, Sd) * post['tau_eng'], rng.normal(0, 1, Sd) * post['tau_ec']
    C = post['C'][:, c] if c is not None else rng.normal(0, 1, Sd) * post['tau_chart']
    FC = post['FC'][:, f, c] if f is not None and c is not None else rng.normal(0, 1, Sd) * post['tau_fc']
    kind = ix.kind_of_chart.get(chart, 'print')
    K = post['K'][:, ix.i('kind')[kind]]
    T = post['T'][:, ix.i('period')[period]] if period else post['T'].mean(1)
    eta = post['a'] + E + C + FC + EC + K + T
    sd = np.sqrt(post['tau_work'] ** 2 + post['tau_page'] ** 2)
    grid = eta[:, None] + sd[:, None] * _GH_X[None, :]
    cer = (1 / (1 + np.exp(-grid)) * _GH_W).sum(1) / _GH_W.sum()
    return 1 - cer


def basis(df, engine, chart):
    n = df[(df.engine == engine) & (df.chart == chart)].page.nunique()
    if n >= MIN_PAGES:
        return 'measured'
    fam = df[df.engine == engine].engine_family.iloc[0] if (df.engine == engine).any() else None
    sib = df[(df.engine_family == fam) & (df.chart == chart)].groupby('engine').page.nunique()
    return 'pooled' if (sib >= MIN_PAGES).any() else 'untested'
