#!/usr/bin/env python3
"""
PRIOR ART: the v1 page was `cat head.html zoo.json tail.html` (README); that page has no charts. This fills the one
placeholder in zoo-page.html with {zoo, stats, fix} so the page carries the class cards, the cross-tabs from
zoo-stats.py and the repair table in fixability.json.

build-page.py <dir> <out.html>    reads <dir>/zoo.json, <dir>/zoo-stats.json and fixability.json next to this file
"""
import json, os, sys
DIR, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
data = dict(zoo=json.load(open(f'{DIR}/zoo.json')), stats=json.load(open(f'{DIR}/zoo-stats.json')), fix=json.load(open(f'{HERE}/fixability.json')))
s = json.dumps(data, ensure_ascii=False).replace('\ufffd', '\\ufffd').replace('</', '<\\/')
page = open(f'{HERE}/zoo-page.html', encoding='utf-8').read()
assert page.count('__DATA__') == 1
open(OUT, 'w', encoding='utf-8').write(page.replace('__DATA__', s))
print('wrote', OUT, len(page) + len(s), 'bytes')
