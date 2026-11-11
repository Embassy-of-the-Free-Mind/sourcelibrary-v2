# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
import xml.etree.ElementTree as ET, os, random, json, re
B='/mnt/HC_Volume_105839809/jobs/replicate-6547/bentham/BenthamDatasetR0-GT'
NS={'p':'http://schema.primaresearch.org/PAGE/gts/pagecontent/2010-03-19'}
def pts(c):
    if c.get('points'): return [tuple(map(int,p.split(','))) for p in c.get('points').split()]
    return [(int(p.get('x')),int(p.get('y'))) for p in c.findall('p:Point',NS)]
def gt(i):
    t=ET.parse(f'{B}/PAGE/{i}.xml').getroot(); L=[]
    for ln in t.findall('.//p:TextLine',NS):
        u=ln.find('./p:TextEquiv/p:Unicode',NS)
        if u is None or not (u.text or '').strip(): continue
        P=pts(ln.find('./p:Coords',NS))
        L.append((sum(y for _,y in P)/len(P), min(x for x,_ in P), u.text.strip()))
    return '\n'.join(x for *_,x in sorted(L))
test=set(json.load(open('/mnt/HC_Volume_105839809/jobs/replicate-6547/bentham/gt.json')))
val=[l.strip() for l in open(f'{B}/Partitions/Validation.lst') if l.strip()]
assert not test & set(val)
rng=random.Random(6544); rng.shuffle(val)
pick=[];cnt={}
for i in val:
    w=i[:7]
    if cnt.get(w,0)>=2: continue
    g=gt(i)
    if len(g)<150: print('skip short',i,len(g)); continue
    pick.append({'id':i,'work':w,'gt':g}); cnt[w]=cnt.get(w,0)+1
    if len(pick)==20: break
json.dump(pick,open('/mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setA/bentham/pick.json','w'),ensure_ascii=False,indent=1)
print([p['id'] for p in pick], [len(p['gt']) for p in pick])
