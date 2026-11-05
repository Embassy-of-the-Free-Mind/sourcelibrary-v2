#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/heldout/heldout.py (partially pooled logit, held-out scoring by cell) and
# estimator/pooled-quality (book_checks pages, failed on coverage). Neither has page-text, image or re-read features,
# and neither predicts a book's judged grade. Their lesson kept: split by book, score held out, intervals scored as
# preregistered. Preregistration: scripts/eval/experiments/2026-11-04-book-grade-model-prereg-7263.md.
"""
#7263 book-grade-model: does a small model over features we hold predict a book's judged grade?

  $JOB_SCRATCH/venv/bin/python scripts/eval/book-grade-7263/model.py dev       # dev only; writes results/dev.json
  $JOB_SCRATCH/venv/bin/python scripts/eval/book-grade-7263/model.py lockbox   # ONCE, after results/final-config.json is committed
  $JOB_SCRATCH/venv/bin/python scripts/eval/book-grade-7263/model.py expand    # judged-expand-7263, after the lockbox
  $JOB_SCRATCH/venv/bin/python scripts/eval/book-grade-7263/model.py sens      # labelled sensitivity (test rows on stored text)

Reads OUT/table-books.json.gz and OUT/table-pages.json.gz (assemble.mjs). Writes aggregates only to results/;
per-book predictions go to OUT (never committed).
"""
import gzip, json, math, os, subprocess, sys
for _v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(_v, '2')  # a shared 16-core box
import numpy as np
from scipy import optimize, special, stats
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, log_loss

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, 'results')
OUT = os.environ.get('BGM_OUT') or os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'bgm')
SEED_FOLDS, SEED_BOOT = 72631, 72633
FAMILIES = ['B', 'T', 'I', 'M', 'R']
CGRID = [0.03, 0.1, 0.3, 1.0]


def load(name):
    with gzip.open(os.path.join(OUT, name), 'rt') as f:
        return json.load(f)


# ── design matrices ──

def onehot(vals, levels):
    return np.array([[1.0 if v == l else 0.0 for l in levels] for v in vals]), [f'={l}' for l in levels]


def levels_of(vals, min_n=3):
    from collections import Counter
    c = Counter(vals)
    return sorted([k for k, n in c.items() if n >= min_n])


def collapse(vals, lv):
    return [v if v in lv else 'other' for v in vals]


class Design:
    """Fits level sets, medians, clips and scales on the TRAIN rows only; applies them to any rows."""

    def __init__(self, fams):
        self.fams = fams

    def raw(self, books):
        cols, names, cats = [], [], {}
        def num(name, xs):
            names.append(name); cols.append([np.nan if x is None or (isinstance(x, float) and not math.isfinite(x)) else float(x) for x in xs])
        if 'B' in self.fams:
            cats['lang'] = [b['lang'] for b in books]
            cats['unit'] = [b['unit'] for b in books]
            cats['script'] = [b['script'] for b in books]
            cats['route'] = [b['route'] for b in books]
        if 'T' in self.fams:
            for k in sorted(books[0]['T'].keys()):
                num(f'T.{k}', [b['T'].get(k) for b in books])
        if 'I' in self.fams:
            ks = sorted({k for b in books for k in (b['I'] or {}).keys()})
            for k in ks:
                num(f'I.{k}', [(b['I'] or {}).get(k) for b in books])
        if 'M' in self.fams:
            num('M.year', [b['year'] for b in books])
            num('M.log_pages', [math.log1p(b['pages_count']) if b['pages_count'] else None for b in books])
            num('M.p_route', [b['p_route'] for b in books])
            num('M.route_measured', [b['route_measured'] for b in books])
            num('M.route_wt_per1k', [b['route_wt_per1k'] for b in books])
            cats['provider'] = [b['provider'] for b in books]
            cats['engine'] = [b['engine'] for b in books]
        if 'R' in self.fams:
            for k in ['rev_dis_med', 'rev_any_share', 'rev_leafshift_share', 'agy_dis', 'agy_ned', 'agy_fail']:
                num(f'R.{k}', [b['R'].get(k) for b in books])
        X = np.array(cols, dtype=float).T if cols else np.zeros((len(books), 0))
        return X, names, cats

    def fit(self, books):
        X, names, cats = self.raw(books)
        self.names = names
        self.miss = [j for j in range(X.shape[1]) if np.isnan(X[:, j]).any()]
        self.med = np.array([np.nanmedian(X[:, j]) if np.isfinite(X[:, j]).any() else 0.0 for j in range(X.shape[1])])
        Xf = np.where(np.isnan(X), self.med, X)
        self.lo = np.percentile(Xf, 1, axis=0) if X.shape[1] else np.zeros(0)
        self.hi = np.percentile(Xf, 99, axis=0) if X.shape[1] else np.zeros(0)
        Xc = np.clip(Xf, self.lo, self.hi)
        self.mu = Xc.mean(axis=0) if X.shape[1] else np.zeros(0)
        self.sd = Xc.std(axis=0) + 1e-9 if X.shape[1] else np.zeros(0)
        self.levels = {k: levels_of(v) for k, v in cats.items()}
        return self

    def transform(self, books):
        X, _, cats = self.raw(books)
        parts, names = [], []
        if X.shape[1]:
            Xf = np.where(np.isnan(X), self.med, X)
            parts.append((np.clip(Xf, self.lo, self.hi) - self.mu) / self.sd); names += self.names
            if self.miss:
                parts.append(np.isnan(X[:, self.miss]).astype(float)); names += [f'{self.names[j]}?missing' for j in self.miss]
        for k, v in cats.items():
            oh, nm = onehot(collapse(v, self.levels[k]), self.levels[k] + ['other'])
            parts.append(oh); names += [f'{k}{n}' for n in nm]
        return (np.hstack(parts) if parts else np.zeros((len(books), 0))), names


# ── models ──

def group_folds(n_books, k, seed):
    rng = np.random.default_rng(seed)
    perm = rng.permutation(n_books)
    return [perm[i::k] for i in range(k)]


def fit_logit(Xtr, ytr, wtr, C=None, seed=0):
    if C is None:
        # inner grouped CV (books are rows here, so plain folds are grouped by book)
        best, bestC = 1e9, CGRID[0]
        for c in CGRID:
            ll = []
            for f in group_folds(len(ytr), 4, seed + 7):
                tr = np.setdiff1d(np.arange(len(ytr)), f)
                if len(set(ytr[tr])) < 2 or len(set(ytr[f])) < 2:
                    continue
                m = LogisticRegression(C=c, max_iter=4000).fit(Xtr[tr], ytr[tr], sample_weight=wtr[tr])
                ll.append(log_loss(ytr[f], m.predict_proba(Xtr[f])[:, 1], labels=[0, 1], sample_weight=wtr[f]))
            if ll and np.mean(ll) < best:
                best, bestC = np.mean(ll), c
        C = bestC
    return LogisticRegression(C=C, max_iter=4000).fit(Xtr, ytr, sample_weight=wtr), C


def fit_hgb(Xtr, ytr, wtr, seed=0):
    return HistGradientBoostingClassifier(max_depth=3, max_iter=200, min_samples_leaf=10, learning_rate=0.05, l2_regularization=1.0, random_state=seed).fit(Xtr, ytr, sample_weight=wtr), None


def oof(books, fams, kind='logit', reps=5, k=5, extra=()):
    """Out-of-fold P(bad) on dev, averaged over repeats. `extra` books join every training fold and are never scored."""
    y = np.array([b['bad'] for b in books]); w = np.array([b['n_pages'] / 5 for b in books])
    ye = np.array([b['bad'] for b in extra]); we = np.array([b['n_pages'] / 5 for b in extra])
    P = np.zeros((reps, len(books)))
    for r in range(reps):
        for f in group_folds(len(books), k, SEED_FOLDS + r):
            tr = np.setdiff1d(np.arange(len(books)), f)
            trb = [books[i] for i in tr] + list(extra)
            d = Design(fams).fit(trb)
            Xtr, _ = d.transform(trb); Xte, _ = d.transform([books[i] for i in f])
            m, _ = (fit_logit if kind == 'logit' else fit_hgb)(Xtr, np.r_[y[tr], ye].astype(int), np.r_[w[tr], we], seed=r)
            P[r, f] = m.predict_proba(Xte)[:, 1]
    return P.mean(axis=0)


def boot_ci(fn, n, B=4000, seed=SEED_BOOT):
    rng = np.random.default_rng(seed); vals = []
    for _ in range(B):
        idx = rng.integers(0, n, n)
        try:
            v = fn(idx)
            if v is not None and np.isfinite(v):
                vals.append(v)
        except ValueError:
            pass
    return [round(float(np.percentile(vals, 2.5)), 3), round(float(np.percentile(vals, 97.5)), 3)] if vals else None


def auc(y, p, idx=None):
    """Mann-Whitney AUC (ties count half); fast enough for 4,000 bootstrap resamples."""
    yy, pp = (y, p) if idx is None else (y[idx], p[idx])
    n1 = int(yy.sum()); n0 = len(yy) - n1
    if n1 == 0 or n0 == 0:
        return None
    r = stats.rankdata(pp)
    return float((r[yy == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def _ll(y, p):
    p = np.clip(p, 1e-15, 1 - 1e-15)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def cal_slope(y, p):
    lp = special.logit(np.clip(p, 1e-4, 1 - 1e-4))
    m = LogisticRegression(C=1e6, max_iter=4000).fit(lp.reshape(-1, 1), y)
    return float(m.coef_[0][0]), float(m.intercept_[0])


def scores(y, p, main):
    """AUC, log loss, slope on the `main` subset (books with >= 4 judged pages), with book-bootstrap CIs."""
    y, p = y[main], p[main]
    a = auc(y, p)
    return {'n': int(len(y)), 'bad': int(y.sum()), 'auc': round(a, 3) if a else None,
            'auc_ci': boot_ci(lambda i: auc(y, p, i), len(y)),
            'logloss': round(log_loss(y, p, labels=[0, 1]), 4), 'logloss_ci': boot_ci(lambda i: _ll(y[i], p[i]), len(y)),
            'slope': round(cal_slope(y, p)[0], 3), 'slope_ci': boot_ci(lambda i: cal_slope(y[i], p[i])[0] if len(set(y[i])) == 2 else None, len(y), B=500),
            'brier': round(float(np.mean((p - y) ** 2)), 4)}


# ── negative binomial on the book's count of sense errors (offset log units) ──

def _nb_ll(y, mu, a):
    r = 1 / a
    return special.gammaln(y + r) - special.gammaln(r) - special.gammaln(y + 1) + r * np.log(r / (r + mu)) + y * np.log(mu / (r + mu) + 1e-300)


def _nb_alpha(y, mu):
    """ML dispersion for fixed means."""
    res = optimize.minimize_scalar(lambda la: -_nb_ll(y, mu, math.exp(la)).sum(), bounds=(-6, 4), method='bounded')
    return math.exp(res.x)


def nb_fit(X, y, expo, lam=1.0, iters=6):
    """L2 negative binomial (NB2), offset log(exposure); beta and dispersion by alternating maximisation."""
    n, k = X.shape
    Xb = np.hstack([np.ones((n, 1)), X]); off = np.log(np.maximum(expo, 1.0))
    beta = np.zeros(k + 1); beta[0] = math.log(max(y.sum(), 1) / max(np.maximum(expo, 1.0).sum(), 1)); a = 1.0
    pen = np.r_[0.0, np.ones(k)]
    for _ in range(iters):
        r = 1 / a
        def f(bt):
            eta = np.clip(Xb @ bt + off, -30, 30); mu = np.exp(eta)
            ll = _nb_ll(y, mu, a).sum()
            g = Xb.T @ ((y - mu) * r / (r + mu))
            return -ll + 0.5 * lam * (pen * bt ** 2).sum(), -g + lam * pen * bt
        beta = optimize.minimize(f, beta, jac=True, method='L-BFGS-B').x
        a = _nb_alpha(y, np.exp(np.clip(Xb @ beta + off, -30, 30)))
    return beta, a


LAMS = [1.0, 10.0, 30.0, 100.0]


def nb_fit_cv(X, y, expo, seed=0):
    """Ridge strength by inner 4-fold predictive density; dispersion re-fitted on the cross-fitted means, so the
    interval carries out-of-sample error and not the in-sample fit (#6557 failed the other way, too wide)."""
    best = None
    for lam in LAMS:
        mu = np.zeros(len(y))
        for f in group_folds(len(y), 4, seed + 11):
            tr = np.setdiff1d(np.arange(len(y)), f)
            bt, _ = nb_fit(X[tr], y[tr], expo[tr], lam)
            mu[f] = nb_mu(bt, X[f], expo[f])
        a = _nb_alpha(y, mu); lpd = _nb_ll(y, mu, a).sum()
        if best is None or lpd > best[0]:
            best = (lpd, lam, a)
    beta, _ = nb_fit(X, y, expo, best[1])
    return beta, best[2], best[1]


def nb_mu(beta, X, expo):
    Xb = np.hstack([np.ones((X.shape[0], 1)), X])
    return np.exp(np.clip(Xb @ beta + np.log(np.maximum(expo, 1.0)), -30, 30))


def nb_interval(mu, a, level=0.90):
    r = 1 / a; p = r / (r + mu)
    lo = stats.nbinom.ppf((1 - level) / 2, r, p); hi = stats.nbinom.ppf(1 - (1 - level) / 2, r, p)
    return lo, hi


def nb_logpmf(yv, mu, a):
    r = 1 / a; p = r / (r + mu)
    return stats.nbinom.logpmf(yv, r, p)


def oof_nb(books, fams, reps=5, k=5):
    y = np.array([b['serious'] for b in books], float); u = np.array([b['units'] for b in books], float)
    MU = np.zeros((reps, len(books))); A = np.zeros((reps, len(books)))
    for r in range(reps):
        for f in group_folds(len(books), k, SEED_FOLDS + r):
            tr = np.setdiff1d(np.arange(len(books)), f)
            d = Design(fams).fit([books[i] for i in tr])
            Xtr, _ = d.transform([books[i] for i in tr]); Xte, _ = d.transform([books[i] for i in f])
            beta, a, _ = nb_fit_cv(Xtr, y[tr], u[tr] / 1000, seed=r)
            MU[r, f] = nb_mu(beta, Xte, u[f] / 1000) / np.maximum(u[f] / 1000, 1.0)  # per 1,000 units
            A[r, f] = a
    return MU.mean(axis=0), A.mean(axis=0)


def coverage(books, rate_per1k, a, main):
    y = np.array([b['serious'] for b in books], float); u = np.array([b['units'] for b in books], float)
    mu = rate_per1k * np.maximum(u / 1000, 1.0)
    lo, hi = nb_interval(mu, a)
    inside = (y >= lo) & (y <= hi)
    width = hi - lo
    return {'n': int(main.sum()), 'coverage_90': round(float(inside[main].mean()), 3),
            'coverage_ci': boot_ci(lambda i: float(inside[main][i].mean()), int(main.sum())),
            'median_width': float(np.median(width[main])), 'lower_bound_zero_share': round(float((lo[main] == 0).mean()), 3)}


# ── false reassurance ──

def reassurance(y, p, grades):
    out = []
    for t in [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5]:
        good = p < t
        n = int(good.sum())
        fr = float(y[good].mean()) if n else None
        out.append({'t': t, 'called_good': n, 'share_called_good': round(n / len(y), 3), 'false_reassurance': round(fr, 3) if fr is not None else None,
                    'fr_ci': boot_ci(lambda i: float(y[good][i].mean()), n, B=2000) if n >= 5 else None,
                    'D_among_called_good': int(sum(1 for g, k in zip(grades, good) if k and g == 'D'))})
    return out


# ── page-count curve: gamma-Poisson update of the NB prior, scored on a fixed held-out pair of pages ──

def page_curve(books, pages, prior_rate, a, rng_seed=SEED_FOLDS):
    rng = np.random.default_rng(rng_seed)
    res = {kk: {'lpd': [], 'p_any': [], 'y_any': [], 'grade_hit': [], 'bad_est': [], 'bad_true': []} for kk in [0, 1, 2, 3]}
    ent = []
    by = {}
    for p in pages:
        by.setdefault(p['book_id'], []).append(p)
    for bi, b in enumerate(books):
        ps = sorted(by[b['book_id']], key=lambda x: x['page_id'])
        if len(ps) < 5:
            continue
        order = rng.permutation(len(ps))
        target, cond = [ps[i] for i in order[:2]], [ps[i] for i in order[2:]]
        ty = sum(x['serious'] for x in target); tu = max(sum(x['units'] for x in target) / 1000, 1e-3)
        r0, mu0 = 1 / a[bi], prior_rate[bi]   # prior on the per-1,000 rate: Gamma(shape r0, rate r0/mu0)
        pb0 = None
        for kk in [0, 1, 2, 3]:
            cy = sum(x['serious'] for x in cond[:kk]); cu = sum(x['units'] for x in cond[:kk]) / 1000
            shape, rate = r0 + cy, r0 / mu0 + cu
            # predictive for the target count: NB(shape, rate/(rate+tu))
            lp = stats.nbinom.logpmf(ty, shape, rate / (rate + tu))
            p_any = 1 - stats.nbinom.pmf(0, shape, rate / (rate + tu))
            p_bad = 1 - stats.gamma.cdf(5.0, shape, scale=1 / rate)  # P(rate > 5 per 1,000)
            seen_wrong = any(x['wrong_page'] for x in cond[:kk])
            est_bad = 1 if (seen_wrong or p_bad > 0.5) else 0
            res[kk]['lpd'].append(lp); res[kk]['p_any'].append(p_any); res[kk]['y_any'].append(1 if ty > 0 else 0)
            res[kk]['bad_est'].append(est_bad); res[kk]['bad_true'].append(b['bad'])
            if kk == 0:
                pb0 = p_bad
        ent.append(-(pb0 * math.log(pb0 + 1e-12) + (1 - pb0) * math.log(1 - pb0 + 1e-12)))
    out = {}
    for kk, v in res.items():
        ya, pa = np.array(v['y_any']), np.array(v['p_any'])
        out[kk] = {'books': len(v['lpd']), 'mean_lpd_pair': round(float(np.mean(v['lpd'])), 4),
                   'auc_any_on_pair': round(auc(ya, pa), 3) if auc(ya, pa) else None,
                   'bad_call_agrees_with_5_page_grade': round(float(np.mean(np.array(v['bad_est']) == np.array(v['bad_true']))), 3)}
    # value of the first judged page by tercile of k=0 predictive entropy
    ent = np.array(ent); gain = np.array(res[1]['lpd']) - np.array(res[0]['lpd'])
    cuts = np.percentile(ent, [33.3, 66.7])
    terc = np.digitize(ent, cuts)
    out['first_page_gain_by_uncertainty'] = [{'tercile': ['most sure', 'middle', 'least sure'][t], 'books': int((terc == t).sum()),
                                              'mean_lpd_gain': round(float(gain[terc == t].mean()), 4)} for t in range(3)]
    return out


# ── page-level model for "many" ──

def page_model(pages, fams_on):
    """OOF AUC for page "many" from page features (+ the book's metadata baseline), grouped by book."""
    keys_T = sorted(pages[0]['T'].keys()); keys_I = sorted((next(p for p in pages if p['I'])['I']).keys())
    def mat(ps):
        cols = []
        if 'T' in fams_on: cols += [[p['T'].get(k) for p in ps] for k in keys_T]
        if 'I' in fams_on: cols += [[(p['I'] or {}).get(k) for p in ps] for k in keys_I]
        if 'R' in fams_on: cols += [[p['R'].get(k) for p in ps] for k in ['rev_dis', 'rev_any', 'agy_dis', 'agy_ned']]
        X = np.array([[np.nan if v is None else float(v) for v in c] for c in cols]).T if cols else np.zeros((len(ps), 0))
        cats = [onehot([p['lang'] for p in ps], sorted({p['lang'] for p in pages}))[0], onehot([p['unit'] for p in ps], ['alphabetic', 'cjk', 'tibetan'])[0],
                onehot([p['script'] for p in ps], ['print', 'manuscript', 'unknown'])[0]]
        return X, np.hstack(cats)
    y = np.array([p['many'] for p in pages]); bk = np.array([p['book_id'] for p in pages]); ub = sorted(set(bk))
    P = np.zeros(len(pages)); R = 3
    for r in range(R):
        for f in group_folds(len(ub), 5, SEED_FOLDS + r):
            teb = {ub[i] for i in f}; te = np.array([b in teb for b in bk]); tr = ~te
            Xn, Xc = mat(pages)
            med = np.nanmedian(np.where(tr[:, None], Xn, np.nan), axis=0) if Xn.shape[1] else np.zeros(0)
            Xf = np.where(np.isnan(Xn), med, Xn) if Xn.shape[1] else Xn
            mu, sd = (Xf[tr].mean(0), Xf[tr].std(0) + 1e-9) if Xn.shape[1] else (0, 1)
            X = np.hstack([(Xf - mu) / sd if Xn.shape[1] else Xf, Xc])
            m = LogisticRegression(C=0.1, max_iter=4000).fit(X[tr], y[tr])
            P[te] += m.predict_proba(X[te])[:, 1] / R
    return {'pages': len(y), 'many': int(y.sum()), 'auc': round(auc(y, P), 3), 'auc_ci': boot_ci(lambda i: auc(y, P, i), len(y), B=1000)}


def within(books, p, main):
    y = np.array([b['bad'] for b in books])
    out = {}
    cells = {
        'zh Paddle manuscripts (7866 low/middle cell)': [b['lang'] == 'Chinese' and b['route'] == 'paddle' for b in books],
        'Chinese': [b['lang'] == 'Chinese' for b in books], 'Sanskrit': [b['lang'] == 'Sanskrit' for b in books],
        'Latin': [b['lang'] == 'Latin' for b in books],
    }
    for k, sel in cells.items():
        idx = np.where(np.array(sel) & main)[0]
        a = auc(y, p, idx)
        out[k] = {'books': int(len(idx)), 'bad': int(y[idx].sum()), 'auc': round(a, 3) if a else None,
                  'auc_ci': boot_ci(lambda i: auc(y[idx], p[idx], i), len(idx), B=2000) if a else None}
    return out


def lolo(books, fams):
    from collections import Counter
    y = np.array([b['bad'] for b in books]); w = np.array([b['n_pages'] / 5 for b in books])
    langs = [l for l, n in Counter(b['lang'] for b in books).items() if n >= 5]
    P = np.full(len(books), np.nan); per = {}
    for L in langs:
        te = np.array([b['lang'] == L for b in books]); tr = ~te
        d = Design(fams).fit([b for b, t in zip(books, tr) if t])
        Xtr, _ = d.transform([b for b, t in zip(books, tr) if t]); Xte, _ = d.transform([b for b, t in zip(books, te) if t])
        m, _ = fit_logit(Xtr, y[tr], w[tr])
        P[te] = m.predict_proba(Xte)[:, 1]
        a = auc(y[te], P[te])
        per[L] = {'books': int(te.sum()), 'bad': int(y[te].sum()), 'auc': round(a, 3) if a else None, 'mean_pred': round(float(P[te].mean()), 3), 'observed_bad': round(float(y[te].mean()), 3)}
    sel = ~np.isnan(P)
    return {'pooled_auc': round(auc(y[sel], P[sel]), 3), 'books': int(sel.sum()), 'by_language': per}


def coefs(books, fams):
    y = np.array([b['bad'] for b in books]); w = np.array([b['n_pages'] / 5 for b in books])
    d = Design(fams).fit(books); X, names = d.transform(books)
    m, C = fit_logit(X, y, w)
    c = sorted(zip(names, m.coef_[0]), key=lambda t: -abs(t[1]))
    return {'C': C, 'top': [[n, round(float(v), 3)] for n, v in c[:25]]}


def dev():
    allb = load('table-books.json.gz'); allp = load('table-pages.json.gz')
    books = [b for b in allb if not b['lockbox']]
    pages = [p for p in allp if not p['lockbox']]
    main = np.array([b['n_pages'] >= 4 for b in books])
    y = np.array([b['bad'] for b in books]); grades = [b['grade'] for b in books]
    R = {'dev_books': len(books), 'dev_books_5page': int(main.sum()), 'dev_bad_5page': int(y[main].sum()), 'families': {}}
    combos = {'B': ['B'], **{f'B+{f}': ['B', f] for f in FAMILIES[1:]}, 'all': FAMILIES, **{f'all-{f}': [x for x in FAMILIES if x != f] for f in FAMILIES[1:]}}
    preds = {}
    for name, fams in combos.items():
        preds[name] = oof(books, fams)
        R['families'][name] = scores(y, preds[name], main)
        print(name, R['families'][name]['auc'], R['families'][name]['logloss'], flush=True)
    # final features by the preregistered rule: B plus every family whose addition lowers dev OOF log loss
    base_ll = R['families']['B']['logloss']
    final = ['B'] + [f for f in FAMILIES[1:] if R['families'][f'B+{f}']['logloss'] < base_ll]
    pf = preds['B'] if final == ['B'] else oof(books, final)
    ph = oof(books, final, kind='hgb')
    s_l, s_h = scores(y, pf, main), scores(y, ph, main)
    kind = 'hgb' if s_l['logloss'] - s_h['logloss'] >= 0.02 else 'logit'
    p = ph if kind == 'hgb' else pf
    R['final'] = {'families': final, 'kind': kind, 'logit': s_l, 'hgb': s_h}
    # confidence score of #7866 alone, on the same books (p_route only where measured)
    R['within_cell'] = within(books, p, main)
    R['within_cell_baseline'] = within(books, preds['B'], main)
    R['false_reassurance'] = reassurance(y[main], p[main], [g for g, m in zip(grades, main) if m])
    R['false_reassurance_baseline'] = reassurance(y[main], preds['B'][main], [g for g, m in zip(grades, main) if m])
    R['lolo'] = {'final': lolo(books, final), 'baseline': lolo(books, ['B'])}
    # NB rate model: coverage, and the page-count curve
    rate_f, a_f = oof_nb(books, final)
    rate_b, a_b = oof_nb(books, ['B'])
    gm = np.array([b['serious'] for b in books]).sum() / np.array([b['units'] for b in books]).sum() * 1000
    R['coverage'] = {'final': coverage(books, rate_f, a_f, main), 'baseline': coverage(books, rate_b, a_b, main)}
    R['nb_dispersion'] = {'final': round(float(np.mean(a_f)), 3), 'baseline': round(float(np.mean(a_b)), 3)}
    R['page_curve'] = {'final_prior': page_curve(books, pages, rate_f, a_f), 'baseline_prior': page_curve(books, pages, rate_b, a_b),
                       'flat_prior': page_curve(books, pages, np.full(len(books), gm), a_b)}
    R['page_model_many'] = {'B': page_model(pages, []), 'B+T': page_model(pages, ['T']), 'B+T+I+R': page_model(pages, ['T', 'I', 'R'])}
    R['coefficients'] = coefs(books, final)
    os.makedirs(RESULTS, exist_ok=True)
    with open(os.path.join(RESULTS, 'dev.json'), 'w') as f:
        json.dump(R, f, indent=1)
    with open(os.path.join(OUT, 'dev-oof.json'), 'w') as f:
        json.dump({b['book_id']: {'p_bad': float(p[i]), 'p_bad_baseline': float(preds['B'][i]), 'rate': float(rate_f[i])} for i, b in enumerate(books)}, f)
    print(json.dumps({k: R[k] for k in ['final', 'within_cell', 'coverage']}, indent=1))


def lockbox():
    cfg_path = os.path.join(RESULTS, 'final-config.json')
    out_path = os.path.join(RESULTS, 'lockbox.json')
    if os.path.exists(out_path):
        sys.exit('lockbox already opened: results/lockbox.json exists. It is looked at once.')
    st = subprocess.run(['git', 'status', '--porcelain', cfg_path, os.path.abspath(__file__)], capture_output=True, text=True, cwd=HERE).stdout.strip()
    if st or not os.path.exists(cfg_path):
        sys.exit('commit results/final-config.json and model.py first: the final model must be frozen before the lockbox opens.')
    cfg = json.load(open(cfg_path))
    allb = load('table-books.json.gz')
    dev_b = [b for b in allb if not b['lockbox']]; lock = [b for b in allb if b['lockbox']]
    fams, kind = cfg['families'], cfg['kind']
    y_d = np.array([b['bad'] for b in dev_b]); w_d = np.array([b['n_pages'] / 5 for b in dev_b])
    out = {'config': cfg, 'lockbox_books': len(lock)}
    for label, fs in [('final', fams), ('baseline', ['B'])] + [('secondary:' + '+'.join(v), v) for v in cfg.get('secondary', [])]:
        d = Design(fs).fit(dev_b); Xd, _ = d.transform(dev_b); Xl, _ = d.transform(lock)
        m, C = (fit_logit if (kind == 'logit' or label != 'final') else fit_hgb)(Xd, y_d, w_d)
        p = m.predict_proba(Xl)[:, 1]
        y = np.array([b['bad'] for b in lock]); main = np.array([b['n_pages'] >= 4 for b in lock])
        res = {'five_page_books': scores(y, p, main)}
        one = ~main
        if one.sum() and len(set(y[one])) == 2:
            res['one_page_books'] = {'n': int(one.sum()), 'bad': int(y[one].sum()), 'auc': round(auc(y[one], p[one]), 3)}
        res['false_reassurance'] = reassurance(y[main], p[main], [b['grade'] for b, k in zip(lock, main) if k])
        if label != 'baseline':
            beta, a, lam = nb_fit_cv(Xd, np.array([b['serious'] for b in dev_b], float), np.array([b['units'] for b in dev_b], float) / 1000)
            ul = np.array([b['units'] for b in lock], float)
            rate = nb_mu(beta, Xl, ul / 1000) / np.maximum(ul / 1000, 1.0)
            res['coverage'] = coverage(lock, rate, np.full(len(lock), a), main)
            res['within_cell'] = within(lock, p, main)
        if label == 'final':
            with open(os.path.join(OUT, 'lockbox-preds.json'), 'w') as f:
                json.dump({b['book_id']: float(p[i]) for i, b in enumerate(lock)}, f)
        out[label] = res
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=1)
    print(json.dumps(out, indent=1))


def later_test(name, test_b, train_b, cfg):
    """Fit on train_b with the frozen config (and each secondary variant, and the baseline); score test_b, one page a book."""
    out = {'books': len(test_b), 'bad': int(sum(b['bad'] for b in test_b))}
    seen = {b['lang'] for b in train_b}
    y_t = np.array([b['bad'] for b in train_b]); w_t = np.array([b['n_pages'] / 5 for b in train_b])
    many = np.array([1 if (b['serious'] >= 3 or b['wrong_page']) else 0 for b in test_b])
    y = np.array([b['bad'] for b in test_b]); allm = np.ones(len(test_b), bool)
    sel_seen = np.array([b['lang'] in seen for b in test_b])
    for label, fs in [('final', cfg['families']), ('baseline', ['B'])] + [('secondary:' + '+'.join(v), v) for v in cfg.get('secondary', [])]:
        d = Design(fs).fit(train_b); Xd, _ = d.transform(train_b); Xl, _ = d.transform(test_b)
        m, _ = (fit_hgb if (label == 'final' and cfg['kind'] == 'hgb') else fit_logit)(Xd, y_t, w_t)
        p = m.predict_proba(Xl)[:, 1]
        res = {'bad': scores(y, p, allm), 'many_auc': round(auc(many, p), 3), 'many_auc_ci': boot_ci(lambda i: auc(many, p, i), len(y), B=2000),
               'seen_language': {'n': int(sel_seen.sum()), 'bad': int(y[sel_seen].sum()), 'auc': round(auc(y[sel_seen], p[sel_seen]) or float('nan'), 3)},
               'unseen_language': {'n': int((~sel_seen).sum()), 'bad': int(y[~sel_seen].sum()), 'auc': round(auc(y[~sel_seen], p[~sel_seen]) or float('nan'), 3) if (~sel_seen).sum() else None},
               'false_reassurance': reassurance(y, p, [b['grade'] for b in test_b]),
               'agy_read_share': round(float(np.mean([b['R'].get('agy_dis') is not None for b in test_b])), 3)}
        from collections import Counter
        res['by_language'] = {L: {'n': n, 'bad': int(sum(b['bad'] for b in test_b if b['lang'] == L)), 'mean_pred': round(float(np.mean([pp for b, pp in zip(test_b, p) if b['lang'] == L])), 3),
                                  'auc': (lambda a: round(a, 3) if a else None)(auc(np.array([b['bad'] for b in test_b if b['lang'] == L]), np.array([pp for b, pp in zip(test_b, p) if b['lang'] == L])))}
                              for L, n in Counter(b['lang'] for b in test_b).most_common() if n >= 10}
        if label != 'baseline':
            beta, a, _ = nb_fit_cv(Xd, np.array([b['serious'] for b in train_b], float), np.array([b['units'] for b in train_b], float) / 1000)
            ul = np.array([b['units'] for b in test_b], float)
            res['coverage'] = coverage(test_b, nb_mu(beta, Xl, ul / 1000) / np.maximum(ul / 1000, 1.0), np.full(len(test_b), a), allm)
        out[label] = res
        print(name, label, res['bad']['auc'], res['many_auc'], flush=True)
    return out


def frozen():
    cfg_path = os.path.join(RESULTS, 'final-config.json')
    st = subprocess.run(['git', 'status', '--porcelain', cfg_path, os.path.abspath(__file__)], capture_output=True, text=True, cwd=HERE).stdout.strip()
    if st or not os.path.exists(cfg_path):
        sys.exit('commit results/final-config.json and model.py first.')
    return json.load(open(cfg_path))


def expand():
    """judged-expand-7263: the second, later test. Trained on all 220 label books (the lockbox is open by now)."""
    if not os.path.exists(os.path.join(RESULTS, 'lockbox.json')):
        sys.exit('open the lockbox first: the expand test trains on it.')
    cfg = frozen()
    out = later_test('expand', load('expand/table-books.json.gz'), load('table-books.json.gz'), cfg)
    out['config'] = cfg
    with open(os.path.join(RESULTS, 'expand.json'), 'w') as f:
        json.dump(out, f, indent=1)


def sens():
    """Labelled sensitivity: the test rows on stored text join every dev training fold; dev out-of-fold change."""
    cfg = frozen()
    books = [b for b in load('table-books.json.gz') if not b['lockbox']]
    extra = load('sens/table-books.json.gz')
    main = np.array([b['n_pages'] >= 4 for b in books]); y = np.array([b['bad'] for b in books])
    out = {'extra_books': len(extra), 'extra_bad': int(sum(b['bad'] for b in extra)), 'extra_langs': sorted({b['lang'] for b in extra})}
    for label, fs in [('final', cfg['families'])] + [('secondary:' + '+'.join(v), v) for v in cfg.get('secondary', [])]:
        p0 = oof(books, fs); p1 = oof(books, fs, extra=extra)
        out[label] = {'without': scores(y, p0, main), 'with': scores(y, p1, main),
                      'within_without': within(books, p0, main), 'within_with': within(books, p1, main)}
        print(label, out[label]['without']['auc'], out[label]['with']['auc'], flush=True)
    with open(os.path.join(RESULTS, 'sensitivity.json'), 'w') as f:
        json.dump(out, f, indent=1)


if __name__ == '__main__':
    {'dev': dev, 'lockbox': lockbox, 'expand': expand, 'sens': sens}[sys.argv[1]]()
