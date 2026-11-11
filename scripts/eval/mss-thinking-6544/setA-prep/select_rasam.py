# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
import sys,glob,json,random,os,csv
sys.path.insert(0,os.path.dirname(__file__)); from pagelib import parse_page
B='/mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setA/rasam'
rows={r['FileName']:r for r in csv.DictReader(open(f'{B}/list-images.tsv'),delimiter='\t')}
# Per page: keep only images BULAC serves today at >= 85% of the width the GT was made on. Many RASAM 2 images
# (mss 1936, 1943, 1960, 1982, 1983, 65, part of 1947) are now served at ~920-982 px wide against 2000-3550 px in the dataset.
import subprocess
def served_ok(r):
    j=json.loads(subprocess.run(['curl','-s','--max-time','60',f'https://bina.bulac.fr/iiif/2/{r["IIIF image ID"]}/info.json'],capture_output=True,text=True).stdout or '{}')
    return (j.get('width') or 0) >= 0.85*int(r['Width (px)']), j.get('width')
_ELIG_PER_MS_SUPERSEDED={'MS.ARA.1977','MS.ARA.417','MS.ARA.609','MS.ARA.1926','MS.ARA.1944','MS.ARA.1946','MS.ARA.1947','MS.ARA.23','MS.ARA.24','MS.ARA.45b','MS.ARA.6','MS.ARA.9'}
# Excluded as widely published/memorised texts: MS.ARA.1926 (Dala'il al-khayrat), MS.ARA.1947 (Maqamat al-Hariri).
EXCL={'MS.ARA.1926','MS.ARA.1947'}
cands=sorted(f for f in glob.glob(f'{B}/page/rasam*/*.xml') if rows[os.path.basename(f)[:-4]]['Manuscript'] not in EXCL)
print('candidates',len(cands))
rng=random.Random(6544); rng.shuffle(cands)
pick=[];cnt={};skips=[]
for f in cands:
    k=os.path.basename(f)[:-4]; r=rows[k]; w=r['Manuscript']
    if cnt.get(w,0)>=2: continue
    regs,wh=parse_page(f)
    lines=[(t,s) for t,L in regs for s,_ in L]
    empty=sum(1 for t,s in lines if not s)
    g='\n'.join(s for t,s in lines if s and not t.startswith('StampZone'))
    gm='\n'.join(s for t,s in lines if s and (t.startswith('MainZone') or t=='text'))
    untr=[t for t,L in regs if not L and not t.startswith('StampZone')]
    if untr: skips.append((k,'untranscribed regions %s'%untr)); continue
    ok,sw=served_ok(r)
    if not ok: skips.append((k,'served width %s < 85%% of GT image width %s'%(sw,r['Width (px)']))); continue
    if empty>1: skips.append((k,'empty %d/%d'%(empty,len(lines)))); continue
    if len(g)<150: skips.append((k,'short %d'%len(g))); continue
    pick.append({'subset':r['Dataset'],'id':k,'work':w,'xml':f,'gt':g,'gt_main':gm,'zones':[t for t,_ in regs],'wh':wh,'iiif':r['IIIF image ID'],'served_width':sw,'manifest':r['IIIF manifest'],'record':r['Bibliographical record']}); cnt[w]=cnt.get(w,0)+1
    if len(pick)==20: break
print(skips)
json.dump(pick,open(f'{B}/pick.json','w'),ensure_ascii=False,indent=1)
for p in pick: print(p['id'],p['work'],len(p['gt']),len(p['gt_main']),p['wh'],p['zones'])
