#!/usr/bin/env python3
# PRIOR ART: scripts/eval/pareto-6182/build-xl-packet.py (reads the same units/records/arms); scripts/eval/run-cli-arm.py
# defines the request row {uid, prompt, image} this writes for the Gemini arms; claude-arm.py reads the same shape.
"""
build-requests.py LANG... — $0, no model call. Writes the request files for #6545's new arms on those panels:
  $W/req/PRO.jsonl    3.1 Pro (agy), units prompt + TRANSLATE_SUFFIX
  $W/req/C38S.jsonl   3.8 Flash low (agy), the same prompt: the A-vs-A repeat of C38 (and the suffix control)
  $W/req/CF.jsonl     3.8 Flash corrects the in-use English (FP) with source + image
  $W/req/CF-PL.jsonl  the same on 10 pages per panel whose draft carries 2 planted meaning errors
  $W/req/OPUS.jsonl   Opus (claude -p) translates, units prompt + TRANSLATE_SUFFIX
  $W/req/CO.jsonl / CO-PL.jsonl   Opus corrects, as CF / CF-PL
  $W/plants-corr.json the planted drafts and where the errors are (never shown to a model)
Rows are appended per language (re-running a language replaces its rows).
"""
import json, os, random, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
from common import W, read, write_jsonl, units, records, panel_uids, arm
from prompts import TRANSLATE_SUFFIX, correction_prompt

langs = sys.argv[1:]
U, R, FP = units(), records(), arm('FP')
os.makedirs(f'{W}/req', exist_ok=True)
pl_path = f'{W}/plants-corr.json'
plants = json.load(open(pl_path)) if os.path.exists(pl_path) else {}
new = {k: [] for k in ('PRO', 'C38S', 'CF', 'CF-PL', 'OPUS', 'CO', 'CO-PL')}
todo_plant = []
for L in langs:
    uids = panel_uids(L)
    for u in uids:
        p = U[u]['prompt'] + TRANSLATE_SUFFIX
        new['PRO'].append({'uid': u, 'lang': L, 'prompt': p}); new['C38S'].append({'uid': u, 'lang': L, 'prompt': p})
        new['OPUS'].append({'uid': u, 'lang': L, 'prompt': p})
        img = f'{W}/img/{u}.jpg'
        new['CF'].append({'uid': u, 'lang': L, 'image': img, 'prompt': correction_prompt(L, R[u]['ocr_text'], FP[u], 'attached at the end of this message')})
        new['CO'].append({'uid': u, 'lang': L, 'image': img, 'prompt': correction_prompt(L, R[u]['ocr_text'], FP[u], 'IMAGE_PATH')})
    for u in random.Random(6545 + len(L)).sample(uids, 10):
        todo_plant.append({'key': u, 'text': FP[u], 'kinds': ['negation', 'number' if random.Random(u).random() < 0.5 else 'name'], 'seed': int(u[:8], 16) % 100000})
out = json.loads(subprocess.check_output(['node', os.path.join(os.path.dirname(__file__), 'plant.mjs')], input=json.dumps(todo_plant).encode()))
for o in out:
    u = o['key']; L = U[u]['lang']
    if len(o['plants']) < 2: print('only', len(o['plants']), 'plants on', u)
    if not o['plants']: continue
    plants[u] = {'lang': L, 'text': o['text'], 'plants': o['plants']}
    img = f'{W}/img/{u}.jpg'
    new['CF-PL'].append({'uid': u + '#pl', 'lang': L, 'image': img, 'prompt': correction_prompt(L, R[u]['ocr_text'], o['text'], 'attached at the end of this message')})
    new['CO-PL'].append({'uid': u + '#pl', 'lang': L, 'image': img, 'prompt': correction_prompt(L, R[u]['ocr_text'], o['text'], 'IMAGE_PATH')})
json.dump(plants, open(pl_path, 'w'), ensure_ascii=False, indent=1)
for k, rows in new.items():
    p = f'{W}/req/{k}.jsonl'
    old = [r for r in read(p) if r['lang'] not in langs] if os.path.exists(p) else []
    write_jsonl(p, old + rows)
    print(k, len(old) + len(rows))
