#!/usr/bin/env python3
"""
PRIOR ART: scripts/audit/convergent-audit-lib.mjs kindAgreement (two readers, one packet, kappa per kind) and
instrument-leakage.py (the same-text ceiling, which the stored labels could not supply). This scores the calibration
set (CALIBRATION-SET-DESIGN.md): reader-reader agreement on identical frozen text, planted-error recall, control pass
rates, and the risk score against each reader, set beside the ceiling.

calib-score.py <cal-dir> [--pool POOL.json] [--out report.md]
Readers are found under <cal-dir>/runs/<run>/readers/<name>/reviews/<packet>.json.
Critical = any finding with severity 'serious' (the rubric maps critical to serious) or right_page 'no'.
"Sure critical" additionally drops findings marked sure:false.
"""
import json, os, sys, glob, math, re, collections as C
CAL = sys.argv[1]
POOL = sys.argv[sys.argv.index('--pool') + 1] if '--pool' in sys.argv else None
OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else f'{CAL}/calibration-report.md'
key = {k['packet']: k for k in (json.loads(l) for l in open(f'{CAL}/key.jsonl'))}
out = []; say = lambda s='': (out.append(s), print(s))

def load(run, name):
    rv = {}
    for f in glob.glob(f'{CAL}/runs/{run}/readers/{name}/reviews/*.json'):
        try: recs = json.load(open(f))
        except Exception: continue
        if isinstance(recs, list) and recs and recs[0].get('pages'):
            rv[os.path.basename(f)[:-5]] = recs[0]['pages'][0]
    return rv
def errs(p): return [*(p.get('ocr_errors') or []), *(p.get('tr_errors') or []), *(p.get('other') or [])]
def crit(p, sure=False):
    if p.get('right_page') == 'no': return 1
    return int(any(e.get('severity') == 'serious' and (not sure or e.get('sure') is not False) for e in errs(p)))
def band(p):
    b = p.get('band'); return b if b in ('usable', 'care', 'not_usable') else None
def kappa(a, b):
    n = len(a)
    if not n: return float('nan')
    po = sum(x == y for x, y in zip(a, b)) / n
    cats = set(a) | set(b); pe = sum((a.count(c) / n) * (b.count(c) / n) for c in cats)
    return (po - pe) / (1 - pe) if pe < 1 else float('nan')
def wilson(k, n, z=1.96):
    if n == 0: return (float('nan'), float('nan'))
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))
fmt = lambda x: '—' if x != x else f'{x:.2f}'

R = {'opus-rubric': load('rubric', 'opus-rubric'), 'gem-rubric': load('rubric', 'gem-rubric'), 'opus-rubric-r2': load('rubric-retest', 'opus-rubric-r2'),
     'gem-rubric-r2': load('rubric-retest', 'gem-rubric-r2'), 'opus-current': load('current', 'opus-current')}
say('# Calibration set — first results (#6420)\n')
say(f'{len(key)} packets: ' + ', '.join(f'{b} {sum(1 for k in key.values() if k["block"] == b)}' for b in 'ABCD') + '. Readers read: ' + ', '.join(f'{n} {len(v)}' for n, v in R.items()) + '.\n')

say('## Agreement on identical text\n')
say('| pair | pages | critical: A rate | B rate | raw agree | κ | κ, sure only | page band κ |')
say('|---|---|---|---|---|---|---|---|')
PAIRS = [('opus-rubric', 'gem-rubric', 'AB', 'two families, same rubric'), ('opus-rubric', 'opus-rubric-r2', None, 'Opus re-read'), ('gem-rubric', 'gem-rubric-r2', None, 'Gemini re-read'),
         ('opus-rubric', 'opus-current', 'A', 'rubric vs current brief (Opus)')]
for a, b, blocks, label in PAIRS:
    ps = [p for p in R[a] if p in R[b] and (not blocks or key[p]['block'] in blocks)]
    if len(ps) < 5: say(f'| {label} | {len(ps)} | not enough reads yet | | | | | |'); continue
    ca = [crit(R[a][p]) for p in ps]; cb = [crit(R[b][p]) for p in ps]
    sa = [crit(R[a][p], True) for p in ps]; sb = [crit(R[b][p], True) for p in ps]
    ba = [band(R[a][p]) for p in ps]; bb = [band(R[b][p]) for p in ps]
    bp = [(x, y) for x, y in zip(ba, bb) if x and y]
    say(f'| {label} | {len(ps)} | {sum(ca)/len(ps):.0%} | {sum(cb)/len(ps):.0%} | {sum(x == y for x, y in zip(ca, cb))/len(ps):.0%} | {fmt(kappa(ca, cb))} | {fmt(kappa(sa, sb))} | {fmt(kappa([x for x, _ in bp], [y for _, y in bp])) if bp else "—"} |')
say()

say('## Planted errors and controls (known answers, no human needed)\n')
say('| reader | planted: page flagged critical | planted: the planted words named | wrong page caught | typed e-text flagged critical (false alarm) |')
say('|---|---|---|---|---|')
norm = lambda s: re.sub(r'\s+', ' ', (s or '').lower()).strip()
for n, rv in R.items():
    pl = [p for p, k in key.items() if k['block'] == 'C' and p in rv]
    named = 0
    for p in pl:
        ans = key[p]['planted']; toks = [norm(ans.get('was'))[:40], norm(ans.get('now'))[:40]]
        blob = norm(json.dumps(errs(rv[p]), ensure_ascii=False))
        if any(t and len(t) >= 3 and t in blob for t in toks): named += 1
    wp = [p for p, k in key.items() if k.get('control') == 'wrong_page' and p in rv]
    et = [p for p, k in key.items() if k.get('control') == 'typed_etext' and p in rv]
    cell = lambda k, m: f'{k}/{m}' if m else '—'
    say(f'| {n} | {cell(sum(crit(rv[p]) for p in pl), len(pl))} | {cell(named, len(pl))} | {cell(sum(1 for p in wp if rv[p].get("right_page") == "no" or crit(rv[p])), len(wp))} | {cell(sum(crit(rv[p]) for p in et), len(et))} |')
say()

say('## Critical rate by block and stratum (rubric readers)\n')
say('| reader | A random | A top decile | B random | B top decile |'); say('|---|---|---|---|---|')
for n in ('opus-rubric', 'gem-rubric'):
    rv = R[n]; cells = []
    for b in 'AB':
        for s in ('random', 'top'):
            ps = [p for p, k in key.items() if k['block'] == b and k['stratum'] == s and p in rv]
            k_ = sum(crit(rv[p]) for p in ps); lo, hi = wilson(k_, len(ps))
            cells.append(f'{k_}/{len(ps)} [{lo:.0%}, {hi:.0%}]' if ps else '—')
    say(f'| {n} | ' + ' | '.join(cells) + ' |')
say()

if POOL:
    from sklearn.metrics import roc_auc_score
    sc = {c['page_id']: c['score'] for c in json.load(open(POOL))['candidates']}
    say('## The risk score against each reader, beside the ceiling (blocks A and B)\n')
    for n in ('opus-rubric', 'gem-rubric'):
        ps = [p for p, k in key.items() if k['block'] in 'AB' and p in R[n] and k['page_id'] in sc]
        y = [crit(R[n][p]) for p in ps]; s = [sc[key[p]['page_id']] for p in ps]
        a = roc_auc_score(y, s) if 0 < sum(y) < len(y) else float('nan')
        say(f'- score vs {n}: AUC {fmt(a)} on {len(ps)} pages ({sum(y)} critical)')
    ps = [p for p in R['opus-rubric'] if p in R['gem-rubric'] and key[p]['block'] in 'AB']
    if ps:
        ca = [crit(R['opus-rubric'][p]) for p in ps]; cb = [crit(R['gem-rubric'][p]) for p in ps]
        def bal(y, x):
            pos = [xi for yi, xi in zip(y, x) if yi]; neg = [xi for yi, xi in zip(y, x) if not yi]
            return 0.5 * (sum(pos) / len(pos) + sum(1 - v for v in neg) / len(neg)) if pos and neg else float('nan')
        say(f'- ceiling: Opus label as a predictor of Gemini\'s, balanced accuracy {fmt(bal(cb, ca))}; Gemini\'s of Opus\'s {fmt(bal(ca, cb))} (a binary label\'s AUC equals its balanced accuracy)')
    say()
open(OUT, 'w').write('\n'.join(out) + '\n'); print('wrote', OUT)
