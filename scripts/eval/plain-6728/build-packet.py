#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/build-packet.py — the item line (`line()`: reference meta, source with its
# neighbours, reference, T1..Tn), the label shuffle and the non-twin plants (located by span) are its code; the inline
# one-item-per-call judge prompt is its JUDGE-PROMPT-PRO.md, used for BOTH judges here. What is new: two families judged
# cross-family (the Gemini arms by Opus, the Opus arms by 3.8 Flash high) and candidates are BODIES (bodies.mjs).
"""
build-packet.py FAMILY — $0. FAMILY G (Gemini arms, judged by Opus) or O (Opus arms, judged by gemini-3.8-flash-high).
Items: ARMS (one per page: <F>-CUR, <F>-PLAIN, and <F>-CUR2 on the 50 noise-floor pages), PLANT (2 per language: the
page's CUR body with ONE planted meaning error, beside its PLAIN body). Writes $W/judge/<FAMILY>/{req.jsonl, key.json,
texts.json}; a copy of key.json without texts goes to scripts/eval/results/plain-6728/.
"""
import json, os, random, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'pro-translate-6545'))
from common import records, write_jsonl   # #6545's records (reference text) for the same panel

W = os.environ.get('W6728', os.environ.get('JOB_SCRATCH', '') + '/w')
RESULTS = 'scripts/eval/results/plain-6728'
F = sys.argv[1]
assert F in ('G', 'O')
J = f'{W}/judge/{F}'; os.makedirs(J, exist_ok=True)
B = json.load(open(f'{W}/bodies.json'))
body = lambda tag: B['body'].get(tag, {})
panel = json.load(open(f'{W}/panel.json'))
floor = set(open(f'{W}/floor-uids.txt').read().split())
recs = records()
rng = random.Random(f'6728-{F}')


def line(r, labels):   # pro-translate-6545/build-packet.py line(), unchanged
    m = r['reference_meta']
    o = {'id': None, 'track': r['track'], 'lang': r['lang'], 'reference_title': m.get('title'), 'reference_translator': m.get('translator'),
         'reference_year': m.get('year'), 'reference_style': m.get('style')}
    if m.get('located'): o['reference_located'] = m['located']
    if m.get('coverage_note'): o['reference_note'] = m['coverage_note']
    if r.get('source_prev_tail'): o['source_prev_tail'] = r['source_prev_tail']
    o['source'] = r['ocr_text']
    if r.get('source_next_head'): o['source_next_head'] = r['source_next_head']
    o['reference'] = r['reference_text']
    o['n'] = len(labels); o['translations'] = labels
    return o


def item(uid, cands):
    names = list(cands); rng.shuffle(names)
    lab = {f'T{i + 1}': n for i, n in enumerate(names)}
    return line(recs[uid], {t: cands[n] for t, n in lab.items()}), lab


items = []
for p in panel:
    u = p['uid']
    arms = [f'{F}-CUR', f'{F}-PLAIN'] + ([f'{F}-CUR2'] if u in floor else [])
    have = {a: body(a)[u] for a in arms if u in body(a)}
    if len(have) < 2: print('skip (fewer than 2 reads)', u, list(have)); continue
    it, lab = item(u, have)
    items.append((it, {'kind': 'ARMS', 'page_id': u, 'lang': p['lang'], 'labels': lab}))
todo = []
for L in ['Persian', 'Sanskrit', 'Chinese', 'Greek', 'Hebrew']:
    us = sorted(x['uid'] for x in panel if x['lang'] == L and x['uid'] in body(f'{F}-CUR') and x['uid'] in body(f'{F}-PLAIN'))
    for i, u in enumerate(random.Random(f'plant-6728-{F}-{L}').sample(us, 2)):
        todo.append({'key': u, 'text': body(f'{F}-CUR')[u], 'kinds': [['negation', 'number'][i % 2]], 'seed': 6728 + i})
out = json.loads(subprocess.check_output(['node', os.path.join(HERE, '..', 'pro-translate-6545', 'plant.mjs')], input=json.dumps(todo).encode()))
for o in out:
    u = o['key']
    if not o['plants']: print('no plant site on', u); continue
    it, lab = item(u, {f'{F}-CUR_PLANT': o['text'], f'{F}-PLAIN': body(f'{F}-PLAIN')[u]})
    items.append((it, {'kind': 'PLANT', 'page_id': u, 'lang': recs[u]['lang'], 'labels': lab, 'plant': o['plants'][0]}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it['id'] = f'{F}-{i + 1:03d}'; key[it['id']] = k
head = open(os.path.join(HERE, '..', 'pro-translate-6545', 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
write_jsonl(f'{J}/req.jsonl', [{'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'} for it, _ in items])
json.dump({it['id']: it['translations'] for it, _ in items}, open(f'{J}/texts.json', 'w'), ensure_ascii=False)
meta = {'family': F, 'judge': 'opus (claude -p)' if F == 'G' else 'gemini-3.8-flash-high (agy -p)', 'items': key, 'did_not_read': {a: v for a, v in B['dnr'].items() if a.startswith(F + '-') and v}}
json.dump(meta, open(f'{J}/key.json', 'w'), ensure_ascii=False, indent=1)
os.makedirs(RESULTS, exist_ok=True)
json.dump(meta, open(f'{RESULTS}/key-{F}.json', 'w'), ensure_ascii=False, indent=1)
print(F, len(items), 'items', {k: sum(1 for _, x in items if x['kind'] == k) for k in ('ARMS', 'PLANT')})
