#!/usr/bin/env python3
"""#6740 read-surface, Amendment 6 (third form): the page-level analysis of every run, Box-Behnken and incomplete-block.

Unit: the target page of a book within a run (one target a book). Responses: CER (raw, percentage points; and on the
logit scale, logit((CER*n + 0.5)/(n + 1)), n = the reference's letters), log quota cost a page (the book's block cost
over its pages; unread pages priced at the one-a-call cost of the same thinking level), accepted (a usable read that is
not wrong text, a loop or a cut), calls a page, wall seconds a page.

Models: linear mixed models, random intercept for book, REML (statsmodels MixedLM), fixed effects: the full quadratic in
pages a call (x1) and thinking (x3), the image (served / 1,024 / 1,600 / 2,400 px, from the Box-Behnken runs), the agy
pool and the century. Intervals for every setting and every difference from live: 2,000 book-level bootstrap resamples
of the within-book least-squares fit (book fixed effects; the same fixed effects as the mixed model, refit in
milliseconds). Decision (Amendment 6.6): a cell of pages a call x thinking at the served image on the default pool is
non-inferior when the upper 95 % bound of its CER difference from live is <= 1 pp; the optimum is the non-inferior cell
with the lowest predicted quota cost per accepted page; under 10 % cheaper than live, live stays. Reported unweighted
and post-stratified to the queue frame (weights from frame.mjs); if they differ, the weighted one decides.

PRIOR ART: surface6.mjs and fit.mjs (this directory: run-level least squares and Bayes on the 15 Box-Behnken runs);
  power6.py (this directory: the same within-book fit, simulated). Nothing in the repo fits a page-level mixed model.

    py/bin/python scripts/eval/read-surface-6740/analysis6.py --bbd=WORK/score.json --ib=WORK-IB/score.json \
        --panel=WORK-IB/panel.json --eye=WORK-IB/eye --weights=WORK-IB/frame/weights.json [--boot=2000] > analysis6.json
"""
import argparse, json, math, sys, warnings
import numpy as np, pandas as pd
import statsmodels.formula.api as smf
import statsmodels, scipy

warnings.filterwarnings('ignore')
ap = argparse.ArgumentParser()
ap.add_argument('--bbd'); ap.add_argument('--ib'); ap.add_argument('--panel'); ap.add_argument('--eye'); ap.add_argument('--weights')
ap.add_argument('--boot', type=int, default=2000); ap.add_argument('--langs', default='de,la,en')
a = ap.parse_args()
RATE = {'input': 0.75e-6, 'cached': 0.075e-6, 'output': 3.75e-6}
usd = lambda t: (t['input'] - t['cache_read']) * RATE['input'] + t['cache_read'] * RATE['cached'] + t['output'] * RATE['output']
MARGIN, MIN_SAVING = 1.0, 0.10
PPC = {1: -1, 4: 0, 8: 1}; THINK = {'low': -1, 'medium': 0, 'high': 1}
panel = json.load(open(a.panel))
W = json.load(open(a.weights)) if a.weights else {}
rng = np.random.default_rng(6740)

def faces(lang):
    try: return {json.loads(l)['slug']: json.loads(l).get('face') for l in open(f'{a.eye}/verdicts-{lang}.jsonl') if l.strip()}
    except FileNotFoundError: return {}

def rows_of(score, src, lang):
    L = score['langs'].get(lang)
    if not L: return []
    ex = {e['slug']: e['why'] for e in L['excluded']}
    T = {t['slug']: t for t in panel['langs'][lang]['targets']}
    runs = [r for r in L['runs'] if r['finished']]
    one = [r for r in runs if r['ppc'] == 1]
    out = []
    for r in runs:
        nousage = r['tokens'].get('no_usage', 0)
        call_usd = usd(r['tokens']) / max(1, r['calls'] - nousage)
        for p in r['targets']:
            t = T.get(p['slug']); bb = r['by_book'].get(p['book_id'])
            if not t or not bb or not bb['pages']: continue
            out.append({'src': src, 'lang': lang, 'run': r['id'], 'book': p['book_id'], 'slug': p['slug'], 'ppc': r['ppc'], 'think': r['think'],
                'x1': PPC[r['ppc']], 'x3': THINK[r['think']], 'edge': 'served' if r['edge'] is None else str(r['edge']), 'live': bool(r['live']),
                'pool': 'default' if (r.get('agy_home') in (None, 'default')) else 'james', 'century': t.get('period') or 'unknown',
                'letters': t.get('ref_letters') or 1000, 'status': p['status'], 'cer': p.get('cer'), 'wrong': bool(p.get('wrong_text')),
                'loop': bool(p.get('loop')), 'cut': bool(p.get('cut')), 'excluded': ex.get(p['slug']),
                'tok': bb['tokens'], 'nousage': bb['tokens'].get('no_usage', 0), 'call_usd': call_usd, 'unread': bb['unread'], 'pages': bb['pages'],
                'calls_book': bb['calls'], 'secs_book': bb['secs'], 'cuts_book': bb.get('cuts', 0)})
    return out

frames = []
for lang in a.langs.split(','):
    rs = rows_of(json.load(open(a.bbd)), 'bbd', lang) if a.bbd else []
    rs += rows_of(json.load(open(a.ib)), 'ib', lang) if a.ib else []
    if not rs: continue
    d = pd.DataFrame(rs)
    # one-a-call cost a page by thinking level (prices pages left unread by --no-alone), pooled over both sources
    one = d[d.ppc == 1]
    u1 = {th: float(np.mean([usd(t) + nu * cu for t, nu, cu in zip(g.tok, g.nousage, g.call_usd)])) for th, g in one.groupby('think')}
    s1 = float((one.secs_book / one.pages).mean()) if len(one) else 30.0
    c1 = float((one.calls_book / one.pages).mean()) if len(one) else 1.0
    d['usd_pp'] = [(usd(t) + nu * cu + un * u1.get(th, u1.get('low', 0.02))) / pg for t, nu, cu, un, th, pg in zip(d.tok, d.nousage, d.call_usd, d.unread, d.think, d.pages)]
    d['calls_pp'] = (d.calls_book + c1 * d.unread) / d.pages
    d['secs_pp'] = (d.secs_book + s1 * d.unread) / d.pages
    d['accepted_raw'] = ((d.status == 'read') & ~d.wrong & ~d.loop & ~d.cut).astype(float)
    # Production-equivalent: a page left unread by --no-alone would be read alone in production, so it takes the
    # acceptance rate of the one-a-call reads at the same thinking level (the cost already prices that read).
    p1 = {th: float(g.accepted_raw.mean()) for th, g in d[d.ppc == 1].groupby('think')}
    d['accepted'] = [p1.get(th, p1.get('low', 1.0)) if str(st).startswith('unread') else ac for st, th, ac in zip(d.status, d.think, d.accepted_raw)]
    bad = int((d.usd_pp <= 0).sum())
    if bad: print(f'{lang}: {bad} book-run rows with no priced cost dropped', file=sys.stderr)
    d = d[d.usd_pp > 0].copy()
    d['cer_pp'] = 100 * d.cer.astype(float)
    d['lcer'] = np.log((d.cer.astype(float) * d.letters + 0.5) / (d.letters + 1) / (1 - (d.cer.astype(float) * d.letters + 0.5) / (d.letters + 1)))
    d['lcost'] = np.log(d.usd_pp)
    d['w'] = [W.get(lang, {}).get(b, 1.0) for b in d.book]
    d['face'] = [faces(lang).get(s) for s in d.slug]
    frames.append(d)
D = pd.concat(frames, ignore_index=True)
D = D.drop(columns=['tok'])

def within_arr(X, Y, g, ww):
    """Within-book weighted least squares on arrays (g: integer book codes): demean by book with bincount."""
    n = g.max() + 1; sw = np.bincount(g, ww, n)
    Xd = X - (np.stack([np.bincount(g, ww * X[:, j], n) for j in range(X.shape[1])], 1) / sw[:, None])[g]
    Yd = Y - (np.bincount(g, ww * Y, n) / sw)[g]
    r = np.sqrt(ww)
    beta, *_ = np.linalg.lstsq(Xd * r[:, None], Yd * r, rcond=None)
    return beta

def within(df, y, cols, w=None):
    g = pd.factorize(df.book)[0]
    return within_arr(df[cols].to_numpy(float), df[y].to_numpy(float), g, np.ones(len(df)) if w is None else df[w].to_numpy(float))

def design(df):
    X = pd.DataFrame({'x1': df.x1, 'x3': df.x3, 'x1sq': df.x1 ** 2, 'x3sq': df.x3 ** 2, 'x1x3': df.x1 * df.x3})
    for e in ('1024', '1600', '2400'): X[f'edge{e}'] = (df.edge == e).astype(float)
    X['james'] = (df.pool == 'james').astype(float)
    return X
COLS = ['x1', 'x3', 'x1sq', 'x3sq', 'x1x3', 'edge1024', 'edge1600', 'edge2400', 'james']
GRID = [(x1, x3) for x1 in (-1, 0, 1) for x3 in (-1, 0, 1)]
cellname = lambda x1, x3: f"{[1, 4, 8][x1 + 1]} a call, {['low', 'medium', 'high'][x3 + 1]}"
gvec = lambda x1, x3: np.array([x1, x3, x1 * x1, x3 * x3, x1 * x3, 0, 0, 0, 0], float)
LIVE = gvec(0, -1)

def cell_stats(df, weighted):
    """Per grid cell at served / default pool: predicted CER difference from live (pp), cost a page, yield, cost per
    accepted page, calls, seconds, by within-book fits; book bootstrap for the intervals."""
    df = df.copy()
    if weighted: df = df[df.w > 0]          # a book in a cell with no share of the frame carries no weight
    X = design(df); df[COLS] = X[COLS]
    keep = [c for c in COLS if df[c].abs().sum() > 0]
    idx = [COLS.index(c) for c in keep]
    w = 'w' if weighted else None
    cer = df[(df.status == 'read') & df.excluded.isna()]
    acc = df[df.excluded.isna() | ~df.excluded.fillna('').str.startswith('by eye')]
    def fit(c, a2):
        bc = np.zeros(len(COLS)); bc[idx] = within(c, 'cer_pp', keep, w)
        bl = np.zeros(len(COLS)); bl[idx] = within(a2, 'lcost', keep, w)
        by = np.zeros(len(COLS)); by[idx] = within(a2, 'accepted', keep, w)
        bk = np.zeros(len(COLS)); bk[idx] = within(a2, 'calls_pp', keep, w)
        bs = np.zeros(len(COLS)); bs[idx] = within(a2, 'secs_pp', keep, w)
        return bc, bl, by, bk, bs
    # live level (the served default-pool live reads) for absolute values
    lv = acc[acc.live & (acc.pool == 'default')]
    def wmean(s, ww): return float(np.average(s, weights=ww)) if len(s) else float('nan')
    ww = lambda f: (f.w if weighted else np.ones(len(f)))
    base = {'lcost': wmean(lv.lcost, ww(lv)), 'accepted': wmean(lv.accepted, ww(lv)), 'calls': wmean(lv.calls_pp, ww(lv)), 'secs': wmean(lv.secs_pp, ww(lv)),
            'cer': wmean(cer[cer.live & (cer.pool == 'default')].cer_pp, ww(cer[cer.live & (cer.pool == 'default')]))}
    P = fit(cer, acc)
    books = df.book.unique()
    # Bootstrap on arrays: each resampled book is a new block (its rows copied), demeaned by bincount.
    def prep(f, ycols):
        rows = {b: np.flatnonzero(f.book.to_numpy() == b) for b in books}
        return rows, f[keep].to_numpy(float), {y: f[y].to_numpy(float) for y in ycols}, (f.w.to_numpy(float) if weighted else np.ones(len(f)))
    Rc, Xc, Yc, Wc = prep(cer, ['cer_pp']); Ra, Xa, Ya, Wa = prep(acc, ['lcost', 'accepted', 'calls_pp', 'secs_pp'])
    def bfit(R, X, Y, Wt, y, pick):
        idx = [R[b] for b in pick if len(R[b])]
        if not idx: return np.zeros(len(COLS))
        ii = np.concatenate(idx); g = np.concatenate([np.full(len(x), k) for k, x in enumerate(idx)])
        b = np.zeros(len(COLS)); b[idx_cols] = within_arr(X[ii], Y[y][ii], g, Wt[ii]); return b
    idx_cols = idx
    BB = []
    for _ in range(a.boot):
        pick = rng.choice(books, len(books))
        BB.append((bfit(Rc, Xc, Yc, Wc, 'cer_pp', pick), bfit(Ra, Xa, Ya, Wa, 'lcost', pick), bfit(Ra, Xa, Ya, Wa, 'accepted', pick)))
    out = []
    for x1, x3 in GRID:
        g = gvec(x1, x3) - LIVE
        def pt(bv): return float(g @ bv)
        dc = [pt(b[0]) for b in BB]; dl = [pt(b[1]) for b in BB]; dy = [pt(b[2]) for b in BB]
        cost = math.exp(base['lcost'] + pt(P[1])) * 1000; yld = min(1.0, max(0.01, base['accepted'] + pt(P[2])))
        cpa = cost / yld
        cpaB = [math.exp(base['lcost'] + l) * 1000 / min(1.0, max(0.01, base['accepted'] + y)) for l, y in zip(dl, dy)]
        live_cpa = math.exp(base['lcost']) * 1000 / base['accepted']
        out.append({'x1': x1, 'x3': x3, 'name': cellname(x1, x3), 'live': (x1, x3) == (0, -1),
            'delta_cer_pp': pt(P[0]), 'delta_lo': float(np.quantile(dc, .025)), 'delta_hi': float(np.quantile(dc, .975)),
            'cer_pp': base['cer'] + pt(P[0]),
            'usd_per_1k_pages': cost, 'usd_lo': float(np.quantile([math.exp(base['lcost'] + l) * 1000 for l in dl], .025)), 'usd_hi': float(np.quantile([math.exp(base['lcost'] + l) * 1000 for l in dl], .975)),
            'yield': yld, 'yield_lo': float(np.quantile([base['accepted'] + y for y in dy], .025)), 'yield_hi': float(np.quantile([base['accepted'] + y for y in dy], .975)),
            'usd_per_1k_accepted': cpa, 'cpa_lo': float(np.quantile(cpaB, .025)), 'cpa_hi': float(np.quantile(cpaB, .975)),
            'saving_vs_live': 1 - cpa / live_cpa, 'saving_lo': float(np.quantile([1 - c / live_cpa for c in cpaB], .025)), 'saving_hi': float(np.quantile([1 - c / live_cpa for c in cpaB], .975)),
            'calls_pp': base['calls'] + pt(P[3]), 'secs_pp': base['secs'] + pt(P[4]),
            'accepted_per_hour_one_reader': 3600 / max(1e-6, base['secs'] + pt(P[4])) * yld,
            'non_inferior': float(np.quantile(dc, .975)) <= MARGIN})
    ni = sorted([c for c in out if c['non_inferior']], key=lambda c: c['usd_per_1k_accepted'])
    best = ni[0] if ni else None
    verdict = ('no cell is non-inferior: live stays' if not best else
               f"the cheapest non-inferior cell ({best['name']}) saves {100 * best['saving_vs_live']:.0f} % per accepted page (under {100 * MIN_SAVING:.0f} %): live stays" if best['saving_vs_live'] < MIN_SAVING or best['live'] else
               f"optimum {best['name']}: {100 * best['saving_vs_live']:.0f} % cheaper per accepted page than live [{100 * best['saving_lo']:.0f}, {100 * best['saving_hi']:.0f}]; confirm on queue pages")
    # frontier: cells no other cell beats on both CER and cost per accepted page
    front = [c['name'] for c in out if not any(o is not c and o['cer_pp'] <= c['cer_pp'] and o['usd_per_1k_accepted'] <= c['usd_per_1k_accepted'] and (o['cer_pp'] < c['cer_pp'] or o['usd_per_1k_accepted'] < c['usd_per_1k_accepted']) for o in out)]
    # Derringer desirability: CER a hard constraint (non-inferior), cost per accepted page minimised linearly
    cmax = max(c['usd_per_1k_accepted'] for c in out); cmin = min(c['usd_per_1k_accepted'] for c in out)
    for c in out: c['desirability'] = 0.0 if not c['non_inferior'] else (cmax - c['usd_per_1k_accepted']) / max(1e-9, cmax - cmin)
    # Continuous surfaces over (pages a call, thinking) in coded units for the contour figures: CER difference from
    # live and its bootstrap upper 95 % bound, cost a page, yield, cost per accepted page.
    ax = np.linspace(-1, 1, 21)
    surf = {'axis': ax.tolist(), 'delta': [], 'delta_hi': [], 'usd': [], 'yield': [], 'usd_acc': []}
    Bc = np.array([b[0] for b in BB])
    for x3 in ax:
        rd, rh, ru, ry, ra = [], [], [], [], []
        for x1 in ax:
            g = gvec(x1, x3) - LIVE
            dv = float(g @ P[0]); rd.append(dv); rh.append(float(np.quantile(Bc @ g, .975)))
            c = math.exp(base['lcost'] + float(g @ P[1])) * 1000; y = min(1.0, max(0.01, base['accepted'] + float(g @ P[2])))
            ru.append(c); ry.append(y); ra.append(c / y)
        for k, v in (('delta', rd), ('delta_hi', rh), ('usd', ru), ('yield', ry), ('usd_acc', ra)): surf[k].append(v)
    return {'base_live': base, 'cells': out, 'optimum': best['name'] if best else None, 'verdict': verdict, 'frontier': front, 'books': int(len(books)), 'surface': surf,
            'rows_cer': int(len(cer)), 'rows_cost': int(len(acc))}

def mixed(df, y, extra=''):
    df = df.copy(); X = design(df); df[COLS] = X[COLS]
    terms = ['x1', 'x3', 'x1sq', 'x3sq', 'x1x3'] + [c for c in ('edge1024', 'edge1600', 'edge2400', 'james') if df[c].abs().sum() > 0]
    cents = df.century.nunique()
    f = f"{y} ~ " + ' + '.join(terms) + (' + C(century)' if cents > 1 else '') + extra
    try:
        m = smf.mixedlm(f, df, groups=df.book).fit(reml=True)
        res = m.resid
        return {'formula': f, 'n': int(m.nobs), 'books': int(df.book.nunique()), 'coef': {k: float(v) for k, v in m.params.items()},
                'se': {k: float(v) for k, v in m.bse.items()}, 'p': {k: float(v) for k, v in m.pvalues.items()},
                'book_var': float(m.cov_re.iloc[0, 0]), 'resid_var': float(m.scale),
                'resid_skew': float(scipy.stats.skew(res)), 'resid_kurtosis': float(scipy.stats.kurtosis(res)),
                'resid_shapiro_p': float(scipy.stats.shapiro(res[:5000])[1]) if len(res) >= 3 else None}
    except Exception as e:
        return {'formula': f, 'error': str(e)}

def lack_of_fit(df, y):
    """IB 3x3 cells at served/default: nested within-book OLS, quadratic (5 terms) vs a dummy per cell (8 terms)."""
    s = df[(df.edge == 'served') & (df.pool == 'default')].copy()
    if s.empty: return None
    X = design(s); s[COLS] = X[COLS]
    q = ['x1', 'x3', 'x1sq', 'x3sq', 'x1x3']
    s['cell'] = s.x1.astype(str) + '_' + s.x3.astype(str)
    cells = sorted(s.cell.unique()); dums = []
    if len(cells) < 7: return {'cells': len(cells), 'note': 'too few cells read yet'}
    for c in cells[1:]: s[f'c_{c}'] = (s.cell == c).astype(float); dums.append(f'c_{c}')
    def rss(cols):
        b = within(s, y, cols); Xd = s[cols].to_numpy(float); Y = s[y].to_numpy(float); g = s.book.to_numpy()
        Xm = Xd.copy(); Ym = Y.copy()
        for bk in np.unique(g):
            i = g == bk; Xm[i] -= Xm[i].mean(0); Ym[i] -= Ym[i].mean()
        r = Ym - Xm @ b; return float(r @ r)
    r_q, r_c = rss(q), rss(dums)
    df_lof = len(dums) - len(q); df_pe = len(s) - s.book.nunique() - len(dums)
    if df_lof <= 0 or df_pe <= 0: return None
    F = ((r_q - r_c) / df_lof) / (r_c / df_pe)
    return {'F': F, 'df': [df_lof, df_pe], 'p': float(1 - scipy.stats.f.cdf(F, df_lof, df_pe)), 'cells': len(cells)}

def mde_pairs(df):
    """6.8(d): smallest paired difference 80 % power, two-sided 0.05, from A-vs-A pairs on the same books."""
    out = {}
    for a1, a2 in (('L1', 'L2'), ('C1', 'C2'), ('C1', 'C3'), ('C2', 'C3'), ('L2', 'LI')):
        A = df[df.run == a1].set_index('book'); B = df[df.run == a2].set_index('book')
        bk = A.index.intersection(B.index)
        if len(bk) < 5: continue
        dc = (A.loc[bk].cer_pp - B.loc[bk].cer_pp).dropna(); dl = (A.loc[bk].lcost - B.loc[bk].lcost).dropna()
        out[f'{a1}-{a2}'] = {'books': int(len(bk)), 'mean_cer_pp': float(dc.mean()), 'sd_cer_pp': float(dc.std()), 'mde_cer_pp': float(2.8 * dc.std() / math.sqrt(len(dc))),
                             'mean_lcost': float(dl.mean()), 'sd_lcost': float(dl.std()), 'mde_lcost': float(2.8 * dl.std() / math.sqrt(len(dl)))}
    return out

result = {'built_by': 'scripts/eval/read-surface-6740/analysis6.py', 'versions': {'python': sys.version.split()[0], 'numpy': np.__version__, 'pandas': pd.__version__, 'statsmodels': statsmodels.__version__, 'scipy': scipy.__version__},
          'boot': a.boot, 'margin_pp': MARGIN, 'min_saving': MIN_SAVING, 'cost_unit': 'US $ a 1,000 pages, agy usage at gemini-3.8-flash list rates', 'langs': {}}
for lang, d in D.groupby('lang'):
    cerd = d[(d.status == 'read') & d.excluded.isna()]
    R = {'rows': int(len(d)), 'books': int(d.book.nunique()), 'runs': sorted(d.run.unique().tolist()),
         'models': {'cer_pp': mixed(cerd, 'cer_pp'), 'cer_logit': mixed(cerd, 'lcer'), 'log_cost': mixed(d[d.excluded.isna() | ~d.excluded.fillna('').str.startswith('by eye')], 'lcost')},
         'unweighted': cell_stats(d, False), 'weighted': cell_stats(d, True) if W.get(lang) else None,
         'lack_of_fit_ib': {'cer_pp': lack_of_fit(cerd, 'cer_pp'), 'log_cost': lack_of_fit(d, 'lcost')},
         'a_vs_a': mde_pairs(d)}
    # robust (third form: century is a covariate, not a per-stratum optimum; reported per century with >= 10 books)
    R['by_century'] = {}
    for c, g in d.groupby('century'):
        if g.book.nunique() >= 10:
            cs = cell_stats(g, False)
            R['by_century'][c] = {'books': int(g.book.nunique()), 'non_inferior': [x['name'] for x in cs['cells'] if x['non_inferior']], 'optimum': cs['optimum']}
        else: R['by_century'][c] = {'books': int(g.book.nunique()), 'too_few': True}
    result['langs'][lang] = R
# robust optimum: cheapest cell (pooled cost) non-inferior in every language and every century stratum with >= 10 books
names = [cellname(x1, x3) for x1, x3 in GRID]
ok = [n for n in names if all(n in [c['name'] for c in R['unweighted']['cells'] if c['non_inferior']] for R in result['langs'].values())
      and all(n in v['non_inferior'] for R in result['langs'].values() for v in R['by_century'].values() if not v.get('too_few'))]
pooled_cost = {n: np.mean([next(c['usd_per_1k_accepted'] for c in R['unweighted']['cells'] if c['name'] == n) for R in result['langs'].values()]) for n in names}
result['robust'] = {'non_inferior_everywhere': ok, 'optimum': min(ok, key=lambda n: pooled_cost[n]) if ok else None, 'rule': 'non-inferior in every language and every century with >= 10 books; cheapest by the mean over languages of cost per accepted page'}
json.dump(result, sys.stdout, indent=1, default=float)
