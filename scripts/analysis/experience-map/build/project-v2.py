#!/usr/bin/env python3
"""
Projection v2 for the experience map.

Adds over v1:
  - the new classifier axes (trigger / aftermath / attributed agent / contested)
    flow into the point payload and the facet metadata
  - stratification is reported honestly: retrieval sampled every language equally,
    so the map's language mix is NOT the corpus's language mix, and the baseline
    sample is carried alongside so the page can say so with numbers
  - cluster labelling widened to include trigger and agent, not just features
"""
import json, collections, math
import numpy as np

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'

rows = [json.loads(l) for l in open(f'{HERE}/points-v2.jsonl') if l.strip()]
print(f'{len(rows)} points')
X = np.array([r['vec'] for r in rows], dtype=np.float32)
X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)

import umap
XY = umap.UMAP(n_neighbors=25, min_dist=0.12, metric='cosine',
               n_components=2, random_state=42).fit_transform(X)
xy = np.array(XY, dtype=np.float64)
xy -= xy.min(axis=0); xy /= (xy.max(axis=0) + 1e-9); xy *= 1000.0

from sklearn.cluster import KMeans
K = max(8, min(20, len(rows) // 130))
labels = KMeans(n_clusters=K, n_init=10, random_state=42).fit(X).labels_
print(f'{K} clusters')

# Global rates, so cluster labels can be chosen by DISTINCTIVENESS (lift) rather than
# raw frequency. Labelling by frequency gave three different regions the same name —
# 'vision encounter' is everywhere, so it names nothing.
g_feat = collections.Counter(f for r in rows for f in r.get('features', []))
g_trad = collections.Counter(r.get('tradition') for r in rows if r.get('tradition'))
g_trig = collections.Counter(r.get('trigger') for r in rows
                             if r.get('trigger') not in (None, 'not-stated', 'spontaneous'))
N = len(rows)

def lift_top(local, glob, n_local, minimum=4):
    best, best_lift = None, 0
    for k, v in local.items():
        if v < minimum: continue
        share_local = v / max(1, n_local)
        share_glob = glob.get(k, 0) / max(1, N)
        if share_glob <= 0: continue
        l = share_local / share_glob
        if l > best_lift: best, best_lift = k, l
    return best

cluster_meta = {}
for c in range(K):
    idx = [i for i, l in enumerate(labels) if l == c]
    feats = collections.Counter(f for i in idx for f in rows[i].get('features', []))
    trads = collections.Counter(rows[i].get('tradition') for i in idx if rows[i].get('tradition'))
    trigs = collections.Counter(rows[i].get('trigger') for i in idx
                                if rows[i].get('trigger') not in (None, 'not-stated'))
    agents = collections.Counter(rows[i].get('attributed_agent') for i in idx
                                 if rows[i].get('attributed_agent') not in (None, 'not-stated'))
    regs = collections.Counter(rows[i].get('register') for i in idx)
    cluster_meta[c] = {
        'size': len(idx),
        'features': feats.most_common(4),
        'traditions': trads.most_common(3),
        'triggers': trigs.most_common(3),
        'agents': agents.most_common(3),
        'registers': regs.most_common(3),
        'label': (lambda: (
            lambda a, b: ' · '.join([x for x in (a, b) if x]) or
                         (feats.most_common(1)[0][0] if feats else 'unlabelled')
        )(
            lift_top(feats, g_feat, len(idx)) or (feats.most_common(1)[0][0] if feats else None),
            lift_top(trads, g_trad, len(idx)) or lift_top(trigs, g_trig, len(idx))
        ))(),
    }

out = []
for i, r in enumerate(rows):
    out.append({
        'x': round(float(xy[i][0]), 1), 'y': round(float(xy[i][1]), 1), 'c': int(labels[i]),
        'q': r['quote'], 't': r['book_title'], 'a': r.get('book_author'),
        'yr': r.get('book_year'), 'lang': r.get('book_language'),
        'reg': r.get('register'), 'fp': bool(r.get('first_person')),
        'tr': r.get('tradition'), 'f': r.get('features', []),
        'tg': r.get('trigger'), 'af': r.get('aftermath'),
        'ag': r.get('attributed_agent'), 'ct': bool(r.get('contested')),
        'u': r['url'], 'g': bool(r.get('has_gloss')),
    })

# --- the honesty layer: baseline + full classified corpus stats ---
baseline = [json.loads(l) for l in open(f'{HERE}/baseline-classified.jsonl') if l.strip()]
allcls = [json.loads(l) for l in open(f'{HERE}/classified-v3.jsonl') if l.strip()]

def rate(rs, pred):
    n = len(rs)
    return {'n': n, 'k': sum(1 for r in rs if pred(r)),
            'pct': round(100 * sum(1 for r in rs if pred(r)) / n, 1) if n else 0}

base_exp = rate(baseline, lambda r: r['experiential'])
ret_exp = rate(allcls, lambda r: r['experiential'])
# Wilson interval on the baseline rate, so the corpus projection carries an honest range
p = base_exp['k'] / base_exp['n']; n = base_exp['n']; z = 1.96
den = 1 + z*z/n
centre = (p + z*z/(2*n)) / den
half = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / den

register_split = []
by = collections.defaultdict(collections.Counter)
for r in allcls:
    by[r['probe_dim']][r['register']] += 1
for dim, c in by.items():
    tot = sum(c.values())
    if tot < 25: continue
    register_split.append({'dim': dim, 'n': tot, 'instruction': c['instruction'],
                           'testimony': c['testimony'], 'vision_narrative': c['vision-narrative'],
                           'doctrine': c['doctrine'], 'fiction': c['fiction']})
register_split.sort(key=lambda r: -(r['instruction']/r['n'] - r['testimony']/r['n']))

meta = {
    'count': len(out),
    'books': len({r['book_id'] for r in rows}),
    'works': len({r.get('work_id') or r['book_id'] for r in rows}),
    'clusters': {str(k): v for k, v in cluster_meta.items()},
    'languages': collections.Counter(r.get('book_language') or '?' for r in rows).most_common(),
    'registers': collections.Counter(r.get('register') for r in rows).most_common(),
    'traditions': collections.Counter(r.get('tradition') for r in rows if r.get('tradition')).most_common(),
    'triggers': collections.Counter(r.get('trigger') for r in rows if r.get('trigger')).most_common(),
    'aftermaths': collections.Counter(r.get('aftermath') for r in rows if r.get('aftermath')).most_common(),
    'agents': collections.Counter(r.get('attributed_agent') for r in rows if r.get('attributed_agent')).most_common(),
    'contested': sum(1 for r in rows if r.get('contested')),
    'centuries': sorted(collections.Counter((r['book_year']//100 + 1) for r in rows if r.get('book_year')).items()),
    'features': collections.Counter(f for r in rows for f in r.get('features', [])).most_common(),
    'registerSplit': register_split,
    'classifiedTotal': len(allcls),
    'baseline': {
        'sample': base_exp['n'],
        'experientialPct': base_exp['pct'],
        'retrievedExperientialPct': ret_exp['pct'],
        'enrichment': round(ret_exp['pct'] / base_exp['pct'], 1) if base_exp['pct'] else None,
        'ciLowPct': round(100*(centre-half), 1), 'ciHighPct': round(100*(centre+half), 1),
        'corpusPages': 3900000,
        'projectedLowK': round(3900000*(centre-half)/1000),
        'projectedHighK': round(3900000*(centre+half)/1000),
        'corpusLanguages': collections.Counter(r.get('book_language') or '?' for r in baseline).most_common(10),
        'baselineRegisters': collections.Counter(r['register'] for r in baseline).most_common(),
    },
}

json.dump({'meta': meta, 'points': out}, open(f'{HERE}/map-data-v2.json', 'w'))
print(f"wrote map-data-v2.json — {len(out)} points, {meta['books']} books, {meta['works']} works")
print(f"baseline {base_exp['pct']}% vs retrieved {ret_exp['pct']}% = {meta['baseline']['enrichment']}x enrichment")
print(f"projected experiential pages corpus-wide: {meta['baseline']['projectedLowK']}K–{meta['baseline']['projectedHighK']}K")
for c, m in cluster_meta.items():
    print(f"  {c:2} n={m['size']:4} {m['label']:32} {m['traditions'][:2]} trig={m['triggers'][:2]}")
