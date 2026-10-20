#!/usr/bin/env python3
"""
Projection v5 for the experience map — project-v2.py re-plumbed for the two-lane v5 run.

PRIOR ART: build/project-v2.py — same UMAP/KMeans projection, lift-labelled clusters, Wilson-interval
baseline, register split; it hardcodes a dead scratchpad path. What v5 adds, each a measurement the
July run could not make because it had one lane:
  - LANE ANALYSIS over every classified row: which lane found it (semantic = English probe sentences over
    page vectors; lexical = native-script terms over source text), experiential rate, register mix and
    verified-quote rate per lane, and per PROBE LANGUAGE for the lexical lane — the direct test of the
    July paper's section 6 (translationese organises the semantic space).
  - the July §6 nearest-neighbour test re-run on the v5 quote embeddings, per lane.
  - untranslated-hit accounting (native-term hits on pages with no translation) as a translation to-do.
  - a display sample: the page inlines its points, so the plotted set is capped (language-stratified,
    round-robin, seeded) while every point goes into the CSV release with its coordinates.
Stratification stays deliberate and non-proportional (equal probe budget per language) and is labelled so.

  V5_OUT=~/sourcelibrary/scripts/output/experience-map/v5 python3 build/project-v5.py [--max-plot 9000]
Reads points-v5.jsonl, classified-v5.jsonl, merge-v5-summary.json, v5-summary.json,
v5-lexical-summary.json, hits-v5-untranslated.jsonl, hits-v5-lex-untranslated.jsonl and the July
../baseline-classified.jsonl (the random-sample denominator, same classifier prompt).
Writes map-data-v5.json, v5-release.csv, v5-numbers.json.
"""
import json, collections, math, os, sys, csv, random
import numpy as np

V5 = os.environ.get('V5_OUT') or os.path.expanduser('~/sourcelibrary/scripts/output/experience-map/v5')
JULY = os.environ.get('JULY_OUT') or os.path.join(V5, '..')
MAX_PLOT = int(sys.argv[sys.argv.index('--max-plot') + 1]) if '--max-plot' in sys.argv else 9000
random.seed(42)

def jl(p):
    return [json.loads(l) for l in open(p) if l.strip()]

rows = jl(f'{V5}/points-v5.jsonl')
print(f'{len(rows)} points')
allcls = jl(f'{V5}/classified-v5.jsonl')
print(f'{len(allcls)} classified rows')
baseline = jl(f'{JULY}/baseline-classified.jsonl')
merge = json.load(open(f'{V5}/merge-v5-summary.json'))
sem = json.load(open(f'{V5}/v5-summary.json'))
lex = json.load(open(f'{V5}/v5-lexical-summary.json'))

def lane_of(r):
    ls = r.get('lanes') or ([r['lane']] if r.get('lane') else [])
    if 'semantic' in ls and 'lexical' in ls: return 'both'
    return ls[0] if ls else 'semantic'
LANE_CODE = {'semantic': 's', 'lexical': 'l', 'both': 'b'}

# ---------------------------------------------------------------- projection
X = np.array([r['vec'] for r in rows], dtype=np.float32)
X /= (np.linalg.norm(X, axis=1, keepdims=True) + 1e-9)

import umap
XY = umap.UMAP(n_neighbors=25, min_dist=0.12, metric='cosine', n_components=2, random_state=42).fit_transform(X)
xy = np.array(XY, dtype=np.float64)
xy -= xy.min(axis=0); xy /= (xy.max(axis=0) + 1e-9); xy *= 1000.0

from sklearn.cluster import KMeans
K = max(8, min(24, len(rows) // 400))
labels = KMeans(n_clusters=K, n_init=4, random_state=42).fit(X).labels_
print(f'{K} clusters')

g_feat = collections.Counter(f for r in rows for f in r.get('features', []))
g_trad = collections.Counter(r.get('tradition') for r in rows if r.get('tradition'))
g_trig = collections.Counter(r.get('trigger') for r in rows if r.get('trigger') not in (None, 'not-stated', 'spontaneous'))
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
    trigs = collections.Counter(rows[i].get('trigger') for i in idx if rows[i].get('trigger') not in (None, 'not-stated'))
    agents = collections.Counter(rows[i].get('attributed_agent') for i in idx if rows[i].get('attributed_agent') not in (None, 'not-stated'))
    regs = collections.Counter(rows[i].get('register') for i in idx)
    lanes = collections.Counter(lane_of(rows[i]) for i in idx)
    a = lift_top(feats, g_feat, len(idx)) or (feats.most_common(1)[0][0] if feats else None)
    b = lift_top(trads, g_trad, len(idx)) or lift_top(trigs, g_trig, len(idx))
    cluster_meta[c] = {
        'size': len(idx), 'features': feats.most_common(4), 'traditions': trads.most_common(3),
        'triggers': trigs.most_common(3), 'agents': agents.most_common(3), 'registers': regs.most_common(3),
        'lanes': lanes.most_common(),
        'label': ' · '.join([x for x in (a, b) if x]) or (feats.most_common(1)[0][0] if feats else 'unlabelled'),
    }

# ---------------------------------------------------------------- §6 re-run: what nearest neighbours share, per lane
from sklearn.neighbors import NearestNeighbors
KNN = 10
nn = NearestNeighbors(n_neighbors=KNN + 1, metric='cosine').fit(X)
_, nbr = nn.kneighbors(X)
def share_expected(key):
    c = collections.Counter(key(r) for r in rows)
    return sum((v / N) ** 2 for v in c.values())
def feat_set(r): return set(r.get('features') or [])
keys = {
    'Same source book': (lambda r: r['book_id'], None),
    'Same language': (lambda r: r.get('book_language') or '?', None),
    'Same tradition': (lambda r: r.get('tradition') or '?', None),
    'Same retrieval lane': (lambda r: lane_of(r), None),
}
neigh = []
for lab, (key, _) in keys.items():
    obs = 0; tot = 0
    for i in range(N):
        for j in nbr[i][1:]:
            tot += 1; obs += key(rows[i]) == key(rows[j])
    exp = share_expected(key)
    neigh.append({'what': lab, 'obsPct': round(100 * obs / tot, 1), 'chancePct': round(100 * exp, 1), 'lift': round(obs / tot / exp, 1) if exp else None})
# same phenomenological feature = share at least one feature; chance = P(two random rows share a feature)
fs = [feat_set(r) for r in rows]
obs = 0; tot = 0
for i in range(N):
    for j in nbr[i][1:]:
        tot += 1; obs += bool(fs[i] & fs[j])
samp = random.Random(1).sample(range(N), min(N, 3000))
pairs = 0; hit = 0
for a in samp:
    for b in random.Random(a).sample(range(N), 20):
        if a == b: continue
        pairs += 1; hit += bool(fs[a] & fs[b])
exp = hit / max(1, pairs)
neigh.append({'what': 'Same phenomenological feature', 'obsPct': round(100 * obs / tot, 1), 'chancePct': round(100 * exp, 1), 'lift': round(obs / tot / exp, 1) if exp else None})
# per-lane: language lift among neighbours, restricted to points found by that lane
neigh_by_lane = {}
for lane in ('semantic', 'lexical', 'both'):
    idx = [i for i, r in enumerate(rows) if lane_of(r) == lane]
    if len(idx) < 50: continue
    lang = lambda r: r.get('book_language') or '?'
    c = collections.Counter(lang(rows[i]) for i in idx); exp = sum((v / len(idx)) ** 2 for v in c.values())
    obs = 0; tot = 0
    for i in idx:
        for j in nbr[i][1:]:
            tot += 1; obs += lang(rows[i]) == lang(rows[j])
    neigh_by_lane[lane] = {'n': len(idx), 'sameLanguagePct': round(100 * obs / tot, 1), 'chancePct': round(100 * exp, 1), 'lift': round(obs / tot / exp, 1) if exp else None}
print('neighbours:', neigh, neigh_by_lane)

# ---------------------------------------------------------------- lane analysis over ALL classified rows
REGS = ['testimony', 'vision-narrative', 'instruction', 'doctrine', 'fiction', 'other', 'junk']
def profile(rs):
    n = len(rs)
    if not n: return None
    exp = [r for r in rs if r.get('experiential')]
    regs = collections.Counter(r.get('register') for r in rs)
    return {
        'n': n, 'experiential': len(exp), 'experientialPct': round(100 * len(exp) / n, 1),
        'quoteVerified': sum(1 for r in exp if r.get('quote_verified')),
        'quoteVerifiedPct': round(100 * sum(1 for r in exp if r.get('quote_verified')) / len(exp), 1) if exp else 0,
        'firstPersonPct': round(100 * sum(1 for r in exp if r.get('first_person')) / len(exp), 1) if exp else 0,
        'registers': {k: regs.get(k, 0) for k in REGS},
        'registerPct': {k: round(100 * regs.get(k, 0) / n, 1) for k in REGS},
        'traditions': collections.Counter(r.get('tradition') for r in exp if r.get('tradition')).most_common(5),
        'languages': collections.Counter(r.get('book_language') or '?' for r in rs).most_common(8),
    }
by_lane = collections.defaultdict(list)
for r in allcls: by_lane[lane_of(r)].append(r)
lane_profiles = {k: profile(v) for k, v in by_lane.items()}
# lexical lane by PROBE language (the language the native term was written in); semantic probes are all English
lex_rows = [r for r in allcls if lane_of(r) in ('lexical', 'both')]
by_probe_lang = collections.defaultdict(list)
for r in lex_rows: by_probe_lang[r.get('probe_lang') or '?'].append(r)
probe_lang_profiles = sorted(
    [dict(probe_lang=k, **profile(v)) for k, v in by_probe_lang.items() if len(v) >= 25],
    key=lambda p: -p['n'])
# edition language × lane: experiential rate per language for each lane (languages with >= 40 rows in both)
by_lang_lane = collections.defaultdict(lambda: collections.defaultdict(list))
for r in allcls: by_lang_lane[r.get('book_language') or '?'][lane_of(r)].append(r)
lang_lane = []
for lang, d in by_lang_lane.items():
    s, l = d.get('semantic', []), d.get('lexical', []) + d.get('both', [])
    if len(s) >= 40 and len(l) >= 40:
        lang_lane.append({'language': lang, 'semanticN': len(s), 'semanticPct': round(100 * sum(1 for r in s if r['experiential']) / len(s), 1),
                          'lexicalN': len(l), 'lexicalPct': round(100 * sum(1 for r in l if r['experiential']) / len(l), 1)})
lang_lane.sort(key=lambda r: -(r['semanticN'] + r['lexicalN']))

# probe-dimension register split (semantic lane, as in July) — for the atlas table
register_split = []
by = collections.defaultdict(collections.Counter)
for r in allcls:
    if lane_of(r) == 'lexical': continue
    by[r.get('probe_dim') or '?'][r['register']] += 1
for dim, c in by.items():
    tot = sum(c.values())
    if tot < 25 or dim == '?': continue
    register_split.append({'dim': dim, 'n': tot, 'instruction': c['instruction'], 'testimony': c['testimony'],
                           'vision_narrative': c['vision-narrative'], 'doctrine': c['doctrine'], 'fiction': c['fiction']})
register_split.sort(key=lambda r: -(r['instruction'] / r['n'] - r['testimony'] / r['n']))

# ---------------------------------------------------------------- baseline / denominator (July random sample, same prompt)
def rate(rs, pred):
    n = len(rs); k = sum(1 for r in rs if pred(r))
    return {'n': n, 'k': k, 'pct': round(100 * k / n, 1) if n else 0}
base_exp = rate(baseline, lambda r: r['experiential'])
ret_exp = rate(allcls, lambda r: r['experiential'])
p = base_exp['k'] / base_exp['n']; n = base_exp['n']; z = 1.96
den = 1 + z * z / n
centre = (p + z * z / (2 * n)) / den
half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
corpus_pages = int(sem.get('vectors') or 4537758)

# ---------------------------------------------------------------- untranslated to-do
untr = set()
for f in ('hits-v5-untranslated.jsonl', 'hits-v5-lex-untranslated.jsonl'):
    pth = f'{V5}/{f}'
    if os.path.exists(pth):
        for r in jl(pth): untr.add(r['page_id'])
untr_books = len({p.split('#')[0] for p in untr})

# ---------------------------------------------------------------- points: full release + display sample
def payload(i, r):
    return {
        'x': round(float(xy[i][0]), 1), 'y': round(float(xy[i][1]), 1), 'c': int(labels[i]),
        'q': r['quote'], 't': r['book_title'], 'a': r.get('book_author'), 'yr': r.get('book_year'),
        'lang': r.get('book_language'), 'reg': r.get('register'), 'fp': bool(r.get('first_person')),
        'tr': r.get('tradition'), 'f': r.get('features', []), 'tg': r.get('trigger'), 'af': r.get('aftermath'),
        'ag': r.get('attributed_agent'), 'ct': bool(r.get('contested')), 'u': r['url'], 'g': bool(r.get('has_gloss')),
        'ln': LANE_CODE[lane_of(r)], 'pl': r.get('probe_lang') if lane_of(r) != 'semantic' else None,
        'pd': r.get('probe_dim'), 'id': r['page_id'],
    }
full = [payload(i, r) for i, r in enumerate(rows)]
# display sample: language-stratified round-robin so the small languages keep everything they have
by_lang = collections.defaultdict(list)
for pt in full: by_lang[pt['lang'] or '?'].append(pt)
for a in by_lang.values(): random.Random(7).shuffle(a)
if len(full) > MAX_PLOT:
    out, i = [], 0
    langs = sorted(by_lang.values(), key=len)
    while len(out) < MAX_PLOT:
        any_ = False
        for a in langs:
            if i < len(a):
                out.append(a[i]); any_ = True
                if len(out) >= MAX_PLOT: break
        if not any_: break
        i += 1
else:
    out = full
plotted_ids = {pt['id'] for pt in out}

with open(f'{V5}/v5-release.csv', 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['page_id', 'quote', 'book', 'author', 'year', 'language', 'tradition', 'register', 'features', 'trigger',
                'aftermath', 'agent', 'contested', 'first_person', 'lane', 'probe_language', 'probe_dimension', 'x', 'y', 'cluster', 'plotted', 'url'])
    for pt in full:
        w.writerow([pt['id'], pt['q'], pt['t'], pt['a'], pt['yr'], pt['lang'], pt['tr'], pt['reg'], ';'.join(pt['f']), pt['tg'],
                    pt['af'], pt['ag'], int(pt['ct']), int(pt['fp']), {'s': 'semantic', 'l': 'lexical', 'b': 'both'}[pt['ln']],
                    pt['pl'] or '', pt['pd'] or '', pt['x'], pt['y'], pt['c'], int(pt['id'] in plotted_ids), pt['u']])

lanes_plotted = collections.Counter(pt['ln'] for pt in full)
meta = {
    'edition': 'v5', 'built': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%d'),
    'count': len(out), 'countAll': len(full),
    'books': len({r['book_id'] for r in rows}),
    'works': len({r.get('work_id') or r['book_id'] for r in rows}),
    'clusters': {str(k): v for k, v in cluster_meta.items()},
    'languages': collections.Counter(pt['lang'] or '?' for pt in full).most_common(),
    'registers': collections.Counter(pt['reg'] for pt in full).most_common(),
    'traditions': collections.Counter(pt['tr'] for pt in full if pt['tr']).most_common(),
    'triggers': collections.Counter(pt['tg'] for pt in full if pt['tg']).most_common(),
    'aftermaths': collections.Counter(pt['af'] for pt in full if pt['af']).most_common(),
    'agents': collections.Counter(pt['ag'] for pt in full if pt['ag']).most_common(),
    'contested': sum(1 for pt in full if pt['ct']),
    'centuries': sorted(collections.Counter((pt['yr'] // 100 + 1) for pt in full if pt['yr']).items()),
    'features': collections.Counter(f for pt in full for f in pt['f']).most_common(),
    'registerSplit': register_split,
    'classifiedTotal': len(allcls),
    'lanesPlotted': {'semantic': lanes_plotted['s'], 'lexical': lanes_plotted['l'], 'both': lanes_plotted['b']},
    'lanes': {
        'candidates': merge.get('unique_pages'), 'foundByBoth': merge.get('found_by_both_lanes'), 'perLane': merge.get('perLane'),
        'semantic': {'probes': sem.get('probes'), 'dimensions': sem.get('dimensions'), 'strata': sem.get('strata'), 'kept': sem.get('kept'),
                     'corpusVectors': sem.get('vectors'), 'threshold': sem.get('threshold')},
        'lexical': {'terms': lex.get('probes'), 'gated': lex.get('gated'), 'zeroHit': lex.get('zero_hit_terms'), 'kept': lex.get('kept'),
                    'probeLanguages': len(by_probe_lang)},
        'profiles': lane_profiles, 'byProbeLanguage': probe_lang_profiles, 'byLanguage': lang_lane,
        'neighbours': neigh, 'neighboursByLane': neigh_by_lane,
        'untranslatedPages': len(untr), 'untranslatedBooks': untr_books,
    },
    'baseline': {
        'sample': base_exp['n'], 'experientialPct': base_exp['pct'], 'retrievedExperientialPct': ret_exp['pct'],
        'enrichment': round(ret_exp['pct'] / base_exp['pct'], 1) if base_exp['pct'] else None,
        'ciLowPct': round(100 * (centre - half), 1), 'ciHighPct': round(100 * (centre + half), 1),
        'corpusPages': corpus_pages,
        'projectedLowK': round(corpus_pages * (centre - half) / 1000), 'projectedHighK': round(corpus_pages * (centre + half) / 1000),
        'corpusLanguages': collections.Counter(r.get('book_language') or '?' for r in baseline).most_common(10),
        'baselineRegisters': collections.Counter(r['register'] for r in baseline).most_common(),
        'sampledFrom': 'July 2026 random sample of the translated corpus, same classifier prompt',
    },
}
json.dump({'meta': meta, 'points': out}, open(f'{V5}/map-data-v5.json', 'w'), ensure_ascii=False, separators=(',', ':'))
numbers = {
    'candidates': merge.get('unique_pages'), 'foundByBoth': merge.get('found_by_both_lanes'), 'perLane': merge.get('perLane'),
    'classified': len(allcls), 'experientialAll': ret_exp['k'], 'experientialPctAll': ret_exp['pct'],
    'points': len(full), 'plotted': len(out), 'books': meta['books'], 'works': meta['works'], 'languages': len(meta['languages']),
    'laneProfiles': {k: {kk: v[kk] for kk in ('n', 'experiential', 'experientialPct', 'quoteVerifiedPct', 'registerPct')} for k, v in lane_profiles.items() if v},
    'untranslatedPages': len(untr), 'untranslatedBooks': untr_books,
    'neighbours': neigh, 'neighboursByLane': neigh_by_lane, 'baseline': meta['baseline'],
}
json.dump(numbers, open(f'{V5}/v5-numbers.json', 'w'), indent=1)
print(f"wrote map-data-v5.json — {len(out)} plotted of {len(full)} points, {meta['books']} books, {meta['works']} works")
print(f"lanes (all classified): " + ', '.join(f"{k}: n={v['n']} exp={v['experientialPct']}%" for k, v in lane_profiles.items() if v))
print(f"baseline {base_exp['pct']}% vs retrieved {ret_exp['pct']}% = {meta['baseline']['enrichment']}x; untranslated to-do {len(untr)} pages in {untr_books} books")
for c, m in cluster_meta.items():
    print(f"  {c:2} n={m['size']:5} {m['label'][:40]:40} {m['lanes'][:2]}")
