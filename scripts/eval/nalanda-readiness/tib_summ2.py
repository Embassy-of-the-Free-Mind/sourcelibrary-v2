# PRIOR ART: ops eval-tibetan/mss_report.py summarises the 2026-09-04 bench's arms; this rolls up kanjur_align scores by stratum x served verdict for the 2026-09-30 draw.
import json, statistics as st, collections
S={r['id']:r for r in map(json.loads,open('tib/scores.jsonl'))}
meta={r['id']:r for r in map(json.loads,open('tib-sample.jsonl'))}
V=json.load(open('tib-sample-verdicts.json'))
g=collections.defaultdict(list)
for i,r in S.items():
    m=meta[i]; v=V.get(i) or {}
    g[(m['stratum'], (v.get('v') or 'none')+':'+(v.get('rule') or '-'))].append((r['identity'], v.get('wood')))
for k in sorted(g):
    ids=sorted(x[0] for x in g[k]); w=[x[1] for x in g[k] if x[1] is not None]
    print(k, 'n', len(ids), 'derge med %.3f min %.3f' % (st.median(ids), ids[0]), 'wood-agree med %.3f' % st.median(w) if w else '')
# verdict distribution corpus-wide
D=json.load(open('tib-verdicts.json'))
agg=collections.Counter()
for k,n in D.items():
    s,v,rule,m,t=k.split('|')
    if t!='text=true': continue
    grp=s; cls = v if v!='none' else ('yig-unjudged' if 'yigdzin' in m else ('gemini' if 'gemini' in m else m))
    agg[(grp, cls)]+=n
for k in sorted(agg): print(k, agg[k])
