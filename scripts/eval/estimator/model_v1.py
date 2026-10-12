#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/model.py — the v0 Gaussian model. It has one round variance for every
# instrument, a single chain and no ceiling at 5; v1 goes beside it so the v0 numbers stay reproducible (#6557).
"""Estimator v1: ordinal hierarchical model of judged translation fidelity (1–5) across experiments (#6557).

The four changes from v0 (model.py):
  1. one round-effect spread per INSTRUMENT CLASS (panel / packet / canon-ref), not one for all rounds;
  2. basis(): a cell is "measured" only when the model was read in that script family, otherwise "pooled";
  3. an ordered-logistic likelihood on the 1–5 score, so no estimate can leave the scale;
  4. four chains, with R-hat, effective sample size and divergences returned beside the posterior.

On the logit scale, for a score by judge j of model m (route r) on page p of work w in language l, round k:

  eta = lang[l] + mod[m] + route[r] + famXsf[f,s] + famXlang[f,l] + modelXlang[m,l]
        + work[w] + page[p] + round[k] + judge[j]
  P(score <= c) = logistic(cut[c] - eta),  c = 1..4

  round[k] ~ N(0, tau_round[class(k)])     class: see INSTRUMENT_CLASS
  canon-ref stores only the mean of its two judges; its likelihood is the exact distribution of the mean of two
  independent ordinal scores (the category probabilities convolved with themselves).

Every judge is Claude, so self-preference is still not in the likelihood (see predict-6545-v1.py).
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

# What the judge was handed. panel: the #6182-style multi-arm panel, every arm of a page scored against the
# published reference in one judging round. packet: blind pairwise / A-B-C-D packets with their own judge prompt
# (xlref t1–t5, #5606). canon-ref: the #6331 canon reference set, which keeps only the two-judge mean.
INSTRUMENT_CLASS = {
    '6182-xl': 'panel', '6331-cli38-xl': 'panel', '6182-claude-xl': 'panel', '6182-tib': 'panel',
    '6182-claude-tib': 'panel', '6331-cli38-tib58': 'panel', '6331-cli38-tib113': 'panel',
    '6331-canon-ref': 'canon-ref',
    'xlref-t1': 'packet', 'xlref-t2': 'packet', 'xlref-t3': 'packet', 'xlref-t4': 'packet', 'xlref-t5': 'packet',
    '5606-ab': 'packet',
}
CLASSES = ['panel', 'packet', 'canon-ref']
MIN_SF_PAGES = 5      # "read in that script family" = at least this many pages


def load(path):
    df = pd.read_json(path, lines=True)
    df = df[df.scored & (df.variant.fillna('') == '')].copy()
    df['work'] = df['work'].fillna(df['page']).astype(str)
    df['wkey'] = df['language'] + ':' + df['work']
    df['pkey'] = df['page'].astype(str)
    df['route'] = df['route'].replace({'sub': 'api'})
    df['iclass'] = df['experiment'].map(INSTRUMENT_CLASS)
    assert df.iclass.notna().all(), 'experiment without an instrument class'
    df['is_mean'] = df.judge == 'mean'
    assert (df[~df.is_mean].score % 1 == 0).all(), 'a single-judge score is not an integer'
    return df


def basis(train, model, lang_sf):
    """measured: the model was read on >= MIN_SF_PAGES pages of this script family in `train`; else pooled."""
    n = train[(train.model == model) & (train.script_family == lang_sf)].pkey.nunique()
    return 'measured' if n >= MIN_SF_PAGES else 'pooled'


class Index:
    def __init__(self, df):
        self.models = sorted(set(df.model))
        self.fam_of = dict(df[['model', 'model_family']].drop_duplicates().itertuples(index=False))
        self.fams = sorted(set(self.fam_of.values()) | {'gemini-pro'})
        self.langs = sorted(set(df.language))
        self.sf_of = dict(df[['language', 'script_family']].drop_duplicates().itertuples(index=False))
        self.sfs = sorted(set(self.sf_of.values()))
        self.routes = ['api', 'cli', 'stored']
        self.works = sorted(set(df.wkey))
        self.pages = sorted(set(df.pkey))
        self.rounds = sorted(set(df['round']))
        self.class_of_round = dict(df[['round', 'iclass']].drop_duplicates().itertuples(index=False))
        self.classes = CLASSES
        self.judges = ['claude-opus-5.5', 'claude-sonnet-5.5']

    def enc(self, df):
        ix = lambda xs: {x: i for i, x in enumerate(xs)}
        cols = dict(m=df.model.map(ix(self.models)), l=df.language.map(ix(self.langs)),
                    r=df.route.map(ix(self.routes)), w=df.wkey.map(ix(self.works)), p=df.pkey.map(ix(self.pages)),
                    k=df['round'].map(ix(self.rounds)), j=df.judge_model.map(ix(self.judges)))
        return {k: jnp.array(v.values) for k, v in cols.items()}

    def maps(self):
        fi = {f: i for i, f in enumerate(self.fams)}
        si = {s: i for i, s in enumerate(self.sfs)}
        ci = {c: i for i, c in enumerate(self.classes)}
        return (jnp.array([fi[self.fam_of[m]] for m in self.models]),
                jnp.array([si[self.sf_of[l]] for l in self.langs]),
                jnp.array([ci[self.class_of_round[k]] for k in self.rounds]))


def probs_of(eta, cut):
    """Category probabilities P(score = 1..5), shape eta.shape + (5,). Works for numpy and jax arrays."""
    xp = jnp if isinstance(eta, jnp.ndarray) else np
    cdf = 1.0 / (1.0 + xp.exp(-(cut - eta[..., None])))
    one = xp.ones(eta.shape + (1,))
    return xp.concatenate([cdf, one], -1) - xp.concatenate([0 * one, cdf], -1)


def model_fn(ix, m, l, r, w, p, k, j, u1, y1, u2, y2):
    fam_of_m, sf_of_l, class_of_k = ix.maps()
    nM, nF, nL, nS = len(ix.models), len(ix.fams), len(ix.langs), len(ix.sfs)
    # the same priors as v0, times about 3: one score point is roughly 3 logits at this noise level
    tau_sf = numpyro.sample('tau_sf', dist.HalfNormal(1.5))
    tau_lang = numpyro.sample('tau_lang', dist.HalfNormal(1.5))
    tau_fam = numpyro.sample('tau_fam', dist.HalfNormal(1.5))
    tau_model = numpyro.sample('tau_model', dist.HalfNormal(1.0))
    tau_fs = numpyro.sample('tau_fs', dist.HalfNormal(1.0))
    tau_fl = numpyro.sample('tau_fl', dist.HalfNormal(1.0))
    tau_ml = numpyro.sample('tau_ml', dist.HalfNormal(0.7))
    tau_w = numpyro.sample('tau_w', dist.HalfNormal(1.5))
    tau_p = numpyro.sample('tau_p', dist.HalfNormal(1.5))
    # one spread per instrument class. A class with no round in the fit keeps this prior.
    tau_round = numpyro.sample('tau_round', dist.HalfNormal(1.0).expand([len(ix.classes)]))
    cut = numpyro.sample('cut', dist.TransformedDistribution(
        dist.Normal(0.0, 4.0).expand([4]), dist.transforms.OrderedTransform()))
    z = lambda name, shape: numpyro.sample(name, dist.Normal(0, 1).expand(shape))
    sf = numpyro.deterministic('sf', tau_sf * z('z_sf', (nS,)))
    lang = numpyro.deterministic('lang', sf[sf_of_l] + tau_lang * z('z_lang', (nL,)))
    fam = numpyro.deterministic('fam', tau_fam * z('z_fam', (nF,)))
    mod = numpyro.deterministic('mod', fam[fam_of_m] + tau_model * z('z_mod', (nM,)))
    route = numpyro.deterministic('route', jnp.concatenate([jnp.zeros(1), 1.0 * z('z_route', (2,))]))
    fs = numpyro.deterministic('fs', tau_fs * z('z_fs', (nF, nS)))
    fl = numpyro.deterministic('fl', tau_fl * z('z_fl', (nF, nL)))
    ml = numpyro.deterministic('ml', tau_ml * z('z_ml', (nM, nL)))
    wk = numpyro.deterministic('wk', tau_w * z('z_w', (len(ix.works),)))
    pg = numpyro.deterministic('pg', tau_p * z('z_p', (len(ix.pages),)))
    rd = numpyro.deterministic('rd', tau_round[class_of_k] * z('z_round', (len(ix.rounds),)))
    judge = numpyro.deterministic('judge', jnp.concatenate([jnp.zeros(1), 1.5 * z('z_judge', (1,))]))
    f, s = fam_of_m[m], sf_of_l[l]
    eta = lang[l] + mod[m] + route[r] + fs[f, s] + fl[f, l] + ml[m, l] + wk[w] + pg[p] + rd[k] + judge[j]
    # eta is per distinct design row; u1 / u2 point each score at its row
    cuts = jnp.concatenate([jnp.array([-1e3]), cut, jnp.array([1e3])])
    cdf = lambda c, e: jax.nn.sigmoid(cuts[c] - e)
    # one judge: P(score = y1)
    e1 = eta[u1]
    ll1 = jnp.log(jnp.clip(cdf(y1 + 1, e1) - cdf(y1, e1), 1e-12, 1.0))
    # mean of two judges (canon-ref): P(sum = a + b) is the self-convolution of the category probabilities
    pr = probs_of(eta[u2], cut)
    conv = jnp.stack([sum(pr[:, a] * pr[:, t - a] for a in range(5) if 0 <= t - a < 5) for t in range(9)], 1)
    ll2 = jnp.log(jnp.clip(jnp.take_along_axis(conv, y2[:, None], 1)[:, 0], 1e-12, 1.0))
    numpyro.factor('loglik', ll1.sum() + ll2.sum())


SITES = ['tau_sf', 'tau_lang', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl', 'tau_ml', 'tau_w', 'tau_p',
         'tau_round', 'cut', 'sf', 'lang', 'fam', 'mod', 'route', 'fs', 'fl', 'ml', 'wk', 'pg', 'rd', 'judge']
HYPER = ['tau_sf', 'tau_lang', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl', 'tau_ml', 'tau_w', 'tau_p',
         'tau_round', 'cut']


def design(ix, df):
    """Distinct design rows (two judges of one arm on one page share a row) and each score's pointer to its row."""
    enc = {k: np.asarray(v) for k, v in ix.enc(df).items()}
    keys = np.stack([enc[c] for c in 'mlrwpkj'], 1)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.ravel()
    one, two = ~df.is_mean.values, df.is_mean.values
    data = dict(u1=jnp.array(inv[one]), y1=jnp.array(df.score.values[one].astype(int) - 1),          # 0..4
                u2=jnp.array(inv[two]), y2=jnp.array(np.round(df.score.values[two] * 2).astype(int) - 2))  # 0..8
    return {c: jnp.array(uniq[:, i]) for i, c in enumerate('mlrwpkj')}, data


def fit(df, seed=0, warmup=500, samples=500, chains=4):
    ix = Index(df)
    e, data = design(ix, df)
    kern = NUTS(lambda **kw: model_fn(ix, **kw), target_accept_prob=0.9)
    mc = MCMC(kern, num_warmup=warmup, num_samples=samples, num_chains=chains, chain_method='parallel',
              progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',), **e, **data)
    by_chain = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items() if k in SITES}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by_chain.items()}
    return ix, post, diagnostics(ix, by_chain, int(np.asarray(mc.get_extra_fields()['diverging']).sum()),
                                 chains, samples)


def diagnostics(ix, by_chain, divergences, chains, samples):
    """R-hat and effective sample size over every fitted quantity; constants (the zero reference levels) and
    the round spread of a class with no round in the fit (its prior) are left out."""
    seen = {ix.class_of_round[k] for k in ix.rounds}
    worst = dict(rhat=(0.0, ''), ess=(np.inf, ''))
    hyper = {}
    for name, v in by_chain.items():
        st = summary({name: v}, group_by_chain=True)[name]
        rhat, ess = np.atleast_1d(st['r_hat']).ravel(), np.atleast_1d(st['n_eff']).ravel()
        sd = np.atleast_1d(v.std((0, 1))).ravel()
        keep = sd > 1e-9
        if name == 'tau_round':
            keep &= np.array([c in seen for c in ix.classes])
        if not keep.any():
            continue
        i, j = np.nanargmax(np.where(keep, rhat, -np.inf)), np.nanargmin(np.where(keep, ess, np.inf))
        if rhat[i] > worst['rhat'][0]:
            worst['rhat'] = (float(rhat[i]), f'{name}[{i}]')
        if ess[j] < worst['ess'][0]:
            worst['ess'] = (float(ess[j]), f'{name}[{j}]')
        if name in HYPER:
            hyper[name] = dict(rhat=[round(float(x), 3) for x in rhat], ess=[int(x) for x in ess])
    return dict(chains=chains, draws_per_chain=samples, divergences=divergences,
                max_rhat=round(worst['rhat'][0], 3), max_rhat_at=worst['rhat'][1],
                min_ess=int(worst['ess'][0]), min_ess_at=worst['ess'][1], hyper=hyper)


# ---------- prediction ----------

def cell_eta(ix, post, model, route, lang, rng, family=None):
    """Posterior draws of a cell's latent quality (logit scale) for an average work and page, Opus judge,
    no round effect. A model that is not in the fit is a fresh draw from its family."""
    S = post['cut'].shape[0]
    fi = {f: i for i, f in enumerate(ix.fams)}
    l, s = ix.langs.index(lang), ix.sfs.index(ix.sf_of[lang])
    fam_name = family or ix.fam_of.get(model)
    f = fi.get(fam_name)
    fam = post['fam'][:, f] if f is not None else rng.normal(0, 1, S) * post['tau_fam']
    if model in ix.models:
        mi = ix.models.index(model)
        mod, ml = post['mod'][:, mi], post['ml'][:, mi, l]
    else:
        mod, ml = fam + rng.normal(0, 1, S) * post['tau_model'], rng.normal(0, 1, S) * post['tau_ml']
    fs = post['fs'][:, f, s] if f is not None else rng.normal(0, 1, S) * post['tau_fs']
    fl = post['fl'][:, f, l] if f is not None else rng.normal(0, 1, S) * post['tau_fl']
    return post['lang'][:, l] + mod + post['route'][:, ix.routes.index(route)] + fs + fl + ml


def expected_score(eta, cut):
    """E[score] given latent eta (any shape with the draw axis first) and cut (S, 4). Always inside [1, 5]."""
    c = cut.reshape((cut.shape[0],) + (1,) * (eta.ndim - 1) + (4,))
    return (probs_of(eta, c) * np.arange(1, 6)).sum(-1)


_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(21)


def marginal_score(eta, post):
    """Expected score for an average work and page: E[score] integrated over the work and page spread."""
    sd = np.sqrt(post['tau_w'] ** 2 + post['tau_p'] ** 2)
    grid = eta[:, None] + sd[:, None] * _GH_X[None, :]
    return (expected_score(grid, post['cut']) * _GH_W).sum(1) / _GH_W.sum()


class Panel:
    """Page, work and round effects for one judged panel, drawn once and shared by every cell on it, so that
    two cells on the same pages keep their common page effects when they are compared."""

    def __init__(self, ix, post, rng, iclass=None, round_name=None):
        self.ix, self.post, self.rng = ix, post, rng
        self.S = post['cut'].shape[0]
        self.pidx = {x: i for i, x in enumerate(ix.pages)}
        self.widx = {x: i for i, x in enumerate(ix.works)}
        self.pe, self.we = {}, {}
        if round_name is not None and round_name in ix.rounds:      # a round that is in the fit
            self.round = post['rd'][:, ix.rounds.index(round_name)]
        elif iclass is not None:                                    # a fresh round of this instrument class
            self.round = rng.normal(0, 1, self.S) * post['tau_round'][:, ix.classes.index(iclass)]
        else:
            self.round = np.zeros(self.S)

    def page(self, p):
        if p not in self.pe:
            self.pe[p] = self.post['pg'][:, self.pidx[p]] if p in self.pidx else self.rng.normal(0, 1, self.S) * self.post['tau_p']
        return self.pe[p]

    def work(self, w):
        if w not in self.we:
            self.we[w] = self.post['wk'][:, self.widx[w]] if w in self.widx else self.rng.normal(0, 1, self.S) * self.post['tau_w']
        return self.we[w]

    def eta_rows(self, cell, pages, works, judges=None):
        """(S, rows) latent for each (page, work[, judge]) row of a cell on this panel."""
        eta = np.stack([cell + self.page(p) + self.work(w) for p, w in zip(pages, works)], 1) + self.round[:, None]
        if judges is not None:
            eta = eta + np.stack([self.post['judge'][:, self.ix.judges.index(j)] for j in judges], 1)
        return eta

    def simulate_mean(self, eta_rows, reads=1):
        """Posterior predictive draws of the observed panel mean: `reads` ordinal scores per row."""
        cut = self.post['cut'][:, None, :]
        cdf = 1.0 / (1.0 + np.exp(-(cut - eta_rows[..., None])))
        tot = np.zeros(self.S)
        for _ in range(reads):
            u = self.rng.random(eta_rows.shape)
            tot += (1 + (u[..., None] > cdf).sum(-1)).mean(1)
        return tot / reads
