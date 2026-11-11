"""Rollout check (#7119): on every edition-anchored leaf, the CER of each of the four candidate reads and of the judge's
pick against the leaf's located edition span ±200 characters, with the stability test's per-row scorer.
PRIOR ART: ./score_gate.py (the same scorer on the 9 gate leaves) and ../whish147-best-attempt-2026-10-22/score-all.py
(the stored fresh read vs the anchored text on all anchored leaves, by collation excerpt); this scores four reads and the
pick by locate span, for all three works (the Jayamaṅgalā leaves are partly Malayalam, so their CER is a rough signal).
Usage: JOB_SCRATCH=<dir with editions/> python score_picks.py   -> pick-scores.json
"""
import json, os, re, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ['JOB_SCRATCH']
sys.path.insert(0, HERE)
from score_lib import norm, mal2iast, best  # noqa: E402

BA = os.path.join(HERE, '..', 'whish147-best-attempt-2026-10-22')
LOC = {}
for f in 'ABC':
    LOC.update(json.load(open(f'{BA}/locate-{f}.json')))
ED = {}
picks = json.load(open(f'{HERE}/picks.json'))
CANDS = ['opus-1', 'opus-2', 'opus-3', 'fable-1']


def rows(stage, key):
    f = f'{HERE}/reads/{stage}/{key}.txt'
    if not os.path.exists(f): return None
    return [norm(mal2iast(m.group(1))) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f, encoding='utf8').read(), re.M)]


out = {}
for key, p in picks.items():
    l = LOC.get(key)
    if not l or l.get('start') is None or not p.get('pick'): continue
    w = l['work']
    if w not in ED: ED[w] = open(f'{S}/editions/{w}.txt').read()
    t = ED[w]; ref = norm(t[max(0, l['start'] - 200):min(len(t), l['end'] + 200)])
    sc = {}
    for c in CANDS:
        r = rows(c, key)
        if r is None: continue
        segs = [x for x in r if len(x) >= 8]; n = sum(map(len, segs))
        sc[c] = dict(d=sum(best(x, ref)[0] for x in segs), n=n)
    out[key] = dict(n=p['n'], work=w, pick=p['pick'], scores=sc)

json.dump(out, open(f'{HERE}/pick-scores.json', 'w'), indent=0)
cer = lambda v: v['d'] / v['n'] if v and v['n'] else None
for w in sorted({v['work'] for v in out.values()}):
    vs = [v for v in out.values() if v['work'] == w and 'opus-1' in v['scores'] and v['pick'] in v['scores']]
    if not vs: continue
    def pooled(sel):
        D = sum(sel(v)['d'] for v in vs); N = sum(sel(v)['n'] for v in vs); return round(D / N, 3) if N else None
    best_ = lambda v: min((x for x in v['scores'].values() if x['n']), key=cer, default={'d': 0, 'n': 0})
    print(f"{w}: {len(vs)} leaves; stored read {pooled(lambda v: v['scores']['opus-1'])}, every read "
          f"{round(sum(x['d'] for v in vs for x in v['scores'].values()) / max(1, sum(x['n'] for v in vs for x in v['scores'].values())), 3)}, "
          f"pick {pooled(lambda v: v['scores'][v['pick']])}, oracle {pooled(best_)}; pick changed on {sum(1 for v in vs if v['pick'] != 'opus-1')}")
