#!/usr/bin/env python3
# PRIOR ART: scripts/eval/route-judge-6740/paired-arm.mjs score (k/n, intervals, controls, noise floor, each arm against
# one baseline on shared pages) and judge.mjs `judge --reuse` (pairs a new route with verdicts already made). --reuse
# copies a verdict only when the text is identical; the baselines here are other routes judged on the same pages in
# earlier runs, so this merges their key rows and verdicts into one directory paired-arm.mjs can score as one run.
"""
merge-baselines.py NEW_DIR OUT_DIR
Key rows and verdicts of: NEW_DIR (this run's Hydrogen arms); router-tests-2026-10-26 for de-lite and de-flash3 (draft,
<draft>>agy-flash-low, <draft>>opus-correct, judged 2026-10-26); latin-flash3-live-route-8632 for latin-flash3 (the
same three routes, judged 2026-11-12). Routes are renamed by role so one baseline name serves every cell: the draft
`lite`/`3flash` -> `draft`, `<draft>>X` -> `draft>X`. Only pages of NEW_DIR's sample are kept. Packet items: this run's,
8632's (committed), and for the German baselines a word-count stand-in: the stored draft's text (the page as served,
whose hash the draft item's id reproduces) for every German baseline arm, marked `words_from` (their corrected
texts were not kept; a correction changes few words). Writes OUT_DIR/{key.json, verdicts-opus.jsonl, packet.json,
recipe.json, merge-notes.json}.
"""
import json, gzip, os, sys, hashlib
NEW, OUT = sys.argv[1:3]; os.makedirs(OUT, exist_ok=True)
R = 'scripts/eval/route-judge-6740/results/'
jl = lambda f: [json.loads(l) for l in (gzip.open(f, 'rt') if f.endswith('.gz') else open(f)) if l.strip()]
role = lambda r: 'draft' if r in ('lite', '3flash') else ('draft>' + r.split('>', 1)[1] if r.split('>')[0] in ('lite', '3flash') and '>' in r else r)
sample = json.load(open(f'{NEW}/sample.json'))
pages = {c: {p['page_id']: p for p in cs['pages']} for c, cs in sample['cells'].items()}
key, verd, items, notes = [], {}, [], {}
for k in json.load(open(f'{NEW}/key.json')): key.append({**k, 'route': role(k['route']), 'run': 'hydrogen-218'})
for v in jl(f'{NEW}/verdicts-opus.jsonl'): verd[v['id']] = v
items += json.load(open(f'{NEW}/packet.json'))['items']
BASE = {'lite', '3flash', 'lite>agy-flash-low', '3flash>agy-flash-low', 'lite>opus-correct', '3flash>opus-correct'}
for run, cells, vf in [('router-tests-2026-10-26', ('de-lite', 'de-flash3'), 'verdicts-opus.jsonl.gz'), ('latin-flash3-live-route-8632', ('latin-flash3',), 'verdicts-opus.jsonl')]:
    K = [k for k in json.load(open(R + run + '/key.json')) if k['cell'] in cells and k['route'] in BASE and k['page_id'] in pages[k['cell']]]
    V = {v['id']: v for v in jl(R + run + '/' + vf)}
    for k in K:
        key.append({**k, 'route': role(k['route']), 'run': run})
        if k['judged_as'] in V: verd.setdefault(k['judged_as'], V[k['judged_as']])
    notes[run] = {'key_rows': len(K), 'by_route_kind': {f"{c}|{r}|{kk}": sum(1 for k in K if (k['cell'], k['route'], k['kind']) == (c, r, kk)) for c, r, kk in sorted({(k['cell'], k['route'], k['kind']) for k in K})}}
    if os.path.exists(R + run + '/packet.json'):
        P = {i['id']: i for i in json.load(open(R + run + '/packet.json'))['items']}
        items += [P[k['judged_as']] for k in K if k['judged_as'] in P]
# German baselines: word-count stand-in from the draft text in Mongo (written by fetch below), see docstring
draft = json.load(open(f'{OUT}/german-drafts.json')) if os.path.exists(f'{OUT}/german-drafts.json') else {}
have = {i['id'] for i in items}
stand = 0
for k in key:
    if k['run'] == 'router-tests-2026-10-26' and k['judged_as'] not in have and k['page_id'] in draft and k['kind'] == 'item':
        items.append({'id': k['judged_as'], 'text': draft[k['page_id']], 'words_from': 'the page text as served (stand-in)'}); have.add(k['judged_as']); stand += 1
notes['german_word_standins'] = stand
# dedupe items by id
seen, it2 = set(), []
for i in items:
    if i['id'] not in seen: seen.add(i['id']); it2.append(i)
json.dump(key, open(f'{OUT}/key.json', 'w'), indent=1)
json.dump({'items': it2}, open(f'{OUT}/packet.json', 'w'))
with open(f'{OUT}/verdicts-opus.jsonl', 'w') as f:
    for v in verd.values(): f.write(json.dumps(v, ensure_ascii=False) + '\n')
rec = json.load(open(f'{NEW}/recipe.json')); rec['baseline'] = 'draft>opus-correct'
rec['arms'] = ['draft>hydrogen-low', 'hydrogen-low', 'hydrogen-medium']; rec['route_names'] = 'by role: draft = the stored lite / 3flash text; draft>X = X correcting it'
json.dump(rec, open(f'{OUT}/recipe.json', 'w'), indent=1)
json.dump(notes, open(f'{OUT}/merge-notes.json', 'w'), indent=1)
print(json.dumps(notes, indent=1)[:3000])
