#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/from-ab-sample.mjs converts ONE #5606-style sample into harness
# records; scripts/eval/xlref-t*/ each cut their own track. Nothing draws ACROSS the five #5695 tracks' finished
# record files, which is what #5698 step 3 needs ("measure v17 on the #5695 reference sets").
"""Pin the #5698 v17 sample: 40 reference pages across the #5695 tracks + up to 8 gallery-pool pages.

  python3 scripts/eval/translation-prompt-v17/build-sample.py     # writes results/translation-prompt-v17-2026-10/sample.jsonl

Main draw (seed 5698, one page per book while a stratum allows): public references only (reference_meta.private
false), source 400–6000 chars, reference cut not judged "wrong" by either track judge.
Gallery pool: pages where a #5695 track judge QUOTED A REVERSAL on a production-prompt arm, one per language, not in
the main draw. They are selected on an outcome, so they are reported separately and never enter a headline rate.
No Tibetan: the only reference (84000) is CC BY-NC-ND and stays on the box; #5497 covers Tibetan separately.
"""
import json, random, collections, os
R = os.path.join(os.path.dirname(__file__), '..', 'results')
OUT = os.path.join(R, 'translation-prompt-v17-2026-10', 'sample.jsonl')
L = lambda f: [json.loads(l) for l in open(os.path.join(R, f)) if l.strip()]
QUOTA = {'Latin': 8, 'Greek': 6, 'German': 2, 'French': 2, 'Italian': 1, 'Dutch': 1, 'Hebrew': 4, 'Aramaic': 1,
         'Arabic': 4, 'Persian': 3, 'Sanskrit': 3, 'Pali': 2, 'Chinese': 3}
PROD_ARMS = {'served', 'prod-A', 'prod-B', 'flash', 'lite', 'lite2', 'flash-0', 'lite-a', 'lite-b'}

def rec(track, lang, r, source, ref, meta, fit=None, reversal=None):
    return {'track': track, 'lang': lang, 'book_id': r['book_id'], 'page_number': r['page_number'], 'source_text': source,
            'reference_text': ref, 'reference_meta': meta, 'source_prev_tail': r.get('source_prev_tail'),
            'source_next_head': r.get('source_next_head'), 'prior_reference_fit': fit, 'prior_reversal': reversal}

pool = []
# T1 Latin / T3 vernaculars: harness records + results per_page
for track, d in (('T1', 'xlref-t1-2026-10'), ('T3', 'xlref-t3-2026-10')):
    res = json.load(open(os.path.join(R, d, 'results-pass1.json' if track == 'T1' else 'results.json')))
    pp = {p['id']: p for p in res['per_page']}
    for r in L(f'{d}/records.jsonl'):
        if r.get('skipped'): continue
        p = pp.get(f"{r['book_id']}_{int(r['page_number']):05d}", {})
        rev = next((j['reversal'] for a, v in (p.get('arms') or {}).items() if a in PROD_ARMS
                    for j in (v.get('by_judge') or {}).values() if j.get('reversal')), None)
        pool.append(rec(track, r['lang'], r, r['source_text'], r['reference_text'], r['reference_meta'], p.get('reference_fit'), rev))
# T2 Greek: pages.jsonl rows (served arm carries source + reference object; the reference TEXT is in the row's `reference.text`)
t2 = L('xlref-t2-2026-10/pages.jsonl')
rev2 = {}
for x in t2:
    bj = (x.get('core_packet') or {}).get('by_judge') or {}
    for j in bj.values():
        if isinstance(j, dict) and j.get('reversal') and x['arm'] in PROD_ARMS: rev2[x['id']] = j['reversal']
for x in t2:
    if x['arm'] != 'served' or x.get('source_is_corrected_transcription'): continue
    ref = x['reference']; text = ref.get('text') or ref.get('reference_text')
    if not text or not ref.get('publishable', True): continue
    meta = {k: ref.get(k) for k in ('title', 'translator', 'year', 'licence', 'style', 'canonical', 'located', 'url')}; meta['private'] = False
    pool.append(rec('T2', 'Greek', x, x['source_text'], text, meta, x.get('reference_fit'), rev2.get(x['id'])))
# T4 Hebrew/Aramaic/Arabic/Persian: references.jsonl (+ reversals from pages.jsonl)
rev4 = {}; fit4 = {}
for x in L('xlref-t4-2026-10/pages.jsonl'):
    fit4[x['id']] = x.get('reference_fit')
    for j in (x.get('by_judge') or {}).values():
        if isinstance(j, dict) and j.get('reversal') and x['arm'] in PROD_ARMS: rev4[x['id']] = j['reversal']
for x in L('xlref-t4-2026-10/references.jsonl'):
    if x['reference_meta'].get('private') or not x.get('reference_text'): continue
    pool.append(rec('T4', x['lang'], x, x['source_text_ocr'], x['reference_text'], x['reference_meta'], fit4.get(x['id']), rev4.get(x['id'])))
# T5 Sanskrit/Pali/Chinese
rev5 = {}; fit5 = {}
for x in L('xlref-t5-2026-10/pages.jsonl'):
    fit5[x['id']] = x.get('reference_fit')
    for j in (x.get('by_judge') or {}).values():
        if isinstance(j, dict) and j.get('reversal') and x['arm'] in PROD_ARMS: rev5[x['id']] = j['reversal']
for r in L('xlref-t5-2026-10/work/records-arms.jsonl'):
    i = f"{r['book_id']}_{int(r['page_number']):05d}"
    pool.append(rec('T5', r['lang'], r, r['source_text'], r['reference_text'], r['reference_meta'], fit5.get(i), rev5.get(i)))

def usable(r):
    if r['reference_meta'].get('private'): return False
    if not (400 <= len(r['source_text'] or '') <= 6000) or not r['reference_text']: return False
    fit = r['prior_reference_fit'] or {}
    return 'wrong' not in (fit.values() if isinstance(fit, dict) else [fit])
pool = [r for r in pool if usable(r)]
pool.sort(key=lambda r: (r['book_id'], r['page_number']))
rng = random.Random(5698)
main, seen_books = [], set()
for lang, q in QUOTA.items():
    cands = [r for r in pool if r['lang'] == lang]; rng.shuffle(cands)
    picked = []
    for r in cands:                      # one page per book first
        if len(picked) < q and r['book_id'] not in {p['book_id'] for p in picked} | seen_books: picked.append(r)
    for r in cands:                      # then fill from already-used books if the stratum is short of books
        if len(picked) < q and r not in picked: picked.append(r)
    seen_books |= {p['book_id'] for p in picked}
    main += [dict(p, set='main') for p in picked]
    print(f'{lang:9s} pool {len(cands):3d}  drew {len(picked)}/{q}')
ids = {(r['book_id'], r['page_number']) for r in main}
gal, glangs = [], collections.Counter()
cands = [r for r in pool if r['prior_reversal'] and (r['book_id'], r['page_number']) not in ids]; rng.shuffle(cands)
for r in cands:
    if len(gal) < 8 and glangs[r['lang']] < 1: gal.append(dict(r, set='gallery-pool')); glangs[r['lang']] += 1
print('gallery pool:', [(r['lang'], r['book_id'][-6:], r['page_number']) for r in gal])
with open(OUT, 'w') as f:
    for r in main + gal: f.write(json.dumps(r, ensure_ascii=False) + '\n')
print(f'wrote {len(main)} main + {len(gal)} gallery-pool pages -> {os.path.relpath(OUT)}; books: {len({r["book_id"] for r in main})}')
