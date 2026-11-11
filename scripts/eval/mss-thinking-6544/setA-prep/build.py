# PRIOR ART: scripts/eval/replicate-6547/prep.py (bentham_gt: PAGE XML lines sorted top to bottom, reused for Bentham) — it reads one set; this prepares #6544 Set A (four open page-level sets, seed 6544, <= 2 pages per work). Data under $JOB_SCRATCH/setA, never the repo.
# Assemble Set A (#6544): pages.jsonl from the four per-dataset pick.json files. No model calls.
import json,os,sys,re
from PIL import Image
sys.path.insert(0,os.path.dirname(__file__)); from altolib import parse_alto; from pagelib import parse_page
B='/mnt/HC_Volume_105839809/jobs/mss-thinking-6544/setA'; IMG=f'{B}/images'
Image.MAX_IMAGE_PIXELS=None
def prep_image(src,ds,name):
    os.makedirs(f'{IMG}/{ds}',exist_ok=True)
    im=Image.open(src); w,h=im.size; big=max(w,h)>4000 or os.path.getsize(src)>8e6
    dst=f'{IMG}/{ds}/{name}.jpg'
    if big:
        s=3000/max(w,h); im=im.convert('RGB').resize((round(w*s),round(h*s)),Image.LANCZOS); im.save(dst,quality=92)
    else:
        if src.lower().endswith(('.jpg','.jpeg')):
            if os.path.exists(dst): os.remove(dst)
            os.link(src,dst) if os.stat(src).st_dev==os.stat(os.path.dirname(dst)).st_dev else im.save(dst,quality=95)
        else: im.convert('RGB').save(dst,quality=95)
    return dst,(w,h),Image.open(dst).size,big
def nlines(g): return g.count('\n')+1
rows=[]; diag=[]
def fix_order(L,key):
    """XML order, with two repairs (recorded in gt_assembly): (a) a table page is re-sorted row-major (rows = lines whose
    top is within 45 px, then x); (b) a trailing run of <=2 MainZone lines that sits ABOVE the first MainZone line
    (a heading/date the annotator added last) is moved to the front of the MainZone text."""
    L=[x for x in L if x[2]]
    if key in TABLES:
        L=sorted(L,key=lambda x:x[3][1]); rows_=[]
        for x in L:
            if rows_ and abs(x[3][1]-rows_[-1][0][3][1])<45: rows_[-1].append(x)
            else: rows_.append([x])
        return [x for r in rows_ for x in sorted(r,key=lambda x:x[3][0])],'sorted row-major by y then x (table layout)'
    main=[i for i,x in enumerate(L) if x[0]=='MainZone']
    if len(main)>4:
        y0=L[main[0]][3][1]
        for k in (2,1):
            tail=main[-k:]
            if all(L[i][3][1]<y0-30 for i in tail) and tail==list(range(tail[0],tail[0]+k)):
                moved=[L[i] for i in tail]; rest=[x for i,x in enumerate(L) if i not in tail]
                j=next(i for i,x in enumerate(rest) if x[0]=='MainZone')
                return rest[:j]+moved+rest[j:],'line-level reassembled in XML order; %d trailing heading line(s) moved to the top by y'%k
    return L,'line-level reassembled in XML order'
TABLES={'bnf-4-s-3789-(-2)/4-S-3789 (2)_f14'}
# Bentham
for p in json.load(open(f'{B}/bentham/pick.json')):
    src=f'{B}/bentham/BenthamDatasetR0-Images/Images/Pages/{p["id"]}.jpg'
    dst,o,n,big=prep_image(src,'bentham',p['id'])
    rows.append(dict(uid=f'bentham-r0|{p["id"]}',dataset='bentham-r0',stratum='english-18-19',language='English',script='Latin (English cursive, Jeremy Bentham and amanuenses)',
        work=p['work'],image=dst,gt=p['gt'],gt_chars=len(p['gt']),gt_lines=nlines(p['gt']),gt_assembly='sorted by y',
        source_url='https://doi.org/10.5281/zenodo.44519 (BenthamDatasetR0-Images/Images/Pages/%s.jpg; PAGE/%s.xml)'%(p['id'],p['id']),
        licence='CC BY 4.0',split='validation',orig_size=o,image_size=n,downscaled=big))
# CREMMA / HTRomance (ALTO)
meta={'cremma':dict(dataset='cremma-medii-aevi',stratum='medieval-latin',language='Latin',script='Latin (medieval book hands, 12th-16th c.)',licence='CC BY 4.0'),
      'htromance':dict(dataset='htromance-modern',stratum='early-modern',language='French (Middle/early modern)',script='Latin (16th-17th c. French cursive/secretary/italic hands)',licence='CC BY 4.0')}
for ds in ['cremma','htromance']:
    for p in json.load(open(f'{B}/{ds}/pick.json')):
        L,wh,fn=parse_alto(p['xml'])
        key=f'{p["work"]}/{os.path.basename(p["img_rel"]).rsplit(".",1)[0]}'
        L,asm=fix_order(L,key)
        gt='\n'.join(x[2] for x in L); gm='\n'.join(x[2] for x in L if x[0]=='MainZone')
        if asm!='line-level reassembled in XML order': print('REORDER',key,asm)
        name=re.sub(r'[^A-Za-z0-9_.-]+','_',p['work']+'__'+os.path.basename(p['img_rel']).rsplit('.',1)[0])[:120]
        dst,o,n,big=prep_image(f'{B}/{ds}/{p["img_rel"]}',ds,name)
        # order diagnostics: block sequence, backward y jumps within MainZone
        seq=[]; back=0; prev=None
        for bl,ll,s,box in L:
            if not seq or seq[-1]!=bl: seq.append(bl)
            if bl=='MainZone' and s:
                if prev is not None and box[1] < prev-50: back+=1
                prev=box[1]
        diag.append((ds,name,seq,back))
        rows.append(dict(uid=f'{meta[ds]["dataset"]}|{p["work"]}/{os.path.basename(p["img_rel"]).rsplit(".",1)[0]}',work=p['work'],image=dst,gt=gt,gt_chars=len(gt),gt_lines=nlines(gt),
            gt_main=gm,gt_assembly=asm,source_url=p['source_url'],split='none (dataset has no split; whole set)',orig_size=o,image_size=n,downscaled=big,zones=p['zones'],**meta[ds]))
# RASAM 2 (PAGE)
for p in json.load(open(f'{B}/rasam/pick.json')):
    dst,o,n,big=prep_image(f'{B}/rasam/img/{p["id"]}.jpg','rasam',p['id'])
    ar=abs(o[0]/o[1]-p['wh'][0]/p['wh'][1]); print('rasam',p['id'],'served',o,'gt-image',p['wh'],'aspect diff %.4f'%ar)
    regs,wh=parse_page(p['xml']); seq=[t for t,_ in regs]; diag.append(('rasam',p['id'],seq,None))
    rows.append(dict(uid=f'rasam|{p["id"]}',dataset='rasam',stratum='non-latin',language='Arabic',script='Arabic, Maghrebi',
        work=p['work'],image=dst,gt=p['gt'],gt_chars=len(p['gt']),gt_lines=nlines(p['gt']),gt_main=p['gt_main'],gt_assembly='line-level reassembled in XML order',
        source_url=f'https://github.com/calfa-co/rasam-dataset/blob/main/page/{p["subset"].lower()}/{p["id"]}.xml ; image https://bina.bulac.fr/iiif/2/{p["iiif"]}/full/full/0/default.jpg ; record {p["record"]}',
        licence='GT: Apache-2.0 (repo LICENSE); images: BULAC, "Domaine public" per IIIF manifest',split=p['subset']+' (no official split)',gt_image_size=p['wh'],orig_size=o,image_size=n,downscaled=big,zones=seq))
with open(f'{B}/pages.jsonl','w',encoding='utf-8') as f:
    for r in rows: f.write(json.dumps(r,ensure_ascii=False)+'\n')
for d in diag: print(d)
import collections
print(collections.Counter(r['dataset'] for r in rows), sum(r['downscaled'] for r in rows),'downscaled')
