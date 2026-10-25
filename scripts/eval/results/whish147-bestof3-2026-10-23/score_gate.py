"""Score the best-of-N judges' picks on the 9 verse leaves (#7119) with the stability test's per-row scorer.
PRIOR ART: ../whish147-stability-recall-2026-10-23/score.py (branch eval/whish147-stability-recall) — its per-read
d/chars (best-window CER per row of 8+ characters, edition span ±200) is reused through score_lib unchanged; this adds
the judges' picks, the random-pick expectation and the best-of-N oracles.
Usage: JOB_SCRATCH=<dir with editions/> STAB=<stability results dir> python score_gate.py  -> gate-scores.json
"""
import json, os, re, statistics as st, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from score_lib import norm, mal2iast, best, ref_for, VERSE  # noqa: E402

STAB = os.environ['STAB']
picks = json.load(open(f'{HERE}/gate-picks.json'))
OPUS = ['opus-1', 'opus-2', 'opus-3']; FABLE = ['fable-1', 'fable-2', 'fable-3']


def score_rows(rows, leaf):
    ref = ref_for(leaf)
    segs = [x for x in (norm(mal2iast(r)) for r in rows) if len(x) >= 8]
    d = sum(best(x, ref)[0] for x in segs); n = sum(len(x) for x in segs)
    return d, n


def read_rows(stage, leaf):
    t = open(f'{STAB}/reads/{stage}/{leaf}.txt', encoding='utf8').read()
    return [m.group(1) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', t, re.M)]


R = {(sg, leaf): score_rows(read_rows(sg, leaf), leaf) for sg in OPUS + FABLE for leaf in VERSE}
cer = lambda dn: dn[0] / dn[1] if dn[1] else None


def agg(per):  # per: {leaf: (d, n)}
    D = sum(v[0] for v in per.values()); N = sum(v[1] for v in per.values())
    return dict(pooled=round(D / N, 3), mean=round(st.mean(cer(v) for v in per.values()), 3), chars=N,
                per_leaf={k: round(cer(v), 3) for k, v in per.items()})


arms = {}
for name, stages in (('opus3', OPUS), ('opus3fable1', OPUS + FABLE[:1]), ('all6', OPUS + FABLE)):
    # pooled over every read (what one random read gives), and the oracle (best read per leaf, by CER)
    allr = {f'{leaf}|{sg}': R[(sg, leaf)] for leaf in VERSE for sg in stages}
    D = sum(v[0] for v in allr.values()); N = sum(v[1] for v in allr.values())
    arms[f'{name}: every read (random pick)'] = dict(pooled=round(D / N, 3), chars=N)
    arms[f'{name}: oracle best'] = agg({leaf: min((R[(sg, leaf)] for sg in stages), key=cer) for leaf in VERSE})
    arms[f'{name}: oracle worst'] = agg({leaf: max((R[(sg, leaf)] for sg in stages), key=cer) for leaf in VERSE})
    for kind in ('text', 'image', 'rows'):
        per, chosen = {}, {}
        for leaf in VERSE:
            p = picks.get(f'{kind}|{name}|{leaf}')
            if not p: continue
            if p.get('pick') == 'rows':
                per[leaf] = score_rows(p['rows'], leaf); chosen[leaf] = 'rows'
            elif p.get('pick'):
                per[leaf] = R[(p['pick'], leaf)]; chosen[leaf] = p['pick']
        if len(per) == len(VERSE):
            a = agg(per); a['picked'] = chosen
            a['oracle_hits'] = sum(1 for leaf in VERSE if chosen[leaf] != 'rows' and cer(R[(chosen[leaf], leaf)]) == min(cer(R[(sg, leaf)]) for sg in stages))
            arms[f'{name}: J-{kind}'] = a
        elif per:
            arms[f'{name}: J-{kind} (partial {len(per)}/9)'] = dict(picked=chosen)

json.dump(arms, open(f'{HERE}/gate-scores.json', 'w'), indent=1, ensure_ascii=False)
for k, v in arms.items():
    print(f"{k:34} pooled {v.get('pooled')}  mean {v.get('mean', '')}  chars {v.get('chars', '')}  {v.get('per_leaf', '')}  hits {v.get('oracle_hits', '')}")
