#!/usr/bin/env python3
"""
PRIOR ART: scripts/eval/error-zoo/zoo-all.py — per-class counts and specimens for the zoo cards; train.py — the
out-of-book page scores (preds.jsonl). This computes the CROSS-TABS the cards cannot show: year x language, class x
severity detectability, class x circumstance (OCR engine, script, language). Read-only over the files in <dir>.

zoo-stats.py <dir>   reads labels.jsonl, pages.jsonl, preds.jsonl, classes/classes.jsonl; writes <dir>/zoo-stats.json

Definitions (stated on the page too):
  page       one reviewed page in one store (a page read by two stores counts once per store)
  error rate findings per reviewed page;  serious rate = share of reviewed pages with >=1 serious finding
  severity   mean of finding severities, minor=1 moderate=2 serious=3 (book_checks only records serious findings)
  caught     the page's out-of-book risk score is in the top 30% of all scored pages
"""
import json, re, sys, collections as C

DIR = sys.argv[1]
CODE = re.compile(r'\b([IOTDE]\d{1,2})\b')
import hashlib
def fid(r, e):
    """Stable id of one finding, by content: survives a regather that reorders labels.jsonl."""
    k = '|'.join(str(x) for x in (r.get('source'), r.get('run_id'), r.get('page_id'), r.get('page_number'), e.get('stage'), e.get('class'), e.get('problem'), e.get('bad')))
    return hashlib.sha1(k.encode()).hexdigest()[:16]
SEVW = {'minor': 1, 'moderate': 2, 'serious': 3}
rows = [json.loads(l) for l in open(f'{DIR}/labels.jsonl')]
pages = {}
for l in open(f'{DIR}/pages.jsonl'):
    p = json.loads(l); pages[p['page_id']] = p
assigned = {}
for l in open(f'{DIR}/classes/classes.jsonl'):
    j = json.loads(l)
    if j.get('cls'): assigned[j['id']] = j['cls']
score = C.defaultdict(list)
for l in open(f'{DIR}/preds.jsonl'):
    j = json.loads(l); score[j['page_id']].append(j['score'])
score = {k: sum(v) / len(v) for k, v in score.items()}
vals = sorted(score.values()); thr = vals[int(len(vals) * 0.7)] if vals else 1

def year_of(b):
    for v in ((b or {}).get('year'), (b or {}).get('published'), (b or {}).get('est_year')):
        m = re.search(r'1[0-9]{3}|20[0-2][0-9]', str(v or ''))
        if m: return int(m.group())
    return None
BINS = [(0, 1450, 'before 1450'), (1450, 1500, '1450–99'), (1500, 1550, '1500–49'), (1550, 1600, '1550–99'), (1600, 1650, '1600–49'), (1650, 1700, '1650–99'),
        (1700, 1750, '1700–49'), (1750, 1800, '1750–99'), (1800, 1850, '1800–49'), (1850, 3000, '1850 on')]
def ybin(y):
    if y is None: return None
    for a, b, lab in BINS:
        if a <= y < b: return lab
LANGFOLD = {'Ancient Greek': 'Greek', 'Classical Chinese': 'Chinese', 'Literary Chinese': 'Chinese', 'Middle French': 'French', 'Early Modern German': 'German', 'Middle High German': 'German'}
def lang_of(r, p):
    L = (p or {}).get('book', {}).get('language') or r.get('language') or '?'
    L = re.split(r'[,;/(]| and ', L)[0].strip() or '?'
    return LANGFOLD.get(L, L)

def fam(m):
    m = (m or '').lower()
    if not m: return 'unknown'
    if 'lite' in m: return 'Gemini Flash-Lite'
    if 'flash' in m: return 'Gemini Flash'
    if 'pro' in m and 'gemini' in m: return 'Gemini Pro'
    if 'opus' in m or 'claude' in m: return 'Claude'
    if 'paddle' in m: return 'PaddleOCR'
    if 'yigdzin' in m or 'bdrc' in m: return 'BDRC yigdzin'
    if 'source' in m or 'esukhia' in m: return 'e-text'
    return 'other'

recs = []
for ri, r in enumerate(rows):
    if r.get('positive_only') or r.get('stale'): continue
    p = pages.get(r['page_id'])
    errs = []
    for ei, e in enumerate(r['errors']):
        m = CODE.search(str(e.get('class') or ''))
        c = m.group(1) if m else assigned.get(fid(r, e))
        errs.append((c, e.get('severity') or 'serious'))
    b = (p or {}).get('book') or {}
    recs.append(dict(src=r['source'], uniform=(r['source'] == 'spare_audit' and r.get('selection') == 'random' and r.get('exposure') == 'served'),
                     lang=lang_of(r, p), yb=ybin(year_of(b) or year_of({'published': r.get('published')})), serious=bool(r['serious']), errs=errs,
                     caught=(score.get(r['page_id'], -1) >= thr) if r['page_id'] in score else None,
                     ocr=fam((p or {}).get('ocr_model') or r.get('ocr_model_at_check')), script=((p or {}).get('script_type') or 'unknown'), pid=r['page_id']))

def heat(sel):
    cells = C.defaultdict(lambda: dict(pages=0, serious=0, n=0, sev=0.0, by={'minor': 0, 'moderate': 0, 'serious': 0}))
    lc = C.Counter(x['lang'] for x in sel if x['yb'])
    langs = [l for l, n in lc.most_common() if n >= 40 and l != '?'][:14]
    for x in sel:
        if x['lang'] not in langs or not x['yb']: continue
        c = cells[(x['lang'], x['yb'])]; c['pages'] += 1; c['serious'] += x['serious']
        for _, s in x['errs']: c['n'] += 1; c['sev'] += SEVW.get(s, 3); c['by'][s if s in SEVW else 'serious'] += 1
    out = []
    for (L, yb), c in cells.items():
        out.append(dict(lang=L, bin=yb, pages=c['pages'], serious=c['serious'], findings=c['n'], by=c['by'], mean_sev=round(c['sev'] / c['n'], 3) if c['n'] else None))
    return dict(langs=langs, bins=[b[2] for b in BINS], cells=out)

stats = dict(threshold_note='caught = page score in the top 30% of scored pages', heat_all=heat(recs), heat_uniform=heat([x for x in recs if x['uniform']]))

# detectability: class x severity, share of pages carrying it whose score is in the top 30%
det = C.defaultdict(lambda: C.defaultdict(lambda: [0, 0]))
for x in recs:
    if x['caught'] is None: continue
    seen = set()
    for c, s in x['errs']:
        if not c or (c, s) in seen: continue
        seen.add((c, s)); d = det[c][s if s in SEVW else 'serious']; d[0] += 1; d[1] += x['caught']
clean = [x for x in recs if x['caught'] is not None and not x['errs']]
stats['clean_flag_rate'] = round(sum(x['caught'] for x in clean) / max(1, len(clean)), 3)
stats['clean_n'] = len(clean)
stats['detect'] = [dict(code=c, sev={s: dict(n=v[0], caught=v[1]) for s, v in d.items()}) for c, d in det.items()]

# circumstance: serious pages with class c / reviewed pages, by OCR engine family and by script
def circ(key):
    base = C.Counter(x[key] for x in recs)
    hit = C.defaultdict(C.Counter)
    for x in recs:
        for c in {c for c, s in x['errs'] if c and s == 'serious'}: hit[c][x[key]] += 1
    return dict(base=dict(base), hit={c: dict(v) for c, v in hit.items()})
stats['by_ocr'] = circ('ocr'); stats['by_script'] = circ('script'); stats['by_lang'] = circ('lang')
stats['n_pages'] = len(recs); stats['n_uniform'] = sum(x['uniform'] for x in recs)
U = [x for x in recs if x['uniform']]
stats['uniform_serious'] = sum(x['serious'] for x in U)
stats['uniform_books'] = len({pages.get(x['pid'], {}).get('book_id') for x in U})
stats['uniform_any'] = sum(1 for x in U if x['errs'])
json.dump(stats, open(f'{DIR}/zoo-stats.json', 'w'), ensure_ascii=False)
print('pages', len(recs), 'uniform', stats['n_uniform'], 'heat langs', stats['heat_all']['langs'], 'clean flagged', stats['clean_flag_rate'])
print('ocr base', stats['by_ocr']['base']); print('script base', stats['by_script']['base'])
for c in ('O6', 'O1', 'T8', 'T7', 'I1', 'O5', 'T10', 'D1', 'O8'):
    d = next((x for x in stats['detect'] if x['code'] == c), None)
    if d: print(c, {s: f"{v['caught']}/{v['n']}" for s, v in d['sev'].items()})
