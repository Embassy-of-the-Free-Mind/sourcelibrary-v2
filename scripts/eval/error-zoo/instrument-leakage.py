#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/train.py — reports pooled and per-source AUC and cross-source transfer, but never
asks how much of the pooled AUC comes from recognising which instrument or frame judged a page.
scripts/eval/lib/agreement-stats.mjs — kappa/Wilson for readers in JS; this needs them inside the Python model loop,
so they are restated here in a few lines. scripts/audit/convergent-audit-lib.mjs kindAgreement — two readers on the
SAME packet; here the two "readers" are different stores, weeks apart, possibly on different text.

instrument-leakage.py <dir>  reads feats.json, preds.jsonl, labels.jsonl; writes <dir>/leakage-report.md

 1. frame-only baseline   the predictor fit on store / method / selection / exposure / reader alone
 2. within-instrument AUC the pooled out-of-book scores, scored inside each method
 3. instrument from text  can the text features tell which method judged the page?
 4. same-page ceiling     pages two methods judged on the SAME text: kappa between them, the score's AUC against
                          each, and one method's label as a predictor of the other's (the ceiling), for three
                          targets: any serious / serious OCR-stage / text not on the leaf (inventing kinds)
 5. test-retest           the weekly audit's Opus reader on pages drawn twice, per target
 6. retarget              the predictor refit on each target, scored within each instrument
"""
import json, sys, math, collections as C, warnings
import numpy as np
warnings.filterwarnings('ignore')
from sklearn.ensemble import HistGradientBoostingClassifier as HGB
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.metrics import roc_auc_score

DIR = sys.argv[1]
INVENT = {'confabulation', 'recitation', 'wrong_leaf', 'carry_over', 'show_through', 'illegible_fill'}
out = []
say = lambda s='': (out.append(s), print(s))
auc = lambda y, p: roc_auc_score(y, p) if len(set(y)) == 2 and len(y) >= 20 else float('nan')
def kappa(a, b):
    a, b = np.asarray(a, int), np.asarray(b, int); n = len(a)
    if n == 0: return float('nan')
    po = (a == b).mean(); pa, pb = a.mean(), b.mean(); pe = pa * pb + (1 - pa) * (1 - pb)
    return (po - pe) / (1 - pe) if pe < 1 else float('nan')
bal = lambda y, x: 0.5 * (np.mean(x[y == 1]) + np.mean(1 - x[y == 0])) if 0 < y.sum() < len(y) else float('nan')

# ---- labels with targets -------------------------------------------------------------------------------------------
L = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
def targets(r):
    ser = [e for e in r['errors'] if (e.get('severity') or 'serious') == 'serious']
    return dict(any=int(bool(r['serious'])), ocr=int(any(e.get('stage') == 'ocr' for e in ser) or any(e.get('kind') == 'wrong_leaf' for e in ser)),
                leaf=int(any(e.get('kind') in INVENT for e in ser)))
for r in L: r['t'] = targets(r)

F = json.load(open(f'{DIR}/feats.json'))
# features rows are in label order minus dropped ones; join by (page_id, source, method) with a counter for repeats
keyc = C.Counter(); lab_by_key = {}
for r in L:
    k = (r['page_id'], r['source'], r['method']); i = keyc[k]; keyc[k] += 1; lab_by_key[k + (i,)] = r
keyc = C.Counter()
for d in F:
    k = (d['page_id'], d['source'], d['method']); i = keyc[k]; keyc[k] += 1; d['lab'] = lab_by_key.get(k + (i,))
F = [d for d in F if d['lab'] is not None and not d.get('stale') and not d.get('positive_only')]
say('# Does the predictor learn errors or instruments? (#6420, error zoo v2)\n')
say(f'{len(F)} fresh, non-correction label rows; {len({d["book"] for d in F})} books; {len({d["method"] for d in F})} methods.\n')

cnt = C.Counter((k, v) for d in F for k, v in d['cat'].items()); cats = sorted(c for c in cnt if cnt[c] >= 15)
nums = sorted({k for d in F for k in d['num']})
X = np.array([[d['num'].get(k, np.nan) for k in nums] + [1.0 if d['cat'].get(k) == v else 0.0 for k, v in cats] for d in F], dtype=float)
g = np.array([d['book'] for d in F]); meth = np.array([d['method'] for d in F]); src = np.array([d['source'] for d in F])
frame_cols = sorted({(f, str(d.get(f))) for d in F for f in ('source', 'method', 'selection', 'exposure', 'reader')})
XF = np.array([[1.0 if str(d.get(f)) == v else 0.0 for f, v in frame_cols] for d in F])
mk = lambda: HGB(max_depth=3, learning_rate=0.04, max_iter=300, l2_regularization=2.0, min_samples_leaf=25)
def oob(Xm, y, mask=None):
    ii = np.arange(len(y)) if mask is None else np.where(mask)[0]
    k = min(5, len(set(g[ii])))
    p = cross_val_predict(mk(), Xm[ii], y[ii], cv=GroupKFold(k), groups=g[ii], method='predict_proba')[:, 1]
    P = np.full(len(y), np.nan); P[ii] = p; return P
def within(P, y, min_n=100):
    rows = []; wsum = 0; tot = 0
    for m in sorted(set(meth)):
        mm = meth == m
        if mm.sum() < min_n or len(set(y[mm])) < 2: continue
        a = auc(y[mm], P[mm]); rows.append((m, mm.sum(), y[mm].mean(), a)); wsum += a * mm.sum(); tot += mm.sum()
    return rows, wsum / max(1, tot)

say('## 1–2. Frame-only baseline and within-instrument AUC\n')
say('| target | base | pooled AUC, all features | pooled AUC, frame only (store, method, selection, exposure, reader) | pooled AUC, text+catalogue without frame | mean within-method AUC (text+catalogue) |')
say('|---|---|---|---|---|---|')
TARGETS = [('any', 'any serious finding'), ('ocr', 'serious OCR-stage finding or wrong leaf'), ('leaf', 'text not on the leaf (inventing kinds)')]
PRED = {}
for t, name in TARGETS:
    y = np.array([d['lab']['t'][t] for d in F])
    Pf = oob(XF, y); Pt = oob(X, y); Pa = oob(np.hstack([X, XF]), y)
    _, w = within(Pt, y)
    PRED[t] = Pt
    say(f'| {name} | {y.mean():.0%} | {auc(y, Pa):.3f} | {auc(y, Pf):.3f} | {auc(y, Pt):.3f} | {w:.3f} |')
say('\nThe text+catalogue model has no store or method column, but it can still learn the frame through features that differ by frame (provider, prompt version, language mix). Within-method AUC removes the between-frame base rates, so it is the honest number.\n')
say('Within the weekly audit only (the uniform frame), per target, from the pooled text+catalogue model and from a model trained on the audit alone:\n')
say('| target | audit base | pooled model, scored in the audit | audit-only model | random stratum only (pooled model) |'); say('|---|---|---|---|---|')
aud = meth == 'convergent-audit-weekly'; rnd = aud & np.array([d.get('selection') == 'random' and d.get('exposure') == 'served' for d in F])
for t, name in TARGETS:
    y = np.array([d['lab']['t'][t] for d in F]); Po = oob(X, y, aud)
    say(f'| {name} | {y[aud].mean():.0%} | {auc(y[aud], PRED[t][aud]):.3f} | {auc(y[aud], Po[aud]):.3f} | {auc(y[rnd], PRED[t][rnd]):.3f} |')
say()
y = np.array([d['lab']['t']['any'] for d in F]); rows, _ = within(PRED['any'], y)
say('Within-method AUC, any serious (text+catalogue model):\n')
say('| method | n | base | AUC within |'); say('|---|---|---|---|')
for m, n, b, a in sorted(rows, key=lambda x: -x[1]): say(f'| {m} | {n} | {b:.0%} | {a:.3f} |')
say()

say('## 3. Can the text tell which instrument judged the page?\n')
top = [m for m, n in C.Counter(meth).most_common() if n >= 150][:6]
mm = np.isin(meth, top)
accs = []
for m in top:
    yy = (meth[mm] == m).astype(int)
    P = cross_val_predict(mk(), X[mm], yy, cv=GroupKFold(5), groups=g[mm], method='predict_proba')[:, 1]
    accs.append((m, mm.sum(), yy.mean(), roc_auc_score(yy, P)))
say('One-vs-rest AUC for "this page was judged by method M", from the text and catalogue features alone, out-of-book:\n')
say('| method | share of rows | AUC |'); say('|---|---|---|')
for m, n, b, a in accs: say(f'| {m} | {b:.0%} | {a:.3f} |')
say('\nAbove ~0.8 means the features carry the frame: a model fed these rows can learn "which queue" as a proxy for "how bad".\n')

# ---- 4. same page, two methods, same text ----------------------------------------------------------------------------
say('## 4. Same page, same text, two instruments: the agreement ceiling\n')
score = {}
for l in open(f'{DIR}/preds.jsonl'):
    j = json.loads(l); score.setdefault(j['page_id'], []).append(j['score'])
score = {k: float(np.mean(v)) for k, v in score.items()}
fresh = [r for r in L if not r.get('stale') and not r.get('positive_only') and r.get('page_id')]
by_page = C.defaultdict(dict)
for r in fresh: by_page[r['page_id']].setdefault(r['method'], r)
pairs = C.defaultdict(list)
for pid, ms in by_page.items():
    ks = sorted(ms)
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)): pairs[(ks[i], ks[j])].append((pid, ms[ks[i]], ms[ks[j]]))
say('Only pages where neither label is stale (the live text has not changed since either judgment), so both judged the text that is served now.\n')
say('| instruments A / B | pages | target | A rate | B rate | raw agree | kappa | ceiling: A predicts B (balanced acc.) | score AUC vs A | score AUC vs B |')
say('|---|---|---|---|---|---|---|---|---|---|')
ceil = {}
for (a, b), ps in sorted(pairs.items(), key=lambda x: -len(x[1])):
    if len(ps) < 25: continue
    for t, name in TARGETS:
        ya = np.array([p[1]['t'][t] for p in ps]); yb = np.array([p[2]['t'][t] for p in ps])
        sc = np.array([score.get(p[0], np.nan) for p in ps]); ok = ~np.isnan(sc)
        k = kappa(ya, yb); c1 = bal(yb, ya)
        ceil[(a, b, t)] = (len(ps), k, c1)
        say(f'| {a} / {b} | {len(ps)} | {t} | {ya.mean():.0%} | {yb.mean():.0%} | {(ya == yb).mean():.0%} | {k:.2f} | {c1:.2f} | {auc(ya[ok], sc[ok]):.2f} | {auc(yb[ok], sc[ok]):.2f} |')
say('\nKappa near 0 means the two instruments agree no better than chance on that target, on the same text. A score whose AUC against one instrument exceeds what the other instrument achieves (the balanced-accuracy ceiling) is fitting that instrument, not the page.\n')

# stale vs fresh comparison for the biggest pair
say('### The headline 46%: how much was stale text and scope?\n')
allp = C.defaultdict(dict)
for r in L:
    if r.get('positive_only') or not r.get('page_id'): continue
    allp[r['page_id']].setdefault(r['method'], []).append(r)
A, B = 'ocr-convergence', 'convergent-audit-weekly'
for label, pick in (('every shared label (as first reported)', lambda ra, rb: True), ('both labels fresh', lambda ra, rb: not ra.get('stale') and not rb.get('stale'))):
    for t, name in TARGETS[:2]:
        ya, yb = [], []
        for pid, ms in allp.items():
            if A in ms and B in ms:
                for ra in ms[A]:
                    for rb in ms[B]:
                        if pick(ra, rb): ya.append(ra['t'][t]); yb.append(rb['t'][t])
        if ya:
            ya, yb = np.array(ya), np.array(yb)
            say(f'- {label}, target {t}: n={len(ya)}, raw agree {(ya == yb).mean():.0%}, kappa {kappa(ya, yb):.2f} (A {ya.mean():.0%}, B {yb.mean():.0%})')
say()

# ---- 5. test-retest ---------------------------------------------------------------------------------------------------
say('## 5. Test-retest: the same Opus audit reader on the same page, different rounds\n')
sa = C.defaultdict(list)
for r in L:
    if r['source'] == 'spare_audit' and not r.get('stale'): sa[r['page_id']].append(r)
rep = [v for v in sa.values() if len(v) >= 2]
say(f'{len(rep)} pages read at least twice on unchanged text.\n')
say('| target | pairs | raw agree | kappa |'); say('|---|---|---|---|')
for t, name in TARGETS:
    a, b = [], []
    for v in rep:
        for i in range(len(v)):
            for j in range(i + 1, len(v)): a.append(v[i]['t'][t]); b.append(v[j]['t'][t])
    a, b = np.array(a), np.array(b)
    say(f'| {name} | {len(a)} | {(a == b).mean():.0%} | {kappa(a, b):.2f} |')
say('\nCaution: the weekly audit sends the same packet text and the same frozen brief each round, so this is the reader agreeing with itself on identical input, an upper bound on reliability, not evidence of validity.\n')

# minor counts vs serious, within the audit
say('## 6. Do minor and moderate findings carry signal? (weekly audit, Opus)\n')
au = [r for r in L if r['source'] == 'spare_audit' and not r.get('stale')]
def cnt_sev(r, s): return sum(1 for e in r['errors'] if (e.get('severity') or 'serious') == s)
from scipy.stats import spearmanr  # noqa: E402  (installed with scikit-learn)
ser = np.array([cnt_sev(r, 'serious') for r in au]); mod = np.array([cnt_sev(r, 'moderate') for r in au]); mi = np.array([cnt_sev(r, 'minor') for r in au])
trs = np.array([(r.get('scores') or {}).get('tr') if (r.get('scores') or {}).get('tr') is not None else np.nan for r in au], dtype=float)
ocs = np.array([(r.get('scores') or {}).get('ocr') if (r.get('scores') or {}).get('ocr') is not None else np.nan for r in au], dtype=float)
ok = ~np.isnan(trs)
say(f'n={len(au)} pages. Spearman ρ with the reader\'s 1–5 translation score: serious {spearmanr(ser[ok], trs[ok])[0]:.2f}, moderate {spearmanr(mod[ok], trs[ok])[0]:.2f}, minor {spearmanr(mi[ok], trs[ok])[0]:.2f}.')
ok2 = ~np.isnan(ocs)
say(f'With the 1–5 OCR score: serious {spearmanr(ser[ok2], ocs[ok2])[0]:.2f}, moderate {spearmanr(mod[ok2], ocs[ok2])[0]:.2f}, minor {spearmanr(mi[ok2], ocs[ok2])[0]:.2f}.')
# does a minor count on one read predict a serious finding on the repeat read?
a, b = [], []
for v in rep:
    a.append(cnt_sev(v[0], 'minor')); b.append(int(any((e.get('severity') or '') == 'serious' for e in v[1]['errors'])))
if len(set(b)) == 2: say(f'Minor count on the first read as a predictor of a serious finding on the repeat read: AUC {roc_auc_score(b, a):.2f} (n={len(a)}).')
say()

open(f'{DIR}/leakage-report.md', 'w').write('\n'.join(out) + '\n')
print('wrote', f'{DIR}/leakage-report.md')
