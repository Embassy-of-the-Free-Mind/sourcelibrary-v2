#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/model_v1.py — the v1 ordinal model, every judge Claude, no judge-family term and
# no way to use an experiment that committed only panel means. v2 goes beside it; v1 stays reproducible (#6740).
"""Estimator v2: v1's ordinal hierarchical model plus a JUDGE-FAMILY term and cell-mean evidence (#6740).

What is new, on v1's logit scale (model_v1.py docstring for the rest):

  eta += judge[j]                                   per judge model (Opus = 0; Sonnet, Fable, 3.1 Pro, 3.8 Flash High)
       + [judge family = gemini] * ( jfm[F(m)]      x the arm's model family (lite / flash / pro / haiku / sonnet / opus)
                                    + jfl[A(m), l] ) x the arm's maker (gemini / claude) x language
       + [arm maker = gemini] * rdm[k]              round x arm maker, one spread per instrument class (--round-maker)

  jfm ~ N(0, tau_jf), jfl ~ N(0, tau_jfl): with Claude-only judges these are unidentified and stay at their prior; the
  first Gemini judges (#6545's 3.1 Pro, #6559's and #6690's 3.8 Flash High) are what move them. Only the difference
  between judge families is identified: Claude judges are the reference.

  rdm is the term the v1 write-up named and did not add ("an instrument can shift single languages"; xlref-t4's
  misses were all Gemini arms). It is per round x maker, not x language: a round x language term would have been
  chosen after seeing the misses. It is switchable so the leave-one-out can say which term did the work.

Cell-mean evidence. #6545 and #6690 committed only per-(language, arm, judge) means with a by-work interval. Each is
a Normal observation of the mean over its pages of E[score], where a page in the fit brings its own page and work
effect and an unseen one is integrated over the page/work spread (Gauss-Hermite). The interval's half-width / 1.96
is the standard error, floored at 0.6/sqrt(n) (build-table-v2.py).

Instrument classes, assigned by a rule fixed BEFORE the leave-one-out: 'panel' is only the #6182 harness (every arm
of a page judged against the published reference by two Opus judges in one sitting). Every round run with its own
harness or judge prompt is 'packet' (#6545's three rounds, #6559 Nahuatl, #6690) — v1 found #6545 r1s1 was not a
#6182 panel, and that classing it as one caused its misses.
"""
import numpy as np
import pandas as pd

import numpyro
numpyro.set_host_device_count(4)
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402

from model_v1 import probs_of, diagnostics, basis, expected_score, MIN_SF_PAGES  # noqa: E402,F401
import model_v1  # noqa: E402
from model_v1 import INSTRUMENT_CLASS as IC1, CLASSES  # noqa: E402

INSTRUMENT_CLASS = dict(IC1, **{'6545-r1s1': 'packet', '6545-r1s2': 'packet', '6545-r2s1': 'packet',
                                '6559-nah': 'packet', '6690-o1': 'packet', '6729-g4': 'packet'})
JUDGES = ['claude-opus-5.5', 'claude-sonnet-5.5', 'claude-fable-5.1', 'gemini-3.1-pro', 'gemini-3.8-flash-high']
JUDGE_FAMILY = {j: ('gemini' if j.startswith('gemini') else 'claude') for j in JUDGES}
MAKERS = ['claude', 'gemini']
_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(15)


def maker(fam):
    return 'gemini' if fam.startswith('gemini') else 'claude'


def load(path, summaries=None):
    df = pd.read_json(path, lines=True)
    df = df[df.scored & (df.variant.fillna('') == '')].copy()
    df['work'] = df['work'].fillna(df['page']).astype(str)
    df['wkey'] = df['language'] + ':' + df['work']
    df['pkey'] = df['page'].astype(str)
    df['route'] = df['route'].replace({'sub': 'api'})
    df['iclass'] = df['experiment'].map(INSTRUMENT_CLASS)
    assert df.iclass.notna().all(), 'experiment without an instrument class'
    df['is_mean'] = df.judge == 'mean'
    df.loc[df.is_mean, 'judge_model'] = 'claude-opus-5.5'
    assert (df[~df.is_mean].score % 1 == 0).all(), 'a single-judge score is not an integer'
    sm = None
    if summaries:
        sm = pd.read_json(summaries, lines=True)
        sm['route'] = sm['route'].replace({'sub': 'api'})
        sm['iclass'] = sm['experiment'].map(INSTRUMENT_CLASS)
        assert sm.iclass.notna().all()
    return df, sm


class Index:
    def __init__(self, df, sm=None):
        both = pd.concat([df[['model', 'model_family', 'language', 'script_family', 'round', 'iclass']],
                          sm[['model', 'model_family', 'language', 'script_family', 'round', 'iclass']]]
                         if sm is not None and len(sm) else df[['model', 'model_family', 'language', 'script_family',
                                                                'round', 'iclass']])
        self.models = sorted(set(both.model))
        self.fam_of = dict(both[['model', 'model_family']].drop_duplicates().itertuples(index=False))
        self.fams = sorted(set(self.fam_of.values()) | {'gemini-pro'})
        self.langs = sorted(set(both.language))
        self.sf_of = dict(both[['language', 'script_family']].drop_duplicates().itertuples(index=False))
        self.sfs = sorted(set(self.sf_of.values()))
        self.routes = ['api', 'cli', 'stored']
        self.works = sorted(set(df.wkey))
        self.pages = sorted(set(df.pkey))
        self.rounds = sorted(set(both['round']))
        self.class_of_round = dict(both[['round', 'iclass']].drop_duplicates().itertuples(index=False))
        self.classes = CLASSES
        self.judges = JUDGES

    def ix(self, xs):
        return {x: i for i, x in enumerate(xs)}

    def maps(self):
        fi, si, ci = self.ix(self.fams), self.ix(self.sfs), self.ix(self.classes)
        return dict(fam_of_m=jnp.array([fi[self.fam_of[m]] for m in self.models]),
                    mk_of_m=jnp.array([MAKERS.index(maker(self.fam_of[m])) for m in self.models]),
                    sf_of_l=jnp.array([si[self.sf_of[lang]] for lang in self.langs]),
                    class_of_k=jnp.array([ci[self.class_of_round[k]] for k in self.rounds]),
                    jg=jnp.array([float(JUDGE_FAMILY[j] == 'gemini') for j in self.judges]))


def params(ix, round_maker):
    """Sample every effect; returns a dict of arrays on the logit scale."""
    mp = ix.maps()
    nM, nF, nL, nS, nK = len(ix.models), len(ix.fams), len(ix.langs), len(ix.sfs), len(ix.rounds)
    hn = lambda name, s: numpyro.sample(name, dist.HalfNormal(s))
    z = lambda name, shape: numpyro.sample(name, dist.Normal(0, 1).expand(shape))
    tau_sf, tau_lang, tau_fam = hn('tau_sf', 1.5), hn('tau_lang', 1.5), hn('tau_fam', 1.5)
    tau_model, tau_fs, tau_fl, tau_ml = hn('tau_model', 1.0), hn('tau_fs', 1.0), hn('tau_fl', 1.0), hn('tau_ml', 0.7)
    tau_w, tau_p = hn('tau_w', 1.5), hn('tau_p', 1.5)
    tau_round = numpyro.sample('tau_round', dist.HalfNormal(1.0).expand([len(ix.classes)]))
    tau_jf, tau_jfl = hn('tau_jf', 1.0), hn('tau_jfl', 0.5)
    cut = numpyro.sample('cut', dist.TransformedDistribution(
        dist.Normal(0.0, 4.0).expand([4]), dist.transforms.OrderedTransform()))
    P = dict(cut=cut, tau_w=tau_w, tau_p=tau_p)
    P['sf'] = numpyro.deterministic('sf', tau_sf * z('z_sf', (nS,)))
    P['lang'] = numpyro.deterministic('lang', P['sf'][mp['sf_of_l']] + tau_lang * z('z_lang', (nL,)))
    P['fam'] = numpyro.deterministic('fam', tau_fam * z('z_fam', (nF,)))
    P['mod'] = numpyro.deterministic('mod', P['fam'][mp['fam_of_m']] + tau_model * z('z_mod', (nM,)))
    P['route'] = numpyro.deterministic('route', jnp.concatenate([jnp.zeros(1), 1.0 * z('z_route', (2,))]))
    P['fs'] = numpyro.deterministic('fs', tau_fs * z('z_fs', (nF, nS)))
    P['fl'] = numpyro.deterministic('fl', tau_fl * z('z_fl', (nF, nL)))
    P['ml'] = numpyro.deterministic('ml', tau_ml * z('z_ml', (nM, nL)))
    P['wk'] = numpyro.deterministic('wk', tau_w * z('z_w', (len(ix.works),)))
    P['pg'] = numpyro.deterministic('pg', tau_p * z('z_p', (len(ix.pages),)))
    P['rd'] = numpyro.deterministic('rd', tau_round[mp['class_of_k']] * z('z_round', (nK,)))
    P['judge'] = numpyro.deterministic('judge', jnp.concatenate([jnp.zeros(1), 1.5 * z('z_judge', (len(ix.judges) - 1,))]))
    P['jfm'] = numpyro.deterministic('jfm', tau_jf * z('z_jfm', (nF,)))
    P['jfl'] = numpyro.deterministic('jfl', tau_jfl * z('z_jfl', (2, nL)))
    if round_maker:
        tau_rdm = numpyro.sample('tau_rdm', dist.HalfNormal(0.5).expand([len(ix.classes)]))
        P['rdm'] = numpyro.deterministic('rdm', tau_rdm[mp['class_of_k']] * z('z_rdm', (nK,)))
    else:
        P['rdm'] = jnp.zeros(nK)
    return P, mp


def cell_part(P, mp, m, l, r, k, j):
    """Latent for a (model, language, route, round, judge) design row, without page and work effects."""
    f, s, a = mp['fam_of_m'][m], mp['sf_of_l'][l], mp['mk_of_m'][m]
    g = mp['jg'][j]
    return (P['lang'][l] + P['mod'][m] + P['route'][r] + P['fs'][f, s] + P['fl'][f, l] + P['ml'][m, l]
            + P['rd'][k] + a * P['rdm'][k] + P['judge'][j] + g * (P['jfm'][f] + P['jfl'][a, l]))


def model_fn(ix, round_maker, m, l, r, w, p, k, j, u1, y1, u2, y2, S=None):
    P, mp = params(ix, round_maker)
    cut = P['cut']
    eta = cell_part(P, mp, m, l, r, k, j) + P['wk'][w] + P['pg'][p]
    cuts = jnp.concatenate([jnp.array([-1e3]), cut, jnp.array([1e3])])
    cdf = lambda c, e: jax.nn.sigmoid(cuts[c] - e)
    e1 = eta[u1]
    ll = jnp.log(jnp.clip(cdf(y1 + 1, e1) - cdf(y1, e1), 1e-12, 1.0)).sum()
    if u2.shape[0]:
        pr = probs_of(eta[u2], cut)
        conv = jnp.stack([sum(pr[:, a] * pr[:, t - a] for a in range(5) if 0 <= t - a < 5) for t in range(9)], 1)
        ll = ll + jnp.log(jnp.clip(jnp.take_along_axis(conv, y2[:, None], 1)[:, 0], 1e-12, 1.0)).sum()
    if S is not None:
        # cell means: per (cell, page) entry, E[score] with the page's own effects or integrated over unseen ones
        base = cell_part(P, mp, S['m'], S['l'], S['r'], S['k'], S['j'])
        ent = (base[S['ec']] + jnp.where(S['ep'] >= 0, P['pg'][jnp.maximum(S['ep'], 0)], 0.0)
               + jnp.where(S['ew'] >= 0, P['wk'][jnp.maximum(S['ew'], 0)], 0.0))
        sd = jnp.sqrt(P['tau_p'] ** 2 * (S['ep'] < 0) + P['tau_w'] ** 2 * (S['ew'] < 0) + 1e-9)   # sqrt'(0) is a NaN gradient
        grid = ent[:, None] + sd[:, None] * jnp.array(_GH_X)[None, :]
        es = (probs_of(grid, cut) * jnp.arange(1, 6)).sum(-1)
        es = (es * jnp.array(_GH_W)).sum(1) / _GH_W.sum()
        mu = jax.ops.segment_sum(es, S['ec'], num_segments=S['n_cells']) / S['count']
        ll = ll + dist.Normal(mu, S['se']).log_prob(S['y']).sum()
    numpyro.factor('loglik', ll)


SITES = ['tau_sf', 'tau_lang', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl', 'tau_ml', 'tau_w', 'tau_p', 'tau_round',
         'tau_jf', 'tau_jfl', 'tau_rdm', 'cut', 'sf', 'lang', 'fam', 'mod', 'route', 'fs', 'fl', 'ml', 'wk', 'pg', 'rd',
         'judge', 'jfm', 'jfl', 'rdm']
HYPER = ['tau_sf', 'tau_lang', 'tau_fam', 'tau_model', 'tau_fs', 'tau_fl', 'tau_ml', 'tau_w', 'tau_p', 'tau_round',
         'tau_jf', 'tau_jfl', 'tau_rdm', 'cut']
model_v1.HYPER = HYPER      # v1's diagnostics() reports the hyperparameters it finds in this list


def design(ix, df):
    I = lambda xs: ix.ix(xs)
    enc = dict(m=df.model.map(I(ix.models)), l=df.language.map(I(ix.langs)), r=df.route.map(I(ix.routes)),
               w=df.wkey.map(I(ix.works)), p=df.pkey.map(I(ix.pages)), k=df['round'].map(I(ix.rounds)),
               j=df.judge_model.map(I(ix.judges)))
    assert all(v.notna().all() for v in enc.values()), 'unencodable row'
    keys = np.stack([enc[c].values.astype(int) for c in 'mlrwpkj'], 1)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.ravel()
    one, two = ~df.is_mean.values, df.is_mean.values
    data = dict(u1=jnp.array(inv[one]), y1=jnp.array(df.score.values[one].astype(int) - 1),
                u2=jnp.array(inv[two]), y2=jnp.array(np.round(df.score.values[two] * 2).astype(int) - 2))
    return {c: jnp.array(uniq[:, i]) for i, c in enumerate('mlrwpkj')}, data


def design_summaries(ix, sm):
    if sm is None or not len(sm):
        return None
    I = lambda xs: ix.ix(xs)
    pi, wi = I(ix.pages), I(ix.works)
    ec, ep, ew = [], [], []
    for c, row in enumerate(sm.itertuples(index=False)):
        for pg, wk in zip(row.pages, row.works):
            ec.append(c)
            ep.append(pi.get(str(pg), -1))
            ew.append(wi.get(f'{row.language}:{wk}', -1))
    return dict(m=jnp.array(sm.model.map(I(ix.models)).values), l=jnp.array(sm.language.map(I(ix.langs)).values),
                r=jnp.array(sm.route.map(I(ix.routes)).values), k=jnp.array(sm['round'].map(I(ix.rounds)).values),
                j=jnp.array(sm.judge_model.map(I(ix.judges)).values), ec=jnp.array(ec), ep=jnp.array(ep),
                ew=jnp.array(ew), n_cells=len(sm), count=jnp.array(sm.pages.map(len).values, dtype=float),
                y=jnp.array(sm['mean'].values), se=jnp.array(sm.se.values))


def fit(df, sm=None, seed=0, warmup=500, samples=500, chains=4, round_maker=True):
    ix = Index(df, sm)
    e, data = design(ix, df)
    S = design_summaries(ix, sm)
    kern = NUTS(lambda **kw: model_fn(ix, round_maker, S=S, **kw), target_accept_prob=0.9)
    mc = MCMC(kern, num_warmup=warmup, num_samples=samples, num_chains=chains, chain_method='parallel',
              progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',), **e, **data)
    by_chain = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items() if k in SITES}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by_chain.items()}
    if 'rdm' not in post:
        post['rdm'] = np.zeros((post['cut'].shape[0], len(ix.rounds)))
        post['tau_rdm'] = np.zeros((post['cut'].shape[0], len(ix.classes)))
    return ix, post, diagnostics(ix, by_chain, int(np.asarray(mc.get_extra_fields()['diverging']).sum()),
                                 chains, samples)


# ---------- prediction ----------

def _fresh(rng, S, sd):
    return rng.normal(0, 1, S) * sd


def cell_eta(ix, post, model, route, lang, rng, family=None, judge='claude-opus-5.5'):
    """Posterior draws of a cell's latent (logit scale): average work and page, no round effect, judged by `judge`.
    A model or language not in the fit is a fresh draw from its family / script family."""
    S = post['cut'].shape[0]
    fi = ix.ix(ix.fams)
    fam_name = family or ix.fam_of.get(model)
    f = fi.get(fam_name)
    fam = post['fam'][:, f] if f is not None else _fresh(rng, S, post['tau_fam'])
    if lang in ix.langs:
        li = ix.langs.index(lang)
        lang_e = post['lang'][:, li]
    else:
        li, lang_e = None, _fresh(rng, S, np.sqrt(post['tau_sf'] ** 2 + post['tau_lang'] ** 2))
    s = ix.sfs.index(ix.sf_of[lang]) if lang in ix.sf_of else None
    if model in ix.models:
        mi = ix.models.index(model)
        mod = post['mod'][:, mi]
        ml = post['ml'][:, mi, li] if li is not None else _fresh(rng, S, post['tau_ml'])
    else:
        mod, ml = fam + _fresh(rng, S, post['tau_model']), _fresh(rng, S, post['tau_ml'])
    fs = post['fs'][:, f, s] if f is not None and s is not None else _fresh(rng, S, post['tau_fs'])
    fl = post['fl'][:, f, li] if f is not None and li is not None else _fresh(rng, S, post['tau_fl'])
    eta = lang_e + mod + post['route'][:, ix.routes.index(route)] + fs + fl + ml
    j = ix.judges.index(judge)
    eta = eta + post['judge'][:, j]
    if JUDGE_FAMILY[judge] == 'gemini':
        a = MAKERS.index(maker(fam_name))
        eta = eta + (post['jfm'][:, f] if f is not None else _fresh(rng, S, post['tau_jf']))
        eta = eta + (post['jfl'][:, a, li] if li is not None else _fresh(rng, S, post['tau_jfl']))
    return eta


_GH21_X, _GH21_W = np.polynomial.hermite_e.hermegauss(21)


def marginal_score(eta, post):
    sd = np.sqrt(post['tau_w'] ** 2 + post['tau_p'] ** 2)
    grid = eta[:, None] + sd[:, None] * _GH21_X[None, :]
    return (expected_score(grid, post['cut']) * _GH21_W).sum(1) / _GH21_W.sum()


class Panel:
    """Page, work and round effects for one judged panel, shared by every cell on it. The round effect has a
    common part and, for Gemini-made arms, the round x maker part (v2)."""

    def __init__(self, ix, post, rng, iclass=None, round_name=None):
        self.ix, self.post, self.rng = ix, post, rng
        self.S = post['cut'].shape[0]
        self.pidx, self.widx = ix.ix(ix.pages), ix.ix(ix.works)
        self.pe, self.we = {}, {}
        if round_name is not None and round_name in ix.rounds:
            k = ix.rounds.index(round_name)
            self.round, self.round_g = post['rd'][:, k], post['rdm'][:, k]
        elif iclass is not None:
            c = ix.classes.index(iclass)
            self.round = rng.normal(0, 1, self.S) * post['tau_round'][:, c]
            self.round_g = rng.normal(0, 1, self.S) * post['tau_rdm'][:, c]
        else:
            self.round, self.round_g = np.zeros(self.S), np.zeros(self.S)

    def page(self, p):
        if p not in self.pe:
            self.pe[p] = self.post['pg'][:, self.pidx[p]] if p in self.pidx else self.rng.normal(0, 1, self.S) * self.post['tau_p']
        return self.pe[p]

    def work(self, w):
        if w not in self.we:
            self.we[w] = self.post['wk'][:, self.widx[w]] if w in self.widx else self.rng.normal(0, 1, self.S) * self.post['tau_w']
        return self.we[w]

    def round_for(self, family):
        return self.round + (self.round_g if maker(family) == 'gemini' else 0.0)

    def eta_rows(self, cell, pages, works, family):
        """(S, rows) latent per (page, work) row; `cell` already carries its judge terms."""
        return np.stack([cell + self.page(p) + self.work(w) for p, w in zip(pages, works)], 1) + self.round_for(family)[:, None]

    def simulate_mean(self, eta_rows, reads=1):
        cut = self.post['cut'][:, None, :]
        cdf = 1.0 / (1.0 + np.exp(-(cut - eta_rows[..., None])))
        tot = np.zeros(self.S)
        for _ in range(reads):
            u = self.rng.random(eta_rows.shape)
            tot += (1 + (u[..., None] > cdf).sum(-1)).mean(1)
        return tot / reads
