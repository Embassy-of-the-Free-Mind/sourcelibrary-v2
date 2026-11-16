#!/usr/bin/env python3
"""
PRIOR ART: instrument-leakage.py (the join of feats.json to labels, the targets, the out-of-book HGB model, the
uniform-frame scoring) — reused in shape; this asks one new question of it.

pair-feature-lift.py <dir>  Do the OCR↔English check scores (pair-feats.json, from pair-features.mjs) lift the
predictor? Same model, same folds (GroupKFold by book), with and without the 8 pair features, for four targets:
any serious, serious OCR-stage or wrong leaf, serious TRANSLATION-stage ("English-critical"), and T10/O7/T8 pages.
Scored on the weekly audit (audit-only model) and on its random served stratum. Writes <dir>/pair-feature-lift.md.
"""
import json, sys, collections as C, warnings
import numpy as np
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier as HGB
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

DIR = sys.argv[1]
auc = lambda y, p: roc_auc_score(y, p) if len(set(y)) == 2 and len(y) >= 20 else float('nan')
L = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
def targets(r):
    ser = [e for e in r['errors'] if (e.get('severity') or 'serious') == 'serious']
    cls = {e.get('class') for e in ser}
    return dict(any=int(bool(r['serious'])),
                ocr=int(any(e.get('stage') == 'ocr' for e in ser) or any(e.get('kind') == 'wrong_leaf' for e in ser)),
                en=int(any(e.get('stage') == 'translation' for e in ser)),
                t10=int('T10' in cls), o7=int('O7' in cls), t8=int('T8' in cls))
for r in L: r['t'] = targets(r)
F = json.load(open(f'{DIR}/feats.json'))
keyc = C.Counter(); lab = {}
for r in L:
    k = (r['page_id'], r['source'], r['method']); i = keyc[k]; keyc[k] += 1; lab[k + (i,)] = r
keyc = C.Counter()
for d in F:
    k = (d['page_id'], d['source'], d['method']); i = keyc[k]; keyc[k] += 1; d['lab'] = lab.get(k + (i,))
F = [d for d in F if d['lab'] is not None and not d.get('stale') and not d.get('positive_only')]
PF = json.load(open(f'{DIR}/pair-feats.json'))
PCOLS = ['neg_deficit', 'untraced_body', 'untraced_notes', 'hedges', 'notes', 'unclear_over', 'sent_ratio', 'len_ratio']
cnt = C.Counter((k, v) for d in F for k, v in d['cat'].items()); cats = sorted(c for c in cnt if cnt[c] >= 15)
nums = sorted({k for d in F for k in d['num']})
X = np.array([[d['num'].get(k, np.nan) for k in nums] + [1.0 if d['cat'].get(k) == v else 0.0 for k, v in cats] for d in F], dtype=float)
XP = np.array([[(PF.get(d['page_id']) or {}).get(c, np.nan) if (PF.get(d['page_id']) or {}).get(c) is not None else np.nan for c in PCOLS] for d in F], dtype=float)
g = np.array([d['book'] for d in F]); meth = np.array([d['method'] for d in F])
aud = meth == 'convergent-audit-weekly'
rnd = aud & np.array([d.get('selection') == 'random' and d.get('exposure') == 'served' for d in F])
mk = lambda: HGB(max_depth=3, learning_rate=0.04, max_iter=300, l2_regularization=2.0, min_samples_leaf=25)
def oob(Xm, y, mask):
    ii = np.where(mask)[0]
    p = cross_val_predict(mk(), Xm[ii], y[ii], cv=GroupKFold(5), groups=g[ii], method='predict_proba')[:, 1]
    P = np.full(len(y), np.nan); P[ii] = p; return P
# paired bootstrap over books for the AUC difference on the random stratum
rng = np.random.default_rng(8632)
def boot_diff(y, a, b, mask, B=400):
    ii = np.where(mask)[0]; books = np.unique(g[ii]); byb = {bk: ii[g[ii] == bk] for bk in books}; ds = []
    for _ in range(B):
        s = np.concatenate([byb[bk] for bk in rng.choice(books, len(books))])
        if len(set(y[s])) < 2: continue
        ds.append(roc_auc_score(y[s], b[s]) - roc_auc_score(y[s], a[s]))
    return np.percentile(ds, [2.5, 97.5]) if ds else [np.nan, np.nan]
out = ['# Do the OCR↔English checks lift the predictor? (#8632)\n',
       f'{aud.sum()} weekly-audit label rows ({rnd.sum()} random served), {len(set(g[aud]))} books; audit-only model, GroupKFold(5) by book; '
       f'{len(PCOLS)} pair features added to {X.shape[1]} existing.\n',
       '| target | base (random) | AUC random, existing | AUC random, + pair | difference [95% book bootstrap] | AUC audit, existing | AUC audit, + pair |', '|---|---|---|---|---|---|---|']
for t, name in [('any', 'any serious'), ('ocr', 'serious OCR-stage or wrong leaf'), ('en', 'serious translation-stage (English-critical)'),
                ('t10', 'T10 page'), ('o7', 'O7 page'), ('t8', 'T8 page')]:
    y = np.array([d['lab']['t'][t] for d in F])
    a = oob(X, y, aud); b = oob(np.hstack([X, XP]), y, aud)
    lo, hi = boot_diff(y, a, b, rnd)
    out.append(f'| {name} | {y[rnd].mean():.1%} | {auc(y[rnd], a[rnd]):.3f} | {auc(y[rnd], b[rnd]):.3f} | {auc(y[rnd], b[rnd]) - auc(y[rnd], a[rnd]):+.3f} [{lo:+.3f}, {hi:+.3f}] | {auc(y[aud], a[aud]):.3f} | {auc(y[aud], b[aud]):.3f} |')
    print(out[-1], flush=True)
open(f'{DIR}/pair-feature-lift.md', 'w').write('\n'.join(out) + '\n')
