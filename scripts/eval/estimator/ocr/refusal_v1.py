#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/failures_v0.py — failed_read as one hierarchical binomial per (route, script)
# over curated experiment counts; no period, no fame, no prompt, and it put Gemini 3.8 Flash at ~2% on English where
# #4763 measured 25%. This keeps its book-clustering idea (a beta-binomial per book) and adds the terms that decide
# refusals, fitted on the pipeline's own per-book record (refusal-census.mjs) plus the #4763 gate's paired pages (#6740).
"""OCR estimator v1, refusals: P(the route does not read the page) by route, language, period and how well known the
text is (#6740).

A refusal here is Gemini's RECITATION / content-filter stop, or a CLI reply that is a refusal or a summary instead of
a transcription (cli-chatter's `refusal or summary`). It is counted, never scored (#6523).

  logit p = a[route] + b[lang] + c[period] + d[route, era] + g[route] * gutenberg + h[route] * z(log downloads)
            + m * downloads_missing + e[route] * date_dense + u[page]

  era          pre-1880 | 1880-1930 | other (the #4763 strata split; d is shrunk to zero)
  gutenberg    the book's title + author surname match a Project Gutenberg text (refusal-census.mjs)
  downloads    the book's own Archive item's download count (log1p, standardised); missing is its own term
  date_dense   the #4763 stratum rule (S2/S4); known only on gate pages, so e is fitted there alone
  archive_text a clean digital text of this edition is online: the book has pages the free IA lane filled with the
               Archive's own OCR (census), or its Archive-text agreement clears the lane's cutoff (#4780). Added after
               v1's first fit failed the #4780 check (13 predicted vs 147): in the census, books with Archive text refuse
               13.7% of lite's pages (19,727/144,530), books without 1.8% (37,127/2,095,894).
  u[page]      a page effect shared by the engines that read the same gate page (a page lite refuses, agy tends to)

Data and likelihoods:
  census       one row per book, route lite+ctx (the pipeline prompt carries the document-context line):
               refused ~ BetaBinomial(lite_attempted, p, kappa) — pages of one book refuse together
  gate         one row per page x engine (#4763, cli-ocr prompt, no context line): Bernoulli
  held out     #4780's 742 one-page-per-book lite reads (5 languages; first pass without the context line, so route
               'lite'), never fitted: the posterior predictive check. Its observed count is a bracket, 169 (after a
               context-line retry of the refused) to 193 (first pass); per language only the 169 rows are on disk.

  refusal_v1.py --census DIR --gate agy-scores.jsonl --gate-pages bench-122.json \
      --heldout scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl --out results/refusal-v1.json
"""
import argparse, collections, json, math, re, sys
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

ROUTES = ['lite+ctx', 'lite', 'agy-3.8-flash-low']
LANGS = ['English', 'Latin', 'German', 'French', 'Italian']
PERIODS = ['<1600', '1600-1699', '1700-1799', '1800-1879', '1880-1930', '>1930', 'unknown']
ERAS = ['pre-1880', '1880-1930', 'other']
GATE_ENGINE = {'lite': 'lite', 'agy': 'agy-3.8-flash-low'}


def period(year):
    if year is None:
        return 'unknown'
    y = int(year)
    return ('<1600' if y < 1600 else '1600-1699' if y < 1700 else '1700-1799' if y < 1800 else '1800-1879' if y < 1880
            else '1880-1930' if y <= 1930 else '>1930')


def era(p):
    return 'pre-1880' if p in ('<1600', '1600-1699', '1700-1799', '1800-1879') else '1880-1930' if p == '1880-1930' else 'other'


# The free IA lane's per-language agreement cutoffs (scripts/lib/ia-ocr-gate.mjs IA_OCR_MIN_AGREEMENT).
IA_CUTOFF = {'English': 0.80, 'French': 0.80, 'Latin': 0.85, 'German': 0.85, 'Italian': 0.85}


def has_archive_text(b):
    """The book has pages filled with the Archive's own OCR: a clean digital text of this edition is online."""
    return any(m.startswith('ia-ocr') for m in b.get('models', {}))


def year_of(s):
    m = re.search(r'(?<!\d)(1[4-9]\d\d|20\d\d)(?!\d)', str(s or ''))
    return int(m.group(1)) if m else None


def load_census(d):
    rd = lambda f: [json.loads(l) for l in open(f'{d}/{f}') if l.strip()]
    books = rd('books.jsonl')
    dl = {r['ia_identifier']: r['downloads'] for r in rd('ia-downloads.jsonl') if r.get('found')}
    gut = {r['id']: bool(r['gutenberg']) for r in rd('gutenberg.jsonl')}
    for b in books:
        b['downloads'] = dl.get(b.get('ia_identifier'))
        b['gutenberg'] = gut.get(b['id'], False)
    return {b['id']: b for b in books}


def features(rows, mu_dl, sd_dl):
    """Index arrays for a list of dict rows with route, lang, period, gutenberg, downloads, dense, page."""
    f = lambda k, vals: jnp.array([vals.index(r[k]) for r in rows])
    ldl = [math.log1p(r['downloads']) if r['downloads'] is not None else None for r in rows]
    return dict(route=f('route', ROUTES), lang=f('lang', LANGS), period=f('period', PERIODS),
                era=jnp.array([ERAS.index(era(r['period'])) for r in rows]),
                gut=jnp.array([float(r['gutenberg']) for r in rows]),
                dl=jnp.array([(x - mu_dl) / sd_dl if x is not None else 0.0 for x in ldl]),
                miss=jnp.array([1.0 if x is None else 0.0 for x in ldl]),
                dense=jnp.array([float(r.get('dense', 0)) for r in rows]),
                arch=jnp.array([float(r['archive_text']) for r in rows]))


def logit_p(P, F, upage=None):
    x = (P['a'][F['route']] + P['b'][F['lang']] + P['c'][F['period']] + P['d'][F['route'], F['era']]
         + P['g'][F['route']] * F['gut'] + P['h'][F['route']] * F['dl'] + P['m'] * F['miss'] + P['e'][F['route']] * F['dense']
         + P['k'][F['route']] * F['arch'])
    return x if upage is None else x + upage


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--census', required=True)
    ap.add_argument('--gate', required=True)
    ap.add_argument('--gate-pages', required=True)
    ap.add_argument('--heldout', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--samples', type=int, default=1000)
    ap.add_argument('--holdout-frac', type=float, default=0.1, help='census books held out for a calibration check')
    a = ap.parse_args()

    books = load_census(a.census)
    rng = np.random.default_rng(6740)
    census, census_out = [], []
    for b in books.values():
        if b['language'] not in LANGS or b['lite_attempted'] < 1:
            continue
        r = dict(route='lite+ctx', lang=b['language'], period=period(b['year']), gutenberg=b['gutenberg'],
                 downloads=b['downloads'], k=min(b['refused'], b['lite_attempted']), n=b['lite_attempted'], id=b['id'],
                 archive_text=has_archive_text(b))
        (census_out if rng.random() < a.holdout_frac else census).append(r)

    gate_books = {p['page_id']: p['book_id'] for p in json.load(open(a.gate_pages))}
    gate = []
    pages = sorted({json.loads(l)['page_id'] for l in open(a.gate)})
    for l in open(a.gate):
        s = json.loads(l)
        if s['engine'] not in GATE_ENGINE:
            continue
        b = books.get(gate_books.get(s['page_id']), {})
        gate.append(dict(route=GATE_ENGINE[s['engine']], lang='English',
                         period=period(b.get('year')) if b.get('year') else ('1800-1879' if s['stratum'] in ('S1', 'S2') else '1880-1930'),
                         gutenberg=b.get('gutenberg', False), downloads=b.get('downloads'), dense=int(s['stratum'] in ('S2', 'S4')),
                         archive_text=True,  # every #5124 reference page is an Archive book whose text the lane admitted
                         y=int(s['cer'] is None), page=pages.index(s['page_id']), stratum=s['stratum']))

    held = []
    for r in (json.loads(l) for l in open(a.heldout)):
        lang = str(r.get('language', '')).capitalize()
        if lang not in LANGS:
            continue
        b = books.get(r['book_id'], {})
        # #4780's first pass omitted the context line (193/742 refused); a retry WITH it recovered 24 (169 left).
        # So it is the no-context arm, the gate's prompt: route 'lite', scored against the bracket [169, 193].
        held.append(dict(route='lite', lang=lang, period=period(year_of(r.get('year'))), gutenberg=b.get('gutenberg', False),
                         downloads=b.get('downloads'), y=int(bool(re.search('RECITATION|PROHIBITED', r.get('finish_reason') or ''))),
                         archive_text=float(r.get('agreement_log') or 0) >= IA_CUTOFF.get(lang, 0.85),
                         in_census=bool(b)))

    ldl = [math.log1p(r['downloads']) for r in census if r['downloads'] is not None]
    mu_dl, sd_dl = float(np.mean(ldl)), float(np.std(ldl))
    Fc, Fg = features(census, mu_dl, sd_dl), features(gate, mu_dl, sd_dl)
    Kc, Nc = jnp.array([r['k'] for r in census], dtype=float), jnp.array([r['n'] for r in census], dtype=float)
    Yg, Pg = jnp.array([r['y'] for r in gate], dtype=float), jnp.array([r['page'] for r in gate])
    print(f'census books {len(census)} (+{len(census_out)} held out), refused pages {int(Kc.sum())}/{int(Nc.sum())}; '
          f'gate rows {len(gate)}; held-out #4780 rows {len(held)}', flush=True)

    def betabinom(k, n, p, kappa):
        al, be = p * kappa, (1 - p) * kappa
        return (gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1) + gammaln(k + al) + gammaln(n - k + be)
                - gammaln(n + al + be) + gammaln(al + be) - gammaln(al) - gammaln(be))

    def params():
        return dict(
            a=numpyro.sample('a', dist.Normal(-3.0, 2.0).expand([len(ROUTES)])),
            b=numpyro.sample('b', dist.Normal(0, 1.0).expand([len(LANGS)])),
            c=numpyro.sample('c', dist.Normal(0, 1.5).expand([len(PERIODS)])),
            d=numpyro.sample('tau_d', dist.HalfNormal(0.7)) * numpyro.sample('z_d', dist.Normal(0, 1).expand([len(ROUTES), len(ERAS)])),
            g=numpyro.sample('g', dist.Normal(0, 1.0).expand([len(ROUTES)])),
            h=numpyro.sample('h', dist.Normal(0, 1.0).expand([len(ROUTES)])),
            m=numpyro.sample('m', dist.Normal(0, 1.0)),
            e=numpyro.sample('e', dist.Normal(0, 1.0).expand([len(ROUTES)])),
            k=numpyro.sample('k', dist.Normal(0, 1.5).expand([len(ROUTES)])))

    def model():
        P = params()
        kappa = numpyro.sample('kappa', dist.LogNormal(0.0, 1.5))
        sp = numpyro.sample('sigma_page', dist.HalfNormal(1.5))
        up = sp * numpyro.sample('z_page', dist.Normal(0, 1).expand([len(pages)]))
        pc = jnp.clip(jax.nn.sigmoid(logit_p(P, Fc)), 1e-6, 1 - 1e-6)
        numpyro.factor('census', betabinom(Kc, Nc, pc, kappa).sum())
        numpyro.sample('gate', dist.Bernoulli(logits=logit_p(P, Fg, up[Pg])), obs=Yg)

    mc = MCMC(NUTS(model, target_accept_prob=0.97), num_warmup=1000, num_samples=a.samples, num_chains=4,
              chain_method='parallel', progress_bar=False)
    mc.run(jax.random.PRNGKey(6740), extra_fields=('diverging',))
    by = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items()}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by.items()}
    rh = {k: float(np.nanmax(np.atleast_1d(summary({k: v}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items()}
    post['d'] = post['tau_d'][:, None, None] * post['z_d']
    S = post['a'].shape[0]
    q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
    draw = lambda s: {k: jnp.asarray(post[k][s]) for k in 'abcdghmek'}

    def predict(rows, page_effect):
        """Posterior predictive refusal probabilities per row, per draw (draws x rows)."""
        F = features(rows, mu_dl, sd_dl)
        out = np.empty((S, len(rows)))
        for s in range(S):
            up = page_effect(s)
            out[s] = np.asarray(jax.nn.sigmoid(logit_p(draw(s), F, up)))
        return out

    # 1. In-sample: does the fit reproduce the gate's own counts (agy 31/122, 14/34 on S4; lite 17/122, 7/34)?
    zp = post['z_page'] * post['sigma_page'][:, None]
    pg = predict(gate, lambda s: jnp.asarray(zp[s])[Pg])
    yrep = rng.random(pg.shape) < pg
    gate_check = []
    for route in ('lite', 'agy-3.8-flash-low'):
        for strat in ('ALL', 'S1', 'S2', 'S3', 'S4'):
            ix = [i for i, r in enumerate(gate) if r['route'] == route and (strat == 'ALL' or r['stratum'] == strat)]
            gate_check.append(dict(route=route, stratum=strat, n=len(ix), observed=int(sum(gate[i]['y'] for i in ix)),
                                   predicted=q(yrep[:, ix].sum(1)), p_mean=q(pg[:, ix].mean(1))))
    # A NEW page of the same kind: the page effect drawn fresh, not the fitted one (what a router faces).
    fresh = lambda s: jnp.asarray(rng.normal(0, post['sigma_page'][s], len(gate)))
    pn = predict(gate, fresh)
    new_page = [dict(route=c['route'], stratum=c['stratum'],
                     p=q(pn[:, [i for i, r in enumerate(gate) if r['route'] == c['route'] and (c['stratum'] == 'ALL' or r['stratum'] == c['stratum'])]].mean(1)))
                for c in gate_check]

    # 2. Held out: #4780 (never fitted). Observed 169/742 after the context-line retry; 193 before it.
    ph = predict(held, lambda s: 0.0)
    held_check = []
    for lang in ['ALL'] + LANGS:
        ix = [i for i, r in enumerate(held) if lang == 'ALL' or r['lang'] == lang]
        if not ix:
            continue
        # Each held-out row is one page of one book: draw the book's share from the beta (the census's overdispersion).
        kap = post['kappa'][:, None]
        pp = rng.beta(ph[:, ix] * kap + 1e-9, (1 - ph[:, ix]) * kap + 1e-9)
        yr = (rng.random(pp.shape) < pp).sum(1)
        held_check.append(dict(language=lang, n=len(ix), observed=int(sum(held[i]['y'] for i in ix)), predicted=q(yr),
                               inside_90=bool(np.percentile(yr, 5) <= sum(held[i]['y'] for i in ix) <= np.percentile(yr, 95))))

    # 3. Held-out census books: predicted vs observed refused pages by decile of predicted rate.
    po = predict(census_out, lambda s: 0.0).mean(0)
    order = np.argsort(po)
    deciles = []
    for chunk in np.array_split(order, 10):
        k = sum(census_out[i]['k'] for i in chunk)
        n = sum(census_out[i]['n'] for i in chunk)
        deciles.append(dict(books=len(chunk), pages=n, observed_rate=round(k / n, 4) if n else None,
                            predicted_rate=round(float(sum(po[i] * census_out[i]['n'] for i in chunk) / n), 4) if n else None))

    eff = lambda name, labels, arr: {l: q(arr[:, i]) for i, l in enumerate(labels)}
    res = dict(
        diagnostics=dict(divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()), max_rhat=round(max(rh.values()), 3),
                         chains=4, draws_per_chain=a.samples),
        data=dict(census_books=len(census), census_heldout_books=len(census_out), census_refused=int(Kc.sum()),
                  census_attempted=int(Nc.sum()), gate_rows=len(gate), heldout_4780=len(held),
                  downloads_log1p_mean=round(mu_dl, 3), downloads_log1p_sd=round(sd_dl, 3)),
        effects=dict(route=eff('a', ROUTES, post['a']), language=eff('b', LANGS, post['b']), period=eff('c', PERIODS, post['c']),
                     route_x_era={f'{r}|{e}': q(post['d'][:, i, j]) for i, r in enumerate(ROUTES) for j, e in enumerate(ERAS)},
                     gutenberg=eff('g', ROUTES, post['g']), log_downloads_sd=eff('h', ROUTES, post['h']),
                     downloads_missing=q(post['m']), date_dense=eff('e', ROUTES, post['e']), archive_text=eff('k', ROUTES, post['k']),
                     kappa=q(post['kappa']), sigma_page=q(post['sigma_page'])),
        gate_check=gate_check, new_page=new_page, heldout_4780=held_check, census_calibration=deciles)
    json.dump(res, open(a.out, 'w'), indent=1)
    # Draws for route_v1.py (chains need the joint refusal of two engines on one page, through sigma_page).
    np.savez_compressed(a.out.replace('.json', '-draws.npz'), **{k: post[k] for k in ('a', 'b', 'c', 'd', 'g', 'h', 'm', 'e', 'k', 'sigma_page', 'kappa')},
                        mu_dl=mu_dl, sd_dl=sd_dl)
    print(json.dumps(res['diagnostics']))
    for c in gate_check:
        print(f"gate {c['route']:<18} {c['stratum']:<4} observed {c['observed']:>3}/{c['n']:<3} predicted {c['predicted']}")
    for c in held_check:
        print(f"4780 {c['language']:<8} observed {c['observed']:>3}/{c['n']:<3} predicted {c['predicted']} inside90 {c['inside_90']}")
    for d in deciles:
        print(f"decile pages {d['pages']:>7} observed {d['observed_rate']} predicted {d['predicted_rate']}")


if __name__ == '__main__':
    sys.exit(main())
