#!/usr/bin/env python3
# PRIOR ART: refusal_v1.py on branch origin/worktree-estimator-v1-6740 (HEAD 969dd28; not on main): the census
# beta-binomial with route, language, period, Gutenberg, downloads and archive-text terms, #4780 held out. Its refit
# (results/refusal-v1-census-refit.json) predicted 17 [3, 71] of #4780's 623 one-page-per-book lite reads refused,
# against 147 observed, because no fitted row held the no-context-line prompt on a non-English page. This keeps its
# terms and adds the missing one, prompt x language family, identified by #4780's own rows (#6740, Derek's 2026-10-25
# note A). No model calls; CPU only.
"""Did-not-read v2: the recitation refusal of Flash-Lite by prompt x language family (#6740).

  refusal_v2.py --census scripts/eval/dataset/refusal-census-v1/books.jsonl \
      --heldout scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl \
      --gate $S/scores.jsonl --gate-pages $S/bench-122.json --out results/refusal-v2.json

  logit p = a[prompt] + b[lang] + c[period] + g * gutenberg + h * z(log downloads) + m * downloads_missing
            + k * archive_text + pf[family] * 1{prompt = no context line}               pf ~ N(0, tau_pf)
  prompt   ctx  = the pipeline prompt with the document-context line (every census row);
           none = no context line (#4780's first pass; the #4763 gate's cli-ocr prompt, lite rows)
  family   english | latin | german | romance (French, Italian): where the context line's effect may differ

Rows: census books (public subset, 8,955 books: the published dataset; the full 17,519 are on Hetzner main),
beta-binomial per book; #4780 pages and the #4763 gate's lite pages, Bernoulli (one page each).

Checks, both ways:
  v1 structure  no pf term, #4780 held out entirely: predict its 623 pages (v1's miss, re-run on these rows)
  split halves  pf in; #4780's books split in two (seeded), fit on one half, predict the other, both directions
  one language  pf in; leave one #4780 language out, predict it (its family's pf comes from the others, or its prior)
  full          pf in, every row: the posterior the router would use
"""
import argparse, json, math, re, sys
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

PROMPTS = ['ctx', 'none']
LANGS = ['English', 'Latin', 'German', 'French', 'Italian']
FAM = {'English': 'english', 'Latin': 'latin', 'German': 'german', 'French': 'romance', 'Italian': 'romance'}
FAMS = ['english', 'latin', 'german', 'romance']
PERIODS = ['<1600', '1600-1699', '1700-1799', '1800-1879', '1880-1930', '>1930', 'unknown']
IA_CUTOFF = {'English': 0.80, 'French': 0.80, 'Latin': 0.85, 'German': 0.85, 'Italian': 0.85}   # ia-ocr-gate.mjs
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
CHAINS = 2


def period(y):
    if y is None:
        return 'unknown'
    y = int(y)
    return ('<1600' if y < 1600 else '1600-1699' if y < 1700 else '1700-1799' if y < 1800 else '1800-1879' if y < 1880
            else '1880-1930' if y <= 1930 else '>1930')


def year_of(s):
    hit = re.search(r'(?<!\d)(1[4-9]\d\d|20\d\d)(?!\d)', str(s or ''))
    return int(hit.group(1)) if hit else None


def load(a):
    books = {b['book_id']: b for b in (json.loads(l) for l in open(a.census))}
    census = [dict(prompt='ctx', lang=b['language'], period=period(b['year']), gut=bool(b['gutenberg_ebooks']),
                   dl=b['archive_downloads'], arch=bool(b['archive_text_online']), k=min(b['refused'], b['lite_attempted']),
                   n=b['lite_attempted'], book=b['book_id'])
              for b in books.values() if b['language'] in LANGS and b['lite_attempted'] >= 1]
    held = []
    for r in (json.loads(l) for l in open(a.heldout)):
        lang = str(r.get('language', '')).capitalize()
        if lang not in LANGS:
            continue
        b = books.get(r['book_id'], {})
        held.append(dict(prompt='none', lang=lang, period=period(year_of(r.get('year'))), gut=bool(b.get('gutenberg_ebooks')),
                         dl=b.get('archive_downloads'), arch=float(r.get('agreement_log') or 0) >= IA_CUTOFF[lang],
                         y=int(bool(re.search('RECITATION|PROHIBITED', r.get('finish_reason') or ''))), book=r['book_id']))
    gp = {p['page_id']: p for p in json.load(open(a.gate_pages))}
    gate = [dict(prompt='none', lang='English', period='1880-1930' if gp[s['page_id']]['stratum'] in ('S3', 'S4') else '1800-1879',
                 gut=False, dl=None, arch=True, y=int(s['cer'] is None), book=gp[s['page_id']]['book_id'])
            for s in (json.loads(l) for l in open(a.gate)) if s['engine'] == 'lite']
    return census, held, gate


def feats(rows, mu, sd):
    ldl = [math.log1p(r['dl']) if r['dl'] is not None else None for r in rows]
    return dict(pr=jnp.array([PROMPTS.index(r['prompt']) for r in rows]), lang=jnp.array([LANGS.index(r['lang']) for r in rows]),
                fam=jnp.array([FAMS.index(FAM[r['lang']]) for r in rows]), per=jnp.array([PERIODS.index(r['period']) for r in rows]),
                gut=jnp.array([float(r['gut']) for r in rows]), arch=jnp.array([float(r['arch']) for r in rows]),
                dl=jnp.array([(x - mu) / sd if x is not None else 0.0 for x in ldl]),
                miss=jnp.array([1.0 if x is None else 0.0 for x in ldl]))


def logit(P, F, with_pf):
    x = (P['a'][F['pr']] + P['b'][F['lang']] + P['c'][F['per']] + P['g'] * F['gut'] + P['h'] * F['dl'] + P['m'] * F['miss']
         + P['k'] * F['arch'])
    if with_pf:
        x = x + P['pf'][F['fam']] * (F['pr'] == 1)
    return x


def fit(census, bern, with_pf, mu, sd, samples, seed=6740):
    Fc, Fb = feats(census, mu, sd), feats(bern, mu, sd)
    Kc = jnp.array([r['k'] for r in census], dtype=float)
    Nc = jnp.array([r['n'] for r in census], dtype=float)
    Yb = jnp.array([r['y'] for r in bern], dtype=float)

    def bb(k, n, p, kap):
        al, be = p * kap, (1 - p) * kap
        return (gammaln(n + 1) - gammaln(k + 1) - gammaln(n - k + 1) + gammaln(k + al) + gammaln(n - k + be)
                - gammaln(n + al + be) + gammaln(al + be) - gammaln(al) - gammaln(be))

    def model():
        P = dict(a=numpyro.sample('a', dist.Normal(-3.0, 2.0).expand([2])), b=numpyro.sample('b', dist.Normal(0, 1.0).expand([len(LANGS)])),
                 c=numpyro.sample('c', dist.Normal(0, 1.5).expand([len(PERIODS)])), g=numpyro.sample('g', dist.Normal(0, 1.0)),
                 h=numpyro.sample('h', dist.Normal(0, 1.0)), m=numpyro.sample('m', dist.Normal(0, 1.0)),
                 k=numpyro.sample('k', dist.Normal(0, 1.5)))
        if with_pf:
            P['pf'] = numpyro.sample('tau_pf', dist.HalfNormal(1.0)) * numpyro.sample('z_pf', dist.Normal(0, 1).expand([len(FAMS)]))
        kap = numpyro.sample('kappa', dist.LogNormal(0.0, 1.5))
        pc = jnp.clip(jax.nn.sigmoid(logit(P, Fc, with_pf)), 1e-6, 1 - 1e-6)
        numpyro.factor('census', bb(Kc, Nc, pc, kap).sum())
        if len(bern):
            # a one-page row is one book's page: the book's own rate is beta(p kappa, (1 - p) kappa), so marginally
            # Bernoulli(p); the overdispersion enters the predictive check below, not this likelihood
            numpyro.sample('pages', dist.Bernoulli(logits=logit(P, Fb, with_pf)), obs=Yb)

    mc = MCMC(NUTS(model, target_accept_prob=0.9), num_warmup=samples, num_samples=samples, num_chains=CHAINS,
              chain_method='parallel', progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), extra_fields=('diverging',))
    by = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items()}
    rh = max(float(np.nanmax(np.atleast_1d(summary({k: v}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items())
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by.items()}
    if with_pf:
        post['pf'] = post['tau_pf'][:, None] * post['z_pf']
    return post, dict(divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()), max_rhat=round(rh, 3))


def predict(post, rows, with_pf, mu, sd, rng, fresh_fams=()):
    """Predicted refused count per language (and ALL) for one-page-per-book rows; a family in fresh_fams gets its pf
    drawn from N(0, tau_pf) (the fit never saw that family's no-context rows)."""
    F = feats(rows, mu, sd)
    S = post['a'].shape[0]
    P = {k: post[k] for k in ('a', 'b', 'c', 'g', 'h', 'm', 'k')}
    eta = (P['a'][:, np.asarray(F['pr'])] + P['b'][:, np.asarray(F['lang'])] + P['c'][:, np.asarray(F['per'])]
           + P['g'][:, None] * np.asarray(F['gut']) + P['h'][:, None] * np.asarray(F['dl']) + P['m'][:, None] * np.asarray(F['miss'])
           + P['k'][:, None] * np.asarray(F['arch']))
    if with_pf:
        pf = post['pf'].copy()
        for f in fresh_fams:
            pf[:, FAMS.index(f)] = rng.normal(0, 1, S) * post['tau_pf']
        eta = eta + pf[:, np.asarray(F['fam'])] * (np.asarray(F['pr']) == 1)
    p = 1 / (1 + np.exp(-eta))
    kap = post['kappa'][:, None]
    pp = rng.beta(p * kap + 1e-9, (1 - p) * kap + 1e-9)        # each row is one book's page: the book's own rate
    y = rng.random(pp.shape) < pp
    out = {}
    for lang in ['ALL'] + LANGS:
        ix = [i for i, r in enumerate(rows) if lang == 'ALL' or r['lang'] == lang]
        if not ix:
            continue
        cnt = y[:, ix].sum(1)
        obs = sum(rows[i]['y'] for i in ix)
        lo, hi = np.percentile(cnt, [5, 95])
        out[lang] = dict(n=len(ix), observed=int(obs), predicted=[int(np.percentile(cnt, 5)), int(np.median(cnt)), int(hi)],
                         inside_90=bool(lo <= obs <= hi))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--census', required=True)
    ap.add_argument('--heldout', required=True)
    ap.add_argument('--gate', required=True)
    ap.add_argument('--gate-pages', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--samples', type=int, default=600)
    ap.add_argument('--chains', type=int, default=2)
    ap.add_argument('--check', default='all', help='all | v1 | split-A | split-B | loo-<Language> | full | merge (the parts)')
    a = ap.parse_args()
    global CHAINS
    CHAINS = a.chains
    if a.check == 'merge':
        import glob
        res = {}
        for f in sorted(glob.glob(a.out + '.part-*')):
            part = json.load(open(f))
            res.setdefault('data', part['data'])
            for k, v in part.get('checks', {}).items():
                if k == 'leave_one_language_out':
                    res.setdefault('checks', {}).setdefault(k, {}).update(v)
                else:
                    res.setdefault('checks', {})[k] = v
            if 'full' in part:
                res['full'] = part['full']
        json.dump(res, open(a.out, 'w'), indent=1)
        print(json.dumps(res, indent=1)[:4000])
        return
    run = lambda c: a.check in ('all', c)
    census, held, gate = load(a)
    ldl = [math.log1p(r['dl']) for r in census if r['dl'] is not None]
    mu, sd = float(np.mean(ldl)), float(np.std(ldl))
    rng = np.random.default_rng(6740)
    res = dict(data=dict(census_books=len(census), census_refused=sum(r['k'] for r in census), census_attempted=sum(r['n'] for r in census),
                         heldout_4780=len(held), heldout_refused=sum(r['y'] for r in held), gate_lite=len(gate),
                         gate_lite_refused=sum(r['y'] for r in gate)), checks={})
    print(res['data'], flush=True)
    # 1. v1's structure: no prompt x family term, #4780 out
    if run('v1'):
        post, d = fit(census, gate, False, mu, sd, a.samples)
        res['checks']['v1_structure_4780_held_out'] = dict(fit=d, by_language=predict(post, held, False, mu, sd, rng))
        print('v1 structure', d, res['checks']['v1_structure_4780_held_out']['by_language']['ALL'], flush=True)
    # 2. split halves of #4780's books
    books = sorted({r['book'] for r in held})
    half = set(np.random.default_rng(4780).permutation(books)[: len(books) // 2])   # one split for every process
    tot = {}
    for nm, tr_ in (('A', [r for r in held if r['book'] in half]), ('B', [r for r in held if r['book'] not in half])):
        if not run(f'split-{nm}'):
            continue
        te_ = [r for r in held if r not in tr_]
        post, d = fit(census, gate + tr_, True, mu, sd, a.samples)
        pr = predict(post, te_, True, mu, sd, rng)
        res['checks'][f'split_half_fit_{nm}'] = dict(fit=d, by_language=pr)
        print('split', nm, d, pr['ALL'], flush=True)
    # 3. leave one #4780 language out
    loo = {}
    for lang in LANGS:
        if not run(f'loo-{lang}'):
            continue
        tr_ = [r for r in held if r['lang'] != lang]
        te_ = [r for r in held if r['lang'] == lang]
        fresh = () if any(FAM[r['lang']] == FAM[lang] for r in tr_) else (FAM[lang],)
        post, d = fit(census, gate + tr_, True, mu, sd, a.samples)
        loo[lang] = dict(fit=d, family_seen=not fresh, **predict(post, te_, True, mu, sd, rng, fresh)[lang])
        print('leave out', lang, loo[lang], flush=True)
    if loo:
        res['checks']['leave_one_language_out'] = loo
    # 4. full
    if not run('full'):
        json.dump(res, open(a.out + ('' if a.check == 'all' else f'.part-{a.check}'), 'w'), indent=1)
        return
    post, d = fit(census, gate + held, True, mu, sd, a.samples)
    res['full'] = dict(fit=d, prompt={p: q(post['a'][:, i]) for i, p in enumerate(PROMPTS)},
                       prompt_x_family={f: q(post['pf'][:, i]) for i, f in enumerate(FAMS)}, tau_pf=q(post['tau_pf']),
                       no_context_minus_context={f: q(post['a'][:, 1] - post['a'][:, 0] + post['pf'][:, i]) for i, f in enumerate(FAMS)},
                       language={l: q(post['b'][:, i]) for i, l in enumerate(LANGS)}, archive_text=q(post['k']),
                       gutenberg=q(post['g']), kappa=q(post['kappa']),
                       in_sample_4780=predict(post, held, True, mu, sd, rng))
    json.dump(res, open(a.out + ('' if a.check == 'all' else f'.part-{a.check}'), 'w'), indent=1)
    print(json.dumps(res['full'], indent=1))


if __name__ == '__main__':
    sys.exit(main())
