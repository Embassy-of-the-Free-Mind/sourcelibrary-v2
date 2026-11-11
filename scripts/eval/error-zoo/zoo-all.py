#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/zoo.py — builds zoo.json from ONE source (the spare-audit review files on disk)
and counts only findings that already carry a taxonomy code. This builds the same zoo.json (same schema, so
head.html + tail.html render it unchanged) from the all-source label table (labels.jsonl) plus the classes the
classify-unclassed pass assigned, and records in meta where every count came from.

zoo-all.py <dir>   reads <dir>/labels.jsonl, <dir>/classes/classes.jsonl (optional), <dir>/pages.jsonl (titles),
                   writes <dir>/zoo.json. Page: cat head.html zoo.json tail.html > error-zoo.html
"""
import json, re, os, sys, random, collections as C
random.seed(7)
DIR = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
TAX = open(os.path.join(HERE, '../../../.claude/docs/page-error-taxonomy.md')).read()
defs = {}
for m in re.finditer(r'^### ([IOTDE]\d+) · (.+?)(?: — (.*?))?$\n(.*?)(?=^### |\Z)', TAX, re.M | re.S):
    code, name, status, body = m.groups()
    sees = re.search(r'\*\*Reader sees:\*\*\s*(.+)', body)
    defs[code] = dict(name=name.strip(), status=(status or '').strip(), sees=(sees.group(1).strip()[:420] if sees else ''))
# class -> default kind, from review-vocabulary.mjs
VOC = open(os.path.join(HERE, '../../lib/review-vocabulary.mjs')).read()
kind = dict(re.findall(r"\b([IOTDE]\d{1,2}):\s*'([a-z_]+)'", VOC))
CODE = re.compile(r'\b([IOTDE]\d{1,2})\b')

rows = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
titles = {}
if os.path.exists(f'{DIR}/pages.jsonl'):
    pass  # titles are not in pages.jsonl; the label row's book_id is enough for the URL
assigned = {}
if os.path.exists(f'{DIR}/classes/classes.jsonl'):
    for l in open(f'{DIR}/classes/classes.jsonl'):
        j = json.loads(l)
        if j.get('cls'): assigned[j['id']] = (j['cls'], j['how'])

SRC_LABEL = {'book_checks': 'book_checks (19 QA methods)', 'spare_audit': 'weekly audit (Opus, spare lane)', 'lane_judge': 'lane judge, served arm', 'correction': 'applied corrections'}
spec = C.defaultdict(list); cnt = C.defaultdict(C.Counter); pages = C.defaultdict(set); langs = C.defaultdict(C.Counter); bysrc = C.defaultdict(C.Counter)
total = unclassed = 0; how = C.Counter(); page_keys = set(); serious_pages = set()
for ri, r in enumerate(rows):
    if r.get('positive_only'): continue
    pk = (r['page_id'] or f"{r['book_id']}|{r['page_number']}"); page_keys.add(pk)
    if r['serious']: serious_pages.add(pk)
    for ei, e in enumerate(r['errors']):
        total += 1
        m = CODE.search(str(e.get('class') or ''))
        if m: c = m.group(1); how['reader'] += 1
        elif f'{ri}:{ei}' in assigned: c, h = assigned[f'{ri}:{ei}']; how[h] += 1
        else: unclassed += 1; continue
        sev = e.get('severity') or 'serious'
        cnt[c][sev] += 1; pages[c].add(pk); langs[c][r.get('language') or '?'] += 1; bysrc[c][r['source']] += 1
        spec[c].append(dict(sev=sev, lang=r.get('language') or '', title=r['book_id'], year='', page=int(r['page_number']),
            url=f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}", ocr_model=r.get('ocr_model_at_check') or '',
            problem=(e.get('problem') or '')[:400], bad=(e.get('bad') or '')[:240], good=(e.get('good') or '')[:240],
            badlabel='OCR' if e.get('stage') == 'ocr' else 'English' if e.get('stage') == 'translation' else '', goodlabel='On the page' if e.get('stage') == 'ocr' else 'Source' if e.get('stage') == 'translation' else '',
            source=r['source'], classed_by='reader' if m else assigned[f'{ri}:{ei}'][1]))
order = {'serious': 0, 'moderate': 1, 'minor': 2}
out = []
for c in sorted(set(defs) | set(cnt), key=lambda k: ('IOTDE'.index(k[0]), int(k[1:]))):
    S = spec[c]; random.shuffle(S)
    # specimens: reader-classed and quoted first, serious first, spread over sources and languages
    S.sort(key=lambda s: (0 if s['classed_by'] == 'reader' else 1, order.get(s['sev'], 3), 0 if (s['bad'] or s['good']) else 1))
    picked = []; seenl = C.Counter(); seenb = set(); seens = C.Counter()
    for s in S:
        if len(picked) >= 8: break
        if s['url'] in seenb or seenl[s['lang']] >= 3 or seens[s['source']] >= 5 or len(s['problem']) < 25: continue
        picked.append(s); seenl[s['lang']] += 1; seenb.add(s['url']); seens[s['source']] += 1
    d = defs.get(c, {'name': '(not in taxonomy doc)', 'status': '', 'sees': ''})
    out.append(dict(code=c, lane=c[0], kind=kind.get(c, ''), name=d['name'], status=d['status'], sees=d['sees'], n=sum(cnt[c].values()), sev=dict(cnt[c]), pages=len(pages[c]),
                    langs=langs[c].most_common(4), sources=dict(bysrc[c]), specimens=picked))
meta = dict(total=total, unclassed=unclassed, pages=len(page_keys), serious_pages=len(serious_pages), runs=len({r['run_id'] for r in rows if r.get('run_id')}),
            classed_by=dict(how), sources={SRC_LABEL.get(s, s): n for s, n in C.Counter(r['source'] for r in rows if not r.get('positive_only')).items()}, built='2026-11-11')
json.dump(dict(meta=meta, classes=out), open(f'{DIR}/zoo.json', 'w'), ensure_ascii=False)
print(meta)
print(sum(1 for o in out if o['n']), 'classes seen;', sum(len(o['specimens']) for o in out), 'specimens;', len(json.dumps(out, ensure_ascii=False)) // 1024, 'KB')
for o in sorted(out, key=lambda o: -o['n'])[:15]: print(o['code'], o['n'], o['sev'], o['pages'], o['name'][:50])
