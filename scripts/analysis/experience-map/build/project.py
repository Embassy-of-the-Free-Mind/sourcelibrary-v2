#!/usr/bin/env python3
"""
Project quote embeddings into 2D for the experience map.

Input : points.jsonl  (one verified quote per line, with a 768d `vec`)
Output: map-data.json (compact, no vectors — coordinates + display fields)

UMAP on cosine distance. Cosine because the embeddings are normalised for
cosine retrieval; euclidean would distort the neighbourhoods the whole corpus
was indexed under.

Clusters come from HDBSCAN-style density via sklearn's KMeans fallback: we want
labelled regions ("what is this part of the map about?"), and the labels are
generated afterwards from the dominant features of each cluster, not asserted.
"""
import json, sys, collections
import numpy as np

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'

rows = [json.loads(l) for l in open(f'{HERE}/points.jsonl') if l.strip()]
print(f'{len(rows)} points')
X = np.array([r['vec'] for r in rows], dtype=np.float32)
X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)
print('matrix', X.shape)

import umap
reducer = umap.UMAP(
    n_neighbors=25, min_dist=0.12, metric='cosine',
    n_components=2, random_state=42, verbose=True,
)
XY = reducer.fit_transform(X)

# normalise to a stable 0..1000 box so the front-end never has to rescale
xy = np.array(XY, dtype=np.float64)
xy -= xy.min(axis=0)
xy /= (xy.max(axis=0) + 1e-9)
xy *= 1000.0

from sklearn.cluster import KMeans
K = max(6, min(18, len(rows) // 120))
km = KMeans(n_clusters=K, n_init=10, random_state=42).fit(X)
labels = km.labels_
print(f'{K} clusters')

# name each cluster from its dominant phenomenological features + traditions
cluster_meta = {}
for c in range(K):
    idx = [i for i, l in enumerate(labels) if l == c]
    feats = collections.Counter(f for i in idx for f in rows[i].get('features', []))
    trads = collections.Counter(rows[i].get('tradition') for i in idx if rows[i].get('tradition'))
    regs = collections.Counter(rows[i].get('register') for i in idx)
    cluster_meta[c] = {
        'size': len(idx),
        'features': feats.most_common(4),
        'traditions': trads.most_common(3),
        'registers': regs.most_common(3),
        'label': ' / '.join(f for f, _ in feats.most_common(2)) or 'unlabelled',
    }

out = []
for i, r in enumerate(rows):
    out.append({
        'x': round(float(xy[i][0]), 1),
        'y': round(float(xy[i][1]), 1),
        'c': int(labels[i]),
        'q': r['quote'],
        't': r['book_title'],
        'a': r.get('book_author'),
        'yr': r.get('book_year'),
        'lang': r.get('book_language'),
        'reg': r.get('register'),
        'fp': bool(r.get('first_person')),
        'tr': r.get('tradition'),
        'f': r.get('features', []),
        'u': r['url'],
        'g': bool(r.get('has_gloss')),
    })

meta = {
    'count': len(out),
    'books': len({r['book_id'] for r in rows}),
    'works': len({r.get('work_id') or r['book_id'] for r in rows}),
    'clusters': {str(k): v for k, v in cluster_meta.items()},
    'languages': collections.Counter(r.get('book_language') or '?' for r in rows).most_common(),
    'registers': collections.Counter(r.get('register') for r in rows).most_common(),
    'traditions': collections.Counter(r.get('tradition') for r in rows if r.get('tradition')).most_common(),
    'centuries': sorted(collections.Counter(
        (r['book_year'] // 100 + 1) for r in rows if r.get('book_year')).items()),
    'features': collections.Counter(f for r in rows for f in r.get('features', [])).most_common(),
}

json.dump({'meta': meta, 'points': out}, open(f'{HERE}/map-data.json', 'w'))
print(f"wrote map-data.json — {len(out)} points, {meta['books']} books, {meta['works']} works")
for c, m in cluster_meta.items():
    print(f"  cluster {c:2} n={m['size']:4}  {m['label']:34} {m['traditions']}")
