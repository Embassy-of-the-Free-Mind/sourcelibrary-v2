#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/train.py (out-of-book scores, preds.jsonl) and instrument-leakage.py (the uniform
frame). Neither asks how audit pages should be CHOSEN. This replays audit policies on the weekly audit's uniform
random stratum, where every page's label is known, to settle #8632's question: does a per-cell bandit beat
"top decile + random", and does a probability-proportional draw keep an unbiased rate?

policy-replay.py <dir> [--target ocr|any] [--weeks 8] [--per-week 40] [--sims 300] [--out report.md]
  <dir> needs labels.jsonl, pages.jsonl, preds.jsonl (train.py out-of-book scores).

Policies, each drawing --per-week pages a week for --weeks weeks, without replacement, from the uniform pages:
  random       uniform
  top-decile   uniform among the top 10% by score (the current risk stratum)
  pps          probability proportional to score (inclusion probabilities known)
  cell-ts      Thompson sampling over cells (language x OCR family), Beta(1,1) priors shrunk to the global rate,
               updated weekly with what was found; within a cell, pps by score
  oracle       the pages that are serious first (the upper bound)
Reported: serious found per 40 checks, and for pps the Hajek estimate of the frame's rate against the truth.
Also: do cell indicators add to the score (cross-validated AUC with and without)? If not, a cell bandit has little to learn.
"""
import json, sys, re, collections as C
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

DIR = sys.argv[1]
opt = lambda k, d: type(d)(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d
TARGET, WEEKS, PER, SIMS = opt('--target', 'ocr'), opt('--weeks', 8), opt('--per-week', 40), opt('--sims', 300)
OUT = opt('--out', f'{DIR}/policy-replay.md')
pages = {}
for l in open(f'{DIR}/pages.jsonl'):
    p = json.loads(l); pages[p['page_id']] = p
score = C.defaultdict(list)
for l in open(f'{DIR}/preds.jsonl'):
    j = json.loads(l); score[j['page_id']].append(j['score'])
INVENT = {'confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'show_through', 'illegible_fill'}
def tgt(r):
    ser = [e for e in r['errors'] if (e.get('severity') or 'serious') == 'serious']
    if TARGET == 'any': return int(bool(r['serious']))
    return int(any(e.get('stage') == 'ocr' for e in ser) or any(e.get('kind') == 'wrong_leaf' for e in ser))
def fam(m):
    m = (m or '').lower()
    return 'lite' if 'lite' in m else 'flash' if 'flash' in m else 'paddle' if 'paddle' in m else 'other'
rows = []; seen = set()
for l in open(f'{DIR}/labels.jsonl'):
    r = json.loads(l)
    if r['source'] != 'spare_audit' or r.get('selection') != 'random' or r.get('exposure') != 'served' or r.get('stale'): continue
    if r['page_id'] in seen or r['page_id'] not in score: continue
    seen.add(r['page_id']); p = pages.get(r['page_id'], {})
    lang = re.split(r'[,;/(]| and ', (p.get('book') or {}).get('language') or '?')[0].strip()
    rows.append(dict(y=tgt(r), s=float(np.mean(score[r['page_id']])), cell=f"{lang}|{fam(p.get('ocr_model') or r.get('ocr_model_at_check'))}", book=r['book_id']))
y = np.array([r['y'] for r in rows]); s = np.array([r['s'] for r in rows]); cells = np.array([r['cell'] for r in rows]); N = len(rows)
out = []; say = lambda t='': (out.append(t), print(t))
say(f'# Audit policy replay (#8632) — target: {"serious OCR error or wrong leaf" if TARGET == "ocr" else "any serious"}\n')
say(f'Frame: the weekly audit\'s random stratum, served, fresh: {N} pages, {y.sum()} positive ({y.mean():.0%}), {len(set(cells))} cells. Scores: train.py out-of-book. {WEEKS} weeks × {PER} checks, {SIMS} simulations each.\n')

# ---- 1. do cells add to the score? ----------------------------------------------------------------------------------
cc = C.Counter(cells); keep = [c for c, n in cc.items() if n >= 15]
lg = np.log(np.clip(s, 1e-4, 1 - 1e-4) / (1 - np.clip(s, 1e-4, 1 - 1e-4)))
X1 = lg.reshape(-1, 1); X2 = np.hstack([X1, np.array([[1.0 if c == k else 0.0 for k in keep] for c in cells])])
g = np.array([r['book'] for r in rows])
p1 = cross_val_predict(LogisticRegression(max_iter=500), X1, y, cv=GroupKFold(5), groups=g, method='predict_proba')[:, 1]
p2 = cross_val_predict(LogisticRegression(max_iter=500, C=0.5), X2, y, cv=GroupKFold(5), groups=g, method='predict_proba')[:, 1]
say('## 1. Do cells know something the score does not?\n')
say(f'Cross-validated AUC, score alone {roc_auc_score(y, p1):.3f}; score + {len(keep)} cell indicators {roc_auc_score(y, p2):.3f}.\n')
say('| cell (language, OCR family) | pages | observed | score\'s mean prediction (recalibrated) | gap |'); say('|---|---|---|---|---|')
for c in sorted(keep, key=lambda c: -cc[c]):
    m = cells == c; say(f'| {c} | {m.sum()} | {y[m].mean():.0%} | {p1[m].mean():.0%} | {y[m].mean() - p1[m].mean():+.0%} |')
say()

# ---- 2. replay ----------------------------------------------------------------------------------------------------
def run(policy, rng):
    avail = np.ones(N, bool); found = []; ht = []
    alpha = C.defaultdict(lambda: 1.0); beta = C.defaultdict(lambda: 1.0)
    prior = y.mean(); k0 = 4.0  # shrink every cell toward the global rate with 4 pseudo-pages
    for w in range(WEEKS):
        idx = np.where(avail)[0]
        if len(idx) < PER: break
        if policy == 'random': pick = rng.choice(idx, PER, replace=False)
        elif policy == 'top-decile':
            top = idx[np.argsort(-s[idx])][:max(PER, int(len(idx) * 0.1))]; pick = rng.choice(top, PER, replace=False)
        elif policy == 'oracle': pick = idx[np.argsort(-(y[idx] + 1e-3 * s[idx]))][:PER]
        elif policy in ('pps', 'pps-sharp', 'cell-ts'):
            wts = (s[idx].copy() ** 3 + 0.002) if policy == 'pps-sharp' else (s[idx].copy() + 0.02)
            if policy == 'cell-ts':
                theta = {c: rng.beta(alpha[c] + k0 * prior, beta[c] + k0 * (1 - prior)) for c in set(cells[idx])}
                wts = wts * np.array([theta[c] for c in cells[idx]]) / max(1e-6, prior)
            pi = np.minimum(1, PER * wts / wts.sum())
            pick = idx[rng.random(len(idx)) < pi]  # Poisson sampling: inclusion probability pi, known
            if policy in ('pps', 'pps-sharp'):
                if len(pick): ht.append((y[pick] / pi[np.isin(idx, pick)]).sum() / (1 / pi[np.isin(idx, pick)]).sum())
        for i in pick: alpha[cells[i]] += y[i]; beta[cells[i]] += 1 - y[i]
        found.append(y[pick].sum() * PER / max(1, len(pick))); avail[pick] = False
    return np.mean(found), (np.mean(ht) if ht else None)
say('## 2. Serious pages found per 40 checks\n')
say('| policy | found per 40 (mean over sims) | vs random |'); say('|---|---|---|')
res = {}
for pol in ('random', 'top-decile', 'pps', 'pps-sharp', 'cell-ts', 'oracle'):
    rng = np.random.default_rng(7); vals = [run(pol, rng) for _ in range(SIMS if pol != 'oracle' else 1)]
    f = np.mean([v[0] for v in vals]); res[pol] = (f, [v[1] for v in vals if v[1] is not None])
for pol, (f, _) in res.items(): say(f'| {pol} | {f:.1f} | {f / res["random"][0]:.2f}× |')
hts = res['pps'][1]; hts3 = res['pps-sharp'][1]
say(f'\nUnbiased rate from the adaptive draw: the Hájek estimate from pps-drawn pages averages **{np.mean(hts):.1%}** (sd across weeks {np.std(hts):.1%}) against the frame\'s true rate **{y.mean():.1%}**. With weights ∝ score³ (pps-sharp) the estimate averages **{np.mean(hts3):.1%}** (sd {np.std(hts3):.1%}). A top-decile draw cannot give this estimate: pages outside the decile have inclusion probability zero.\n')
open(OUT, 'w').write('\n'.join(out) + '\n'); print('wrote', OUT)
