#!/usr/bin/env python3
"""Jev (typesafe-ai/jev, a non-Gemini typed-decision model on the Vercel AI Gateway) as an independent rater for the
animism layer of the aliveness atlas (#6652). It scores every page the flash-lite screen read, with the judge's rubric
as one yes/no ("noul") question, plus the reverse wording scored as 1 - p, so a wording bias cancels in the mean.
The decision it informs: if Jev's score separates judge-confirmed from judge-rejected pages (AUC), it can screen the
FULL phrase-hit set (~60K pages, about $4) instead of a 3.5K sample; if not, the sample stays the instrument.

PRIOR ART: scripts/eval/jev/jevlib.py — the gateway call and answer parsing are copied from it. It does not fit as-is
because it reads its token from scripts/eval/.env.gw and writes ledgers into scripts/eval/jev/, both tracked paths.
Token: VERCEL_OIDC_TOKEN from `vercel env pull <file>` (expires ~12 h), passed with --env; never commit it.

  python3 classify/jev-animism.py --env <.env.gw> --out <scores.jsonl> <input.jsonl> [<input.jsonl> ...] [--cap 1.0]
"""
import json, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

args = sys.argv[1:]
def opt(k, d=None):
    if k in args:
        i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
ENV = opt('--env'); OUT = opt('--out'); CAP = float(opt('--cap', '1.0')); CONC = int(opt('--conc', '8'))
INPUTS = args
if not ENV or not OUT or not INPUTS: sys.exit(__doc__)
TOK = [l.split('=', 1)[1].strip().strip('"') for l in open(ENV) if l.startswith('VERCEL_OIDC_TOKEN')][0]

W1 = ('This passage presents a particular place or natural thing (a river, spring, lake, sea, mountain, rock, tree, grove, '
      'forest, field, the earth or land, the sky, an animal) as a PERSON, or as the dwelling of a spirit or god tied to that '
      'place (a naga of the lake, a lord of the soil, a mountain god, a kami, a river god, a nymph of the spring, ancestors in '
      'the land), with whom people can stand in a relation such as offering, appeasement, offence or kinship. Gods of heaven, '
      'angels, metaphor, a place merely called holy, or the world-soul of natural philosophy do not count.')
W2 = ('This passage presents NO particular place or natural thing as a person or as the dwelling of a spirit or god tied to '
      'that place; any gods, spirits or personified nature in it are heavenly, abstract, metaphorical or absent.')

lock = threading.Lock(); spent = [0.0]; tokens = [0]
done = set()
if os.path.exists(OUT):
    for l in open(OUT):
        try: done.add(json.loads(l)['page_id'])
        except Exception: pass

def ask(state):
    if spent[0] >= CAP: raise RuntimeError(f'cap ${CAP} reached')
    body = json.dumps({'model': 'typesafe-ai/jev', 'state': state[:6000],
                       'questions': {'w1': {'type': 'noul', 'instructions': W1}, 'w2': {'type': 'noul', 'instructions': W2}}}).encode()
    for i in range(4):
        try:
            r = urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone', data=body,
                                       headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json'})
            j = json.load(urllib.request.urlopen(r, timeout=60))
            cost = float(j.get('provider_metadata', {}).get('gateway', {}).get('marketCost', 0) or 0)
            with lock: spent[0] += cost; tokens[0] += j['usage']['input_tokens']
            a = j['answers']; return a['w1'].get('noul'), a['w2'].get('noul'), cost
        except urllib.error.HTTPError as e:
            if e.code in (401, 403): raise
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    return None

rows = []
for f in INPUTS:
    for l in open(f):
        if l.strip():
            r = json.loads(l)
            if r['page_id'] not in done: rows.append(r)
print(f'{len(rows)} pages to score ({len(done)} done), cap ${CAP}', flush=True)

out = open(OUT, 'a'); n = [0]
def one(r):
    state = f"{r.get('book_title', '')} ({r.get('book_year') or 'n.d.'})\n\n{r['text']}"
    res = ask(state)
    if not res: return
    w1, w2, cost = res
    with lock:
        out.write(json.dumps({'page_id': r['page_id'], 'w1': w1, 'w2': w2,
                              'jev': None if w1 is None or w2 is None else round((w1 + 1 - w2) / 2, 4)}) + '\n'); out.flush()
        n[0] += 1
        if n[0] % 500 == 0: print(f'  {n[0]} scored, ${spent[0]:.4f}', flush=True)

with ThreadPoolExecutor(CONC) as ex:
    for _ in ex.map(lambda r: (one(r) if spent[0] < CAP else None), rows): pass
print(f'done scored={n[0]} cost=${spent[0]:.4f} input_tokens={tokens[0]}', flush=True)
