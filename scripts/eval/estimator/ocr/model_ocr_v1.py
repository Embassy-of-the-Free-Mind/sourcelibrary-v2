#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/model_ocr_v0.py — the v0 accuracy model (one beta-binomial over every scored
# read; its levels run 0.064 CER high because 6.6% of reads score exactly 100% error) and failures_v0.py (failed reads
# per route x script with no period, fame or page-kind term, so it predicted ~2% for Gemini 3.8 Flash on English where
# #4763 measured 25%). v1 keeps v0's hierarchy and adds the hurdle, the did-not-read terms and the number outcomes
# .claude/docs/quality-research-system.md §3a names (#6740).
"""OCR estimator v1: hurdle accuracy, did-not-read with era / fame / page-kind terms, number errors (#6740).

Rows: build-ocr-table-v1.py (Pareto chart rows + the #4763 English gate rows). Page p (work w, panel s, chart c,
era t) read by engine e of family F.

1. Accuracy, among reads (a failed read is counted in 2, never scored here):
     z = 1[CER >= 0.999]                     the point mass v0 could not fit (unplaced reads, wrong text)
     z ~ Bernoulli(h),  logit h  = lin_h
     errors | z = 0 ~ BetaBinomial(n_ref, mu phi_c, (1 - mu) phi_c),  logit mu = lin_mu, phi_c = phi exp(lphi[c])
     E[CER] = h + (1 - h) mu
   lin = a + fam[F] + eng[e] + chart[c] + fc[F, c] + ec[e, c] + era[t] + panel[s] + work[w] + page[p]
         + dense * (d + ed[e])
   work[w] ~ N(0, tau_work * exp(lt_work[c(w)])), page[p] likewise: each chart scales the shared spread
   With `hurdle=False` the same lin_mu drives one beta-binomial over every read: v0's structure, refitted here so the
   level-bias comparison is on the same rows and the same inference.

2. Did not read (refusal, copy filter, empty, timeout), every row:
     logit q = a + fam[F] + eng[e] + chart[c] + ec[e, c] + era[t] + fe[F, t]
               + fame_web * (b_fame + bf[F]) + dense * (b_dense + bd[F]) + work[w] + page[p]
   fame_web = the page's text is a public web transcription (Wikisource): the recitation filter keys on text it has
   seen. fe, bf, bd let the recitation-prone Gemini families differ from engines that fail for other reasons.

3. Numbers, on pages that print numbers (#4763 rows, scorePage's num_* counts), for o in misread / dropped / spurious:
     k_o ~ Poisson(num_ref * exp(a_o + eng_o[e] + stratum_o[s] + es_o[e, s] + page_o[p]))
   page_o carries the overdispersion (pages of numbers fail together) and is shared by the engines. A cell's rate is
   per number printed over the stratum's measured pages (number-weighted, as a reader meets them).

Script-family extension (`ext=True`, #7341): the Arabic charts are new, and a new chart's effect drawn from the
spread of every chart is what made the #4763 holdout centre on 0.2-0.3 CER (2026-10-24 file, section 7). With ext,
both parts 1 and 2 add
     + grp[g] + kind[k] + eg[e, g] + ek[e, k]
   g = the chart's script group (GROUP_OF: Arabic, Hebrew and Syriac are one group of right-to-left abjads), k =
   manuscript | print; eg / ek let an engine's strength on that group and on handwriting carry to a chart it has
   not read. Part 1 adds the key: + kt[key_type] + b_self * key_self (kt = 0 for an expert or published reference;
   model keys and corrected-served keys get a shift, and a read the key was built from gets b_self). Part 2 adds
   + alchemy * (b_alch + ba[F]): Gemini's CLI safety filter cut alchemical recipes on 16 of 26 Jabir pages.
A cell's prediction is for an expert key and a read the key did not come from (key_type = reference, key_self = 0).

Inference: stochastic variational inference (AutoNormal) for 1 and 2, which have ~12K rows and ~2K page effects (v0's
NUTS fit of 1 alone took 5.9 h on 3 cores); NUTS for 3, which is small. SVI intervals run narrow; the held-out check
in fit_ocr_v1.py is the test of whether they are honest.
"""
import os
import numpy as np
import pandas as pd

import numpyro
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS, SVI, Trace_ELBO, Predictive  # noqa: E402
from numpyro.infer.autoguide import AutoNormal  # noqa: E402
from numpyro.optim import Adam  # noqa: E402

LEVELS = ['fam', 'eng', 'chart', 'era', 'panel', 'work', 'page', 'grp', 'kind', 'ktype']
COL = {'fam': 'engine_family', 'eng': 'engine', 'chart': 'chart', 'era': 'era', 'panel': 'panel', 'work': 'work',
       'page': 'page', 'grp': 'script_group', 'kind': 'kind', 'ktype': 'key_type'}
HUNDRED = 0.999
GROUPS = {'latin': 'Latn', 'latin-script-other': 'Latn', 'english': 'Latn', 'greek': 'Grek', 'chinese': 'Hani',
          'armenian': 'Armn', 'hebrew': 'semitic-rtl', 'rashi': 'semitic-rtl', 'syriac': 'semitic-rtl',
          'arabic': 'semitic-rtl'}


def GROUP_OF(chart):
    """The script group of a chart, by its name's first part (english-1880-1930-dense -> english -> Latn)."""
    c = chart if chart in GROUPS else chart.split('-')[0]
    return GROUPS[c]


def load(path, extra=None):
    """v1's table, plus optional extra rows (the Arabic rows), with the extension's columns filled for old rows."""
    df = pd.read_json(path, lines=True)
    if extra:
        df = pd.concat([df, pd.read_json(extra, lines=True)], ignore_index=True)
    df['script_group'] = df.chart.map(GROUP_OF)
    for c, v in (('key_type', 'reference'), ('key_self', 0), ('alchemy', 0)):
        df[c] = df[c].fillna(v) if c in df else v
    df['key_self'] = df.key_self.astype(int)
    df['alchemy'] = df.alchemy.astype(int)
    df['n'] = df.n_ref.clip(lower=20).astype(int)
    df['k'] = np.where(df.scored, np.minimum(df.n, np.round(df.cer.fillna(0).clip(0, 1) * df.n)), 0).astype(int)
    df['z'] = (df.scored & (df.cer >= HUNDRED)).astype(int)
    df['fail'] = (~df.scored).astype(int)
    return df


class Index:
    def __init__(self, df, ext=False):
        self.ext = ext
        self.lv = {f: sorted(set(df[COL[f]])) for f in LEVELS}
        self.fam_of = dict(df[['engine', 'engine_family']].drop_duplicates().itertuples(index=False))
        ci = self.i('chart')
        self.chart_of_page = jnp.array([ci[c] for c in df.groupby('page').chart.agg(lambda s: s.value_counts().index[0])
                                       .reindex(self.lv['page'])])
        self.chart_of_work = jnp.array([ci[c] for c in df.groupby('work').chart.agg(lambda s: s.value_counts().index[0])
                                       .reindex(self.lv['work'])])

    def i(self, f):
        return {x: j for j, x in enumerate(self.lv[f])}

    def enc(self, df):
        e = {f: jnp.array(df[COL[f]].map(self.i(f)).values) for f in LEVELS if f in self.lv}  # a v1 pickle has no grp
        e['dense'] = jnp.array(df.dense.values, dtype=float)
        e['web'] = jnp.array(df.fame_web.values, dtype=float)
        e['self'] = jnp.array(df.key_self.values, dtype=float)
        e['alch'] = jnp.array(df.alchemy.values, dtype=float)
        return e

    def fam_of_eng(self):
        return jnp.array([self.i('fam')[self.fam_of[e]] for e in self.lv['eng']])


def _effects(p, ix, x, refusal=False):
    """One part's hierarchical linear predictor. p: site prefix. Returns (eta, sampled effect arrays)."""
    N = {f: len(ix.lv[f]) for f in LEVELS}
    hn = lambda n, s: numpyro.sample(f'{p}tau_{n}', dist.HalfNormal(s))
    z = lambda n, shape: numpyro.sample(f'{p}z_{n}', dist.Normal(0, 1).expand(shape).to_event(len(shape)))
    det = lambda n, v: numpyro.deterministic(f'{p}{n}', v)
    a = numpyro.sample(f'{p}a', dist.Normal(-3.0, 2.0))
    F = det('F', hn('fam', 1.5) * z('fam', (N['fam'],)))
    E = det('E', F[ix.fam_of_eng()] + hn('eng', 1.0) * z('eng', (N['eng'],)))
    C = det('C', hn('chart', 1.5) * z('chart', (N['chart'],)))
    EC = det('EC', hn('ec', 0.7) * z('ec', (N['eng'], N['chart'])))
    T = det('T', hn('era', 1.0) * z('era', (N['era'],)))
    if refusal:
        W = det('W', hn('work', 1.5) * z('work', (N['work'],)))
        P = det('P', hn('page', 1.5) * z('page', (N['page'],)))
    else:
        # accuracy: the spread of works and pages differs by chart (Syriac works fail whole, English 1880-1930 pages
        # split prose from indexes), so each chart scales the shared spread
        tw = det('tau_work_c', hn('work', 1.5) * jnp.exp(numpyro.sample(
            f'{p}lt_work', dist.Normal(0, 0.7).expand((N['chart'],)).to_event(1))))
        tp = det('tau_page_c', hn('page', 1.5) * jnp.exp(numpyro.sample(
            f'{p}lt_page', dist.Normal(0, 0.7).expand((N['chart'],)).to_event(1))))
        W = det('W', tw[ix.chart_of_work] * z('work', (N['work'],)))
        P = det('P', tp[ix.chart_of_page] * z('page', (N['page'],)))
    eta = a + E[x['eng']] + C[x['chart']] + EC[x['eng'], x['chart']] + T[x['era']] + W[x['work']] + P[x['page']]
    if ix.ext:
        G = det('G', hn('grp', 1.0) * z('grp', (N['grp'],)))
        K = det('K', hn('kind', 1.0) * z('kind', (N['kind'],)))
        EG = det('EG', hn('eg', 0.7) * z('eg', (N['eng'], N['grp'])))
        EK = det('EK', hn('ek', 0.7) * z('ek', (N['eng'], N['kind'])))
        eta = eta + G[x['grp']] + K[x['kind']] + EG[x['eng'], x['grp']] + EK[x['eng'], x['kind']]
        if refusal:
            ba = numpyro.sample(f'{p}b_alch', dist.Normal(0, 1.5))
            BA = det('BA', hn('ba', 1.0) * z('ba', (N['fam'],)))
            eta = eta + x['alch'] * (ba + BA[x['fam']])
        else:
            ref = jnp.array([k == 'reference' for k in ix.lv['ktype']])
            KT = det('KT', jnp.where(ref, 0.0, numpyro.sample(f'{p}kt', dist.Normal(0, 1.0).expand((N['ktype'],)).to_event(1))))
            eta = eta + KT[x['ktype']] + numpyro.sample(f'{p}b_self', dist.Normal(0, 1.0)) * x['self']
    if refusal:
        FT = det('FT', hn('fe', 1.0) * z('fe', (N['fam'], N['era'])))
        bfame = numpyro.sample(f'{p}b_fame', dist.Normal(0, 1.5))
        BF = det('BF', hn('bf', 1.0) * z('bf', (N['fam'],)))
        bd = numpyro.sample(f'{p}b_dense', dist.Normal(0, 1.5))
        BD = det('BD', hn('bd', 1.0) * z('bd', (N['fam'],)))
        eta = eta + FT[x['fam'], x['era']] + x['web'] * (bfame + BF[x['fam']]) + x['dense'] * (bd + BD[x['fam']])
    else:
        FC = det('FC', hn('fc', 1.0) * z('fc', (N['fam'], N['chart'])))
        S = det('S', hn('panel', 1.0) * z('panel', (N['panel'],)))
        d = numpyro.sample(f'{p}b_dense', dist.Normal(0, 1.5))
        ED = det('ED', hn('ed', 0.7) * z('ed', (N['eng'],)))
        eta = eta + FC[x['fam'], x['chart']] + S[x['panel']] + x['dense'] * (d + ED[x['eng']])
    return eta


def accuracy_model(ix, x, n, k, z, hurdle=True):
    """x, n, k, z restricted to scored rows."""
    eta_mu = _effects('mu_', ix, x)
    # dispersion by chart: a clean chart (English 1880-1930 prose) is not as skewed as a Syriac manuscript, and one
    # shared phi let the fit read a clean chart's low median as the tail of a skewed beta and keep its mean high
    phi0 = numpyro.sample('phi', dist.LogNormal(3.0, 1.5))
    lphi = numpyro.sample('lphi', dist.Normal(0, 1.0).expand((len(ix.lv['chart']),)).to_event(1))
    phi = numpyro.deterministic('phi_c', phi0 * jnp.exp(lphi))[x['chart']]
    mu = jnp.clip(jax.nn.sigmoid(eta_mu), 1e-6, 1 - 1e-6)
    if hurdle:
        eta_h = _effects('h_', ix, x)
        numpyro.sample('z', dist.Bernoulli(logits=eta_h), obs=z)
        keep = z == 0
        ll = dist.BetaBinomial(mu * phi, (1 - mu) * phi, total_count=n).log_prob(k)
        numpyro.factor('y', jnp.where(keep, ll, 0.0).sum())
    else:
        numpyro.sample('y', dist.BetaBinomial(mu * phi, (1 - mu) * phi, total_count=n), obs=k)


def refusal_model(ix, x, fail):
    eta = _effects('q_', ix, x, refusal=True)
    numpyro.sample('fail', dist.Bernoulli(logits=eta), obs=fail)


def svi_fit(model, seed, steps, lr=0.01, draws=400, **kw):
    guide = AutoNormal(model, init_scale=0.05)
    svi = SVI(model, guide, Adam(lr), Trace_ELBO())
    res = svi.run(jax.random.PRNGKey(seed), steps, progress_bar=False, **kw)
    lat = guide.sample_posterior(jax.random.PRNGKey(seed + 1), res.params, sample_shape=(draws,))
    det = Predictive(model, posterior_samples=lat)(jax.random.PRNGKey(seed + 2), **kw)
    post = {k: np.asarray(v) for k, v in {**lat, **det}.items() if k not in ('y', 'z', 'fail')}
    loss = np.asarray(res.losses)
    diag = dict(method='SVI AutoNormal', steps=steps, draws=draws,
                elbo_last=float(loss[-1]), elbo_change_last_10pct=float(loss[-len(loss) // 10:].mean() -
                                                                         loss[-len(loss) // 5:-len(loss) // 10].mean()))
    return post, diag


def fit_accuracy(df, hurdle=True, seed=0, steps=20000, ext=False):
    s = df[df.scored].reset_index(drop=True)
    ix = Index(s, ext)
    post, diag = svi_fit(accuracy_model, seed, steps, ix=ix, x=ix.enc(s), n=jnp.array(s.n.values),
                         k=jnp.array(s.k.values), z=jnp.array(s.z.values), hurdle=hurdle)
    return ix, post, diag


def fit_refusal(df, seed=0, steps=20000, ext=False):
    ix = Index(df, ext)
    post, diag = svi_fit(refusal_model, seed, steps, ix=ix, x=ix.enc(df), fail=jnp.array(df.fail.values))
    return ix, post, diag


def row_eta(post, p, ix, d, refusal=False):
    """Per-draw linear predictor for rows d whose levels the fit saw (in-sample predictive)."""
    e = {k: np.asarray(v) for k, v in ix.enc(d).items()}
    g = lambda n: post[p + n]
    eta = (g('a')[:, None] + g('E')[:, e['eng']] + g('C')[:, e['chart']] + g('EC')[:, e['eng'], e['chart']]
           + g('T')[:, e['era']] + g('W')[:, e['work']] + g('P')[:, e['page']])
    if getattr(ix, 'ext', False):
        eta = eta + g('G')[:, e['grp']] + g('K')[:, e['kind']] + g('EG')[:, e['eng'], e['grp']] + g('EK')[:, e['eng'], e['kind']]
        if refusal:
            eta = eta + e['alch'] * (g('b_alch')[:, None] + g('BA')[:, e['fam']])
        else:
            eta = eta + g('KT')[:, e['ktype']] + g('b_self')[:, None] * e['self']
    if refusal:
        eta = eta + g('FT')[:, e['fam'], e['era']] + e['web'] * (g('b_fame')[:, None] + g('BF')[:, e['fam']]) \
            + e['dense'] * (g('b_dense')[:, None] + g('BD')[:, e['fam']])
    else:
        eta = eta + g('FC')[:, e['fam'], e['chart']] + g('S')[:, e['panel']] \
            + e['dense'] * (g('b_dense')[:, None] + g('ED')[:, e['eng']])
    return eta


def _lvl(post, p, ix, name, f, key, rng, tau):
    """Draws of one effect at `key`; a fresh draw from its spread when the fit never saw the level."""
    j = ix.i(f).get(key)
    return post[p + name][:, j] if j is not None else rng.normal(0, 1, post[p + 'a'].shape[0]) * post[p + 'tau_' + tau]


def cell_eta(post, p, ix, engine, family, chart, era, panel, dense, web, rng, refusal=False, kind=None, alchemy=0,
             key_type='reference', key_self=0):
    """Per-draw linear predictor for an average NEW page and work of a cell, as a (draws,) array without the
    work/page terms (integrate those with `spread`). kind / alchemy / key_* are read only by an `ext` fit."""
    S = post[p + 'a'].shape[0]
    f = ix.i('fam').get(family)
    Fe = post[p + 'F'][:, f] if f is not None else rng.normal(0, 1, S) * post[p + 'tau_fam']
    if engine in ix.i('eng'):
        j = ix.i('eng')[engine]
        E = post[p + 'E'][:, j]
        c = ix.i('chart').get(chart)
        EC = post[p + 'EC'][:, j, c] if c is not None else rng.normal(0, 1, S) * post[p + 'tau_ec']
    else:
        j = None
        E = Fe + rng.normal(0, 1, S) * post[p + 'tau_eng']
        EC = rng.normal(0, 1, S) * post[p + 'tau_ec']
    eta = post[p + 'a'] + E + EC + _lvl(post, p, ix, 'C', 'chart', chart, rng, 'chart') + \
        _lvl(post, p, ix, 'T', 'era', era, rng, 'era')
    if getattr(ix, 'ext', False):
        g = GROUP_OF(chart)
        eta = eta + _lvl(post, p, ix, 'G', 'grp', g, rng, 'grp') + _lvl(post, p, ix, 'K', 'kind', kind, rng, 'kind')
        gi, ki = ix.i('grp').get(g), ix.i('kind').get(kind)
        eta = eta + (post[p + 'EG'][:, j, gi] if j is not None and gi is not None else rng.normal(0, 1, S) * post[p + 'tau_eg'])
        eta = eta + (post[p + 'EK'][:, j, ki] if j is not None and ki is not None else rng.normal(0, 1, S) * post[p + 'tau_ek'])
        if refusal:
            BA = post[p + 'BA'][:, f] if f is not None else rng.normal(0, 1, S) * post[p + 'tau_ba']
            eta = eta + alchemy * (post[p + 'b_alch'] + BA)
        else:
            if key_type != 'reference':  # a key type the fit never saw: its N(0, 1) prior
                kj = ix.i('ktype').get(key_type)
                eta = eta + (post[p + 'KT'][:, kj] if kj is not None else rng.normal(0, 1, S))
            eta = eta + key_self * post[p + 'b_self']
    if refusal:
        t = ix.i('era').get(era)
        FT = post[p + 'FT'][:, f, t] if f is not None and t is not None else rng.normal(0, 1, S) * post[p + 'tau_fe']
        BF = post[p + 'BF'][:, f] if f is not None else rng.normal(0, 1, S) * post[p + 'tau_bf']
        BD = post[p + 'BD'][:, f] if f is not None else rng.normal(0, 1, S) * post[p + 'tau_bd']
        eta = eta + FT + web * (post[p + 'b_fame'] + BF) + dense * (post[p + 'b_dense'] + BD)
    else:
        c = ix.i('chart').get(chart)
        FC = post[p + 'FC'][:, f, c] if f is not None and c is not None else rng.normal(0, 1, S) * post[p + 'tau_fc']
        ED = post[p + 'ED'][:, j] if j is not None else rng.normal(0, 1, S) * post[p + 'tau_ed']
        Sp = _lvl(post, p, ix, 'S', 'panel', panel, rng, 'panel') if panel else 0.0
        eta = eta + FC + Sp + dense * (post[p + 'b_dense'] + ED)
    return eta


_GH_X, _GH_W = np.polynomial.hermite_e.hermegauss(21)


def spread(post, p, ix=None, chart=None, rng=None):
    """Per-draw sd of work + page effects for a new page: the chart's own spread where the fit has one; a chart the
    fit never saw draws its scale from the charts' spread of scales."""
    if p + 'tau_page_c' not in post:
        return np.sqrt(post[p + 'tau_work'] ** 2 + post[p + 'tau_page'] ** 2)
    c = ix.i('chart').get(chart)
    if c is not None:
        return np.sqrt(post[p + 'tau_work_c'][:, c] ** 2 + post[p + 'tau_page_c'][:, c] ** 2)
    S = post[p + 'a'].shape[0]
    return np.sqrt((post[p + 'tau_work'] * np.exp(rng.normal(0, 0.7, S))) ** 2 +
                   (post[p + 'tau_page'] * np.exp(rng.normal(0, 0.7, S))) ** 2)


def mean_sigmoid(eta, sd):
    """E[sigmoid(eta + sd * N(0,1))] per draw."""
    g = eta[:, None] + sd[:, None] * _GH_X[None, :]
    return (1 / (1 + np.exp(-g)) * _GH_W).sum(1) / _GH_W.sum()


def cell_cer(post, ix, hurdle=True, **cell):
    """Draws of E[CER] over new pages of the cell, among reads: h + (1 - h) mu, page/work effects integrated."""
    rng = cell.pop('rng')
    mu = mean_sigmoid(cell_eta(post, 'mu_', ix, rng=rng, **cell), spread(post, 'mu_', ix, cell['chart'], rng))
    if not hurdle:
        return mu
    h = mean_sigmoid(cell_eta(post, 'h_', ix, rng=rng, **cell), spread(post, 'h_', ix, cell['chart'], rng))
    return h + (1 - h) * mu


def cell_fail(post, ix, **cell):
    rng = cell.pop('rng')
    return mean_sigmoid(cell_eta(post, 'q_', ix, rng=rng, refusal=True, **cell), spread(post, 'q_'))


# ---- 3. numbers ---------------------------------------------------------------------------------------------------
NUM = ['sub', 'drop', 'ins']


def numbers_model(eng, strat, page, nref, ks, n_eng, n_strat, n_page):
    for o, k in zip(NUM, ks):
        a = numpyro.sample(f'{o}_a', dist.Normal(-3.0, 2.0))
        E = numpyro.deterministic(f'{o}_E', numpyro.sample(f'{o}_tau_eng', dist.HalfNormal(1.0)) *
                                  numpyro.sample(f'{o}_z_eng', dist.Normal(0, 1).expand([n_eng]).to_event(1)))
        St = numpyro.deterministic(f'{o}_S', numpyro.sample(f'{o}_tau_strat', dist.HalfNormal(1.5)) *
                                   numpyro.sample(f'{o}_z_strat', dist.Normal(0, 1).expand([n_strat]).to_event(1)))
        ES = numpyro.deterministic(f'{o}_ES', numpyro.sample(f'{o}_tau_es', dist.HalfNormal(0.7)) *
                                   numpyro.sample(f'{o}_z_es', dist.Normal(0, 1).expand([n_eng, n_strat]).to_event(2)))
        tp = numpyro.sample(f'{o}_tau_page', dist.HalfNormal(1.0))
        P = tp * numpyro.sample(f'{o}_z_page', dist.Normal(0, 1).expand([n_page]).to_event(1))
        rate = jnp.exp(a + E[eng] + St[strat] + ES[eng, strat] + P[page])
        numpyro.sample(f'{o}_k', dist.Poisson(nref * rate), obs=k)


def fit_numbers(df, seed=0, warmup=int(os.environ.get('NUM_WARMUP', 800)), samples=int(os.environ.get('NUM_SAMPLES', 800)), chains=3):
    s = df[df.scored & df.num_ref.fillna(0).gt(0)].reset_index(drop=True)
    lv = {'eng': sorted(set(s.engine)), 'strat': sorted(set(s.stratum)), 'page': sorted(set(s.page))}
    enc = {f: jnp.array(s[{'eng': 'engine', 'strat': 'stratum', 'page': 'page'}[f]].map(
        {x: j for j, x in enumerate(lv[f])}).values) for f in lv}
    mc = MCMC(NUTS(numbers_model, target_accept_prob=0.95), num_warmup=warmup, num_samples=samples,
              num_chains=chains, chain_method='sequential', progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',), eng=enc['eng'], strat=enc['strat'],
           page=enc['page'], nref=jnp.array(s.num_ref.values, dtype=float),
           ks=[jnp.array(s[f'num_{o}'].values) for o in NUM], n_eng=len(lv['eng']), n_strat=len(lv['strat']),
           n_page=len(lv['page']))
    post = {k: np.asarray(v) for k, v in mc.get_samples().items()}
    from numpyro.diagnostics import summary
    by = mc.get_samples(group_by_chain=True)
    rh = max(float(np.nanmax(np.atleast_1d(summary({k: np.asarray(v)}, group_by_chain=True)[k]['r_hat'])))
             for k, v in by.items())
    diag = dict(method='NUTS', chains=chains, draws_per_chain=samples, max_rhat=round(rh, 3),
                divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()))
    return lv, s, post, diag


def stratum_pages(df, lv):
    """stratum -> (indices into lv['page'], numbers printed on each): every page of the stratum that prints numbers."""
    s = df[df.num_ref.fillna(0).gt(0)].groupby('page').agg(stratum=('stratum', 'first'), n=('num_ref', 'max'))
    pi = {p: j for j, p in enumerate(lv['page'])}
    out = {}
    for st, g in s.groupby('stratum'):
        g = g[g.index.isin(pi)]
        out[st] = (np.array([pi[p] for p in g.index]), g.n.values.astype(float))
    return out


def number_rate(lv, post, o, engine, stratum, pages):
    """Draws of errors of kind o per number printed, on the stratum's measured number-bearing pages: sum over pages of
    numbers x rate / numbers printed, each page with its fitted page effect. The page effects are shared by the
    engines, so two engines are compared on the same pages, including pages one of them did not read."""
    e, s = lv['eng'].index(engine), lv['strat'].index(stratum)
    idx, n = pages[stratum]
    P = post[f'{o}_tau_page'][:, None] * post[f'{o}_z_page'][:, idx]
    base = post[f'{o}_a'] + post[f'{o}_E'][:, e] + post[f'{o}_S'][:, s] + post[f'{o}_ES'][:, e, s]
    return (np.exp(base[:, None] + P) * n[None, :]).sum(1) / n.sum()
