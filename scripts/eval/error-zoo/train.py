#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/model2.py — HistGradientBoosting with GroupKFold by book over feats2.json (one
source: the spare audit), group ablations and quintile tables. This is the same model over the all-source table
(feats.json from features.py), and adds what one source cannot give: AUC and precision@k PER SOURCE of labels,
cross-instrument transfer (train on every other instrument, test on this one), the difficulty-vs-text ablation, and
the honest frame (random draws, served text) for the "top 5% holds X% of serious pages" statement.

train.py <dir> [--out <dir>/predictor-report.md]   reads <dir>/feats.json, writes the report and <dir>/preds.jsonl.
CPU-light: OMP_NUM_THREADS is respected by sklearn; ~12K rows x ~130 features, seconds per fit.
"""
import json, sys, math, collections as C, warnings
import numpy as np
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier as HGB
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score
from sklearn.inspection import permutation_importance

DIR = sys.argv[1]
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else f'{DIR}/predictor-report.md'
D = json.load(open(f'{DIR}/feats.json'))
lines = []
say = lambda s='': (lines.append(s), print(s))

# ---- matrix ---------------------------------------------------------------------------------------------------
for key in ('tr_ratio', 'ocr_chars', 'tri_ppl', 'oov_frac', 'len_vs_neighbours'):
    by = C.defaultdict(list)
    for d in D:
        v = d['num'].get(key)
        if v is not None and v == v: by[d['cat']['lang']].append(np.log1p(v) if key != 'tri_ppl' else v)
    for d in D:
        v = d['num'].get(key); a = by[d['cat']['lang']]
        if v is not None and v == v and len(a) >= 10:
            x = np.log1p(v) if key != 'tri_ppl' else v; med = np.median(a); mad = np.median(np.abs(np.array(a) - med)) + 1e-6
            d['num']['z_' + key] = (x - med) / mad; d['num']['absz_' + key] = abs((x - med) / mad)
cnt = C.Counter((k, v) for d in D for k, v in d['cat'].items())
cats = sorted(c for c in cnt if cnt[c] >= 15)
nums = sorted({k for d in D for k in d['num']})
names = nums + [f'{k}={v}' for k, v in cats]
X = np.array([[d['num'].get(k, np.nan) for k in nums] + [1.0 if d['cat'].get(k) == v else 0.0 for k, v in cats] for d in D], dtype=float)
y = np.array([d['y'] for d in D]); g = np.array([d['book'] for d in D])
src = np.array([d['source'] for d in D]); meth = np.array([d['method'] for d in D])
sel = np.array([d.get('selection') or 'NA' for d in D]); expo = np.array([d.get('exposure') or 'NA' for d in D])
stale = np.array([bool(d.get('stale')) for d in D]); posonly = np.array([bool(d.get('positive_only')) for d in D])

DIFFICULTY = [n for n in names if n.split('=')[0] in ('lang', 'ocr_family', 'tr_family', 'script', 'page_type', 'book_class', 'provider', 'ocr_prompt', 'scan_quality')
              or n in ('year', 'pages_count', 'page_pos', 'edge_page', 'img_aspect', 'img_px', 'quality_score', 'split_from_spread')]
TEXT = [n for n in names if n not in DIFFICULTY]
SEAM = [n for n in names if n.startswith(('seam_', 'catchword', 't5_', 'prev_', 'next_', 'len_vs', 'page_num', 'has_page_num'))]
idx = lambda cols: [names.index(c) for c in cols]
mk = lambda: HGB(max_depth=3, learning_rate=0.04, max_iter=350, l2_regularization=2.0, min_samples_leaf=25)

def cv_pred(mask, cols, seeds=2):
    """Out-of-book predictions for rows in mask, trained on rows in mask (GroupKFold by book)."""
    ii = np.where(mask)[0]; p = np.zeros(len(ii))
    for sd in range(seeds):
        perm = np.random.RandomState(sd).permutation(len(ii)); j = ii[perm]
        pp = cross_val_predict(mk(), X[j][:, idx(cols)], y[j], cv=GroupKFold(5), groups=g[j], method='predict_proba')[:, 1]
        q = np.zeros(len(ii)); q[perm] = pp; p += q / seeds
    return ii, p

def auc(yy, pp):
    return roc_auc_score(yy, pp) if len(set(yy)) == 2 and len(yy) >= 20 else float('nan')

def at_k(yy, pp, q):
    o = np.argsort(-pp); k = max(1, int(len(yy) * q)); return yy[o[:k]].mean(), yy[o[:k]].sum() / max(1, yy.sum())

def wilson(k, n, z=1.96):
    if n == 0: return (0, 0)
    p = k / n; den = 1 + z * z / n; c = (p + z * z / (2 * n)) / den; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0, c - h), min(1, c + h))

train_mask = (~stale) & (~posonly)
say(f'# Bad-page predictor, v2 — all label sources\n')
say(f'Rows featured: {len(D)}; trainable (fresh text, not positive-only): {train_mask.sum()}; books: {len(set(g[train_mask]))}; features: {len(names)} ({len(DIFFICULTY)} difficulty, {len(TEXT)} text, of which {len(SEAM)} seam).')
say(f'Serious rate on trainable rows: {y[train_mask].mean():.0%}. Stale rows (text changed since the judgment) held out: {stale.sum()}; positive-only correction rows: {posonly.sum()}.\n')

# ---- 1. pooled model, per-source evaluation ---------------------------------------------------------------------
say('## 1. Pooled model (all sources, GroupKFold by book), scored per label source\n')
ii, p = cv_pred(train_mask, names)
P = np.full(len(D), np.nan); P[ii] = p
say('| source / method | n | base rate | AUC | prec@10% | catch@10% | prec@30% | catch@30% |')
say('|---|---|---|---|---|---|---|---|')
def row(label, m):
    yy = y[m]; pp = P[m]
    if len(yy) < 30: return
    a = auc(yy, pp); p10, c10 = at_k(yy, pp, .10); p30, c30 = at_k(yy, pp, .30)
    say(f'| {label} | {len(yy)} | {yy.mean():.0%} | {a:.3f} | {p10:.0%} | {c10:.0%} | {p30:.0%} | {c30:.0%} |')
row('**all**', train_mask)
for s in sorted(set(src[train_mask])): row(f'source {s}', train_mask & (src == s))
for m_ in [m for m, n in C.Counter(meth[train_mask]).most_common() if n >= 100]: row(f'· method {m_}', train_mask & (meth == m_))
say()

# ---- 2. the honest frame: random draws of served text -----------------------------------------------------------
say('## 2. The honest frame: random draws, served text\n')
honest = train_mask & (sel == 'random') & (expo == 'served')
say(f'{honest.sum()} rows, {len(set(g[honest]))} books, serious {y[honest].mean():.0%}. Scores are the pooled out-of-book predictions above.\n')
yy = y[honest]; pp = P[honest]; o = np.argsort(-pp)
say('| top share by risk | pages | serious among them | share of all serious pages caught |')
say('|---|---|---|---|')
for q in (.05, .10, .20, .30, .50):
    k = int(len(yy) * q); kk = int(yy[o[:k]].sum()); lo, hi = wilson(kk, k)
    say(f'| {int(q*100)}% | {k} | {kk/k:.0%} [{lo:.0%}, {hi:.0%}] | {kk/max(1,yy.sum()):.0%} |')
say(f'\nBy source inside the frame:')
for s in sorted(set(src[honest])):
    m = honest & (src == s); say(f'- {s}: n={m.sum()}, base {y[m].mean():.0%}, AUC {auc(y[m], P[m]):.3f}, prec@10% {at_k(y[m], P[m], .1)[0]:.0%}, prec@30% {at_k(y[m], P[m], .3)[0]:.0%}')
say()
say('### 2b. The library-wide frame: the weekly audit\'s uniform draw (one page per random visible non-English book, served)\n')
lib = honest & (src == 'spare_audit')
say(f'{lib.sum()} pages, {len(set(g[lib]))} books, serious {y[lib].mean():.0%}. The book_checks "random" rows above are random WITHIN picked frames (most-read books, lane queues); this is the only draw that is uniform over the library, so this table is the one to quote for "these N% of pages hold M% of the serious errors".\n')
yy = y[lib]; pp = P[lib]; o = np.argsort(-pp)
say('| top share by risk | pages | serious among them | share of all serious pages caught |')
say('|---|---|---|---|')
for q in (.05, .10, .20, .30, .50):
    k = int(len(yy) * q); kk = int(yy[o[:k]].sum()); lo, hi = wilson(kk, k)
    say(f'| {int(q*100)}% | {k} | {kk/k:.0%} [{lo:.0%}, {hi:.0%}] | {kk/max(1,yy.sum()):.0%} |')
say()

# ---- 3. per-source models and cross-instrument transfer ---------------------------------------------------------
say('## 3. Per-source training and cross-instrument transfer\n')
say('Within: trained and scored on that source alone (out-of-book). Transfer: trained on every OTHER source, scored on this one (a true held-out instrument).\n')
say('| source | n | within AUC | transfer AUC | transfer prec@30% |')
say('|---|---|---|---|---|')
for s in sorted(set(src[train_mask])):
    m = train_mask & (src == s)
    if m.sum() < 150 or len(set(y[m])) < 2: continue
    _, pw = cv_pred(m, names, seeds=1); aw = auc(y[m], pw)
    other = train_mask & (src != s)
    mdl = mk().fit(X[other][:, idx(names)], y[other]); pt = mdl.predict_proba(X[m][:, idx(names)])[:, 1]
    say(f'| {s} | {m.sum()} | {aw:.3f} | {auc(y[m], pt):.3f} | {at_k(y[m], pt, .3)[0]:.0%} |')
# reader-family transfer: Opus-read labels vs Gemini-read labels
rd = np.array([('gemini' in (d.get('reader') or '').lower()) for d in D])
say('\nReader family (who judged): Opus/Claude-read vs Gemini-read labels, trained on one, scored on the other:')
for name, a, b in (('train Opus-read → test Gemini-read', train_mask & ~rd, train_mask & rd), ('train Gemini-read → test Opus-read', train_mask & rd, train_mask & ~rd)):
    if a.sum() > 200 and b.sum() > 200:
        mdl = mk().fit(X[a][:, idx(names)], y[a]); pt = mdl.predict_proba(X[b][:, idx(names)])[:, 1]
        say(f'- {name}: n_train={a.sum()}, n_test={b.sum()}, AUC {auc(y[b], pt):.3f}, prec@30% {at_k(y[b], pt, .3)[0]:.0%} (base {y[b].mean():.0%})')
say()

# ---- 4. ablation: difficulty vs text ------------------------------------------------------------------------------
say('## 4. Hard page or wrong text? Feature-block ablation (pooled, out-of-book)\n')
say('| block | features | AUC all | AUC honest frame |')
say('|---|---|---|---|')
for label, cols in (('difficulty only (year, language, model, script, provider…)', DIFFICULTY), ('text only (what changes when the text is repaired)', TEXT), ('seam features only (neighbour pages)', SEAM), ('text without seam', [c for c in TEXT if c not in SEAM]), ('all', names)):
    ii2, p2 = cv_pred(train_mask, cols, seeds=1); P2 = np.full(len(D), np.nan); P2[ii2] = p2
    say(f'| {label} | {len(cols)} | {auc(y[train_mask], P2[train_mask]):.3f} | {auc(y[honest], P2[honest]):.3f} |')
say()

# ---- 5. importance and direction --------------------------------------------------------------------------------
say('## 5. What the model uses\n')
mdl = mk().fit(X[train_mask][:, idx(names)], y[train_mask])
pi = permutation_importance(mdl, X[train_mask][:, idx(names)], y[train_mask], n_repeats=3, random_state=0, scoring='roc_auc', n_jobs=1)
top = np.argsort(-pi.importances_mean)[:25]
say('Permutation importance (drop in AUC), top 25: ' + ', '.join(f'{names[i]} {pi.importances_mean[i]:.3f}' for i in top))
say('\nSerious rate by quintile of a feature (trainable rows; lowest → highest):')
for c in ['year', 'ocr_zlib', 'tri_ppl', 'oov_frac', 'absz_tr_ratio', 'tr_meta_frac', 'vocab_absent', 'seam_prev_overlap', 't5_prev_tr_overlap', 'len_vs_neighbours', 'page_num_delta', 'max_4gram_repeat', 'tr_unclear', 'num_jacc']:
    if c not in names: continue
    v = X[train_mask][:, names.index(c)]; ok = ~np.isnan(v)
    if ok.sum() < 100: continue
    qs = np.quantile(v[ok], [.2, .4, .6, .8]); b = np.digitize(v[ok], qs); yy = y[train_mask][ok]
    say(f'- {c}: ' + ' · '.join(f'{yy[b == i].mean():.0%}' for i in range(5) if (b == i).sum() > 0) + f'  (n={ok.sum()})')
say()

# ---- 6. do corrections (positive-only) rank high? -------------------------------------------------------------------
m = posonly & (~stale)
if m.sum() >= 20:
    pt = mdl.predict_proba(X[m][:, idx(names)])[:, 1]
    thr30 = np.quantile(P[train_mask][~np.isnan(P[train_mask])], .7); thr10 = np.quantile(P[train_mask][~np.isnan(P[train_mask])], .9)
    say(f'## 6. Applied corrections as a check\n\nOf {m.sum()} pages someone corrected after reading the image, {(pt >= thr30).mean():.0%} score in the top 30% of the pooled scale and {(pt >= thr10).mean():.0%} in the top 10%.\n')

with open(f'{DIR}/preds.jsonl', 'w') as f:
    for d, pp in zip(D, P):
        if not np.isnan(pp): f.write(json.dumps(dict(page_id=d['page_id'], book=d['book'], source=d['source'], method=d['method'], y=d['y'], score=round(float(pp), 4))) + '\n')
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('wrote', OUT)
