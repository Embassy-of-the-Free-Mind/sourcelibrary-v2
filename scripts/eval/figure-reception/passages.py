# Every passage that names a figure, filtered and embedded once, for rare.py and diels.py (#7073).
# PRIOR ART: this is rare.py's own loader, moved here unchanged so diels.py tags exactly the passages the Told once
# list ranks (same filters, same embedding cache); map.py and extend.py keep their own loaders for reported sayings.
#
# Kept: public books, public pages (p > 0), the name capitalised, passages of 60+ characters. Dropped: index and
# apparatus lines (citation numbers), garbled pages, passages set aside in figures.json, and figures.json
# `rare.skipTitles` / `rare.skipText` (other men of the name, fictional speakers). `claim` = a reported saying (q) or
# the name near a verb of attributing (CLAIM). `rare.notes` attach a sentence where a passage means something other
# than it seems. Embeddings: nomic-embed-text on local ollama ("clustering:" prefix, as map.py), cached by passage in
# <work>/rare-emb.npy + rare-keys.json, so a filter change re-embeds only what is new.
import json, os, re, sys, urllib.request
import numpy as np
from dating import written_year

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../..'))
ATTRIB = ('calls?|called|localizes|locates|places|placed|measured|measures|demonstrates|demonstrated|recogni[sz]ed|'
          'postulated?|admitted|admits|explains?|explained|considers?|considered|reckons?|reckoned|attributes?|attributed|'
          'ascribes?|ascribed|assigns?|assigned|makes|made|gives|gave|derives?|derived|supposed|supposes|judged|judges|knew|'
          'discovered|invented|found|introduced|established|taught|teaches|testifies|testified|mentions?|mentioned|relates?|'
          'related|reports?|reported|records?|recorded|tells|told|claims?|claimed|denied|denies|refutes?|refuted|believed?|'
          'believes|thought|thinks|held|holds|says?|said|wrote|writes|declared?|declares|affirm(s|ed)?|maintain(s|ed)?|'
          'as pleases|would have it|was the first|first to')
APPARATUS = re.compile(r'\b[AB] ?\d+[a-z]? \(\d+, ?\d+|\bletter [A-Z], page \d+|(\b\d{1,4},? [A-Z][a-z]+\b.*){3}')
SKIP = {'index', 'toc', 'errata', 'title-page', 'blank', 'digitizer-notice', 'digitizer-insert', 'colophon'}


def figure(key):
    """figures.json entry and work directory for a figure."""
    F = json.load(open(os.path.join(HERE, 'figures.json')))[key]
    return F, os.path.join(os.environ.get('FIGURE_WORK', os.path.expanduser('~/sl-work/figure-reception')), key)


def passage_key(book_id, page, s):
    """How the published files and the page match one passage: book, page and the start of its text."""
    return f"{book_id}:{page}:{re.sub(r'[^a-z0-9]+', '', s.lower())[:30]}"


def load_rows(key):
    """(rows, notes): every passage naming the figure, as rare.py ranks them."""
    F, W = figure(key)
    R = F.get('rare', {})
    NAME = re.compile(r'\b(' + F['name'] + r')\b', re.I)
    CLAIM = re.compile(r'\b(' + F['name'] + r')\b[^.;:]{0,60}?\b(' + ATTRIB + r')\b|\b(' + ATTRIB + r')\b[^.;:]{0,40}?\b(' +
                       F['name'] + r")\b|\b(" + F['name'] + r")['’]s\s", re.I)
    skip_t = re.compile(R.get('skipTitles', '^$'), re.I)
    skip_x = re.compile(R.get('skipText', '^$'), re.I)
    aside = [tuple(re.compile(a.get(k, d), re.I) for k, d in (('titles', ''), ('unless', '^$'), ('text', ''))) for a in F.get('setAside', [])]
    notes = [(re.compile(n['match'], re.I), n['note']) for n in R.get('notes', [])]  # match: the title, or the passage

    # Rarity is judged against other AUTHORS, not just other works: two translations of one Vitruvius sentence are
    # catalogued as different works but are not two witnesses.
    AUTHOR = {}
    for l in open(os.path.expanduser('~/sl-corpus/catalog.jsonl')):
        d = json.loads(l)
        if d.get('author_id'):
            AUTHOR[d['id']] = d['author_id']
    rows, seen = [], set()
    for b in json.load(open(os.path.join(W, 'hits.json'))):
        if not b.get('v') or not b.get('pc') or skip_t.search(b.get('t') or ''):
            continue
        for p in b['passages']:
            if p['p'] <= 0 or p.get('type') in SKIP:  # soft-hidden duplicate page (harvest.mjs)
                continue
            s = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', p['s'])).strip(' …')
            m = NAME.search(s)
            if len(s) < 60 or not m or not m.group(0)[0].isupper() or APPARATUS.search(s) or len(re.findall(r'\d+', s)) >= 8 or s.count(' / ') >= 4 or s.count('[') >= 6:  # the last two: a garbled page
                continue
            if skip_x.search(s) or any(t.search(b.get('t') or '') and x.search(s) and not u.search(s) for t, u, x in aside):
                continue
            k = re.sub(r'\W+', '', s.lower())[:160]
            if k in seen:
                continue
            seen.add(k)
            note = next((i for i, (x, _) in enumerate(notes) if x.search(b.get('t') or '') or x.search(s)), -1)
            rows.append({'id': b['id'], 'p': p['p'], 's': s[:400], 'y': written_year(b['id'], b.get('y'), p.get('type'), s, p['p']),
                         'ey': b.get('y'), 't': b.get('t') or '', 'w': b.get('w') or b['id'], 'a': AUTHOR.get(b['id']) or b.get('w') or b['id'], 'q': 1 if p['q'] else 0, 'claim': bool(p['q'] or CLAIM.search(s)), 'note': note})
    print('passages', len(rows), file=sys.stderr)
    return rows, [n for _, n in notes]


def embed(texts):
    """Unit vectors from nomic-embed-text on local ollama (free), "clustering:" prefix as map.py."""
    req = urllib.request.Request('http://localhost:11434/api/embed', data=json.dumps({'model': 'nomic-embed-text', 'input': ['clustering: ' + t for t in texts]}).encode(), headers={'content-type': 'application/json'})
    v = np.array(json.load(urllib.request.urlopen(req, timeout=600))['embeddings'], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def embed_rows(key, rows):
    """One vector per row, from the passage cache; only passages not seen before are embedded."""
    _, W = figure(key)
    cache, kfile = os.path.join(W, 'rare-emb.npy'), os.path.join(W, 'rare-keys.json')
    keys = [r['id'] + ':' + str(r['p']) + ':' + r['s'][:40] for r in rows]
    have = dict(zip(json.load(open(kfile)), np.load(cache))) if os.path.exists(cache) and os.path.exists(kfile) else {}
    todo = [i for i, k in enumerate(keys) if k not in have]
    for n in range(0, len(todo), 128):
        for i, v in zip(todo[n:n + 128], embed([rows[i]['s'] for i in todo[n:n + 128]])):
            have[keys[i]] = v
        print(f'\rembedded {min(n + 128, len(todo))}/{len(todo)}', end='', file=sys.stderr)
    E = np.stack([have[k] for k in keys]) if keys else np.zeros((0, 768), np.float32)
    if todo:
        np.save(cache, E)
        json.dump(keys, open(kfile, 'w'))
    return E
