# PRIOR ART: scripts/eval/figure-reception/prep-map.py (#7073) publishes a figure's map.json for FigureMap and ThemeRiver;
#   this writes the same shape from the harmony probe retrieval, so the same two components draw it unchanged.
# Families = the eight kinds of harmony the probes were written for; themes = the 48 probes (each dot sits in the probe
# whose page it was retrieved for at its highest similarity). The passage shown is the 240-character window of the page
# that shares most content words with its probe: a pointer, not a quotation chosen by a reader.
#   python3 scripts/eval/harmony-semantic/prep-map.py <run-dir> <out-dir>
# Writes <out-dir>/map.json and <out-dir>/semantic-report.json (per probe: hits, never naming harmony, five best).
import json, sys, os, re, collections
RUN, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
P = json.load(open(os.path.join(HERE, 'probes.json')))
pts = json.load(open(os.path.join(RUN, 'semantic-points.json')))['points']
fam = [{'key': d['id'], 'name': d['label']} for d in P['dimensions']]
probes = [(d['id'], p) for d in P['dimensions'] for p in d['probes']]
STOP = set('the a an and or of to in on is are be by as at it its that this with for from when one two each their his her they them which who not no so but if then there these those into same other others all every most more than'.split())
words = lambda s: [w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2 and w not in STOP]
hits = {}
for l in open(os.path.join(RUN, 'hits.jsonl')):
    r = json.loads(l); k = (r['b'], r['p'])
    if k not in hits or r['sim'] > hits[k]['sim']: hits[k] = r
def window(text, probe, n=240):
    ws = set(words(probe)); best, at = -1, 0
    for i in range(0, max(1, len(text) - n), 40):
        sc = sum(1 for w in words(text[i:i + n]) if w in ws)
        if sc > best: best, at = sc, i
    s = text[at:at + n]; return ('… ' if at else '') + s.strip() + (' …' if at + n < len(text) else '')
idx = {p: i for i, (_, p) in enumerate(probes)}
rows = []
# each point carries its /q link; the hit it came from has the book, page, year and probe
by_q = {r['q'].replace('https://sourcelibrary.org', ''): r for r in hits.values()}
for q in pts:
    h = by_q[q['q']]; c = idx[h['probe']]
    rows.append([q['x'], q['y'], c, h['year'], h['b'], h['p'], window(h['text'], h['probe']), (h['title'] or '')[:90]])
n = collections.Counter(r[2] for r in rows); yrs = collections.defaultdict(list)
for r in rows:
    if r[3] is not None: yrs[r[2]].append(r[3])
themes = [{'c': i, 'name': p, 'family': d, 'n': n[i], 'earliest': min(yrs[i]) if yrs[i] else None,
           'median': sorted(yrs[i])[len(yrs[i]) // 2] if yrs[i] else None} for i, (d, p) in enumerate(probes)]
json.dump({'families': fam, 'themes': themes, 'rows': rows}, open(os.path.join(OUT, 'map.json'), 'w'), ensure_ascii=False)
rep = json.load(open(os.path.join(RUN, 'report.json')))
json.dump(rep, open(os.path.join(OUT, 'semantic-report.json'), 'w'), ensure_ascii=False)
print('rows', len(rows), 'themes', len(themes), file=sys.stderr)
