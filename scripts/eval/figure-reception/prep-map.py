# Publish a figure's theme map: <work>/map-points.json + themes/<figure>.json → <out>/map.json (#7073).
# Usage: python3 scripts/eval/figure-reception/prep-map.py <figure>
#
# PRIOR ART: ~/sl-work/figure-reception/pymap-prep.py — the Pythagoras one-off; its hand-written names now live
# in themes/pythagoras.json, and this script reproduces its map.json byte for byte.
#
# Theme names are written by hand after reading clusters.txt; every theme map.py produced must have one.
import json, os, sys, collections
from dating import written_year, page_types

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
KEY = sys.argv[1]
F = json.load(open(os.path.join(HERE, 'figures.json')))[KEY]
W = os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), KEY)
T = json.load(open(os.path.join(HERE, 'themes', KEY + '.json')))
OUT = os.path.join(REPO, F['out'], 'map.json')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

pts = json.load(open(os.path.join(W, 'map-points.json')))['points']
# Date each passage by when it was written, not by the edition (dating.py); map-points.json keeps the edition year.
types = page_types(json.load(open(os.path.join(W, 'hits.json'))))
for p in pts:
    p['yr'] = written_year(p['id'], p['yr'], types.get((p['id'], p['p'])))
names = {int(k): v for k, v in T['names'].items()}
theme_family = {c: f['key'] for f in T['families'] for c in f['themes']}
found = {p['c'] for p in pts if p['c'] >= 0}
assert set(names) == set(theme_family) == found, ('names', set(names) ^ found, 'families', set(theme_family) ^ found)

by = collections.defaultdict(list)
for p in pts:
    by[p['c']].append(p)
themes = []
for c, ps in by.items():
    if c < 0:
        continue
    ys = sorted(p['yr'] for p in ps if p['yr'] is not None)
    themes.append({'c': c, 'name': names[c], 'family': theme_family[c], 'n': len(ps), 'earliest': ys[0] if ys else None, 'median': ys[len(ys) // 2] if ys else None})
themes.sort(key=lambda t: -t['n'])

# terse rows: [x, y, theme(-1 = unassigned), year, book id, page, passage, title]
rows = [[p['x'], p['y'], p['c'], p['yr'], p['id'], p['p'], p['s'][:240], (p['t'] or '')[:70]] for p in pts]
json.dump({'families': [{'key': f['key'], 'name': f['name']} for f in T['families']], 'themes': themes, 'rows': rows}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(KEY, 'rows', len(rows), 'themes', len(themes), 'bytes', os.path.getsize(OUT), '→', OUT)
