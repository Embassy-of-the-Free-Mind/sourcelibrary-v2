#!/usr/bin/env python3
# PRIOR ART: scripts/eval/plain-6728/build-packet.py — the item line (`line()`, from pro-translate-6545), the label
# shuffle, the plants (pro-translate-6545/plant.mjs) and JUDGE-PROMPT-PRO.md are its code, unchanged. What is new: one
# packet per ENGINE holding all of that engine's arms per page (v13, v20, plain, v13b), and the wrong-page and duplicate
# controls of translation-vs-reference/README.md, which #6728 did not run.
"""
build-packet.py ENGINE [--batch2] — $0. ENGINE lite | flash38 | opus. Reads $W/bodies.json and $W/records.jsonl.
Writes $W/judge/<ENGINE>/{req.jsonl, key.json, texts.json}; key.json (labels → arms, plants; no text) is copied to
scripts/eval/results/bench-translation-7499/key-<ENGINE>.json. Items already in an existing key keep their ids and
labels (batch 2 appends), so a judge run can resume.
"""
import json, os, random, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
W = os.environ.get('BENCH_W', os.environ.get('JOB_SCRATCH', '') + '/w')
RESULTS = os.path.join(HERE, '..', 'results', 'bench-translation-7499')
E = sys.argv[1]
assert E in ('lite', 'flash38', 'opus')
J = f'{W}/judge/{E}'; os.makedirs(J, exist_ok=True)
B = json.load(open(f'{W}/bodies.json'))
body = lambda arm: B['body'].get(f'{E}-{arm}', {})
recs = {r['id']: r for r in (json.loads(l) for l in open(f'{W}/records.jsonl', encoding='utf-8') if l.strip())}
man = {p['id']: p for p in json.load(open(os.path.join(HERE, 'manifest.json')))['pages']}
ARMS = ['v13', 'v20', 'plain', 'v13b']
rng = random.Random(f'7499-{E}')


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


old = json.load(open(f'{J}/key.json'))['items'] if os.path.exists(f'{J}/key.json') else {}
have_arms = {k['page_id'] for k in old.values() if k['kind'] == 'ARMS'}
have_ctrl = any(k['kind'] != 'ARMS' for k in old.values())
items = []
for u in sorted(man):
    if u in have_arms: continue
    have = {f'{E}-{a}': body(a)[u] for a in ARMS if u in body(a)}
    if f'{E}-v13' not in have or len(have) < 2: continue
    it, lab = item(u, have)
    items.append((it, {'kind': 'ARMS', 'page_id': u, 'lang': recs[u]['lang'], 'group': man[u]['group'], 'labels': lab}))

if not have_ctrl:
    both = lambda g: sorted(u for u in man if man[u]['group'] == g and u in body('v13') and u in body('plain') and u in body('v20'))
    groups = sorted({man[u]['group'] for u in man if u in body('v13')})
    todo = []
    for g in groups:
        us = both(g)
        for i, u in enumerate(random.Random(f'plant-7499-{E}-{g}').sample(us, min(2, len(us)))):
            todo.append({'key': u, 'text': body('v13')[u], 'kinds': [['negation', 'number'][i % 2]], 'seed': 7499 + i})
    out = json.loads(subprocess.check_output(['node', os.path.join(HERE, '..', 'pro-translate-6545', 'plant.mjs')], input=json.dumps(todo).encode()))
    for o in out:
        u = o['key']
        if not o['plants']: print('no plant site on', u); continue
        it, lab = item(u, {f'{E}-v13_PLANT': o['text'], f'{E}-plain': body('plain')[u]})
        items.append((it, {'kind': 'PLANT', 'page_id': u, 'lang': recs[u]['lang'], 'group': man[u]['group'], 'labels': lab, 'plant': o['plants'][0]}))
    R = random.Random(f'ctrl-7499-{E}')
    pool = [u for g in groups for u in both(g)]
    for u in R.sample(pool, min(4, len(pool))):   # wrong page: another page's v13 body (same group), beside this page's v20
        other = [x for x in pool if x != u and man[x]['group'] == man[u]['group']] or [x for x in pool if x != u]
        w = R.choice(other)
        it, lab = item(u, {f'{E}-WRONG': body('v13')[w], f'{E}-v20': body('v20')[u]})
        items.append((it, {'kind': 'WRONG', 'page_id': u, 'lang': recs[u]['lang'], 'group': man[u]['group'], 'labels': lab, 'wrong_from': w}))
    for u in R.sample(pool, min(4, len(pool))):   # duplicate: one v13 body under two labels
        it, lab = item(u, {f'{E}-v13': body('v13')[u], f'{E}-v13_DUP': body('v13')[u]})
        items.append((it, {'kind': 'DUP', 'page_id': u, 'lang': recs[u]['lang'], 'group': man[u]['group'], 'labels': lab}))

rng.shuffle(items)
start = len(old)
key = dict(old)
for i, (it, k) in enumerate(items):
    it['id'] = f'{E}-{start + i + 1:04d}'; key[it['id']] = k
head = open(os.path.join(HERE, '..', 'pro-translate-6545', 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
mode = 'a' if old else 'w'
with open(f'{J}/req.jsonl', mode, encoding='utf-8') as f:
    for it, _ in items: f.write(json.dumps({'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'}, ensure_ascii=False) + '\n')
texts = json.load(open(f'{J}/texts.json')) if old else {}
texts.update({it['id']: it['translations'] for it, _ in items})
json.dump(texts, open(f'{J}/texts.json', 'w'), ensure_ascii=False)
judge = 'opus (claude -p)' if E != 'opus' else ('opus (claude -p), SAME FAMILY' if os.environ.get('BENCH_SAME_FAMILY') == '1' else 'gemini-3.8-flash-high (agy -p)')
meta = {'engine': E, 'judge': judge, 'items': key, 'did_not_read': {a: v for a, v in B['dnr'].items() if a.startswith(E + '-') and v}}
json.dump(meta, open(f'{J}/key.json', 'w'), ensure_ascii=False, indent=1)
os.makedirs(RESULTS, exist_ok=True)
json.dump(meta, open(f'{RESULTS}/key-{E}.json', 'w'), ensure_ascii=False, indent=1)
print(E, len(items), 'new items', {k: sum(1 for _, x in items if x['kind'] == k) for k in ('ARMS', 'PLANT', 'WRONG', 'DUP')}, 'total', len(key))
