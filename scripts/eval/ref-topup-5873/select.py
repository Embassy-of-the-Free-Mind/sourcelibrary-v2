#!/usr/bin/env python3
# PRIOR ART: scripts/eval/xlref-t4/build-records.mjs merges alignment-agent output into harness records for T4's hand-picked books (track fixed to T4, no draw order); scripts/eval/xlref-t5/assemble.py does the same for T5. Neither applies a registered "first k aligned books in seeded draw order" rule or keeps the per-book alignment log. This does both.
"""Select the #5873 top-up pages from the alignment agents' files by the registered rule and write harness records.

  python3 scripts/eval/ref-topup-5873/select.py <private dir> <results dir>
Writes <private>/records.jsonl (harness input, reference texts included: stays private) and
<results>/alignment.json (every book tried, in draw order, with the outcome; no reference text).
"""
import json, glob, os, sys, re
P, RES = sys.argv[1], sys.argv[2]
RULE = json.load(open(os.path.join(os.path.dirname(__file__), 'rule.json')))
# Quotas: the registered top-up, with the two deviations recorded before any arm (Pali: every book that aligns; hidden draw for Persian and Pali, 3 each).
# Hebrew 15 + 1: Lite refused one Hebrew page (Psalm 72, RECITATION, 4 of 4 requests), so it has no Flash - Lite pair; the next aligned
# book in draw order replaces it (decided before any page was judged).
QUOTA = {'Persian': 18, 'Hebrew': 16, 'Arabic': 10, 'Pali': 99, 'Chinese': 6, 'Sanskrit': 2, 'Persian-hidden': 3, 'Pali-hidden': 3}
TRACK = {'Persian': 'T4-topup', 'Hebrew': 'T4-topup', 'Aramaic': 'T4-topup', 'Arabic': 'T4-topup', 'Pali': 'T5-topup', 'Sanskrit': 'T5-topup', 'Chinese': 'T5-topup'}
STYLE = {'literal', 'free', 'early-modern'}
records, log, problems = [], {}, []
for draw in QUOTA:
    base = draw.replace('-hidden', '')
    order_of = {}
    for f in glob.glob(f'{P}/cands/{draw}/*.json'):
        d = json.load(open(f)); order_of[d['book_id']] = (d['order'], d.get('title'), d.get('eligible_pages'))
    rows = []
    for bid, (order, title, elig) in sorted(order_of.items(), key=lambda kv: kv[1][0]):
        f = f'{P}/refs/{draw}/{bid}.json'
        r = json.load(open(f)) if os.path.exists(f) else None
        rows.append((order, bid, title, elig, r))
    taken = 0; log[draw] = []
    for order, bid, title, elig, r in rows:
        title = ' '.join((title or '').split())
        if r is None:
            log[draw].append({'order': order, 'book_id': bid, 'title': title, 'outcome': 'not reached (the quota was met or the agent was told to stop earlier in the order)'}); continue
        if r.get('failed') or 'reference_text' not in r:
            log[draw].append({'order': order, 'book_id': bid, 'title': title, 'outcome': 'not aligned', 'reason': r.get('reason'), 'skipped': r.get('skipped', [])}); continue
        m = r['reference_meta']
        lang = r.get('lang')
        entry = {'order': order, 'book_id': bid, 'title': title, 'page_number': r['page_number'], 'page_lang': lang, 'candidate_index': r.get('candidate_index'),
                 'translator': m.get('translator'), 'ref_year': m.get('year'), 'licence': m.get('licence'), 'private': m.get('private'), 'style': m.get('style'),
                 'canonical': m.get('canonical'), 'located': m.get('located'), 'coverage_note': m.get('coverage_note'), 'align_confidence': r.get('align_confidence'), 'skipped': r.get('skipped', [])}
        # The quota counts pages in the DRAW language (an Aramaic page in a Hebrew-labelled book is reported, not counted).
        if lang != base:
            entry['outcome'] = f'aligned, page language {lang}: outside the {base} quota, not used'; log[draw].append(entry); continue
        if taken >= QUOTA[draw]:
            entry['outcome'] = 'aligned, beyond the registered quota: not used'; log[draw].append(entry); continue
        taken += 1; entry['outcome'] = 'used'; log[draw].append(entry)
        if m.get('style') not in STYLE: problems.append((draw, order, 'style', m.get('style')))
        if not isinstance(m.get('private'), bool): problems.append((draw, order, 'private', m.get('private')))
        for k in ('title', 'translator', 'licence'):
            if not m.get(k): problems.append((draw, order, 'missing ' + k))
        if m.get('private') and m.get('licence') != 'in-copyright': problems.append((draw, order, 'private licence', m.get('licence')))
        records.append({'track': TRACK[lang], 'lang': lang, 'book_id': bid, 'page_number': int(r['page_number']), 'reference_text': r['reference_text'],
                        'reference_meta': {**m, 'year': m.get('year')}, 'book_title': title, 'draw': draw, 'draw_order': order, 'hidden_book': draw.endswith('-hidden'),
                        'period': r.get('period'), 'genre': r.get('genre'), 'famous': bool(r.get('famous')), 'page_content': r.get('page_content'),
                        'align': {'candidate_index': r.get('candidate_index'), 'confidence': r.get('align_confidence'), 'note': r.get('align_note'), 'skipped': r.get('skipped', [])},
                        'candidates': []})
    print(draw, 'books with a file', sum(1 for x in rows if x[4] is not None), 'of', len(rows), '| used', taken)
with open(f'{P}/records.jsonl', 'w') as f:
    for r in records: f.write(json.dumps(r, ensure_ascii=False) + '\n')
json.dump(log, open(f'{RES}/alignment.json', 'w'), ensure_ascii=False, indent=1)
print(len(records), 'records;', 'private', sum(1 for r in records if r['reference_meta']['private']), '; problems', problems)
from collections import Counter
print(Counter(r['lang'] for r in records), Counter((r['lang'], bool(r['reference_meta'].get('canonical'))) for r in records))
print('ref chars max', max(len(r['reference_text']) for r in records), 'min', min(len(r['reference_text']) for r in records))
