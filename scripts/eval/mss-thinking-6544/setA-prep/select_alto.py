# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
import sys,glob,json,random,os
sys.path.insert(0,os.path.dirname(__file__)); from altolib import parse_alto
B='/mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setA'
CFG={
 'cremma':{'root':'cremma/data','keep':['Egerton821','H318','CLM13027','Latin16195','WettF0015','BIS-193','Phi_10a135','Mazarine915','UBL758','PalLat373','LaurentianusPluteus53.08','LaurentianusPluteus53.09','CCCC-MSS-165']},
 'htromance':{'root':'htromance/data/fr','keep':['bnf-français-3816','bnf-français-2982','bnf-français-3640','bnf-naf-1992','bnf-français-3413','bnf-ms-dupuy-63','las-concernant-lully-8','bnf-ms-baluze-209','bnf-ms-picardie-13',"bnf-bibliothèque-de-l'-arsenal.-ms-9314",'bnf-français-17217','bnf-naf-12303-#-0','bnf-français-2533','bnf-français-2394','bnf-français-4108','bnf-4-s-3789-(-2)']},
}
def untranscribed_area(f):
    import xml.etree.ElementTree as ET
    t=ET.parse(f).getroot(); ns=t.tag.split('}')[0]+'}'
    tags={o.get('ID'):o.get('LABEL') for o in t.iter(ns+'OtherTag')}
    return sum(float(b.get('WIDTH',0))*float(b.get('HEIGHT',0)) for b in t.iter(ns+'TextBlock')
               if not any((x.get('CONTENT') or '').strip() for x in b.iter(ns+'String')) and tags.get(b.get('TAGREFS'))!='StampZone')
def gt_of(L): return '\n'.join(x[2] for x in L if x[2])
ds=sys.argv[1]; c=CFG[ds]
cands=[]
for w in c['keep']:
    for f in sorted(glob.glob(f"{B}/{c['root']}/{glob.escape(w)}/*.chocomufin.xml")):
        cands.append((w,f))
print(ds,'works',len(c['keep']),'candidate pages',len(cands))
rng=random.Random(6544); rng.shuffle(cands)
pick=[];cnt={};skips=[]
for w,f in cands:
    if cnt.get(w,0)>=2: continue
    L,wh,fn=parse_alto(f); g=gt_of(L); empty=sum(1 for x in L if not x[2])
    ua=untranscribed_area(f)
    if ua>0.005*wh[0]*wh[1]: skips.append((f,'untranscribed non-stamp blocks %.1f%% of page'%(100*ua/wh[0]/wh[1]))); continue
    if empty>1: skips.append((f,'empty lines %d/%d'%(empty,len(L)))); continue
    if len(g)<150: skips.append((f,'short %d'%len(g))); continue
    pick.append({'work':w,'xml':f,'gt':g,'n_lines':len(L),'empty_lines':empty,'wh':wh,'fileName':fn,'zones':sorted({x[0] for x in L})}); cnt[w]=cnt.get(w,0)+1
    if len(pick)==20: break
for s in skips: print('skip',s)
json.dump(pick,open(f'{B}/{ds}/pick.json','w'),ensure_ascii=False,indent=1)
for p in pick: print(p['work'],os.path.basename(p['xml'])[:50],len(p['gt']),p['wh'],p['zones'])
