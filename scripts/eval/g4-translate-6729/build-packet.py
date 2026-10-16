#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pro-translate-6545/build-packet.py — the item line, label shuffle, plant construction (same
# seeds, so the same planted drafts) and the judge file shapes are its code; #6729 adds the second order of every
# page (candidates reversed) in place of #6545's REPEAT items, and a Gemini 3.8 Flash judge in place of 3.1 Pro.
"""
build-packet.py LANG... — $0, no model call. Blind judge packet for #6729 (G4L, OPUS, C38S) on those panels.
W6545 must point at this job's working dir ($JOB_SCRATCH/w) so pro-translate-6545/arms.py reads OPUS, C38S and G4L
from $W/arms/. Writes, under $W/judge/r1/:
  opus/in-NN.jsonl   Opus parts, 3 items each, a page's two orders never in one part
  g38/req.jsonl      one agy request per item (JUDGE-PROMPT-PRO.md + the item inline)
  key.json, texts.json
Items: ORD1 / ORD2 per page (ORD2 = ORD1's candidates in reverse order; ORD1's first slot rotates over pages), and
PLANT (#6545's: 10 per panel, a copy of the stored C38 with one planted meaning error, beside FP and C38S).
"""
import json, os, random, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
P6545 = os.path.join(HERE, '..', 'pro-translate-6545')
sys.path.insert(0, P6545)
from common import W, write_jsonl, records, panel_uids
from arms import load

langs = [x for x in sys.argv[1:] if not x.startswith('--')]
ARMS = ['G4L', 'OPUS', 'C38S']
RESULTS = 'scripts/eval/results/g4-translate-6729'
J = f'{W}/judge/r1'
for d in ('opus', 'g38'): os.makedirs(f'{J}/{d}', exist_ok=True)
rng = random.Random('6729-r1')
recs = records()
uids = [u for L in langs for u in panel_uids(L)]
texts, fails, _ = load(uids, ARMS)
ptexts, _, _ = load(uids, ['C38', 'FP'])
texts.update(ptexts)


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


def item_in_order(uid, names, cands):
    lab = {f'T{i + 1}': n for i, n in enumerate(names)}
    return line(recs[uid], {t: cands[n] for t, n in lab.items()}), lab


items = []
for n, u in enumerate(uids):
    have = {a: texts[a][u] for a in ARMS if u in texts.get(a, {})}
    names = list(have); rng.shuffle(names)
    # rotate so each arm leads ORD1 about equally often (when all three read)
    if len(names) == 3:
        names = sorted(names, key=ARMS.index)
        names = names[n % 3:] + names[:n % 3]
        if rng.random() < 0.5: names = [names[0], names[2], names[1]]
    for kind, order in (('ORD1', names), ('ORD2', names[::-1])):
        it, lab = item_in_order(u, order, have)
        items.append((it, {'kind': kind, 'page_id': u, 'lang': recs[u]['lang'], 'labels': lab}))

# plants: #6545's construction, same seeds (build-packet.py r1 branch)
todo = []
for L in langs:
    pu = [u for u in panel_uids(L) if u in texts['C38'] and u in texts['C38S']]
    for i, u in enumerate(random.Random(f'plant-{L}').sample(pu, 10)):
        todo.append({'key': u, 'text': texts['C38'][u], 'kinds': [['negation', 'number', 'clause'][i % 3] if i % 3 != 1 else ('number' if i % 2 else 'name')], 'seed': 7000 + i})
out = json.loads(subprocess.check_output(['node', os.path.join(P6545, 'plant.mjs')], input=json.dumps(todo).encode()))
for o in out:
    u = o['key']
    if not o['plants']: print('no plant site on', u); continue
    cands = {'C38_PLANT': o['text'], 'FP': texts['FP'][u], 'C38S': texts['C38S'][u]}
    names = list(cands); rng.shuffle(names)
    it, lab = item_in_order(u, names, cands)
    items.append((it, {'kind': 'PLANT', 'page_id': u, 'lang': recs[u]['lang'], 'labels': lab, 'plant': o['plants'][0]}))

rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it['id'] = f'r1-{i + 1:03d}'; key[it['id']] = k
parts = []
for it, k in items:
    for p in parts:
        if len(p) < 3 and not any(k2['page_id'] == k['page_id'] for _, k2 in p): p.append((it, k)); break
    else: parts.append([(it, k)])
for f in os.listdir(f'{J}/opus'):
    if f.startswith('in-'): os.remove(f'{J}/opus/{f}')
for n, p in enumerate(parts):
    write_jsonl(f'{J}/opus/in-{n + 1:03d}.jsonl', [it for it, _ in p])
head = open(os.path.join(P6545, 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
write_jsonl(f'{J}/g38/req.jsonl', [{'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'} for it, _ in items])
failed = {a: v for a, v in fails.items() if v and a in ARMS}
meta = {'round': 'r1', 'langs': langs, 'arms': ARMS, 'items': key, 'failed_reads': failed}
json.dump({it['id']: it['translations'] for it, _ in items}, open(f'{J}/texts.json', 'w'), ensure_ascii=False)
json.dump(meta, open(f'{J}/key.json', 'w'), ensure_ascii=False, indent=1)
os.makedirs(RESULTS, exist_ok=True)
json.dump(meta, open(f'{RESULTS}/key.json', 'w'), ensure_ascii=False, indent=1)
kinds = {k: sum(1 for _, x in items if x['kind'] == k) for k in ('ORD1', 'ORD2', 'PLANT')}
print(len(items), 'items', kinds, 'opus parts', len(parts), 'failed', {a: len(v) for a, v in failed.items()})
