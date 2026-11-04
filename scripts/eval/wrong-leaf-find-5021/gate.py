#!/usr/bin/env python3
# PRIOR ART: leaf-shift-screen-5021.mjs scoreRows (recall / false flags overall and by language, no intervals, no script
# cut); this adds Wilson intervals, the script family cut, and the natural Han/Tibetan set. The flag rule is the
# pre-registered one (2026-11-03 13:05Z): next | prev | none is a flag; multi and parallel are not.
"""gate.py SCREEN_DIR OUT.json — for gate2 (held-out, 150) and natural (Opus-judged Han/Tibetan/control, 114)."""
import sys, json, math, os, collections
D, OUT = sys.argv[1:3]
FLAG = {'next', 'prev', 'none'}
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z*z/n; c = p + z*z/(2*n); h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return {'k': k, 'n': n, 'p': round(p, 3), 'lo': round((c-h)/d, 3), 'hi': round((c+h)/d, 3)}
SCRIPT = [('Han', ('chinese', 'japanese')), ('Tibetan', ('tibetan',)), ('Greek', ('greek',)), ('Cyrillic', ('russian', 'church slavonic', 'ukrain', 'bulgar', 'serbian')), ('Arabic/Hebrew/Syriac', ('arabic', 'hebrew', 'syriac', 'persian', 'ottoman', 'urdu')), ('Indic', ('sanskrit', 'pali', 'hindi', 'bengali', 'tamil', 'marathi'))]
def fam(lang):
    l = str(lang or '').lower()
    for name, keys in SCRIPT:
        if any(l.startswith(k) for k in keys): return name
    return 'Latin script'
out = {}
for name in ('gate2', 'natural'):
    reqs = [json.loads(l) for l in open(f'{D}/{name}/requests.jsonl')]
    for f in sorted(os.listdir(f'{D}/{name}')):
        if not f.startswith('answers-') or not f.endswith('.jsonl'): continue
        arm = f[len('answers-'):-len('.jsonl')]
        ans = {}
        for l in open(f'{D}/{name}/{f}'):
            a = json.loads(l)
            if a.get('role'): ans[a['key']] = a['role']
        rows = [(r, ans.get(r['key'])) for r in reqs if r.get('y') in (0, 1) and ans.get(r['key'])]
        by = collections.defaultdict(list)
        for r, role in rows: by['all'].append((r, role)); by[fam(r.get('language'))].append((r, role))
        out[f'{name}:{arm}'] = {k: {'recall': wilson(sum(role in FLAG for r, role in v if r['y'] == 1), sum(r['y'] == 1 for r, _ in v)), 'false_flags': wilson(sum(role in FLAG for r, role in v if r['y'] == 0), sum(r['y'] == 0 for r, _ in v))} for k, v in by.items()}
json.dump(out, open(OUT, 'w'), indent=1)
for k, v in out.items():
    for s, x in v.items():
        print(f'{k:60s} {s:22s} recall {x["recall"] and (x["recall"]["k"], x["recall"]["n"], x["recall"]["lo"], x["recall"]["hi"])}  false {x["false_flags"] and (x["false_flags"]["k"], x["false_flags"]["n"], x["false_flags"]["lo"], x["false_flags"]["hi"])}')
