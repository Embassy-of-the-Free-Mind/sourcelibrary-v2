# Add newly harvested reported sayings to an existing theme map without re-clustering it (#7073).
# Usage: python3 scripts/eval/figure-reception/extend.py <figure>   (after harvest.mjs; then prep-map.py, tree.py)
#
# PRIOR ART: map.py builds the map from scratch (UMAP + HDBSCAN). Re-running it after the harvest widens — as it did
# on 2026-10-22, when "speaks thus:" and other verbs that introduce a quotation began to count — would renumber
# every theme and throw away the theme names written by hand from the samples. This keeps the map and places each
# new passage by its nearest neighbours instead: its theme is the one most of its ten nearest mapped passages
# belong to (sim-weighted), if the nearest is at least NEAR similar, else unassigned; its position is the
# sim-weighted mean of its five nearest. figures.json setAside rules still apply first. Passages whose page is
# no longer public are dropped. Embeddings reuse rare.py's cache (same text, same model).
import json, os, re, sys, collections, urllib.request
import numpy as np

NEAR = 0.80
HERE = os.path.dirname(os.path.abspath(__file__))
KEY = sys.argv[1]
F = json.load(open(os.path.join(HERE, 'figures.json')))[KEY]
W = os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), KEY)

pts = json.load(open(os.path.join(W, 'map-points.json')))
E = np.load(os.path.join(W, 'emb.npy'))
assert len(E) == len(pts['points'])
books = json.load(open(os.path.join(W, 'hits.json')))
public = {(b['id'], p['p']) for b in books if b.get('v') and b.get('pc') for p in b['passages']}
keep = [i for i, p in enumerate(pts['points']) if (p['id'], p['p']) in public]
P, E = [pts['points'][i] for i in keep], E[keep]
norm = lambda s: re.sub(r'\W+', '', s.lower())[:160]
seen = {norm(p['s']) for p in P}

new = []
for b in books:
    if not b.get('v') or not b.get('pc'):
        continue
    for p in b['passages']:
        if not p['q'] or p['p'] <= 0 or p.get('type') in ('index', 'toc', 'errata', 'title-page', 'blank'):
            continue
        s = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', p['s'])).strip(' …')
        if len(s) < 40 or norm(s) in seen:
            continue
        seen.add(norm(s))
        new.append({'id': b['id'], 'p': p['p'], 's': s[:400], 'y': b.get('y'), 'l': b.get('lang'), 't': b.get('t')})
print(f'{KEY}: kept {len(P)} of {len(pts["points"])} mapped passages, {len(new)} new', file=sys.stderr)

cache, kfile = os.path.join(W, 'rare-emb.npy'), os.path.join(W, 'rare-keys.json')
have = dict(zip(json.load(open(kfile)), np.load(cache))) if os.path.exists(kfile) else {}


def embed(texts):
    req = urllib.request.Request('http://localhost:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': ['clustering: ' + t for t in texts]}).encode(), headers={'content-type': 'application/json'})
    v = np.array(json.load(urllib.request.urlopen(req, timeout=600))['embeddings'], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


keys = [r['id'] + ':' + str(r['p']) + ':' + r['s'][:40] for r in new]
todo = [i for i, k in enumerate(keys) if k not in have]
for n in range(0, len(todo), 128):
    for i, v in zip(todo[n:n + 128], embed([new[i]['s'] for i in todo[n:n + 128]])):
        have[keys[i]] = v
print(f'embedded {len(todo)}, reused {len(new) - len(todo)}', file=sys.stderr)
N = np.stack([have[k] for k in keys]) if new else np.zeros((0, E.shape[1]), np.float32)

aside = [(a['theme'],) + tuple(re.compile(a.get(k, d), re.I) for k, d in (('titles', ''), ('unless', '^$'), ('text', ''))) for a in F.get('setAside', [])]
lab = np.array([p['c'] for p in P])
xy = np.array([[p['x'], p['y']] for p in P])
added = collections.Counter()
for r, v in zip(new, N):
    s = E @ v
    top = np.argsort(-s)[:10]
    c = next((th for th, t, u, x in aside if t.search(r['t'] or '') and x.search(r['s']) and not u.search(r['s'])), None)
    if c is None:
        votes = collections.Counter()
        for j in top:
            votes[int(lab[j])] += float(s[j])
        c = votes.most_common(1)[0][0] if s[top[0]] >= NEAR else -1
    w = np.clip(s[top[:5]], 0, None) + 1e-6
    x, y = (xy[top[:5]] * w[:, None]).sum(0) / w.sum()
    P.append({'x': round(float(x), 3), 'y': round(float(y), 3), 'c': int(c), 'yr': r['y'], 'id': r['id'], 'p': r['p'], 's': r['s'][:300],
              't': (r['t'] or '')[:90], 'l': r['l'], 'd': 0, 'added': 1})
    added[int(c)] += 1
E = np.concatenate([E, N])
json.dump({**pts, 'points': P}, open(os.path.join(W, 'map-points.json'), 'w'), ensure_ascii=False)
np.save(os.path.join(W, 'emb.npy'), E)
print(f'{KEY}: map now {len(P)} passages; new by theme {dict(added.most_common())}', file=sys.stderr)
