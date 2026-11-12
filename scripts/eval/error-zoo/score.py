#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/train.py (reports out-of-book AUC; scores only labelled pages) and
instrument-leakage.py (the target comparison: serious OCR-stage error or wrong leaf is the target the text predicts
best within the uniform frame, AUC 0.85). This fits that model on every fresh label and SCORES unreviewed candidate
pages (rows with source 'candidate', from pool.mjs), so an audit or a calibration set can be aimed at the risk tail.

score.py <dir> --out POOL.json [--target ocr|any|leaf]
  <dir> holds labels.jsonl (training labels + candidate rows) and feats.json (features.py over the same union, so the
  language vocabulary tables are shared). Writes POOL.json: {generated_at, target, n_train, cv_auc_within_audit,
  candidates: [{page_id, book_id, language, score, pct}] sorted by score, pct = percentile within the candidates}.
"""
import json, sys, collections as C, datetime, warnings
import numpy as np
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier as HGB
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

DIR = sys.argv[1]
OUT = sys.argv[sys.argv.index('--out') + 1]
TARGET = sys.argv[sys.argv.index('--target') + 1] if '--target' in sys.argv else 'ocr'
INVENT = {'confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'show_through', 'illegible_fill'}
def target(r):
    ser = [e for e in r['errors'] if (e.get('severity') or 'serious') == 'serious']
    if TARGET == 'any': return int(bool(r['serious']))
    if TARGET == 'leaf': return int(any(e.get('kind') in INVENT for e in ser))
    return int(any(e.get('stage') == 'ocr' for e in ser) or any(e.get('kind') == 'wrong_leaf' for e in ser))

L = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
keyc = C.Counter(); lab = {}
for r in L:
    k = (r['page_id'], r['source'], r['method']); lab[k + (keyc[k],)] = r; keyc[k] += 1
F = json.load(open(f'{DIR}/feats.json'))
keyc = C.Counter()
for d in F:
    k = (d['page_id'], d['source'], d['method']); d['lab'] = lab.get(k + (keyc[k],)); keyc[k] += 1
train = [d for d in F if d['source'] != 'candidate' and d['lab'] and not d.get('stale') and not d.get('positive_only')]
cand = [d for d in F if d['source'] == 'candidate']
cnt = C.Counter((k, v) for d in train for k, v in d['cat'].items()); cats = sorted(c for c in cnt if cnt[c] >= 15)
nums = sorted({k for d in train for k in d['num']})
mat = lambda rows: np.array([[d['num'].get(k, np.nan) for k in nums] + [1.0 if d['cat'].get(k) == v else 0.0 for k, v in cats] for d in rows], dtype=float)
X, Xc = mat(train), mat(cand)
y = np.array([target(d['lab']) for d in train]); g = np.array([d['book'] for d in train])
mk = lambda: HGB(max_depth=3, learning_rate=0.04, max_iter=350, l2_regularization=2.0, min_samples_leaf=25)
# honest check: out-of-book AUC inside the weekly audit's random served stratum
P = cross_val_predict(mk(), X, y, cv=GroupKFold(5), groups=g, method='predict_proba')[:, 1]
rnd = np.array([d['method'] == 'convergent-audit-weekly' and d.get('selection') == 'random' and d.get('exposure') == 'served' for d in train])
auc_rnd = roc_auc_score(y[rnd], P[rnd]) if len(set(y[rnd])) == 2 else None
m = mk().fit(X, y)
sc = m.predict_proba(Xc)[:, 1] if len(cand) else np.array([])
order = np.argsort(-sc); pct = np.empty(len(sc)); pct[order] = 1 - np.arange(len(sc)) / max(1, len(sc))
lang = {r['page_id']: r.get('language') for r in L if r['source'] == 'candidate'}
rows = sorted([dict(page_id=d['page_id'], book_id=d['book'], language=lang.get(d['page_id']), score=round(float(s), 4), pct=round(float(p), 4)) for d, s, p in zip(cand, sc, pct)], key=lambda r: -r['score'])
out = dict(generated_at=datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z', target=TARGET, target_means='serious OCR-stage finding or wrong leaf' if TARGET == 'ocr' else TARGET,
           n_train=len(train), train_base_rate=round(float(y.mean()), 3), cv_auc_within_audit_random=round(float(auc_rnd), 3) if auc_rnd else None, n_candidates=len(rows), candidates=rows)
json.dump(out, open(OUT, 'w'))
print(f'trained on {len(train)} rows (base {y.mean():.0%}); out-of-book AUC in the audit random stratum {auc_rnd:.3f}; scored {len(rows)} candidates → {OUT}')
