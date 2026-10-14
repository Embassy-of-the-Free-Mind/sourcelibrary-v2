#!/usr/bin/env python3
"""
Alias candidates for each aliveness-ontology node (#6720), from the library's own term <-> gloss harvest (#4695).

PRIOR ART: .claude/docs/concept-aliases/finalize-2026-09-11.mjs and src/data/concept-aliases.json — the 62 curated
concepts and the judging they went through. This does not rebuild them: a node that names a curated `concept` takes
its variants/equivalents from concept-aliases.json as already judged; every other node gets a candidate list in the
same shape the JUDGE-RUBRIC expects (seed_forms, seed_glosses, candidates with evidence), to be judged by that rubric.

READ-ONLY over /mnt/HC_Volume_105839809/page-terms-bridges.sqlite (tg, surf) and page-terms-partial.sqlite (raw, for
evidence rows). Writes OUT/term-candidates.jsonl.
  python3 terms.py [OUT]
"""
import json, os, re, sqlite3, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('JOB_SCRATCH', '/tmp'), 'ontology')
VOL = '/mnt/HC_Volume_105839809'
br = sqlite3.connect(f'file:{VOL}/page-terms-bridges.sqlite?mode=ro', uri=True)
raw = sqlite3.connect(f'file:{VOL}/page-terms-partial.sqlite?mode=ro', uri=True)
nodes = json.load(open(os.path.join(HERE, 'seed-nodes.json')))['nodes']
curated = {c['concept']: c for c in json.load(open(os.path.join(ROOT, 'src', 'data', 'concept-aliases.json')))['concepts']}


def keys(term):
    """term_key candidates: the harvest lowercases; Latin-script forms are also tried without diacritics."""
    k = unicodedata.normalize('NFC', term).strip().lower()
    out = {k}
    if not re.search(r'[^\u0000-ɏḀ-ỿ\s\'’-]', k):
        out.add(''.join(ch for ch in unicodedata.normalize('NFD', k) if unicodedata.category(ch) != 'Mn'))
    return out


def surf(k):
    rows = br.execute('SELECT term, kind, n, books, pages FROM surf WHERE term_key=?', (k,)).fetchall()
    if not rows:
        return None
    return {'term_key': k, 'surfaces': sorted({r[0] for r in rows})[:4], 'tagged_pages': max(r[4] for r in rows), 'books': max(r[3] for r in rows),
            'by_kind': {r[1]: r[2] for r in rows}}


def evidence(k, n=3):
    rows = raw.execute('SELECT book_id, page_number, kind, gloss, context FROM raw WHERE term_key=? LIMIT 40', (k,)).fetchall()
    seen, out = set(), []
    for b, p, kind, g, ctx in rows:
        if b in seen:
            continue
        seen.add(b)
        out.append({'book_id': b, 'page': p, 'kind': kind, 'gloss': g, 'context': (ctx or '')[-160:]})
        if len(out) >= n:
            break
    return out


# A gloss shared by this many distinct terms is a generic English word (spirit, soul, heat): it groups everything.
GENERIC_FANOUT = 400
res = []
for nd in nodes:
    seed_keys = set()
    for term, _lang in nd['forms']:
        seed_keys |= keys(term)
    for p in nd['search']:
        seed_keys |= keys(p)
    seed_forms = [s for s in (surf(k) for k in sorted(seed_keys)) if s]
    present = {s['term_key'] for s in seed_forms}
    glosses = {}
    for k in present:
        for gk, g, n in br.execute('SELECT gloss_key, gloss, sum(n) FROM tg WHERE term_key=? GROUP BY gloss_key ORDER BY 3 DESC LIMIT 8', (k,)):
            if n >= 2 and gk not in glosses:
                glosses[gk] = {'gloss': g, 'n': n}
    cands = {}
    for gk in glosses:
        fan = br.execute('SELECT count(DISTINCT term_key) FROM tg WHERE gloss_key=?', (gk,)).fetchone()[0]
        if fan > GENERIC_FANOUT:
            glosses[gk]['generic'] = True
            continue
        for tk, t, n, b in br.execute('SELECT term_key, term, sum(n), sum(books) FROM tg WHERE gloss_key=? GROUP BY term_key ORDER BY 3 DESC LIMIT 40', (gk,)):
            if tk in present or n < 2:
                continue
            c = cands.setdefault(tk, {'term_key': tk, 'term': t, 'n': 0, 'books': 0, 'via_glosses': []})
            c['n'] += n
            c['books'] += b
            c['via_glosses'].append(glosses[gk]['gloss'])
    top = sorted(cands.values(), key=lambda c: -c['n'])[:22]
    for c in top:
        c['evidence'] = evidence(c['term_key'])
        r = br.execute('SELECT rendering, n FROM render WHERE term_key=? ORDER BY n DESC LIMIT 4', (c['term_key'],)).fetchall()
        c['renderings'] = [x[0] for x in r]
    row = {'node': nd['id'], 'label': nd['label'], 'gloss': nd['gloss'], 'seed_forms': seed_forms,
           'seed_glosses': sorted(({'gloss': v['gloss'], 'n': v['n'], **({'generic': True} if v.get('generic') else {})} for v in glosses.values()), key=lambda x: -x['n'])[:12],
           'candidates': top}
    if nd.get('concept') in curated:
        cc = curated[nd['concept']]
        row['curated'] = {'concept': cc['concept'], 'variants': [r['term'] for r in cc['variants']], 'equivalents': [r['term'] for r in cc['equivalents']],
                          'related': [r['term'] for r in cc['related']]}
    res.append(row)
    print(f"{nd['id']:<22} seeds {len(seed_forms):>2} glosses {len(glosses):>2} cands {len(top):>2}{'  (curated)' if 'curated' in row else ''}")

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'term-candidates.jsonl'), 'w') as f:
    for r in res:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')
