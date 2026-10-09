# PRIOR ART: the ocr-bakeoff-5660c job matched TCP to Latin bim_ books by title only (its non-test matches were
# mostly wrong works); this matches every bim_ book by author surname + year (+-1) + title-token overlap against TCP.csv,
# as CANDIDATES only - tcp_pages.py verifies each against our stored reads (#5730). Run from /root/kraken-ft-5730.
import csv, json, re, unicodedata, collections
def toks(s):
    s = unicodedata.normalize('NFD', (s or '').lower()).replace('ſ','s')
    s = ''.join(c for c in s if not unicodedata.combining(c)).replace('v','u').replace('j','i')
    return [t for t in re.findall(r'[a-z]+', s) if len(t) > 2]
STOP = set('the and que cum per pro est quae qui quod non sed eius atque etiam for that with this which are was his her their from into unto other ouer vpon'.split())
def tset(s): return set(t for t in toks(s) if t not in STOP)
books = json.load(open('bim-books.json'))
tcp = list(csv.DictReader(open('/root/ocr-bakeoff-5660c/tcp/TCP.csv', encoding='utf-8')))
by_year = collections.defaultdict(list)
for r in tcp:
    m = re.search(r'\d{4}', r['Date'] or '')
    if m: by_year[int(m.group())].append(r)
out = []
for b in books:
    y = re.search(r'\d{4}', b['ia'].split('_')[-1] or '') or re.search(r'\d{4}', str(b.get('published') or ''))
    if not y: continue
    y = int(y.group())
    sur = toks((b.get('creator') or '').split(',')[0])
    if not sur:
        m = re.search(r'_([a-z-]+)_\d{4}$', b['ia']); sur = toks(m.group(1).split('-')[0]) if m else []
    bt = tset(b['title'])
    best = None
    for yy in (y-1, y, y+1):
        for r in by_year.get(yy, []):
            at = toks(r['Author'])
            if sur and sur[0] not in at[:3]: continue
            tt = tset(r['Title'])
            if not bt or not tt: continue
            j = len(bt & tt) / min(len(bt), len(tt))
            sc = j + (0.2 if sur else 0) + (0.05 if yy == y else 0)
            if best is None or sc > best[0]: best = (sc, r, j)
    if best and best[2] >= 0.3:
        out.append({'book': b['id'], 'language': b['language'], 'year': y, 'pages': b['pages'], 'title': b['title'][:80], 'tcp': best[1]['TCP'], 'tcp_title': best[1]['Title'][:80], 'status': best[1]['Status'], 'tcp_pages': best[1]['Pages'], 'j': round(best[2], 2)})
json.dump(out, open('tcp-cands.json', 'w'), indent=1, ensure_ascii=False)
c = collections.Counter((x['language'], x['year']//100*100) for x in out)
print(len(out), c.most_common())
