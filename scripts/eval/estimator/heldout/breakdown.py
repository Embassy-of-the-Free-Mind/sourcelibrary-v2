# PRIOR ART: none — a reader for heldout.py's own output (scripts/eval/estimator/heldout/).
"""Per-language and per-base held-out log-density gains, and the gain by route size, from heldout.py's output (#7263).

  python3 scripts/eval/estimator/heldout/breakdown.py scripts/eval/estimator/heldout/results/<run>.json   (repo root)
"""
import json,os,sys,collections
R=json.load(open(sys.argv[1]))
E=R['full_fit']['effects']
for g,d in E.items():
    if g in('eng:wsys','eng:stype'):
        print(g,'max |effect|',max(abs(v[0]) for v in d.values())); continue
    print(g, {k:v[0] for k,v in sorted(d.items(), key=lambda kv:-kv[1][0])})
for fold in ('language','base'):
  agg=collections.defaultdict(lambda:[0,0,0,0,0,0])
  for r in R['rows']:
    key=r['factors']['lang'] if fold=='language' else r['uid'].split('/')[0]
    p=r['pred'][fold]; a=agg[key]
    a[0]+=1;a[1]+=r['n'];a[2]+=p['hier'][1]-p['flat'][1];a[3]+=p['hier'][1]-p['grand'][1];a[4]+=r['k'];a[5]+=p['hier'][0]*r['n']
  print('\n',fold)
  for k,a in sorted(agg.items(), key=lambda kv:kv[1][3]):
    print(f"  {k:24s} routes {a[0]:3d} books {a[1]:7.1f} hier-flat {a[2]:+7.2f} hier-grand {a[3]:+7.2f} obs {a[4]/a[1]:.2f} pred {a[5]/a[1]:.2f}")
for fold in ('row','base','language'):
  for lo,hi in ((0,10),(10,30),(30,1e9)):
    rs=[r for r in R['rows'] if lo<=r['n']<hi]
    d=lambda m:sum(r['pred'][fold]['hier'][1]-r['pred'][fold][m][1] for r in rs)
    print(fold,f"n_eff [{lo},{hi})",len(rs),'routes; hier-flat %.2f hier-grand %.2f hier-table %.2f'%(d('flat'),d('grand'),d('table')))
