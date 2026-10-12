#!/usr/bin/env python3
# PRIOR ART: none — looked in scripts/eval/lib/ (INDEX.md: bootstrap CIs, paired deltas, judge agreement),
# scripts/eval/pareto-6182/score-*.py (per-instrument arm means) and scripts/eval/xlref-synthesis-2026-10/;
# nothing pools across experiments or fits a hierarchical model (#6557).
"""Hierarchical Gaussian model of judged translation fidelity (1–5) across experiments (#6557).

score = mu + lang[l] + engine(model[m] + route[r]) + famXsf[f,s] + famXlang[f,l] + modelXlang[m,l]
        + work[w] + page[p] + round[k] + instrument[i] + judge[j] + eps

  lang[l]  ~ N(sf[s], tau_lang)          language nested in script family
  model[m] ~ N(fam[f], tau_model)        model pooled within family (gemini-lite/flash/pro, claude-*)
  route    : cli / stored offsets vs api (sub = Claude only, folded into the Claude models)
  instrument: offset for what the judge saw. Every instrument in the table is reference-anchored, so this is
  fixed at 0 today; the slot is for source-only judging when it enters the table.
  judge: fixed offset for the judge MODEL (Opus = 0; Sonnet judged #5606 only). work, page, round: random.
  Every judge in the data is Claude (Opus, plus Sonnet on #5606), so judge-FAMILY effects and self-preference
  are NOT in the likelihood; they enter only as priors when predicting a non-Opus judge (see predict-6545.py).

Usage (library):  fit(df) -> posterior samples dict + index maps
"""
import json, sys
import numpy as np
import pandas as pd

import jax
import jax.numpy as jnp
import numpyro
import numpyro.distributions as dist
from numpyro.infer import MCMC, NUTS

numpyro.set_host_device_count(1)


def load(path):
    df = pd.read_json(path, lines=True)
    df = df[df.scored & (df.variant.fillna('') == '')].copy()
    df['work'] = df['work'].fillna(df['page']).astype(str)
    df['wkey'] = df['language'] + ':' + df['work']
    df['pkey'] = df['page'].astype(str)
    # AA is a second run of the production engine through the API: same engine, route api
    df['route'] = df['route'].replace({'sub': 'api'})
    return df


class Index:
    def __init__(self, df, extra_models=(), extra_langs=()):
        self.models = sorted(set(df.model) | set(extra_models))
        self.fam_of = {}
        for m, f in df[['model', 'model_family']].drop_duplicates().itertuples(index=False):
            self.fam_of[m] = f
        self.fams = sorted(set(self.fam_of.values()) | {'gemini-pro'})
        self.langs = sorted(set(df.language) | set(extra_langs))
        self.sf_of = dict(df[['language', 'script_family']].drop_duplicates().itertuples(index=False))
        self.sfs = sorted(set(self.sf_of.values()))
        self.routes = ['api', 'cli', 'stored']
        self.works = sorted(set(df.wkey))
        self.pages = sorted(set(df.pkey))
        self.rounds = sorted(set(df['round']))
        self.instruments = ['reference', 'source']
        self.judges = ['claude-opus-5.5', 'claude-sonnet-5.5']

    def enc(self, df):
        mi = {m: i for i, m in enumerate(self.models)}
        li = {m: i for i, m in enumerate(self.langs)}
        ri = {m: i for i, m in enumerate(self.routes)}
        wi = {m: i for i, m in enumerate(self.works)}
        pi = {m: i for i, m in enumerate(self.pages)}
        ki = {m: i for i, m in enumerate(self.rounds)}
        ii = {m: i for i, m in enumerate(self.instruments)}
        ji = {m: i for i, m in enumerate(self.judges)}
        return dict(i=jnp.array(df.instrument.map(ii).values), j=jnp.array(df.judge_model.map(ji).values),
                    m=jnp.array(df.model.map(mi).values), l=jnp.array(df.language.map(li).values),
                    r=jnp.array(df.route.map(ri).values), w=jnp.array(df.wkey.map(wi).values),
                    p=jnp.array(df.pkey.map(pi).values), k=jnp.array(df['round'].map(ki).values))

    def maps(self):
        fi = {f: i for i, f in enumerate(self.fams)}
        si = {s: i for i, s in enumerate(self.sfs)}
        return (jnp.array([fi[self.fam_of[m]] for m in self.models]),
                jnp.array([si[self.sf_of[l]] for l in self.langs]))


def model_fn(ix, m, l, r, w, p, k, i, j, y=None):
    fam_of_m, sf_of_l = ix.maps()
    nM, nF, nL, nS = len(ix.models), len(ix.fams), len(ix.langs), len(ix.sfs)
    mu = numpyro.sample('mu', dist.Normal(4.0, 1.0))
    tau_sf = numpyro.sample('tau_sf', dist.HalfNormal(0.5))
    tau_lang = numpyro.sample('tau_lang', dist.HalfNormal(0.5))
    tau_fam = numpyro.sample('tau_fam', dist.HalfNormal(0.5))
    tau_model = numpyro.sample('tau_model', dist.HalfNormal(0.3))
    tau_fs = numpyro.sample('tau_fs', dist.HalfNormal(0.3))
    tau_fl = numpyro.sample('tau_fl', dist.HalfNormal(0.3))
    tau_ml = numpyro.sample('tau_ml', dist.HalfNormal(0.2))
    tau_w = numpyro.sample('tau_w', dist.HalfNormal(0.5))
    tau_p = numpyro.sample('tau_p', dist.HalfNormal(0.5))
    tau_round = numpyro.sample('tau_round', dist.HalfNormal(0.2))
    sigma = numpyro.sample('sigma', dist.HalfNormal(1.0))
    z = lambda name, shape: numpyro.sample(name, dist.Normal(0, 1).expand(shape))
    sf = numpyro.deterministic('sf', tau_sf * z('z_sf', (nS,)))
    lang = numpyro.deterministic('lang', sf[sf_of_l] + tau_lang * z('z_lang', (nL,)))
    fam = numpyro.deterministic('fam', tau_fam * z('z_fam', (nF,)))
    mod = numpyro.deterministic('mod', fam[fam_of_m] + tau_model * z('z_mod', (nM,)))
    route = numpyro.deterministic('route', jnp.concatenate([jnp.zeros(1), 0.3 * z('z_route', (2,))]))
    fs = numpyro.deterministic('fs', tau_fs * z('z_fs', (nF, nS)))
    fl = numpyro.deterministic('fl', tau_fl * z('z_fl', (nF, nL)))
    ml = numpyro.deterministic('ml', tau_ml * z('z_ml', (nM, nL)))
    wk = tau_w * z('z_w', (len(ix.works),))
    pg = numpyro.deterministic('pg', tau_p * z('z_p', (len(ix.pages),)))
    numpyro.deterministic('wk', wk)
    rd = numpyro.deterministic('rd', tau_round * z('z_round', (len(ix.rounds),)))
    inst = numpyro.deterministic('inst', jnp.concatenate([jnp.zeros(1), 0.5 * z('z_inst', (1,))]))
    judge = numpyro.deterministic('judge', jnp.concatenate([jnp.zeros(1), 0.5 * z('z_judge', (1,))]))
    f = fam_of_m[m]
    s = sf_of_l[l]
    pred = mu + lang[l] + mod[m] + route[r] + fs[f, s] + fl[f, l] + ml[m, l] + wk[w] + pg[p] + rd[k] + inst[i] + judge[j]
    numpyro.sample('y', dist.Normal(pred, sigma), obs=y)


def fit(df, extra_models=(), seed=0, warmup=600, samples=600):
    ix = Index(df, extra_models)
    e = ix.enc(df)
    kern = NUTS(lambda **kw: model_fn(ix, **kw), target_accept_prob=0.85)
    mc = MCMC(kern, num_warmup=warmup, num_samples=samples, num_chains=1, progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), y=jnp.array(df.score.values, dtype=jnp.float32), **e)
    post = {k: np.asarray(v) for k, v in mc.get_samples().items() if not k.startswith('z_')}
    return ix, post


def cell_draws(ix, post, model, route, lang, pages=None, works=None, new_round=True, rng=None, n_obs=None,
               instrument='reference', family=None, judge='claude-opus-5.5'):
    """Posterior predictive draws of a cell mean (model x route x language) for a panel of pages.

    pages/works: the panel. Known pages/works use their fitted effects; unknown ones contribute a fresh draw
    averaged over the panel. new_round adds a fresh judging-round effect. n_obs adds the sampling noise of
    the observed mean (n_obs = number of page x judge scores)."""
    rng = rng or np.random.default_rng(0)
    S = post['mu'].shape[0]
    fi = {f: i for i, f in enumerate(ix.fams)}
    si = {s: i for i, s in enumerate(ix.sfs)}
    li = {x: i for i, x in enumerate(ix.langs)}
    l = li[lang]                      # languages are never held out whole (every LOO experiment shares them)
    s = si[ix.sf_of[lang]]
    fam_name = family or ix.fam_of.get(model)
    f = fi[fam_name] if fam_name in fi else None
    fam = post['fam'][:, f] if f is not None else rng.normal(0, 1, S) * post['tau_fam']
    if model in ix.models:            # measured somewhere in the training data
        mi = ix.models.index(model)
        mod = post['mod'][:, mi]
        ml = post['ml'][:, mi, l]
    else:                             # never measured: a fresh model drawn from its family
        mod = fam + rng.normal(0, 1, S) * post['tau_model']
        ml = rng.normal(0, 1, S) * post['tau_ml']
    fs = post['fs'][:, f, s] if f is not None else rng.normal(0, 1, S) * post['tau_fs']
    fl = post['fl'][:, f, l] if f is not None else rng.normal(0, 1, S) * post['tau_fl']
    out = post['mu'] + post['lang'][:, l] + mod + post['route'][:, ix.routes.index(route)] \
        + fs + fl + ml
    if 'inst' in post:                # fits from before 2026-10-12 (the pinned #6545 prediction) have neither
        out = out + post['inst'][:, ix.instruments.index(instrument)] + post['judge'][:, ix.judges.index(judge)]
    if pages is not None:
        pidx = {x: i for i, x in enumerate(ix.pages)}
        widx = {x: i for i, x in enumerate(ix.works)}
        pe = np.zeros(S)
        for pgid, wk in zip(pages, works):
            pe += post['pg'][:, pidx[pgid]] if pgid in pidx else rng.normal(0, post['tau_p'])
            pe += post['wk'][:, widx[wk]] if wk in widx else rng.normal(0, post['tau_w'])
        out = out + pe / len(pages)
    if new_round:
        out = out + rng.normal(0, 1, S) * post['tau_round']
    if n_obs:
        out = out + rng.normal(0, 1, S) * post['sigma'] / np.sqrt(n_obs)
    return out
