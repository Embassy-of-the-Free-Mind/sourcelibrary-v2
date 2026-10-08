# PRIOR ART: scripts/eval/translation-ab-5606/assemble-sample.py builds the #5606 sample.json; scripts/eval/
# translation-vs-reference/from-ab-sample.mjs converts it into harness records (used first, see README). This adds
# what #5695 T5 needs on top: the 11 non-canonical pages cut for T5, per-page canonical / genre / reference-style
# labels, and the licence block Addendum A asks for (scan, our text, reference, publishable).
"""assemble.py --served <rec-served.jsonl> --refs <private refs dir> --books <books.json> --out <records.jsonl>
The T5 reference set: the #5606 pages (Pali p.306 re-cut) plus the T5 additions, one record per page."""
import argparse, json, os, re, glob

ap = argparse.ArgumentParser()
ap.add_argument('--served'); ap.add_argument('--refs'); ap.add_argument('--books'); ap.add_argument('--add'); ap.add_argument('--out')
a = ap.parse_args()
books = json.load(open(a.books))

# canonical = scripture or a classic whose standard English is reproduced everywhere online (recitation risk, #5523)
NONCANON = {  # book_id -> genre, for pages NOT canonical
  '69dea23c4d19ec2e9ba75f5e': 'kavya', '69e3ff61b142e5dd9d6b0095': 'kavya', '69e72c8ca409200ea79f4dd6': 'story literature',
  '69e7490585f786e884a4d1aa': 'kavya', '69e7490d85f786e884a4d40e': 'kavya', '69ea3e63300d991d0f1d3186': 'sastra (polity)',
  '6a06b0aff12363da8cfdc945': 'sastra (law, commentary)', '6a0e54e98831ddc9459ad225': 'yoga manual + commentary',
  '6a3067d0c4fd77fb5b9f8378': 'buddhist philosophy (commentary)', '6a312d8867a0ec73f1bc373f': 'philosophy (sutra + vrtti)',
  '69e8b2642ff2a8dc09e778a1': 'philosophy (Mozi)', '69e8b26b2ff2a8dc09e77afc': 'philosophy (Xunzi)',
  '69e80662fdad300064d9ed7c': 'medicine', '69e80670fdad300064d9ef9d': 'medicine', '69907971b621b177c1af74df': 'astronomy + commentary',
  '69906a861cf6ed5fbc8f5d21': 'mathematics + commentary', '69e7267ca409200ea79ef51d': 'fable (didactic)', '69e72674a409200ea79ef3ae': 'fable (didactic)',
  '69de10185cedf736edb851e4': 'sastra (kama) + commentary', '69e7268ca409200ea79ef73b': 'fiction (tales)', '69e72698a409200ea79ef8c3': 'fiction (tales)',
  '69e792f880b52390feb17389': 'fiction (novel)', '69e792fd80b52390feb1770f': 'fiction (novel) + commentary',
}
CANON_GENRE = {'Pali': 'pali canon (sutta/vinaya)'}
def canon_genre(r):
    t = (r['reference_meta']['title'] + ' ' + r['reference_meta']['translator']).lower()
    if r['lang'] == 'Pali': return 'pali canon (sutta/vinaya)'
    if re.search(r'veda', t): return 'veda'
    if re.search(r'brahma sutra|yoga-s|manu|mānava', t): return 'sastra / sutra + commentary'
    if re.search(r'gita|gītā', t): return 'gita'
    if re.search(r'mahabharata|mahābh|rāmāya', t): return 'epic'
    if re.search(r'lotus|蓮華|金剛|diamond|起信|awakening|gemmell|soothill|richard|suzuki', t): return 'buddhist sutra / sastra'
    if re.search(r'tao|莊子|zhuangzi|liezi|列子', t): return 'daoist classic + commentary'
    if re.search(r'論語|analects|詩經|she king|legge', t): return 'confucian classic + commentary'
    return 'other canonical'

LITERAL = {'Bhikkhu Sujato', 'Bhikkhu Brahmali', 'George Thibaut', 'James Haughton Woods', 'William Dwight Whitney', 'H. H. Wilson',
           'G. Bühler', 'K. T. Telang', 'R. Shamasastry', 'V. N. Mandlik', 'Pancham Sinh', 'Th. Stcherbatsky', 'H. Kern', 'James Legge',
           'Y. P. Mei', 'Homer H. Dubs', 'Daisetz Teitaro Suzuki', 'W. E. Soothill', 'William Gemmell', 'C. H. Tawney', 'Kisari Mohan Ganguli',
           'Manmatha Nath Dutt'}
FREE = {'Edwin Arnold', 'Ralph T. H. Griffith', 'Arthur W. Ryder', 'Lionel Giles', 'Monier Williams', 'Samuel Beal'}
def style_of(tr):
    if tr.startswith('Richard Garbe'): return 'literal'
    if tr.startswith('Timothy Richard'): return 'free'
    if tr in LITERAL: return 'literal'
    if tr in FREE: return 'free'
    raise SystemExit(f'no style for translator {tr!r}')
def year_of(m):
    for s in (m.get('licence') or '', m.get('coverage_note') or ''):
        y = re.findall(r'(1[789]\d\d|20[0-2]\d)', s)
        if y: return int(y[0])
    return None
def period_of(pub):
    y = re.search(r'-?\d{3,4}', str(pub or ''))
    if not y: return 'unknown'
    y = int(y.group(0))
    return '<1500' if y < 1500 else '1500-1799' if y < 1800 else '1800-1899' if y < 1900 else '1900-1949' if y < 1950 else '1950+'

def finish(r):
    m = r['reference_meta']
    m['canonical'] = r['book_id'] not in NONCANON
    m['genre'] = NONCANON.get(r['book_id']) or canon_genre(r)
    m['publishable'] = not m['private']
    b = books.get(f"{r['book_id']}_{r['page_number']:05d}", {})
    r['edition'] = {'title': b.get('title'), 'published': b.get('published'), 'period': period_of(b.get('published')), 'provider': b.get('provider')}
    r['licences'] = {
        'scan': b.get('image_license') or 'unrecorded',
        'our_text': 'CC BY-SA 4.0 (Source Library translations; OCR transcription likewise)',
        'reference': m['licence'],
        'reference_publishable': m['publishable'],
    }
    return r

out = []
for l in open(a.served):
    r = json.loads(l); m = r['reference_meta']
    m['style'] = style_of(m['translator'])
    m['year'] = m.get('year') or year_of(m)
    out.append(finish(r))

# T5 additions (cut 2026-10-03 under REF-AGENT-BRIEF.md; all pre-1931 = US public domain)
EXCLUDE = {'69e8b2562ff2a8dc09e774b0': 'the page prints Legge\'s English beside the Chinese (bilingual page; #5606 excluded these)'}
cands = {}
for f in glob.glob(os.path.join(a.refs, '..', 'cands', '*', '*.json')):
    for c in json.load(open(f)): cands[(c['book_id'], c['page_number'])] = c
excluded = []
for f in sorted(glob.glob(os.path.join(a.refs, '*', '*.json'))):
    d = json.load(open(f)); lang = os.path.basename(os.path.dirname(f))
    if d.get('unlocated'): excluded.append({'book_id': d['book_id'], 'why': 'unlocated: ' + (d.get('reason') or '')[:200]}); continue
    if d['book_id'] in EXCLUDE: excluded.append({'book_id': d['book_id'], 'page_number': d['page_number'], 'why': EXCLUDE[d['book_id']]}); continue
    c = cands[(d['book_id'], d['page_number'])]
    r = {'track': 'T5', 'lang': lang, 'book_id': d['book_id'], 'page_number': d['page_number'], 'source_text': c['ocr'],
         'reference_text': d['reference'],
         'reference_meta': {'title': d.get('work') or c['title'], 'translator': d['translator'], 'year': d['year'], 'licence': d['reference_licence'],
                            'private': False, 'style': d['style'], 'style_note': d.get('style_note'), 'located': d['located'],
                            'url': d['reference_url'], 'coverage_note': d.get('coverage_note'), 'page_content': d.get('page_content'),
                            'confidence': d.get('confidence'), 'origin': 'xlref-t5 additions 2026-10-03', 'source': d.get('reference_source')},
         'candidates': []}
    out.append(finish(r))
with open(a.out, 'w') as fo:
    for r in out: fo.write(json.dumps(r, ensure_ascii=False) + '\n')
json.dump(excluded, open(a.out + '.excluded.json', 'w'), indent=1, ensure_ascii=False)
from collections import Counter
print(len(out), 'records;', Counter((r['lang'], r['reference_meta']['canonical']) for r in out), '; excluded', len(excluded))
