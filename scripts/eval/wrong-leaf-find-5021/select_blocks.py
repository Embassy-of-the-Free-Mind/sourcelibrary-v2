#!/usr/bin/env python3
# PRIOR ART: scripts/eval/block-guard-5021/sample-blocks.mjs (fresh blocks, no natural slide); onset.py (the slide shape).
"""
select_blocks.py LABELS.jsonl OUT.jsonl — seeded (5021) replay blocks from the Opus-labelled books.
shifted: a write group (2 s rule) of 3-8 pages on a worker-era Gemini model whose slide starts INSIDE the group (an onset
  page before the first `next`) and runs to its end; the call is the group plus the next page when that page was written
  alone 0-60 s later (the final section came back short and was read again alone, onset.py part 3).
clean: a group of 3-8 pages in the SAME books, same model, no page labelled anything but own (unlabelled = not flagged).
30 each, at most one of each kind per book.
"""
import sys, json, random
rows = [json.loads(l) for l in open(sys.argv[1])]
MODELS = {'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite'}
random.seed(5021)
sh, cl = [], []
for b in rows:
    ps = sorted([p for p in b['pages'] if p.get('t') is not None], key=lambda p: p['n'])
    by = {p['n']: p for p in ps}
    groups, cur = [], []
    for p in ps:
        if cur and p['n'] == cur[-1]['n'] + 1 and abs(p['t'] - cur[-1]['t']) <= 2000: cur.append(p)
        else:
            if cur: groups.append(cur)
            cur = [p]
    if cur: groups.append(cur)
    gsz = {p['n']: len(g) for g in groups for p in g}
    S, C = [], []
    for g in groups:
        if not (3 <= len(g) <= 8) or g[0].get('m') not in MODELS: continue
        ys = [p.get('y') for p in g]
        pages = [p['n'] for p in g]
        nx = by.get(g[-1]['n'] + 1)
        tail = nx is not None and gsz.get(nx['n']) == 1 and 0 < (nx['t'] - g[-1]['t']) / 1000 <= 60
        if 'next' in ys:
            f = ys.index('next')
            if f > 0 and all(y in ('next', 'mixed', None) for y in ys[f:]) and ys[-1] in ('next', None):
                S.append({'pages': pages + ([nx['n']] if tail and len(pages) < 8 else []), 'onset': g[f-1]['n'], 'model': g[0]['m'], 'tail_fallback': bool(tail)})
        elif all(y in (None, 'own') for y in ys) and all(p['wh'] == 0 for p in g):
            C.append({'pages': pages, 'model': g[0]['m']})
    if S:
        s = random.choice(S); sh.append({**s, 'book_id': b['b'], 'lang': b['lang'], 'kind': 'shifted'})
        cm = [c for c in C if c['model'] == s['model'] and len(c['pages']) >= 3]
        if cm: c = random.choice(cm); cl.append({**c, 'book_id': b['b'], 'lang': b['lang'], 'kind': 'clean'})
random.shuffle(sh)
pick = sh[:30]
books = {s['book_id'] for s in pick}
cpick = [c for c in cl if c['book_id'] in books][:30]
if len(cpick) < 30: cpick += [c for c in cl if c['book_id'] not in books][:30 - len(cpick)]
with open(sys.argv[2], 'w') as f:
    for i, r in enumerate(pick + cpick): f.write(json.dumps({'id': f"{r['kind'][0]}{i:02d}-{r['book_id'][:8]}-{r['pages'][0]}", **r}) + '\n')
import collections
print('shifted candidates', len(sh), 'picked', len(pick), 'clean picked', len(cpick), collections.Counter(r['lang'] for r in pick).most_common(8), collections.Counter(r['model'] for r in pick))
