#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/heldout/heldout.py (#7878) — the partially pooled logit (Gaussian random effects,
# Laplace marginal likelihood, hyperparameters by coordinate ascent on log grids) and the held-out log density scoring;
# restated here on a PAGE design with a book effect (heldout.py's Design is route-level, pure Python, dense O(p^3) with
# p ~ 60; a page design has p ~ 2,000, so numpy). router-table/pooled_prior.py runs that model as a router prior and has
# no page or book level. confidence-7866/analyze.mjs scores one draw by itself.
"""Pooled quality model over every spot-check method (#6557). numpy + scipy (no model calls, no DB): the data come from
build-table.mjs.

  node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/pooled-quality/build-table.mjs   # Mongo reads
  python3 scripts/eval/estimator/pooled-quality/fit.py [--data DIR] [--out FILE.json] [--sim] [--fresh-only]

(--data defaults to $JOB_SCRATCH/pooled-quality or /tmp/pooled-quality; any python3 with numpy and scipy, e.g. a venv.)

Per stage (ocr, translation), a page's outcome y = 1 when its method's reader called it serious at that stage:
  logit P(y) = mu + method + form + writing system + language + engine + round + book + page
method and form (print / manuscript / unknown) are fixed effects with a N(0, 1.5^2) prior; the rest are Gaussian random
effects with their own scale (language nested in writing system, round nested in method, page only for pages read more
than once). Scales by Laplace marginal likelihood; effects are the MAP with the Laplace Gaussian posterior (scale
uncertainty is not propagated). The level is anchored on the methods that draw at random and read with REVIEWER.md
(ANCHOR), at a new round and a new book, and poststratified to live pages per cell (language x form x engine).

Held out (the preregistered test, experiments/2026-11-04-pooled-quality-model-6557.md): the newest fortnightly round
and the confidence-7866 draw, scored by book against the grand mean (G) and the plain per-method rate (M).
"""
import gzip, json, math, os, re, sys, collections as C
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla
import scipy.linalg as sla

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[1:]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
DATA = opt('--data', os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'pooled-quality'))
OUT = opt('--out')
RNG = np.random.default_rng(6557)
ANCHOR = ('shelf-overview', 'served-audit', 'fortnightly-spot-check')
H2_LANE = 'confidence-7866'
SGRID = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]
FIXED_SD = {'mu': 3.0, 'method': 1.5, 'form': 1.5}
RANDOM = ('wsys', 'lang', 'eng', 'round', 'book', 'page')
SIM_SIG = dict(wsys=0.5, lang=0.5, eng=0.75, round=0.35, book=1.0, page=0.5)   # known scales for the recovery check
expit = lambda x: 1 / (1 + np.exp(-x))
load = lambda n: json.load(gzip.open(os.path.join(DATA, n)))

# ---------------------------------------------------------------- factors
WSYS = {  # primary language (lowercased, first token) -> script family
    **{l: 'Latn' for l in ('latin', 'german', 'english', 'french', 'italian', 'dutch', 'spanish', 'danish', 'portuguese', 'swedish',
                           'polish', 'czech', 'hungarian', 'old', 'middle', 'malay', 'yucatec', 'nahuatl', 'welsh', 'irish', 'icelandic',
                           'norwegian', 'catalan', 'occitan', 'romanian', 'turkish', 'finnish', 'croatian', 'slovenian', 'basque', 'frisian')},
    **{l: 'Grek' for l in ('greek', 'ancient', 'byzantine', 'coptic')},
    **{l: 'Cyrl' for l in ('russian', 'church', 'old-church-slavonic', 'ukrainian', 'bulgarian', 'serbian')},
    **{l: 'Hani' for l in ('chinese', 'classical', 'japanese', 'korean', 'tangut', 'vietnamese')},
    'tibetan': 'Tibt', 'mongolian': 'Mong',
    **{l: 'Indic' for l in ('sanskrit', 'pali', 'hindi', 'tamil', 'bengali', 'prakrit', 'marathi', 'telugu', 'kannada', 'sinhala', 'burmese', 'thai')},
    **{l: 'Arab' for l in ('arabic', 'persian', 'ottoman', 'urdu', 'judeo-arabic')},
    **{l: 'Hebr' for l in ('hebrew', 'aramaic', 'yiddish', 'ladino')},
    **{l: 'Syrc' for l in ('syriac',)},
}


def lang_of(book):
    s = (book or {}).get('language') or 'unknown'
    first = re.split(r'\s*(?:/|,|;|\band\b|-(?=[A-Z]))\s*', s.strip())[0].strip().lower()
    first = {'classical chinese': 'chinese', 'ancient greek': 'greek', 'old english': 'english', 'middle english': 'english',
             'church slavonic': 'russian', 'old church slavonic': 'russian'}.get(first, first)
    return first or 'unknown'


def wsys_of(lang):
    return WSYS.get(lang, WSYS.get(lang.split()[0], 'Other')) if lang != 'unknown' else 'Other'


def form_of(st):
    return {'printed': 'print', 'handwritten': 'manuscript'}.get(st, 'unknown')


def eng_ocr(m):
    m = (m or '').lower()
    if not m: return 'unknown'
    if 'flash-lite' in m: return 'lite'
    if m.startswith('gemini-3-flash') or m.startswith('gemini-2'): return 'flash3'
    if re.search(r'gemini-3\.[5-9]-flash|argon', m): return 'agy'
    if 'paddle' in m: return 'paddle'
    if m.startswith('bdrc'): return 'bdrc'
    if m.startswith('source:') or 'corpus' in m or 'cbeta' in m or m in ('human', 'manual'): return 'etext'
    if m.startswith('ia-') or 'abbyy' in m: return 'ia-ocr'
    if 'lighton' in m or 'glm' in m or 'mineru' in m: return 'gpu'
    if 'kraken' in m or 'pero' in m: return 'htr'
    if 'claude' in m: return 'claude'
    if 'ndl' in m: return 'ndl'
    return 'other'


def eng_tr(m):
    e = eng_ocr(m)
    return e if e in ('lite', 'flash3', 'agy', 'claude', 'unknown') else 'other'


def route_eng(route, model):
    if model: return eng_ocr(model)
    r = (route or '').lower()
    last = r.split('>')[-1]
    if 'agy' in last: return 'agy'
    if last.startswith('opus') or last.startswith('sonnet'): return 'claude'
    if last.startswith('lite'): return 'lite'
    if '3flash' in last or 'flash3' in last: return 'flash3'
    if 'paddle' in last: return 'paddle'
    if 'yigdzin' in last: return 'bdrc'
    if last.startswith('import:ia') or 'ia_' in last: return 'ia-ocr'
    if last.startswith('import') or 'etext' in last: return 'etext'
    if 'gpu' in last or 'lighton' in last: return 'gpu'
    if 'pero' in last or 'kraken' in last: return 'htr'
    return 'unknown'


# ---------------------------------------------------------------- the table
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
_EV = {}


def from_evidence(c):
    """A reviewer row without page_findings: its serious pages from the evidence file (REVIEWER.md per-page errors with
    severity; ocr_errors -> ocr, tr_errors -> translation; right_page "no" -> wrong page). The same rule reproduces
    page_findings exactly on the 924 pages where both exist (2026-11-04)."""
    ep = os.path.join(REPO, c.get('evidence_path') or '')
    if not c.get('evidence_path') or not os.path.isfile(ep): return None
    if ep not in _EV: _EV[ep] = json.load(open(ep))
    d = _EV[ep]; d = d if isinstance(d, list) else d.get('books') or d.get('reviews') or []
    e = next((b for b in d if isinstance(b, dict) and b.get('book_id') == c['book_id']), None)
    if not e or not e.get('pages'): return None
    out = {}
    for p in e['pages']:
        errs = [dict(stage=st) for k, st in (('ocr_errors', 'ocr'), ('tr_errors', 'translation'), ('other', 'other'))
                for x in (p.get(k) or []) if isinstance(x, dict) and x.get('severity') == 'serious']
        if errs or p.get('right_page') == 'no': out[p['page_number']] = dict(errors=errs, wrong_page=p.get('right_page') == 'no')
    return out


def build_table():
    checks, verdicts, conv = load('checks.json.gz'), load('verdicts.json.gz'), load('convergence.json.gz')
    pages, books = load('pages.json.gz'), load('books.json.gz')
    P = {(p['book_id'], p['page_number']): p for p in pages}
    B = {b['id']: b for b in books}
    obs, excl, notes = [], C.Counter(), {}

    def add(stage, y, method, rnd, book_id, pn, eng, fresh, split='train', when=None):
        b = B.get(book_id); p = P.get((book_id, pn)) or {}
        lang = lang_of(b)
        obs.append(dict(stage=stage, y=int(y), method=method, round=f'{method}:{rnd}', book=book_id, page=f'{book_id}|{pn}', lang=lang,
                        wsys=wsys_of(lang), form=form_of(p.get('script_type')), eng=eng, fresh=fresh, split=split, when=when,
                        live=bool(b and b.get('visible') is True and (b.get('pages_count') or 0) > 0)))

    # newest fortnightly round = H1
    fort_runs = sorted({c['run_id'] for c in checks if c['method_id'] == 'fortnightly-spot-check'},
                       key=lambda r: max(str(c['checked_at']) for c in checks if c['run_id'] == r))
    h1 = fort_runs[-1] if fort_runs else None
    notes['H1_round'] = h1
    # convergence rows: the provenance captured at apply time, per page
    conv_tp = {}
    for c in checks:
        if c['method_id'] == 'ocr-convergence':
            for t in c.get('text_provenance') or []: conv_tp[(c['book_id'], t['page_number'])] = t

    for c in checks:
        m = c['method_id']
        if m in ('judged-pages', 'ocr-convergence'):
            excl[f'{m}: read at the source instead (lane_judge_verdicts / decisions files)'] += len(c.get('pages_read') or []); continue
        if m == 'hide-broken-text':
            excl['hide-broken-text: chosen on the outcome (the hide acts on a check that found broken text)'] += len(c.get('pages_read') or []); continue
        if m == 'curation-check':
            excl['curation-check: hand-picked pages, and page-level findings absent on 106 of 107 rows'] += len(c.get('pages_read') or []); continue
        if m == 'retranslation-gate':
            excl['retranslation-gate: blind A/B of a retranslation run\'s arms, Tibetan only (21 pages)'] += len(c.get('pages_read') or []); continue
        if m not in ANCHOR:
            excl[f'{m}: method not mapped to the shared outcome yet (add it in fit.py)'] += len(c.get('pages_read') or []); continue
        if '/reruns-' in c['run_id']:
            excl[f'{m}: re-read of the same pages by the same method (consistency runs, kappa 0.9, #6174)'] += len(c.get('pages_read') or []); continue
        fd = {f['page_number']: f for f in c['page_findings']} if 'page_findings' in c else from_evidence(c)
        if fd is None:
            excl[f'{m}: row has no page_findings and no evidence file with per-page errors'] += len(c.get('pages_read') or []); continue
        if 'page_findings' not in c: notes['pages_from_evidence'] = notes.get('pages_from_evidence', 0) + len(c.get('pages_read') or [])
        tp = {t['page_number']: t for t in c.get('text_provenance') or []}
        split = 'H1' if c['run_id'] == h1 else 'train'
        for pn in c.get('pages_read') or []:
            f = fd.get(pn) or {}; st = {e.get('stage') for e in f.get('errors') or []}; wp = bool(f.get('wrong_page'))
            t = tp.get(pn) or {}; live = P.get((c['book_id'], pn)) or {}
            fo = (t.get('ocr_updated_at') or None) == (live.get('ocr_updated_at') or None) if t else None
            ft = (t.get('translation_content_hash') or None) == (live.get('tr_hash') or None) if t and live.get('tr_hash') else (
                (t.get('translation_updated_at') or None) == (live.get('tr_updated_at') or None) if t else None)
            add('ocr', 'ocr' in st or wp, m, c['run_id'], c['book_id'], pn, eng_ocr(t.get('ocr_model') or live.get('ocr_model')), fo, split, c['checked_at'])
            add('translation', 'translation' in st or wp, m, c['run_id'], c['book_id'], pn, eng_tr(t.get('translation_model') or live.get('tr_model')), ft, split, c['checked_at'])

    planted = []
    for v in verdicts:
        if v['kind'] == 'planted': planted.append(v); continue
        if v['kind'] != 'item': excl[f"lane_judge_verdicts {v['kind']} rows: controls / drafts, not served text"] += 1; continue
        if not v.get('verdict') or not re.search('opus', str((v.get('judge') or {}).get('model_reported') or (v.get('judge') or {}).get('model') or ''), re.I):
            excl['lane_judge_verdicts: item without an Opus verdict'] += 1; continue
        live = P.get((v['book_id'], v['page_number'])) or {}
        stage = 'translation' if (v.get('task') == 'translation' or 'translate' in v['lane']) else 'ocr'
        wm = (v.get('write') or {}).get('model')
        eng = eng_tr(wm) if stage == 'translation' else route_eng(v.get('route'), wm)
        if v['lane'] == H2_LANE and eng == 'unknown': eng = eng_ocr(live.get('ocr_model'))
        add(stage, v['verdict']['fidelity'] <= 3, 'judged-pages', v['run_id'], v['book_id'], v['page_number'], eng,
            live.get('lane_text_live'), 'H2' if v['lane'] == H2_LANE else 'train', v.get('judged_at'))

    sets = C.defaultdict(list)
    for d in conv: sets[(d['run'], d['set'])].append(d)
    for (run, s), ds in sorted(sets.items()):
        opus = all(d['adjudicated'] and d['stored_serious'] is not None or d['action'] in ('agree', 'contain', 'no-second-read', 'pending-adjudication') for d in ds)
        if not opus:
            excl[f'ocr-convergence set {s}: no Opus page verdict (disagreements decided without the adjudicator)'] += len(ds); continue
        for d in ds:
            if d['action'] in ('no-second-read', 'pending-adjudication'): excl['ocr-convergence: page with no second read or not adjudicated'] += 1; continue
            y = 1 if d['action'] == 'contain' else 0 if d['action'] == 'agree' else int(bool(d['stored_serious']))
            t = conv_tp.get((d['book_id'], d['page_number'])) or {}; live = P.get((d['book_id'], d['page_number'])) or {}
            fresh = False if d['action'] == 'write' else ((t.get('ocr_updated_at') or None) == (live.get('ocr_updated_at') or None) if t else None)
            add('ocr', y, 'ocr-convergence', s, d['book_id'], d['page_number'], eng_ocr(d.get('stored_model') or t.get('ocr_model') or live.get('ocr_model')), fresh)
    return obs, excl, planted, notes


# ---------------------------------------------------------------- the model
class Design:
    def __init__(self, rows):
        multi = C.Counter(r['page'] for r in rows)
        self.cols = {}
        def col(g, lv):
            k = (g, lv)
            if k not in self.cols: self.cols[k] = len(self.cols)
            return self.cols[k]
        col('mu', 'mu')
        for r in rows:
            for g in ('method', 'form', 'wsys', 'lang', 'eng', 'round', 'book'): col(g, r[g])
            if multi[r['page']] > 1: col('page', r['page'])
        self.multi = multi
        self.p = len(self.cols)
        self.group = [None] * self.p
        for (g, lv), j in self.cols.items(): self.group[j] = g

    def idx(self, r, groups=('mu', 'method', 'form', 'wsys', 'lang', 'eng', 'round', 'book', 'page')):
        out = []
        for g in groups:
            lv = 'mu' if g == 'mu' else r.get(g)
            if (g, lv) in self.cols: out.append(self.cols[(g, lv)])
        return out

    def X(self, rows):
        ri, ci = [], []
        for i, r in enumerate(rows):
            for j in self.idx(r): ri.append(i); ci.append(j)
        return sp.csr_matrix((np.ones(len(ri)), (ri, ci)), shape=(len(rows), self.p))


def prior_prec(D, sig):
    return np.array([1 / (FIXED_SD.get(g) or sig[g]) ** 2 for g in D.group])


def hessian(X, pr, q):
    return (X.T @ sp.diags(pr * (1 - pr)) @ X + sp.diags(q)).tocsc()


def fit(D, X, y, sig, th0=None, iters=50):
    """MAP (Newton, line search, sparse LU) and the Laplace log marginal likelihood."""
    q = prior_prec(D, sig); th = np.zeros(D.p) if th0 is None else th0.copy()
    def obj(t):
        e = X @ t
        return float(np.sum(y * e - np.logaddexp(0, e)) - 0.5 * np.sum(q * t * t))
    cur = obj(th)
    for _ in range(iters):
        pr = expit(X @ th)
        g = X.T @ (y - pr) - q * th
        step = spla.splu(hessian(X, pr, q)).solve(g); s = 1.0
        while s > 1e-4:
            nt = th + s * step; v = obj(nt)
            if v >= cur - 1e-10: break
            s /= 2
        done = abs(v - cur) < 1e-7; th, cur = nt, v
        if done: break
    H = hessian(X, expit(X @ th), q)
    lu = spla.splu(H)
    logdet = float(np.sum(np.log(np.abs(lu.U.diagonal()))))
    lml = cur + 0.5 * np.sum(np.log(q)) - 0.5 * logdet
    return dict(theta=th, H=H, lu=lu, lml=float(lml), sig=dict(sig))


def fit_hyper(D, X, y, start=None):
    sig = dict(start or {g: 0.5 for g in RANDOM})
    best = fit(D, X, y, sig); cache = {}
    for _ in range(3):
        moved = False
        for g in RANDOM:
            if g not in set(D.group): continue
            for v in SGRID:
                s2 = dict(sig); s2[g] = v; key = tuple(sorted(s2.items()))
                if key not in cache: cache[key] = fit(D, X, y, s2, best['theta'])
                if cache[key]['lml'] > best['lml'] + 1e-6: best, sig, moved = cache[key], s2, True
        if not moved: break
    return best


def contrast(D, F, w):
    """Mean and sd of w . theta under the Laplace posterior (var = w' H^-1 w)."""
    return float(w @ F['theta']), float(math.sqrt(max(w @ F['lu'].solve(w), 0.0)))


def draws(F, n):
    """Joint posterior draws of theta: theta_hat + L^-T z, L the dense Cholesky of H (computed once per fit)."""
    if 'L' not in F: F['L'] = np.linalg.cholesky(F['H'].toarray())
    Z = RNG.standard_normal((F['L'].shape[0], n))
    return F['theta'][:, None] + sla.solve_triangular(F['L'].T, Z, lower=False)


def anchor_vec(D, methods=ANCHOR):
    w = np.zeros(D.p); ms = [m for m in methods if ('method', m) in D.cols]
    for m in ms: w[D.cols[('method', m)]] = 1 / len(ms)
    return w


# ---------------------------------------------------------------- held out
def lbeta(a, b): return math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)


def bb_lpd(k, n, m, W):
    a, b = m * W, (1 - m) * W
    return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1) + lbeta(k + a, n - k + b) - lbeta(a, b)


def bb_fit(kn):
    best = None
    for i in range(1, 200):
        m = i / 200
        for W in [math.exp(x / 8) for x in range(-16, 60)]:
            v = sum(bb_lpd(k, n, m, W) for k, n in kn)
            if best is None or v > best[0]: best = (v, m, W)
    return best[1], best[2]


def bb_pmf(n, m, W):
    return np.array([math.exp(bb_lpd(k, n, m, W)) for k in range(n + 1)])


def central90(pmf):
    """Smallest central interval [lo, hi] holding >= 90%."""
    c = np.cumsum(pmf); lo = int(np.searchsorted(c, 0.05 - 1e-12)); hi = int(np.searchsorted(c, 0.95 - 1e-12))
    return lo, min(hi, len(pmf) - 1)


def by_book(rows):
    g = C.defaultdict(list)
    for r in rows: g[r['book']].append(r)
    return g


def pooled_book_pmf(D, F, rows, method, nd=4000):
    """Predictive pmf of a held-out book's serious-page count: a new round of `method`; the book effect from training if
    the book was read there, else a new draw; posterior uncertainty jointly drawn."""
    T = draws(F, nd)                               # p x nd
    s = F['sig']
    u_round = RNG.standard_normal(nd) * s['round']
    bk = rows[0]['book']
    kb = ('book', bk)
    u_book = T[D.cols[kb]] if kb in D.cols else RNG.standard_normal(nd) * s['book']
    ps = []
    for r in rows:
        eta = T[D.cols[('mu', 'mu')]] + u_round + u_book
        for g in ('method', 'form', 'wsys', 'lang', 'eng'):
            lv = method if g == 'method' else r[g]
            if (g, lv) in D.cols: eta = eta + T[D.cols[(g, lv)]]
            elif g in s: eta = eta + RNG.standard_normal(nd) * s[g]     # an unseen level: a new draw at its scale
        ps.append(expit(eta))
    # Poisson-binomial per draw, averaged
    n = len(rows); pmf = np.zeros(n + 1)
    dist = np.zeros((nd, n + 1)); dist[:, 0] = 1
    for p in ps:
        new = dist * (1 - p)[:, None]; new[:, 1:] += dist[:, :-1] * p[:, None]; dist = new
    pmf = dist.mean(axis=0)
    return pmf


def score_heldout(D, F, train, test, method, label):
    tb, hb = by_book(train), by_book(test)
    kn_all = [(sum(r['y'] for r in v), len(v)) for v in tb.values()]
    kn_m = [(sum(r['y'] for r in v), len(v)) for v in tb.values() if all(r['method'] == method for r in v)]
    kn_m = [(sum(r['y'] for r in v if r['method'] == method), sum(1 for r in v if r['method'] == method)) for v in tb.values()]
    kn_m = [x for x in kn_m if x[1] > 0]
    gm, gW = bb_fit(kn_all); mm, mW = bb_fit(kn_m)
    res = dict(set=label, books=len(hb), pages=len(test), serious=sum(r['y'] for r in test), method=method,
               G=dict(mean=round(gm, 3), W=round(gW, 2), lpd=0.0, cover=0), M=dict(mean=round(mm, 3), W=round(mW, 2), books=len(kn_m), lpd=0.0, cover=0),
               P=dict(lpd=0.0, cover=0), per_book=[])
    tot_pred = np.zeros(1)
    set_pmf = np.array([1.0])
    for bk, rows in hb.items():
        k, n = sum(r['y'] for r in rows), len(rows)
        pp = pooled_book_pmf(D, F, rows, method)
        pg, pm = bb_pmf(n, gm, gW), bb_pmf(n, mm, mW)
        row = dict(book=bk, k=k, n=n, lang=rows[0]['lang'], eng=rows[0]['eng'])
        for name, pmf in (('P', pp), ('G', pg), ('M', pm)):
            lp = math.log(max(pmf[k], 1e-300)); lo, hi = central90(pmf)
            res[name]['lpd'] += lp; res[name]['cover'] += int(lo <= k <= hi)
            row[name] = dict(lpd=round(lp, 3), mean=round(float(np.arange(n + 1) @ pmf), 2), i90=[lo, hi])
        res['per_book'].append(row)
        set_pmf = np.convolve(set_pmf, pp)
    for name in ('P', 'G', 'M'):
        res[name]['lpd'] = round(res[name]['lpd'], 2); res[name]['coverage'] = round(res[name]['cover'] / len(hb), 3)
    # set-level rate: P's pmf of the total (books independent given the posterior is an approximation: it ignores the
    # shared round and posterior draw, so this interval is too narrow; the per-book scores are the preregistered ones)
    lo, hi = central90(set_pmf)
    res['set_rate'] = dict(observed=round(res['serious'] / len(test), 3), P_i90_independent_books=[round(lo / len(test), 3), round(hi / len(test), 3)])
    res['P_beats'] = dict(G=res['P']['lpd'] > res['G']['lpd'], M=res['P']['lpd'] > res['M']['lpd'])
    res['pass'] = bool(res['P_beats']['G'] and res['P_beats']['M'] and res['P']['coverage'] >= 0.80
                       and abs(res['P']['coverage'] - 0.9) <= abs(res['M']['coverage'] - 0.9))
    return res


def set_rate_interval(D, F, test, method, nd=4000):
    """P's 90% interval for the held-out set's serious rate, with the shared new round and joint posterior draws."""
    T = draws(F, nd); s = F['sig']
    u_round = RNG.standard_normal(nd) * s['round']
    tot = np.zeros(nd)
    for bk, rows in by_book(test).items():
        kb = ('book', bk)
        u_book = T[D.cols[kb]] if kb in D.cols else RNG.standard_normal(nd) * s['book']
        for r in rows:
            eta = T[D.cols[('mu', 'mu')]] + u_round + u_book
            for g in ('method', 'form', 'wsys', 'lang', 'eng'):
                lv = method if g == 'method' else r[g]
                if (g, lv) in D.cols: eta = eta + T[D.cols[(g, lv)]]
                elif g in s: eta = eta + RNG.standard_normal(nd) * s[g]
            tot += RNG.random(nd) < expit(eta)
    q = np.quantile(tot / len(test), [0.05, 0.5, 0.95])
    return [round(float(x), 3) for x in q]


# ---------------------------------------------------------------- poststratification
def frame_cells(stage):
    f = load('frame.json.gz'); B = {b['id']: b for b in load('books.json.gz')}
    cells = C.Counter()
    for r in f['rows']:
        n = r['ocr'] if stage == 'ocr' else r['tr']
        if not n: continue
        lang = lang_of(B.get(r['b']))
        eng = eng_ocr(r['m']) if stage == 'ocr' else eng_tr(r['t'])
        cells[(lang, wsys_of(lang), form_of(r['st']), eng)] += n
    return cells, f['built_at']


def poststrat(D, F, cells, nd=2000, by=('lang',)):
    T = draws(F, nd); s = F['sig']; a = anchor_vec(D)
    base = T[D.cols[('mu', 'mu')]] + a @ T
    newer = lambda g: RNG.standard_normal(nd) * s[g]
    out_rates = {}
    tot_w, tot = 0, np.zeros(nd)
    groups = C.defaultdict(lambda: [0, np.zeros(nd)])
    # integrate the new round and new book by MC: draw once per cell
    for (lang, wsys, form, eng), w in cells.items():
        eta = base + newer('round') + newer('book')
        for g, lv in (('form', form), ('wsys', wsys), ('lang', lang), ('eng', eng)):
            if (g, lv) in D.cols: eta = eta + T[D.cols[(g, lv)]]
            elif g in s: eta = eta + newer(g)
        p = expit(eta)
        tot += w * p; tot_w += w
        for key in by:
            kv = {'lang': lang, 'wsys': wsys, 'form': form, 'eng': eng}[key] if isinstance(key, str) else tuple({'lang': lang, 'wsys': wsys, 'form': form, 'eng': eng}[k] for k in key)
            gk = (key if isinstance(key, str) else '+'.join(key), kv)
            groups[gk][0] += w; groups[gk][1] = groups[gk][1] + w * p
    q = lambda v: [round(float(x), 3) for x in np.quantile(v, [0.05, 0.5, 0.95])]
    out = dict(all=dict(pages=int(tot_w), rate=q(tot / tot_w)))
    for (key, kv), (w, v) in groups.items():
        out.setdefault(key, {})['|'.join(kv) if isinstance(kv, tuple) else kv] = dict(pages=int(w), rate=q(v / w))
    return out


# ---------------------------------------------------------------- simulation
def simulate(D, rows, X, sig_true, meth_true, mu=-1.2, form_true=None):
    th = np.zeros(D.p)
    for (g, lv), j in D.cols.items():
        if g == 'mu': th[j] = mu
        elif g == 'method': th[j] = meth_true.get(lv, 0.0)
        elif g == 'form': th[j] = (form_true or {}).get(lv, 0.0)
        elif g in sig_true: th[j] = RNG.standard_normal() * sig_true[g]
    y = (RNG.random(len(rows)) < expit(X @ th)).astype(float)
    F = fit_hyper(D, X, y)
    a = anchor_vec(D); rep = {}
    for m, v in meth_true.items():
        if ('method', m) not in D.cols: continue
        w = np.zeros(D.p); w[D.cols[('method', m)]] = 1; w -= a
        true = v - sum(meth_true.get(x, 0) for x in ANCHOR if ('method', x) in D.cols) / len([x for x in ANCHOR if ('method', x) in D.cols])
        est, sd = contrast(D, F, w)
        rep[m] = dict(true=round(true, 3), est=round(est, 3), sd=round(sd, 3), inside90=abs(est - true) <= 1.645 * sd)
    return dict(sig_true=sig_true, sig_fit={g: F['sig'][g] for g in RANDOM if g in set(D.group)},
                within_factor2={g: (sig_true[g] / 2 <= F['sig'][g] <= sig_true[g] * 2) for g in sig_true if g in set(D.group)}, method_offsets=rep)


# ---------------------------------------------------------------- main
def summary_table(obs):
    t = C.defaultdict(C.Counter)
    for r in obs: t[(r['stage'], r['method'], r['split'])]['pages'] += 1; t[(r['stage'], r['method'], r['split'])]['serious'] += r['y']
    return {f'{s}|{m}|{sp}': dict(v) for (s, m, sp), v in sorted(t.items())}


def effects(D, F):
    out = C.defaultdict(dict); a = anchor_vec(D)
    for (g, lv), j in D.cols.items():
        if g in ('book', 'page', 'round'): continue
        w = np.zeros(D.p); w[j] = 1
        if g == 'method': w = w - a
        m, sd = contrast(D, F, w)
        out[g][lv] = [round(m, 3), round(m - 1.645 * sd, 3), round(m + 1.645 * sd, 3)]
    rounds = {}
    for (g, lv), j in D.cols.items():
        if g == 'round':
            w = np.zeros(D.p); w[j] = 1; m, sd = contrast(D, F, w); rounds[lv] = [round(m, 3), round(sd, 3)]
    out['round'] = rounds
    return dict(out)


def main():
    obs, excl, planted, notes = build_table()
    if '--table' in argv:
        print(json.dumps(dict(notes=notes, exclusions=dict(excl), table=summary_table(obs)), indent=1)); return
    fresh_only = '--fresh-only' in argv
    res = dict(_about=__doc__.split('\n\n')[0], data=DATA, built=notes, exclusions=dict(excl), table=summary_table(obs), stages={})
    res['frame_built_at'] = load('frame.json.gz')['built_at']
    # planted controls: does the shared reader (Opus, judge prompt) call a planted error serious?
    res['planted'] = dict(n=len(planted), serious_bar=sum(1 for v in planted if v.get('verdict') and v['verdict']['fidelity'] <= 3),
                          rejected=sum(1 for v in planted if v.get('verdict') and not v['verdict']['accept']),
                          kinds=dict(C.Counter((v.get('plant') or {}).get('kind') for v in planted)))
    for stage in ('ocr', 'translation'):
        rows = [r for r in obs if r['stage'] == stage]
        train = [r for r in rows if r['split'] == 'train' and (r['fresh'] is not False or not fresh_only)]
        if len(train) < 200:
            res['stages'][stage] = dict(skipped=f'{len(train)} training pages'); continue
        D = Design(train); X = D.X(train); y = np.array([r['y'] for r in train], float)
        sys.stderr.write(f'{stage}: {len(train)} pages, {len({r["book"] for r in train})} books, p = {D.p}\n')
        if '--sim-only' in argv:   # the recovery check, run before any real fit (preregistration)
            meth = sorted({r['method'] for r in train}); mt = {m: v for m, v in zip(meth, [0.0, 0.6, -0.5, 0.3, -0.3, 0.8])}
            res['stages'][stage] = dict(design=dict(pages=len(train), p=D.p), simulation=[simulate(D, train, X, SIM_SIG, mt) for _ in range(3)])
            continue
        F = fit_hyper(D, X, y)
        st = dict(pages=len(train), books=len({r['book'] for r in train}), p=D.p, lml=round(F['lml'], 2),
                  sig={g: F['sig'][g] for g in RANDOM if g in set(D.group)}, effects=effects(D, F),
                  multi_read_pages=sum(1 for v in D.multi.values() if v > 1),
                  fresh=dict(C.Counter(str(r['fresh']) for r in rows)))
        am, asd = contrast(D, F, anchor_vec(D) + np.eye(D.p)[D.cols[('mu', 'mu')]])
        st['anchor_logit'] = [round(am, 3), round(asd, 3)]
        # held out
        st['heldout'] = {}
        for label, meth in (('H1', 'fortnightly-spot-check'), ('H2', 'judged-pages')):
            test = [r for r in rows if r['split'] == label]
            if not test: continue
            sc = score_heldout(D, F, train, test, meth, label)
            sc['set_rate']['P_i90'] = set_rate_interval(D, F, test, meth)
            st['heldout'][label] = sc
        cells, built = frame_cells(stage)
        st['poststrat'] = poststrat(D, F, cells, by=('lang', 'wsys', 'form', 'eng', ('lang', 'eng'), ('lang', 'form')))
        # coverage: cells of the frame with no training page
        seen = C.Counter((r['lang'], r['form']) for r in train)
        lf = C.Counter()
        for (lang, w, form, eng), n in cells.items(): lf[(lang, form)] += n
        st['coverage'] = sorted([dict(lang=l, form=f, live_pages=n, pages_read=seen.get((l, f), 0)) for (l, f), n in lf.items()], key=lambda x: -x['live_pages'])[:60]
        if '--sim' in argv:
            meth = sorted({r['method'] for r in train}); mt = {m: v for m, v in zip(meth, [0.0, 0.6, -0.5, 0.3, -0.3, 0.8])}
            st['simulation'] = [simulate(D, train, X, SIM_SIG, mt) for _ in range(3)]
        res['stages'][stage] = st
        # final: refit with every split (held-out sets included) for the reported levels
        allr = [r for r in rows if (r['fresh'] is not False or not fresh_only)]
        D2 = Design(allr); F2 = fit_hyper(D2, D2.X(allr), np.array([r['y'] for r in allr], float), F['sig'])
        st['all_data'] = dict(pages=len(allr), books=len({r['book'] for r in allr}), sig={g: F2['sig'][g] for g in RANDOM if g in set(D2.group)},
                              effects=effects(D2, F2), poststrat=poststrat(D2, F2, cells, by=('lang', 'wsys', 'form', 'eng', ('lang', 'eng'), ('lang', 'form'))))
    if '--sim-only' in argv: res = dict(simulation_only=True, sig_true=SIM_SIG, stages=res['stages'])
    s = json.dumps(res, indent=1, default=str)
    if OUT: open(OUT, 'w').write(s + '\n')
    else: print(s)


if __name__ == '__main__':
    main()
