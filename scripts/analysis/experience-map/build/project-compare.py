#!/usr/bin/env python3
"""
Joint projection: the Western-instrument atlas and the Visuddhimagga's own stage
model, embedded in ONE space so their coverage can be compared directly.

The question is not which taxonomy is right. It is whether an indigenous stage
model carves the corpus at the same joints as the modern questionnaires, and where
the two disagree about what belongs together.
"""
import json, collections
import numpy as np

HERE = '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/b4cc9f10-7660-4f2b-b3cf-554d4017f8f7/scratchpad'

west = [json.loads(l) for l in open(f'{HERE}/points-v2.jsonl') if l.strip()]
vism = [json.loads(l) for l in open(f'{HERE}/points-jhana.jsonl') if l.strip()]
print(f'western atlas: {len(west)}   visuddhimagga: {len(vism)}')

TAX = {d['id']: d for d in json.load(open(f'{HERE}/probes-jhana.json'))['dimensions']}
DARK = {'nana_06','nana_07','nana_08','nana_09','nana_10','nana_11'}
CONC = {'access_concentration','jhana_1','jhana_2','jhana_3','jhana_4',
        'base_space','base_consciousness','base_nothingness','base_neither','cessation'}
BUD = {'theravada','tibetan-buddhist','mahayana','buddhist','zen','chan'}

def ladder(s):
    if s in DARK: return 'dark-night'
    if s in CONC: return 'concentration'
    return 'insight-other'

# one embedding space for both sets
allrows = west + vism
X = np.array([r['vec'] for r in allrows], dtype=np.float32)
X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)

import umap
XY = umap.UMAP(n_neighbors=25, min_dist=0.12, metric='cosine',
               n_components=2, random_state=42).fit_transform(X)
xy = np.array(XY, dtype=np.float64)
xy -= xy.min(axis=0); xy /= (xy.max(axis=0) + 1e-9); xy *= 1000.0

pts = []
for i, r in enumerate(allrows):
    isv = i >= len(west)
    p = {
        'x': round(float(xy[i][0]), 1), 'y': round(float(xy[i][1]), 1),
        'q': r['quote'], 't': r['book_title'], 'a': r.get('book_author'),
        'yr': r.get('book_year'), 'lang': r.get('book_language'),
        'tr': r.get('tradition'), 'u': r['url'],
        'src': 'vism' if isv else 'west',
    }
    if isv:
        p['stage'] = r.get('stage')
        p['stageLabel'] = TAX.get(r.get('stage'), {}).get('label', r.get('stage'))
        p['pali'] = TAX.get(r.get('stage'), {}).get('pali')
        p['ladder'] = ladder(r.get('stage'))
        p['fit'] = r.get('fit')
        p['inside'] = (r.get('tradition') or '') in BUD
    else:
        p['f'] = r.get('features', [])
        p['reg'] = r.get('register')
    pts.append(p)

# --- the comparative numbers ---
cls = [json.loads(l) for l in open(f'{HERE}/classified-jhana.jsonl') if l.strip()]
matched = [r for r in cls if r['stage'] != 'none' and r['experiential'] and r['fit'] in ('native','analogical')]
inside = [r for r in matched if (r['tradition'] or '') in BUD]
outside = [r for r in matched if (r['tradition'] or '') not in BUD]

def ladderProfile(rs):
    c = collections.Counter(ladder(r['stage']) for r in rs)
    n = max(1, len(rs))
    return {k: {'n': v, 'pct': round(100*v/n, 1)} for k, v in c.items()}

# where do Visuddhimagga points sit relative to western points? nearest-neighbour test
W = np.array([r['vec'] for r in west], dtype=np.float32); W /= np.linalg.norm(W,axis=1,keepdims=True)+1e-9
V = np.array([r['vec'] for r in vism], dtype=np.float32); V /= np.linalg.norm(V,axis=1,keepdims=True)+1e-9
S = V @ W.T
nn = np.argsort(-S, axis=1)[:, :5]
feat_near = collections.Counter()
for i, row in enumerate(nn):
    for j in row:
        for f in (west[j].get('features') or []):
            feat_near[f] += 1

meta = {
    'west': {'count': len(west)},
    'vism': {
        'count': len(vism),
        'retrieved': len(cls),
        'matched': len(matched),
        'matchRatePct': round(100*len(matched)/max(1,len(cls)), 1),
        'inside': len(inside), 'outside': len(outside),
        'ladderInside': ladderProfile(inside),
        'ladderOutside': ladderProfile(outside),
        'outsideTraditions': collections.Counter(r['tradition'] for r in outside).most_common(10),
        'stages': collections.Counter(r['stage'] for r in matched).most_common(),
    },
    'stageLabels': {k: {'label': v['label'], 'pali': v['pali'], 'group': v['group']} for k, v in TAX.items()},
    'westFeaturesNearVism': feat_near.most_common(12),
}

json.dump({'meta': meta, 'points': pts}, open(f'{HERE}/map-data-compare.json','w'))
print(f"wrote map-data-compare.json — {len(pts)} points")
print('match rate of the indigenous taxonomy:', meta['vism']['matchRatePct'], '% of retrieved')
print('inside  ladder:', meta['vism']['ladderInside'])
print('outside ladder:', meta['vism']['ladderOutside'])
print('western features nearest to Visuddhimagga points:', feat_near.most_common(6))
