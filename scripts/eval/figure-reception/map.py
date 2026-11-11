# Theme map of what the books say a figure said or taught (#7073).
# Usage: python3 scripts/eval/figure-reception/map.py <figure>
#
# PRIOR ART: ~/sl-work/figure-reception/pymap.py — the Pythagoras one-off this generalises (same embedding,
# projection and clustering); scripts/analysis/cluster-books.py clusters whole books, not passages.
#
# Input: <work>/hits.json (harvest.mjs). Keeps passages flagged q (a reported saying), public books only, exact
# repeats collapsed. Embeds with local ollama nomic-embed-text ("clustering:" prefix; free), UMAP to 2-D for the
# map and 10-D for clustering, HDBSCAN themes, c-TF-IDF keywords per theme.
# Writes <work>/emb.npy (row order = map-points.json points), <work>/map-points.json, and <work>/clusters.txt:
# keywords plus ten sample passages per theme. Theme names are written BY HAND after reading clusters.txt, into
# themes/<figure>.json; prep-map.py then publishes map.json.
import json, re, sys, os, math, collections, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
KEY = sys.argv[1]
F = json.load(open(os.path.join(HERE, 'figures.json')))[KEY]
W = os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), KEY)

books = json.load(open(os.path.join(W, 'hits.json')))
rows, seen = [], {}
for b in books:
    if not b.get('v') or not b.get('pc'):
        continue
    for p in b['passages']:
        if not p['q'] or p.get('type') in ('index', 'toc', 'errata', 'title-page', 'blank'):
            continue
        s = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', p['s'])).strip(' …')
        if len(s) < 40:
            continue
        key = re.sub(r'\W+', '', s.lower())[:160]
        if key in seen:
            seen[key]['dup'] += 1
            continue
        r = {'id': b['id'], 'p': p['p'], 's': s[:400], 'y': b.get('y'), 'l': b.get('lang'), 't': b.get('t'), 'w': b.get('w') or b['id'], 'dup': 0}
        seen[key] = r
        rows.append(r)
print('passages', len(rows), file=sys.stderr)


def embed(texts):
    req = urllib.request.Request('http://localhost:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': ['clustering: ' + t for t in texts]}).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=600))['embeddings']


E = []
for i in range(0, len(rows), 128):
    E.extend(embed([r['s'] for r in rows[i:i + 128]]))
E = np.array(E, dtype=np.float32)
E /= np.linalg.norm(E, axis=1, keepdims=True)
np.save(os.path.join(W, 'emb.npy'), E)

import umap, hdbscan
nn = min(30, max(10, len(rows) // 40))
xy = umap.UMAP(n_components=2, n_neighbors=nn, min_dist=0.08, metric='cosine', random_state=7).fit_transform(E)
z10 = umap.UMAP(n_components=10, n_neighbors=nn, min_dist=0.0, metric='cosine', random_state=7).fit_transform(E)
# Set-aside passages (figures.json setAside: another man of the same name, or the figure as a fictional
# speaker) keep their place on the map but get a fixed theme and stay out of the clustering.
fixed = np.full(len(rows), -1)
for a in F.get('setAside', []):
    t, u, x = (re.compile(a.get(k, d), re.I) for k, d in (('titles', ''), ('unless', '^$'), ('text', '')))
    for i, r in enumerate(rows):
        if fixed[i] < 0 and t.search(r['t'] or '') and x.search(r['s']) and not u.search(r['s']):
            fixed[i] = a['theme']
free = np.where(fixed < 0)[0]
lab = fixed.copy()
lab[free] = hdbscan.HDBSCAN(min_cluster_size=F['minCluster'], min_samples=F['minSamples']).fit_predict(z10[free])
print('themes', lab[free].max() + 1, 'unassigned', int((lab < 0).sum()), 'set aside', int((fixed >= 0).sum()), file=sys.stderr)

names = set(re.findall(r'[a-z]+', F['name']))
STOP = set('the of and to a in that is it as he for was his be by with this which are not they from but or have on at all said says say one who were their also so them those these what him had has an there when i we you its into than then such no more other may would can will been do does thus things thing way same according first like'.split()) | names
tok = lambda s: [w for w in re.findall(r"[a-z]{3,}", s.lower()) if w not in STOP and not w.startswith(F['prefix'])]
docs = collections.defaultdict(collections.Counter)
for r, c in zip(rows, lab):
    docs[int(c)].update(tok(r['s']))
df = collections.Counter()
for cnt in docs.values():
    df.update(cnt.keys())
kw = {}
for c, cnt in docs.items():
    tot = sum(cnt.values()) or 1
    sc = {w: (n / tot) * math.log(1 + len(docs) / df[w]) for w, n in cnt.items() if n >= 3}
    kw[c] = [w for w, _ in sorted(sc.items(), key=lambda x: -x[1])[:10]]

rng = np.random.default_rng(1)
with open(os.path.join(W, 'clusters.txt'), 'w') as out:
    for c, n in sorted(collections.Counter(int(c) for c in lab).items(), key=lambda x: -x[1]):
        idx = [i for i, l in enumerate(lab) if l == c]
        ys = sorted(rows[i]['y'] for i in idx if rows[i]['y'] is not None)
        out.write(f'\n=== cluster {c}  n={n}  median year={ys[len(ys) // 2] if ys else None}  earliest={ys[0] if ys else None}\nkeywords: {", ".join(kw[c])}\n')
        for i in rng.choice(idx, size=min(10, len(idx)), replace=False):
            out.write(f'  - [{rows[i]["y"]}] {rows[i]["s"][:230]}\n')

pts = [{'x': round(float(a), 3), 'y': round(float(b), 3), 'c': int(c), 'yr': r['y'], 'id': r['id'], 'p': r['p'], 's': r['s'][:300], 't': (r['t'] or '')[:90], 'l': r['l'], 'd': r['dup']}
       for r, (a, b), c in zip(rows, xy, lab)]
json.dump({'points': pts, 'keywords': {str(k): v for k, v in kw.items()}}, open(os.path.join(W, 'map-points.json'), 'w'))
print('done', len(pts), '→', W, file=sys.stderr)
