#!/usr/bin/env python3
# PRIOR ART: judge.mjs score / paired-arm.mjs score — they score each arm's own output; neither reads the lane's
# dry-run written lists, so neither gives the 'as served' view (the arm where its apply guards write, else the stored text).
"""As-served k/n for the #8632 flash3 cell tests: python3 -I as-served.py <DIR with key.json, verdicts-opus.jsonl, dry/>.
Floor = invented or wrong-leaf classes (O1 O2 I1 I2 I6 T14), counted on any defect of that class."""
import json, os, sys, collections
O = sys.argv[1]
key = json.load(open(f'{O}/key.json'))
V = {}
for l in open(f'{O}/verdicts-opus.jsonl'):
    r = json.loads(l)
    if r.get('verdict'): V[r['id']] = r['verdict']
FLOOR = {'O1','O2','I1','I2','I6','T14'}
def wrong(v): return any(d.get('severity') == 'wrong_text' for d in v.get('defects', []))
def floor(v): return any(str(d.get('class') or d.get('code') or '').split(':')[0] in FLOOR for d in v.get('defects', []))
items = [k for k in key if k['kind'] == 'item']
by = collections.defaultdict(dict)
for k in items: by[(k['cell'], k['page_id'])][k['route']] = V.get(k['judged_as'])
out = {}
for cell in sorted({k['cell'] for k in items}):
    for route, slug in [('3flash>agy-flash-low', '3flash_agy_flash_low'), ('agy-flash-low@4', 'agy_flash_low_4')]:
        f = f'{O}/dry/{cell}.{slug}.written.jsonl'
        W = {json.loads(l)['page_id'] for l in open(f)} if os.path.exists(f) else set()
        acc = wr = fl = n = 0
        for (c, pid), arms in by.items():
            if c != cell: continue
            v = arms.get(route) if pid in W and arms.get(route) else arms.get('3flash')
            if v is None: continue
            n += 1; acc += bool(v.get('accept')); wr += wrong(v); fl += floor(v)
        out[f'{cell}/{route}-written'] = dict(written=f'{len(W)}/{sum(1 for (c,_) in by if c==cell)}', accept=f'{acc}/{n}', wrong_text=f'{wr}/{n}', floor=f'{fl}/{n}')
    for route in ['3flash', '3flash>agy-flash-low', 'agy-flash-low@4', '3flash>opus-correct']:
        vs = [a[route] for (c,_), a in by.items() if c == cell and a.get(route)]
        out[f'{cell}/{route}'] = dict(accept=f'{sum(bool(v.get("accept")) for v in vs)}/{len(vs)}', wrong_text=f'{sum(wrong(v) for v in vs)}/{len(vs)}', floor=f'{sum(floor(v) for v in vs)}/{len(vs)}')
json.dump(out, open(f'{O}/as-served.json', 'w'), indent=1)
for k, v in out.items(): print(k, v)
