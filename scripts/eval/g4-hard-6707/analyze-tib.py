# PRIOR ART: engine-wave1-6011 Tibetan table (median identity, paired vs Yigdzin) — recomputed with the G4L arm; the wave-1 numbers reproduce.
# Tibetan (panel 6): syllable identity vs Derge (kanjur_align.py), median per arm with a by-book bootstrap; paired
# delta identity (G4L - other; positive = G4L better) by page. A row with no identity ("too short") counts 0, as wave 1.
import json, statistics as st, random, hashlib, collections
S='/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'; W='/mnt/HC_Volume_105839809/worktrees/job-g4-hard2-6707'
G='gemini-4-argon-low+antigravity-cli'
by=collections.defaultdict(dict)
for f in (f'{W}/scripts/eval/results/engine-wave1-6011/tibetan-scores.jsonl', f'{S}/an/tib-scores-G4L.jsonl'):
    for l in open(f):
        r=json.loads(l); by[r['arm']][r['id']]=r.get('identity') or 0.0
ids=sorted(by['bdrc-yigdzin-v1'])
wave1=[a for a in by if a!=G]
off=[i for i in ids if max(by[a].get(i,0) for a in wave1)<0.5]
book=lambda i:i.split('_')[0]
seed=lambda *k:int(hashlib.sha256('|'.join(k).encode()).hexdigest()[:12],16)
def med_ci(a):
    groups=collections.defaultdict(list)
    for i in ids:
        if i not in off: groups[book(i)].append(by[a].get(i,0.0))
    Gs=list(groups.values()); rnd=random.Random(seed('tib',a,'med')); bs=sorted(st.median([x for g in rnd.choices(Gs,k=len(Gs)) for x in g]) for _ in range(2000))
    xs=[by[a].get(i,0.0) for i in ids if i not in off]
    return {'median_identity':round(st.median(xs),3),'ci95':[round(bs[49],3),round(bs[1949],3)],'pages_lt_0.5':sum(x<0.5 for x in xs),'n':len(xs),'books':len(Gs)}
def paired(a,b):
    d=[by[a][i]-by[b][i] for i in ids if i not in off]; w=sum(x>0 for x in d); l=sum(x<0 for x in d)
    rnd=random.Random(seed('tib',a,b)); bs=sorted(st.median(rnd.choices(d,k=len(d))) for _ in range(2000)); md=st.median(d)
    c=[round(bs[49],4),round(bs[1949],4)]
    return {'n':len(d),'wins':w,'losses':l,'ties':len(d)-w-l,'median_delta':round(md,4),'median_delta_ci95':c,
            'verdict':'better' if c[0]>0 and abs(md)>0.01 else 'worse' if c[1]<0 and abs(md)>0.01 else 'same'}
res={'pages':len(ids),'off_index':off,'books':len({book(i) for i in ids}),'arms':{a:med_ci(a) for a in sorted(by,key=lambda a:-st.median(by[a].values()))},
     'paired':{f'vs {b}':paired(G,b) for b in ('bdrc-yigdzin-v1','claude-opus-5-5')}}
json.dump(res,open(f'{S}/an/res-tib.json','w'),indent=1)
for a,v in res['arms'].items(): print(a,v)
for k,v in res['paired'].items(): print(k,v)
print('off-index',off)
