#!/usr/bin/env python3
# PRIOR ART: classify.py (this directory: the by-eye strata of the first 105 candidates, kept as code). This is the same
# record for the confirmation draw (CONFIRM.md): 241 candidates of the pooled draw looked at in draw order, the first 50
# printed Devanagari pages kept. Run in $JOB_SCRATCH holding candidates.json; writes candidates-confirm-observed.json and
# pages-confirm.json (the shape prep.py and sevprep.mjs read).
import json, sys
from collections import Counter
d = json.load(open('candidates.json')); P = d['pages']
# By eye (contact sheets of the middle third of each page, then the full page where it was unclear), Opus, 2026-11-03.
# P = printed, Devanagari the main script. M = manuscript or lithograph, any script (Devanagari, Sharada and Newar hands
# were not separated: the confirmation is about print). X = other: English/Latin-main pages, Urdu/Persian, Telugu or
# Malayalam script, blank leaves, catalogue cards, drawings.
X = {3: 'English main, Devanagari quotations', 13: 'catalogue card', 20: 'blank', 40: 'English', 49: 'English',
     53: 'Urdu manuscript', 71: 'English', 73: 'blank', 81: 'English', 86: 'blank', 92: 'English', 103: 'blank',
     106: 'blank', 113: 'English', 117: 'Persian manuscript', 121: 'Urdu print', 130: 'architectural drawing',
     131: 'catalogue card', 134: 'Urdu manuscript', 140: 'blank', 145: 'Sanskrit in Telugu script', 149: 'blank',
     158: 'Urdu/Persian print', 175: 'Malayalam-script palm leaf', 226: 'Urdu print', 230: 'blank',
     234: 'English main, Devanagari text above', 236: 'Urdu', 239: 'Urdu manuscript'}
# printed Devanagari: index -> (lang, layout, cols, hard, note)
PR = {
    4: ('hi', 'single', 1, None, 'Hindi prose'), 5: ('sa', 'single', 1, None, 'verse with commentary'),
    14: ('sa', 'single', 1, None, 'verse and commentary, heavy gutter shadow'), 15: ('sa+pra', 'single', 1, None, 'drama, Prakrit with Sanskrit chāyā'),
    16: ('sa', 'single', 1, None, 'verse with commentary'), 25: ('sa', 'index', 2, 'verse index, two columns of numbers', ''),
    28: ('sa', 'two-column', 2, 'two columns, small type', 'āyurveda commentary'), 31: ('sa', 'two-column', 2, 'two columns, curved page', ''),
    33: ('hi', 'single', 1, None, 'Hindi jyotiṣa prose'), 34: ('sa', 'two-column', 2, 'two columns, small type', ''),
    42: ('sa', 'single', 1, None, 'verse'), 47: ('sa', 'single', 1, 'dense small type', ''), 48: ('sa', 'single', 1, None, 'verse'),
    50: ('sa+hi', 'single', 1, None, 'Sanskrit with Hindi bhāṣya'), 54: ('sa', 'single', 1, None, 'digital type, numbered verses'),
    56: ('sa', 'single', 1, None, 'verse, poor contrast'), 59: ('sa', 'single', 1, None, 'commentary prose'),
    65: ('sa', 'index', 2, 'word index with roman numerals, two columns', ''), 67: ('sa', 'single', 1, None, 'large-type verse'),
    69: ('pra+en', 'single', 1, 'Prakrit grammar with English glosses, worn type', ''), 79: ('sa', 'single', 1, None, 'digital type, numbered verses'),
    82: ('pra', 'framed', 1, 'framed pothi page, side headings', 'Jaina Prakrit'), 84: ('sa', 'single', 1, 'dense commentary, cropped margin', ''),
    89: ('sa', 'single', 1, None, 'verse'), 100: ('sa', 'single', 1, 'dense compounds and numerals', ''),
    102: ('sa', 'single', 1, None, 'verse, modern type'), 114: ('hi', 'single', 1, None, 'Hindi prose'),
    119: ('hi+sa', 'single', 1, None, 'Hindi with Sanskrit verse'), 120: ('sa', 'single', 1, 'faint type, fractions', 'gaṇita'),
    139: ('sa', 'single', 1, 'Vedic accents, gutter noise', 'Atharvaveda-type saṃhitā'), 141: ('sa', 'single', 1, None, 'digital type, numbered verses'),
    142: ('sa', 'single', 1, None, 'verse'), 150: ('sa+hi', 'framed', 1, None, 'verse with Hindi anvaya'),
    152: ('sa', 'single', 1, 'commentary, gutter shadow', ''), 159: ('sa', 'single', 1, 'small type, dark gutter', ''),
    168: ('sa+hi', 'single', 1, None, 'Sanskrit with Hindi'), 171: ('sa', 'single', 1, None, 'digital type, numbered verses'),
    185: ('sa', 'single', 1, None, 'verse'), 189: ('hi', 'two-column', 2, 'two columns, curved page', 'Hindi prose'),
    190: ('sa', 'single', 1, 'commentary, small type', ''), 200: ('sa', 'single', 1, 'dense commentary, small type', ''),
    203: ('sa', 'single', 1, 'worn type, footnote marks', ''), 205: ('sa+hi', 'single', 1, None, 'verse with Hindi variant notes'),
    209: ('sa', 'single', 1, 'commentary, curved page', ''), 215: ('sa', 'single', 1, None, 'journal title page, ornaments'),
    216: ('sa', 'single', 1, None, 'commentary prose'), 221: ('sa', 'single', 1, None, 'kāvya with commentary'),
    223: ('mr', 'single', 1, None, 'Marathi prose'), 231: ('sa', 'single', 1, None, 'digital type, numbered verses'),
    240: ('sa', 'single', 1, 'algebra notation', 'bījagaṇita'),
}
LOOKED = 241   # candidates 0..240 were classified; the 50th printed page is #240
obs = []
for i, p in enumerate(P[:LOOKED]):
    if i in PR:
        lang, layout, cols, hard, note = PR[i]
        o = dict(script='devanagari', kind='print', lang=lang, layout=layout, cols=cols, hard=hard, canonical=False, note=note)
    elif i in X:
        o = dict(script='other', kind='other', lang=None, layout='single', cols=1, hard=None, canonical=False, note=X[i])
    else:
        o = dict(script='unsplit', kind='manuscript', lang=None, layout='single', cols=1, hard=None, canonical=False, note='manuscript or lithograph')
    p['idx'] = i; p['observed'] = o; p['in_test'] = i in PR; obs.append(p)
test = [p for p in obs if p['in_test']]
assert len(test) == 50, len(test)
json.dump({**{k: v for k, v in d.items() if k != 'pages'}, 'looked': LOOKED, 'pages': obs}, open('candidates-confirm-observed.json', 'w'), ensure_ascii=False, indent=1)
json.dump({'pages': test}, open('pages-confirm.json', 'w'), ensure_ascii=False, indent=1)
print('looked', LOOKED, Counter(p['observed']['kind'] for p in obs), 'test', len(test), 'hard', sum(1 for p in test if p['observed']['hard']),
      'by group', Counter(p['group'] for p in test), file=sys.stderr)
