#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs — blinded packet with a positive
# control and same-arm pairs, but it ranks several candidates against an 84000 REFERENCE. Here
# there is one English per page and no reference: the judge scores it against the Tibetan
# e-text and the image, so the packet carries a wrong-page negative, a planted meaning change
# and duplicate pairs instead of competing arms.
"""
Part C of the Tengyur pilot QA (#5497): a source-grounded fidelity sample.

  python3 build-packet-c.py <pages.jsonl> <plants.json> <out-dir>

Draws 8 pages per volume (seed 5497) from pilot pages with >= 60 source syllables, then adds:
  NEG   one per volume: a non-sample page's image + Tibetan with the English of a page >= 30
        pages away in the same volume (must score fidelity <= 2);
  PLANT one per volume: a sample page's English with a planted meaning change (plants.json,
        written by hand; must be caught as inversion / invention / fidelity drop);
  DUP   one per volume: a byte-identical copy of a sample page's item (noise floor).
Each judge (A, B) reads the same 55 items in its own shuffle, split into two halves; a DUP or
PLANT copy always sits in the other half from its original, so the pair is read by two agent
instances of the same judge. Writes items.jsonl (what the judge sees), key.json (what each id
is) and half-{A,B}{1,2}.jsonl.
"""
import json, os, random, re, sys

pages_path, plants_path, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
rows = [json.loads(l) for l in open(pages_path, encoding='utf8')]
by = {(r['vol'], r['page_number']): r for r in rows}
plants = json.load(open(plants_path, encoding='utf8')) if os.path.exists(plants_path) else {}

def syl(t):
    t = re.sub(r'\{D\d+[a-z]?\}', ' ', t)
    return len(re.findall(r'[ཀ-ྼ]+', t))

rng = random.Random(5497)
VOLS = [113, 33, 96, 174, 157]
sample = {}
for v in VOLS:
    pool = sorted(r['page_number'] for r in rows if r['vol'] == v and syl(r['src']) >= 60)
    sample[v] = sorted(rng.sample(pool, 8))

def lines(t):
    return [l for l in t.split('\n') if l.strip()]

def item_for(r, english):
    prev = by.get((r['vol'], r['page_number'] - 1))
    nxt = by.get((r['vol'], r['page_number'] + 1))
    return {
        'image': f"img/{r['vol']}_{r['page_number']:03d}.jpg",
        'folio': r['label'],
        'source': r['src'],
        'prev_page_last_line': lines(prev['src'])[-1] if prev and prev['src'].strip() else None,
        'next_page_first_line': lines(nxt['src'])[0] if nxt and nxt['src'].strip() else None,
        'english': english,
    }

items, key = [], {}
def add(kind, r, english, extra=None):
    it = item_for(r, english)
    items.append((kind, r, it, extra or {}))

for v in VOLS:
    for p in sample[v]:
        add('REAL', by[(v, p)], by[(v, p)]['en'])
for v in VOLS:
    s = sample[v]
    # NEG: a page not in the sample, English from >= 30 pages away
    pool = sorted(r['page_number'] for r in rows if r['vol'] == v and syl(r['src']) >= 60 and r['page_number'] not in s)
    a = rng.choice(pool)
    far = [p for p in pool if abs(p - a) >= 30]
    b = rng.choice(far)
    add('NEG', by[(v, a)], by[(v, b)]['en'], {'english_from_page': b})
    # PLANT on the sample's first page, DUP of its second
    pp = s[0]
    pl = plants.get(f'{v}:{pp}')
    if pl:
        en = by[(v, pp)]['en']
        assert pl['find'] in en, (v, pp, pl['find'][:60])
        add('PLANT', by[(v, pp)], en.replace(pl['find'], pl['replace'], 1), {'plant': pl})
    add('DUP', by[(v, s[1])], by[(v, s[1])]['en'], {'dup_of_page': s[1]})

# blind ids
ids = rng.sample(range(100, 1000), len(items))
recs = []
for (kind, r, it, extra), i in zip(items, ids):
    cid = f'C{i}'
    recs.append({'id': cid, **it})
    key[cid] = {'kind': kind, 'vol': r['vol'], 'page': r['page_number'], 'book_id': r['book_id'], 'folio': r['label'], **extra}
json.dump(sample, open(f'{out}/sample.json', 'w'), indent=1)
json.dump(key, open(f'{out}/key.json', 'w'), indent=1)
with open(f'{out}/items.jsonl', 'w', encoding='utf8') as f:
    for rec in recs:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')

# halves: copies (DUP/PLANT) opposite their REAL original
def orig_of(cid):
    k = key[cid]
    if k['kind'] in ('DUP', 'PLANT'):
        return next(c for c, kk in key.items() if kk['kind'] == 'REAL' and kk['vol'] == k['vol'] and kk['page'] == k['page'])
    return None
for judge, seed in (('A', 1), ('B', 2)):
    r2 = random.Random(5497 * 10 + seed)
    order = [rec['id'] for rec in recs]
    r2.shuffle(order)
    h1, h2 = [], []
    copies = [c for c in order if orig_of(c)]
    pinned = {}
    for c in copies:
        o = orig_of(c)
        side = r2.choice((1, 2))
        pinned[o] = side
        pinned[c] = 3 - side if pinned.get(c) is None else pinned[c]
    for c in order:
        if c in pinned:
            (h1 if pinned[c] == 1 else h2).append(c)
    rest = [c for c in order if c not in pinned]
    for c in rest:
        (h1 if len(h1) <= len(h2) else h2).append(c)
    byid = {rec['id']: rec for rec in recs}
    for n, h in ((1, h1), (2, h2)):
        r2.shuffle(h)
        with open(f'{out}/half-{judge}{n}.jsonl', 'w', encoding='utf8') as f:
            for c in h:
                f.write(json.dumps(byid[c], ensure_ascii=False) + '\n')
print(json.dumps({'items': len(recs), 'kinds': {k: sum(1 for v in key.values() if v['kind'] == k) for k in ('REAL', 'NEG', 'PLANT', 'DUP')}, 'sample': sample}))
