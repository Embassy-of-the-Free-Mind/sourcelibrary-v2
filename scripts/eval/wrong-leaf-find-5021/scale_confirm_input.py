#!/usr/bin/env python3
# PRIOR ART: scripts/eval/shift-screen-5021/opus-select.mjs (draws flags for the confirmer from the shift screen's answer
# file); this reads the scale-runner chunks instead. One page per book, seeded, stratified by queue and flag class.
"""scale_confirm_input.py SCALE_DIR OUT.jsonl TIERS.json — 20 next/prev + 10 none flags per queue (zh, readers), one per book,
seed 50216, in the leaf-shift-confirm-5021.mjs input shape; TIERS maps book:page to its draw."""
import sys, json, os, glob, random
D, OUT, TI = sys.argv[1:4]
random.seed(50216)
flags = {}
for f in sorted(glob.glob(f'{D}/*/answers-*.jsonl')):
    q = f.split('/')[-2].split('-')[0]
    for l in open(f):
        a = json.loads(l)
        if a.get('role') in ('next', 'prev', 'none'): flags.setdefault((q, 'none' if a['role'] == 'none' else 'shift'), []).append(a['key'])
out, tiers = {}, {}
for (q, cls), keys in sorted(flags.items(), key=lambda kv: (kv[0][0], kv[0][1] != 'shift')):  # shift draws first
    random.shuffle(keys); seen = set(); n = 20 if cls == 'shift' else 10
    for k in keys:
        b, p = k.split(':')[:2]
        if b in seen or b in out: continue
        seen.add(b); tiers[f'{b}:{p}'] = f'scale-{q}-{cls}'
        out[b] = {'book_id': b, 'tier': f'scale-{q}-{cls}', 'flagged': True, 'runs': [{'dir': '?', 'start': int(p), 'end': int(p), 'strong': False, 'strict': False, 'voting': 1}]}
        if len(seen) >= n: break
with open(OUT, 'w') as f:
    for v in out.values(): f.write(json.dumps(v) + '\n')
json.dump(tiers, open(TI, 'w'))
print(len(out), 'pages', {t: list(tiers.values()).count(t) for t in set(tiers.values())})
