# Story family trees: for each theme (and each keyword story in themes/<figure>.json), link every dated passage
# to its most similar EARLIER passage from a different work, if the two are similar enough (#7073).
# Usage: python3 scripts/eval/figure-reception/tree.py <figure>  → <out>/tree.json
#
# PRIOR ART: none — looked in scripts/eval, scripts/analysis and scripts/lib for a nearest-earlier-neighbour or
# stemma builder; the embeddings and theme labels come from map.py.
#
# Similarity is cosine over the nomic-embed-text vectors map.py saved (row order = map-points.json). The threshold
# was set by reading pairs on 2026-10-20 (beans, five years of silence): at 0.88 and above the later passage tells
# the story the same way, often with the same quotation; below about 0.86 it is merely the same topic. A link is
# similarity of wording, NOT evidence that one author read the other. Editions of the same work (work_id) never
# link to each other, and a passage only links to a strictly earlier year — the year it was written (dating.py),
# so an old text in a modern edition can be the root its later citers hang from. Undated passages are left out.
#
# A theme's passages are the map's (reported sayings only). A keyword story (themes/<figure>.json `stories`) is
# drawn from the whole harvest instead, since a story like the smiths' hammers is usually told without a verb of
# saying; its passages are embedded here (local ollama, free) and shipped inline as `rows`.
#
# Output: {threshold, stories: [{key, name, theme|null, rows?, nodes: [[row, parentRow (-1 = starts a new line),
# sim%]]}]}. For a theme, row indexes map.json rows; for a keyword story, its own `rows` (same row shape as
# map.json, x/y = 0). Nodes are in date order.
import json, os, re, sys, urllib.request
import numpy as np
from dating import written_year, page_types

THRESHOLD = 0.88
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
KEY = sys.argv[1]
F = json.load(open(os.path.join(HERE, 'figures.json')))[KEY]
W = os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), KEY)
T = json.load(open(os.path.join(HERE, 'themes', KEY + '.json')))

pts = json.load(open(os.path.join(W, 'map-points.json')))['points']
E = np.load(os.path.join(W, 'emb.npy'))
assert len(E) == len(pts), 'emb.npy and map-points.json are out of step; re-run map.py'
keep = [i for i, p in enumerate(pts) if p['p'] > 0]  # as prep-map.py: soft-hidden pages are not on the map
pts, E = [pts[i] for i in keep], E[keep]
HITS = json.load(open(os.path.join(W, 'hits.json')))
work = {b['id']: (b.get('w') or b['id']) for b in HITS}
types = page_types(HITS)
for p in pts:  # by when it was written, not the edition (dating.py), as in map.json
    p['yr'] = written_year(p['id'], p['yr'], types.get((p['id'], p['p'])), p['s'], p['p'])
W_OF = [work.get(p['id'], p['id']) for p in pts]


def tree(idx, pts=pts, E=E, W_OF=W_OF):
    idx = sorted((i for i in idx if pts[i]['yr'] is not None), key=lambda i: (pts[i]['yr'], i))
    nodes = []
    for k, i in enumerate(idx):
        prev = [j for j in idx[:k] if pts[j]['yr'] < pts[i]['yr'] and W_OF[j] != W_OF[i]]
        parent, sim = -1, 0.0
        if prev:
            s = E[prev] @ E[i]
            b = int(s.argmax())
            if s[b] >= THRESHOLD:
                parent, sim = prev[b], float(s[b])
        nodes.append([i, parent, round(sim * 100)])
    return nodes


stories = []
names = {int(k): v for k, v in T['names'].items()}
for c, name in names.items():
    stories.append({'key': f't{c}', 'name': name, 'theme': c, 'nodes': tree([i for i, p in enumerate(pts) if p['c'] == c])})


def embed(texts):
    req = urllib.request.Request('http://localhost:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': ['clustering: ' + t for t in texts]}).encode(), headers={'content-type': 'application/json'})
    v = np.array(json.load(urllib.request.urlopen(req, timeout=600))['embeddings'], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


SKIP = {'index', 'toc', 'errata', 'title-page', 'blank'}
for s in T.get('stories', []):
    rx = re.compile(r'\b(' + s['match'] + r')\b', re.I)
    sp, seen = [], set()
    for b in HITS:
        if not b.get('v') or not b.get('pc'):
            continue
        for p in b['passages']:
            txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', p['s'])).strip(' …')
            k = re.sub(r'\W+', '', txt.lower())[:160]
            if p['p'] <= 0 or p.get('type') in SKIP or len(txt) < 40 or k in seen or not rx.search(txt):
                continue
            seen.add(k)
            sp.append({'yr': written_year(b['id'], b.get('y'), p.get('type'), txt, p['p']), 'id': b['id'], 'p': p['p'], 's': txt[:300], 't': (b.get('t') or '')[:90], 'w': b.get('w') or b['id']})
    SE = np.concatenate([embed([x['s'] for x in sp[i:i + 128]]) for i in range(0, len(sp), 128)])
    nodes = tree(range(len(sp)), pts=sp, E=SE, W_OF=[x['w'] for x in sp])
    stories.append({'key': s['key'], 'name': s['name'], 'theme': None, 'rows': [[0, 0, -1, x['yr'], x['id'], x['p'], x['s'][:240], x['t'][:70]] for x in sp], 'nodes': nodes})

OUT = os.path.join(REPO, F['out'], 'tree.json')
json.dump({'threshold': THRESHOLD, 'stories': stories}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
for s in stories:
    n = s['nodes']
    linked = sum(1 for x in n if x[1] >= 0)
    print(f"{s['name'][:44]:44} nodes {len(n):4}  linked {linked:4}  roots {len(n) - linked:4}")
print('bytes', os.path.getsize(OUT), '→', OUT)
