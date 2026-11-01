# PRIOR ART: build.py names routes by id ('<draft>><corrector>', '-written', '@N') and stages (rules.json stages) but
# never decomposes them into factors; rules.json cells carry no language code. This is that decomposition, by hand.
"""A router route's factors for the hierarchical held-out test (#7263): engine, draft, language, writing system, script type."""
import re

# base cell prefix -> (language, writing system). Longest prefix wins.
LANG = {
    'arabic': ('ar', 'Arab'), 'ottoman': ('ota', 'Arab'), 'chinese': ('zh', 'Hani'), 'zh': ('zh', 'Hani'),
    'danish': ('da', 'Latn'), 'english': ('en', 'Latn'), 'middle-english': ('enm', 'Latn'), 'french': ('fr', 'Latn'),
    'old-french': ('fro', 'Latn'), 'german': ('de', 'Latn'), 'mhg': ('gmh', 'Latn'), 'italian': ('it', 'Latn'),
    'latin': ('la', 'Latn'), 'portuguese': ('pt', 'Latn'), 'spanish': ('es', 'Latn'), 'turkish': ('tr', 'Latn'),
    'greek': ('grc', 'Grek'), 'hebrew': ('he', 'Hebr'), 'hindi': ('hi', 'Deva'), 'sanskrit': ('sa', 'Deva'),
    'korean': ('ko', 'Kore'), 'russian': ('ru', 'Cyrl'), 'tamil': ('ta', 'Taml'), 'tibetan': ('bo', 'Tibt'), 'tengyur': ('bo', 'Tibt'),
}
DRAFT = {'lite': 'lite', '3flash': 'flash3', 'flash3': 'flash3', 'gpu': 'gpu', 'gpu2': 'gpu', 'gpu-glm': 'gpu-glm', 'pero': 'pero',
         'lighton': 'lighton', 'kraken': 'kraken', 'paddle': 'paddle', 'yigdzin': 'yigdzin', 'agy-flash-low': 'agy-read'}


def norm(part):
    return re.sub(r'@\d+', '', re.sub(r'(-written|\+diffqa|\+diff|-diplomatic)$', '', part))


def factors(cell, route):
    base, rid = cell['base'], route['id']
    key = max((k for k in LANG if base == k or base.startswith(k + '-')), key=len)
    lang, wsys = LANG[key]
    parts = [norm(p) for p in rid.split('>')]
    if '-tr' in base:  # translation cells: the engine that wrote the English
        eng = 'tr-opus' if parts[-1].startswith('opus') else 'tr-agy' if parts[-1].startswith('agy') else 'tr-draft'
        draft = 'none'
    else:
        last = parts[-1]
        if len(parts) > 1:
            eng = 'opus-correct' if last.startswith('opus') else 'agy-correct-high' if last == 'agy-flash-high' else 'agy-correct'
            draft = DRAFT[parts[0]]
        else:
            eng = 'agy-read' if last.startswith('agy-flash-low') else DRAFT.get(last, last)
            draft = 'none'
    return {'eng': eng, 'draft': draft, 'lang': lang, 'wsys': wsys, 'stype': cell['script'],
            'eng:wsys': f'{eng}:{wsys}', 'eng:stype': f'{eng}:{cell["script"]}'}
