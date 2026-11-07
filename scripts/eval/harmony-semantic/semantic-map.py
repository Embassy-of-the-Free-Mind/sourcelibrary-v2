# PRIOR ART: scripts/eval/figure-reception/map.py (#7073): same local nomic-embed-text ("clustering:" prefix; free) and UMAP;
#   it starts from a harvest of passages that NAME a figure, this from the probe retrieval (retrieve.mjs), whose point is
#   the pages that never use the word.
# Semantic map of harmony (#7129): the strongest pages per probe (top --per, by similarity), embedded locally with
# nomic-embed-text through ollama, UMAP to 2-D (not named umap.py: that shadows the package). Each point keeps its probe kind, language, year and /q link.
#   <venv>/bin/python scripts/eval/harmony-semantic/semantic-map.py <run-dir> [--per 120]
# Writes <run-dir>/semantic-points.json and <run-dir>/emb.npy.
import json, sys, os, re, collections, urllib.request
import numpy as np
RUN = sys.argv[1]; PER = int(sys.argv[sys.argv.index('--per') + 1]) if '--per' in sys.argv else 120
rows = [json.loads(l) for l in open(os.path.join(RUN, 'hits.jsonl')) if l.strip()]
by = collections.defaultdict(list)
for r in rows: by[r['probe']].append(r)
pages = {}
for probe, rs in by.items():
    for r in sorted(rs, key=lambda r: -r['sim'])[:PER]:
        k = (r['b'], r['p']); x = pages.get(k)
        if x is None or r['sim'] > x['sim']: pages[k] = r
pts = list(pages.values()); print('pages', len(pts), file=sys.stderr)
cache_f = os.path.join(RUN, 'emb-cache.jsonl'); cache = {}
if os.path.exists(cache_f):
    for l in open(cache_f): d = json.loads(l); cache[d['k']] = d['v']
def embed(texts):
    req = urllib.request.Request('http://127.0.0.1:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': texts}).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=600))['embeddings']
todo = [p for p in pts if f"{p['b']}:{p['p']}" not in cache]
with open(cache_f, 'a') as out:
    for i in range(0, len(todo), 32):
        b = todo[i:i + 32]
        vs = embed(['clustering: ' + re.sub(r'\s+', ' ', p['text'])[:1500] for p in b])
        for p, v in zip(b, vs):
            k = f"{p['b']}:{p['p']}"; cache[k] = v; out.write(json.dumps({'k': k, 'v': v}) + '\n')
        if i % 640 == 0: print('  embedded', i + len(b), '/', len(todo), file=sys.stderr, flush=True)
X = np.array([cache[f"{p['b']}:{p['p']}"] for p in pts], dtype=np.float32); np.save(os.path.join(RUN, 'emb.npy'), X)
import umap
xy = umap.UMAP(n_components=2, n_neighbors=30, min_dist=0.08, metric='cosine', random_state=7129).fit_transform(X)
xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))
out = [{'x': round(float(a), 4), 'y': round(float(b), 4), 'k': p['dim'], 'l': p['lang'], 'yr': p['year'], 't': (p['title'] or '')[:90], 'a': (p['author'] or '')[:40],
        'n': 1 if p['names'] else 0, 'q': p['q'].replace('https://sourcelibrary.org', ''), 's': p['text'][:240], 'sim': p['sim']} for p, (a, b) in zip(pts, xy)]
json.dump({'n': len(out), 'points': out}, open(os.path.join(RUN, 'semantic-points.json'), 'w'), ensure_ascii=False)
print('points', len(out), 'never name', sum(1 for o in out if not o['n']), file=sys.stderr)
