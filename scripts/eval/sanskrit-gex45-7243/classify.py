#!/usr/bin/env python3
# PRIOR ART: none — the by-eye classification of the 105 drawn candidates (contact sheets, Opus, 2026-10-24), kept as code so the strata are reproducible.
import json
d = json.load(open('candidates.json')); P = d['pages']
# by-eye classification of all 105 candidates (contact sheets, 2026-10-24, Opus): index -> (script, kind, lang, layout, hard)
OBS = {}
def o(idx, script, kind='print', lang='sa', layout='single', hard=None, canonical=False, cols=1, note=''):
    OBS[idx] = dict(script=script, kind=kind, lang=lang, layout=layout, hard=hard, canonical=canonical, cols=cols, note=note)
for i in [0,3,6,7,12,13,14,18,20,23,25,27,30,31,33,36,37,38,39,41,42,43,44,46,55,58,90,100]: o(i, 'sharada', 'manuscript')
o(45, 'sharada', 'manuscript', layout='table', note='almanac table')
for i, s, l in [(2,'latin','en'),(4,'arabic','ur'),(10,'arabic','ur'),(11,'kannada','kn'),(19,'latin','it'),(22,'telugu','te'),(28,'arabic','ur'),(52,'gurmukhi','pa'),(66,'latin','en'),(69,'latin','en'),(73,'latin','en'),(71,'latin','en')]: o(i, s, 'print', lang=l)
o(15, 'latin', 'mixed', lang='en', note='catalogue card'); o(51, 'devanagari', 'print', lang='hi', note='photograph, 3-word caption')
for i in [97,102,103]: o(i, 'devanagari', 'manuscript', note='near-blank leaf')
o(50, 'unsure', 'manuscript', note='Sharada Tilak; script not settled at thumbnail size')
# Devanagari pages
o(1,'devanagari'); o(5,'devanagari', note='1966 edition, apparatus'); o(8,'devanagari', hard='commentary small type')
o(9,'devanagari', lang='sa+hi', hard='Hindi commentary, poor scan'); o(16,'devanagari', lang='mr')
o(17,'devanagari', hard='Vedic accents, pada text', canonical=True); o(21,'devanagari'); o(24,'devanagari', note='1892 Kielhorn')
o(26,'devanagari', hard='commentary small type'); o(29,'devanagari','manuscript', layout='spread', hard='two-leaf spread, small, red ink', canonical=True, cols=2, note='Vishnu Sahasranama')
o(32,'devanagari'); o(34,'devanagari','manuscript', note='red ink'); o(35,'devanagari', layout='index', hard='numeric index, two columns', cols=2)
o(40,'devanagari', canonical=True, note='Gita with Sankara bhasya'); o(47,'devanagari', lang='hi', layout='two-column', hard='two columns, curved page', cols=2)
o(48,'devanagari'); o(49,'devanagari', lang='hi'); o(53,'devanagari','manuscript', lang='hi'); o(54,'devanagari','manuscript', hard='stained, interlinear glosses')
o(56,'devanagari'); o(57,'devanagari', hard='dense commentary, small type', canonical=True, note='Rigveda 1849'); o(59,'devanagari', lang='hi+sa')
for i in [60,62,64,68,72,80]: o(i,'devanagari', note='BORI Mahabharata, digital type', canonical=True)
o(61,'devanagari', hard='dense commentary'); o(63,'devanagari', canonical=True, note='Yogasutra bhasya'); o(65,'devanagari')
o(67,'devanagari', lang='hi', layout='rotated', hard='page rotated 90 degrees'); o(70,'devanagari','manuscript')
o(74,'devanagari', lang='sa+hi'); o(75,'devanagari'); o(76,'devanagari', layout='two-column', hard='two columns, small type', cols=2)
o(77,'devanagari'); o(78,'devanagari', layout='two-column', hard='two columns, dense, curved', cols=2); o(79,'devanagari', lang='hi')
o(81,'devanagari', canonical=True, note='Rajatarangini'); o(82,'devanagari', layout='two-column', hard='dictionary, two columns, small type', cols=2)
o(83,'devanagari'); o(84,'devanagari', hard='poor scan, cropped')
for i in [85,86,87,88,89,91,93,94,95,96,98,99,101]: o(i,'devanagari','manuscript')
o(92,'devanagari','manuscript', hard='very faint'); o(104,'devanagari','manuscript', layout='tripatha', hard='commentary layout, small hand')
assert len(OBS) == 105, len(OBS)
TEST = [1,5,8,9,16,17,21,24,26,29,32,34,35,40,47,48,53,54,56,57, 60,62,68,61,63,65,67,70,74,76,78,81,82, 85,89,91,94,95,101,104]
assert len(TEST) == 40 and len(set(TEST)) == 40
for i, p in enumerate(P): p['idx'] = i; p['observed'] = OBS[i]; p['in_test'] = i in TEST
json.dump(d, open('candidates-observed.json', 'w'), ensure_ascii=False, indent=1)
test = [P[i] for i in TEST]
json.dump({'pages': test}, open('pages.json', 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print(Counter((p['group'], p['observed']['script']) for p in P))
print('test by kind', Counter(p['observed']['kind'] for p in test), 'hard', sum(1 for p in test if p['observed']['hard']), 'canonical', sum(p['observed']['canonical'] for p in test))
