# Rarely told: the claims about a figure that no other work in the library makes in similar words (#7073).
# Usage: python3 scripts/eval/figure-reception/rare.py <figure> [--show N]   → <out>/rare.json
#
# PRIOR ART: map.py and tree.py embed only the reported sayings (passages flagged q) and draw what is COMMON —
# themes and lines of retelling. This looks at the other end of the same harvest: every passage that names the
# figure, whether or not it reports a saying, ranked by how unlike every other work it is. That is where the
# out-of-the-mainstream material sits — a legend told once, a spurious fragment, a book that borrowed his name.
# Spurious and legendary claims are kept on purpose; the list says what a book claims, not whether it is true.
#
# Rarity of a passage = its highest cosine similarity (nomic-embed-text, local ollama, free) to any passage by a
# DIFFERENT author (author_id, else work_id), so reprints, editions and translations of one author do not vouch
# for each other. A passage is listed
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
import json, os, sys
import numpy as np
from passages import REPO, figure, load_rows, embed_rows

RARE, CLOSE = 0.84, 0.80
KEY = sys.argv[1]
SHOW = int(sys.argv[sys.argv.index('--show') + 1]) if '--show' in sys.argv else 0
F, W = figure(KEY)
rows, notes = load_rows(KEY)
E = embed_rows(KEY, rows)

# Nearest passage in another work, in blocks so the largest figure (~50K passages) fits in memory.
wid = np.array([hash(r['a']) for r in rows])
best = np.zeros(len(rows), np.float32)
close = np.zeros(len(rows), np.int32)
for i in range(0, len(rows), 2048):
    S = E[i:i + 2048] @ E.T
    S[wid[i:i + 2048, None] == wid[None, :]] = -1
    best[i:i + 2048] = S.max(1)
    # count distinct other works with a close passage
    for j in range(S.shape[0]):
        close[i + j] = len(set(wid[S[j] >= CLOSE]))

# At most PER_WORK from any one author, the rarest first, so one long commentary cannot fill the list,
PER_WORK = 3
pick, per = [], {}
for i in sorted((i for i, r in enumerate(rows) if r['claim'] and best[i] < RARE), key=lambda i: best[i]):
    # and one telling of each claim: another edition or translation of the same sentence is skipped
    if per.get(rows[i]['a'], 0) < PER_WORK and not any(E[i] @ E[j] >= CLOSE for j in pick):
        per[rows[i]['a']] = per.get(rows[i]['a'], 0) + 1
        pick.append(i)
pick.sort(key=lambda i: (rows[i]['y'] is None, rows[i]['y'] or 0, rows[i]['id'], rows[i]['p']))
items = [[rows[i]['y'], rows[i]['id'], rows[i]['p'], rows[i]['s'][:320], rows[i]['t'][:80], rows[i]['q'], int(close[i]), rows[i]['note']] for i in pick]
OUT = os.path.join(REPO, F['out'], 'rare.json')
json.dump({'threshold': RARE, 'total': len(rows), 'items': items, 'notes': notes}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print(f'\n{KEY}: {len(rows)} passages, {sum(r["claim"] for r in rows)} claims, {len(items)} rare → {OUT} ({os.path.getsize(OUT)} bytes)', file=sys.stderr)
for i in sorted(pick, key=lambda i: best[i])[:SHOW]:
    r = rows[i]
    print(f"{best[i]:.2f} {close[i]:2d} {r['y']} {'Q' if r['q'] else ' '}{'N' if r['note'] >= 0 else ' '} {r['t'][:26]:26} p{r['p']} | {r['s'][:200]}")
