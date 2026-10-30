#!/usr/bin/env python3
"""judge-controls.py — #7567: planted-error controls for the Opus judge (#7522's judge.mjs), judged blind with the rest.

PRIOR ART: scripts/eval/ocr-per-call-7522/controls.mjs plants dropped lines and lines bled in from the next page into a
copy of a read, for that run's packets and Mongo neighbours. Same two plants here, on this panel's packets: from the first 6 of 12 drawn
packets (seed 7567) with six or more body lines, one version is copied twice into a control packet — once with one interior body line DROPPED, once
with a line of ANOTHER panel page INSERTED mid-page — beside the untouched original. The judge must report the omission
and the addition (or call the version unusable). Written as <name>__ctrl packets; the key goes to judge-controls-key.json.

  judge-controls.py <J>
"""
import json, os, random, re, sys

J = sys.argv[1]
P = os.path.join(J, 'judge-run', 'judge', 'packets')
rng = random.Random(7567)
names = sorted(f[:-5] for f in os.listdir(P) if f.endswith('__lite.json'))
pick = rng.sample(names, 12)   # the first 6 with >= 6 line-broken body lines are used
others = [n for n in names if n not in pick]
key = {}
for n in pick:
    if len(key) == 6: break
    pk = json.load(open(os.path.join(P, n + '.json')))
    base = max(pk['versions'], key=lambda v: len(v['text']))
    body = [i for i, l in enumerate(base['text'].split('\n')) if len(l.strip()) > 25 and not l.strip().startswith('<')]
    if len(body) < 6: continue
    lines = base['text'].split('\n')
    drop_i = body[len(body) // 2]
    dropped = '\n'.join(l for i, l in enumerate(lines) if i != drop_i)
    donor_lines = []
    while not donor_lines:
        donor = json.load(open(os.path.join(P, rng.choice(others) + '.json')))['versions'][0]['text'].split('\n')
        donor_lines = [l for l in donor if 30 < len(l.strip()) < 120 and not l.strip().startswith('<')]
    donor_line = rng.choice(donor_lines)
    ins_i = body[len(body) // 3]
    inserted = '\n'.join(lines[:ins_i] + [donor_line] + lines[ins_i:])
    vs = [('orig', base['text']), ('drop', dropped), ('insert', inserted)]
    rng.shuffle(vs)
    labels = ['A', 'B', 'C']
    pk['versions'] = [{'label': l, 'text': t} for l, (_, t) in zip(labels, vs)]
    json.dump(pk, open(os.path.join(P, n + '__ctrl.json'), 'w'), ensure_ascii=False)
    key[n + '__ctrl'] = {l: k for l, (k, _) in zip(labels, vs)} | {'dropped_line': lines[drop_i], 'inserted_line': donor_line}
json.dump(key, open(os.path.join(J, 'judge-controls-key.json'), 'w'), ensure_ascii=False, indent=1)
print(len(key), 'control packets')
