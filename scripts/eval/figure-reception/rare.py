# Rarely told: the claims about a figure that no other work in the library makes in similar words (#7073).
# Usage: python3 scripts/eval/figure-reception/rare.py <figure> [--show N]   → <out>/rare.json
#
# PRIOR ART: map.py and tree.py embed only the reported sayings (passages flagged q) and draw what is COMMON —
# themes and lines of retelling. This looks at the other end of the same harvest: every passage that names the
# figure, whether or not it reports a saying, ranked by how unlike every other work it is. That is where the
# out-of-the-mainstream material sits — a legend told once, a spurious fragment, a book that borrowed his name.
# Spurious and legendary claims are kept on purpose; the list says what a book claims, not whether it is true.
#
# Rarity of a passage = its highest cosine similarity (nomic-embed-text, local ollama, free) to any passage in a
# DIFFERENT work (work_id), so reprints and editions of one work do not vouch for each other. A passage is listed
# when that is below RARE (0.84, set by reading the Philolaus list on 2026-10-22: above it the closest passage
# elsewhere makes the same claim; below it, it rarely does) and it is a claim about him: a reported saying (q), or
# his name near a verb of attributing (CLAIM); at most three from any one work. Dropped first: index and apparatus lines (citation numbers), the
# Greek word philolaos (lower case), passages set aside in figures.json, and figures.json `rare.skipTitles` /
# `rare.skipText` (other men of the name, fictional speakers). `rare.notes` attach a sentence for the reader where a
# passage means something other than it seems (Boulliau's own book titled Philolaus, 1639).
#
# Output: {threshold, total (passages considered), items: [[year, book id, page, passage, title, q 0|1,
# closeWorks (other works at >= 0.80), note index or -1]], notes: [str]} sorted by year. Year = when written
# (dating.py).
import json, os, re, sys, urllib.request
import numpy as np
from dating import written_year

RARE, CLOSE = 0.84, 0.80
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
KEY = sys.argv[1]
SHOW = int(sys.argv[sys.argv.index('--show') + 1]) if '--show' in sys.argv else 0
F = json.load(open(os.path.join(HERE, 'figures.json')))[KEY]
R = F.get('rare', {})
W = os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), KEY)

NAME = re.compile(r'\b(' + F['name'] + r')\b', re.I)
ATTRIB = ('calls?|called|localizes|locates|places|placed|measured|measures|demonstrates|demonstrated|recogni[sz]ed|'
          'postulated?|admitted|admits|explains?|explained|considers?|considered|reckons?|reckoned|attributes?|attributed|'
          'ascribes?|ascribed|assigns?|assigned|makes|made|gives|gave|derives?|derived|supposed|supposes|judged|judges|knew|'
          'discovered|invented|found|introduced|established|taught|teaches|testifies|testified|mentions?|mentioned|relates?|'
          'related|reports?|reported|records?|recorded|tells|told|claims?|claimed|denied|denies|refutes?|refuted|believed?|'
          'believes|thought|thinks|held|holds|says?|said|wrote|writes|declared?|declares|affirm(s|ed)?|maintain(s|ed)?|'
          'as pleases|would have it|was the first|first to')
CLAIM = re.compile(r'\b(' + F['name'] + r')\b[^.;:]{0,60}?\b(' + ATTRIB + r')\b|\b(' + ATTRIB + r')\b[^.;:]{0,40}?\b(' +
                   F['name'] + r")\b|\b(" + F['name'] + r")['’]s\s", re.I)
APPARATUS = re.compile(r'\b[AB] ?\d+[a-z]? \(\d+, ?\d+|\bletter [A-Z], page \d+|(\b\d{1,4},? [A-Z][a-z]+\b.*){3}')
SKIP = {'index', 'toc', 'errata', 'title-page', 'blank', 'digitizer-notice', 'digitizer-insert', 'colophon'}
skip_t = re.compile(R.get('skipTitles', '^$'), re.I)
skip_x = re.compile(R.get('skipText', '^$'), re.I)
aside = [tuple(re.compile(a.get(k, d), re.I) for k, d in (('titles', ''), ('unless', '^$'), ('text', ''))) for a in F.get('setAside', [])]
notes = [(re.compile(n['match'], re.I), n['note']) for n in R.get('notes', [])]  # match: the title, or the passage

rows, seen = [], set()
for b in json.load(open(os.path.join(W, 'hits.json'))):
    if not b.get('v') or not b.get('pc') or skip_t.search(b.get('t') or ''):
        continue
    for p in b['passages']:
        if p['p'] <= 0 or p.get('type') in SKIP:  # soft-hidden duplicate page (harvest.mjs)
            continue
        s = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', p['s'])).strip(' …')
        m = NAME.search(s)
        if len(s) < 60 or not m or not m.group(0)[0].isupper() or APPARATUS.search(s) or len(re.findall(r'\d+', s)) >= 8:
            continue
        if skip_x.search(s) or any(t.search(b.get('t') or '') and x.search(s) and not u.search(s) for t, u, x in aside):
            continue
        k = re.sub(r'\W+', '', s.lower())[:160]
        if k in seen:
            continue
        seen.add(k)
        note = next((i for i, (x, _) in enumerate(notes) if x.search(b.get('t') or '') or x.search(s)), -1)
        rows.append({'id': b['id'], 'p': p['p'], 's': s[:400], 'y': written_year(b['id'], b.get('y'), p.get('type'), s),
                     't': b.get('t') or '', 'w': b.get('w') or b['id'], 'q': 1 if p['q'] else 0, 'claim': bool(p['q'] or CLAIM.search(s)), 'note': note})
print('passages', len(rows), file=sys.stderr)


def embed(texts):
    req = urllib.request.Request('http://localhost:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': ['clustering: ' + t for t in texts]}).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=600))['embeddings']


# Embeddings are cached by passage, so a filter change re-embeds only what is new.
cache, kfile = os.path.join(W, 'rare-emb.npy'), os.path.join(W, 'rare-keys.json')
keys = [r['id'] + ':' + str(r['p']) + ':' + r['s'][:40] for r in rows]
have = dict(zip(json.load(open(kfile)), np.load(cache))) if os.path.exists(cache) and os.path.exists(kfile) else {}
todo = [i for i, k in enumerate(keys) if k not in have]
for n in range(0, len(todo), 128):
    for i, v in zip(todo[n:n + 128], embed([rows[i]['s'] for i in todo[n:n + 128]])):
        v = np.array(v, dtype=np.float32)
        have[keys[i]] = v / np.linalg.norm(v)
    print(f'\rembedded {min(n + 128, len(todo))}/{len(todo)}', end='', file=sys.stderr)
E = np.stack([have[k] for k in keys]) if keys else np.zeros((0, 768), np.float32)
if todo:
    np.save(cache, E)
    json.dump(keys, open(kfile, 'w'))

# Nearest passage in another work, in blocks so the largest figure (~50K passages) fits in memory.
wid = np.array([hash(r['w']) for r in rows])
best = np.zeros(len(rows), np.float32)
close = np.zeros(len(rows), np.int32)
for i in range(0, len(rows), 2048):
    S = E[i:i + 2048] @ E.T
    S[wid[i:i + 2048, None] == wid[None, :]] = -1
    best[i:i + 2048] = S.max(1)
    # count distinct other works with a close passage
    for j in range(S.shape[0]):
        close[i + j] = len(set(wid[S[j] >= CLOSE]))

# At most PER_WORK from any one work, the rarest first, so one long commentary cannot fill the list.
PER_WORK = 3
pick, per = [], {}
for i in sorted((i for i, r in enumerate(rows) if r['claim'] and best[i] < RARE), key=lambda i: best[i]):
    if per.get(rows[i]['w'], 0) < PER_WORK:
        per[rows[i]['w']] = per.get(rows[i]['w'], 0) + 1
        pick.append(i)
pick.sort(key=lambda i: (rows[i]['y'] is None, rows[i]['y'] or 0, rows[i]['id'], rows[i]['p']))
items = [[rows[i]['y'], rows[i]['id'], rows[i]['p'], rows[i]['s'][:320], rows[i]['t'][:80], rows[i]['q'], int(close[i]), rows[i]['note']] for i in pick]
OUT = os.path.join(REPO, F['out'], 'rare.json')
json.dump({'threshold': RARE, 'total': len(rows), 'items': items, 'notes': [n for _, n in notes]}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'\n{KEY}: {len(rows)} passages, {sum(r["claim"] for r in rows)} claims, {len(items)} rare → {OUT} ({os.path.getsize(OUT)} bytes)', file=sys.stderr)
for i in sorted(pick, key=lambda i: best[i])[:SHOW]:
    r = rows[i]
    print(f"{best[i]:.2f} {close[i]:2d} {r['y']} {'Q' if r['q'] else ' '}{'N' if r['note'] >= 0 else ' '} {r['t'][:26]:26} p{r['p']} | {r['s'][:200]}")
