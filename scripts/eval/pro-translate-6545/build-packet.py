#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/build-xl-packet.py — the item line (`line()`: reference meta, source with its
# neighbours, reference, T1..Tn) and the label shuffle are its code, unchanged; the arms, the controls (non-twin
# plants, located by span) and the three judges' file shapes are #6545's.
"""
build-packet.py ROUND LANG... [--arms FP,C38,...] — $0. Blind judge packet for one round on those panels.

Items: ARMS (one per page, every arm with a read), PLANT (10 per panel: a copy of the page's C38 with ONE planted meaning
error — negation, number/name, or a dropped clause, in rotation — beside FP and C38S; no twin, so a catch must be
located), REPEAT (20 ARMS items per panel again, labels reshuffled: test–retest). Writes, under $W/judge/<ROUND>/:
  opus/in-NN.jsonl     Opus parts (3 items each)
  fable/in-NN.jsonl    Fable's subset (stage-1: 18 ARMS + 5 PLANT per panel), 3 items each
  pro/req.jsonl        one agy request per item, the item inline (Gemini judging degrades at 5 per call)
  key.json             labels → arms, plants, failed reads (holds no reference text, but stays in $W; a copy without
                       texts goes to results/)
Nothing here tells a judge how many errors to expect, or that any item is a control.
"""
import json, os, random, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import W, read, write_jsonl, units, records, panel_uids, RESULTS
from arms import load

ROUND = sys.argv[1]
langs = [x for k, x in enumerate(sys.argv[2:], 2) if not x.startswith('--') and not sys.argv[k - 1].startswith('--')]
opt = lambda k, d: sys.argv[sys.argv.index(f'--{k}') + 1] if f'--{k}' in sys.argv else d
ARMS = opt('arms', 'FP,C38,C38S,PRO,OPUS,CF,CO').split(',')
J = f'{W}/judge/{ROUND}'
for d in ('opus', 'fable', 'pro'): os.makedirs(f'{J}/{d}', exist_ok=True)
rng = random.Random(f'6545-{ROUND}')
recs = records()
uids = [u for L in langs for u in panel_uids(L)]
texts, fails, _ = load(uids, ARMS)
if os.path.exists(f'{W}/arms-extra-{ROUND}.json'):          # round-2 arms (edit contract) built by dr.py
    ex = json.load(open(f'{W}/arms-extra-{ROUND}.json'))
    for a, d in ex['texts'].items(): texts[a] = d
    for a, d in ex['fails'].items(): fails[a] = d
    # round 2 judges only the pages the edit-contract arms touched (pages with an agreed span); elsewhere DO = DF = FP
    uids = [u for u in uids if any(u in ex['texts'][a] or u in ex['fails'][a] for a in ex['texts'])]


def line(r, labels):   # build-xl-packet.py's line(), unchanged
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
for u in uids:
    have = {a: texts[a][u] for a in ARMS if u in texts.get(a, {})}
    it, lab = item(u, have)
    items.append((it, {'kind': 'ARMS', 'page_id': u, 'lang': recs[u]['lang'], 'labels': lab}))
plants = []
if ROUND.startswith('r1'):
    todo = []
    for L in langs:
        pu = [u for u in panel_uids(L) if u in texts['C38'] and u in texts['C38S']]
        for i, u in enumerate(random.Random(f'plant-{L}').sample(pu, 10)):
            todo.append({'key': u, 'text': texts['C38'][u], 'kinds': [['negation', 'number', 'clause'][i % 3] if i % 3 != 1 else ('number' if i % 2 else 'name')], 'seed': 7000 + i})
    out = json.loads(subprocess.check_output(['node', os.path.join(os.path.dirname(__file__), 'plant.mjs')], input=json.dumps(todo).encode()))
    for o in out:
        u = o['key']
        if not o['plants']: print('no plant site on', u); continue
        it, lab = item(u, {'C38_PLANT': o['text'], 'FP': texts['FP'][u], 'C38S': texts['C38S'][u]})
        items.append((it, {'kind': 'PLANT', 'page_id': u, 'lang': recs[u]['lang'], 'labels': lab, 'plant': o['plants'][0]}))
    for L in langs:
        arms_L = [x for x in items if x[1]['kind'] == 'ARMS' and x[1]['lang'] == L]
        for it0, k0 in random.Random(f'rep-{L}').sample(arms_L, min(int(opt('repeats', '20')), len(arms_L))):
            u = k0['page_id']
            have = {a: texts[a][u] for a in k0['labels'].values()}
            it, lab = item(u, have)
            items.append((it, {'kind': 'REPEAT', 'page_id': u, 'lang': L, 'labels': lab}))
rng.shuffle(items)
key = {}
for i, (it, k) in enumerate(items):
    it['id'] = f'{ROUND}-{i + 1:03d}'; key[it['id']] = k
# Opus: 3 items per part, a page's REPEAT never in the same part as its ARMS item
order = [x for x in items]
parts = []
for it, k in order:
    for p in parts:
        if len(p) < 3 and not any(k2['page_id'] == k['page_id'] for _, k2 in p): p.append((it, k)); break
    else: parts.append([(it, k)])
for f in os.listdir(f'{J}/opus'):
    if f.startswith('in-'): os.remove(f'{J}/opus/{f}')
for n, p in enumerate(parts):
    write_jsonl(f'{J}/opus/in-{n + 1:02d}.jsonl', [it for it, _ in p])
# Fable subset
fab = []
if ROUND.startswith('r1'):
    for L in langs:
        a = [x for x in items if x[1]['kind'] == 'ARMS' and x[1]['lang'] == L]
        pl = [x for x in items if x[1]['kind'] == 'PLANT' and x[1]['lang'] == L]
        fab += random.Random(f'fable-{L}').sample(a, min(int(opt('fable-arms', '18')), len(a))) + random.Random(f'fable-pl-{L}').sample(pl, min(5, len(pl)))
    random.Random('fable').shuffle(fab)
    for f in os.listdir(f'{J}/fable'):
        if f.startswith('in-'): os.remove(f'{J}/fable/{f}')
    for n in range(0, len(fab), 3):
        write_jsonl(f'{J}/fable/in-{n // 3 + 1:02d}.jsonl', [it for it, _ in fab[n:n + 3]])
# Pro: one request per item
head = open(os.path.join(os.path.dirname(__file__), 'JUDGE-PROMPT-PRO.md'), encoding='utf-8').read()
write_jsonl(f'{J}/pro/req.jsonl', [{'uid': it['id'], 'prompt': head + '\n\nITEM:\n' + json.dumps(it, ensure_ascii=False) + '\n'} for it, _ in items])
failed = {a: v for a, v in fails.items() if v}
json.dump({it['id']: it['translations'] for it, _ in items}, open(f'{J}/texts.json', 'w'), ensure_ascii=False)
json.dump({'round': ROUND, 'langs': langs, 'arms': ARMS, 'items': key, 'fable_items': [it['id'] for it, _ in fab], 'failed_reads': failed}, open(f'{J}/key.json', 'w'), ensure_ascii=False, indent=1)
os.makedirs(f'{RESULTS}/{ROUND}', exist_ok=True)
json.dump({'round': ROUND, 'langs': langs, 'arms': ARMS, 'items': key, 'fable_items': [it['id'] for it, _ in fab], 'failed_reads': failed}, open(f'{RESULTS}/{ROUND}/key.json', 'w'), ensure_ascii=False, indent=1)
kinds = {k: sum(1 for _, x in items if x['kind'] == k) for k in ('ARMS', 'PLANT', 'REPEAT')}
print(len(items), 'items', kinds, 'opus parts', len(parts), 'fable items', len(fab), 'failed', {a: len(v) for a, v in failed.items()})
