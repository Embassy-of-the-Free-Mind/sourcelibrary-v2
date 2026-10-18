"""Normalise the Stuart syllabary crops and the Wayeb handbook signs into one record set.
Output: <out>/signs.jsonl (one record per glyph image, plus explicit empty chart cells) and <out>/img/*.png."""
import sys, json, hashlib, io, re, collections
from PIL import Image
STU, WAY, OUT = sys.argv[1:4]
import os; os.makedirs(f'{OUT}/img', exist_ok=True)
CHECK={'by':'claude-opus-5-5','date':'2026-10-18','method':'every crop viewed on a labelled contact sheet against the source page'}
SRC={
 'stuart-syllabary-v2':{'title':'Maya Hieroglyph Syllabary','authors':['David Stuart'],'year':2013,'edition':'Version 2 (Version 1: 2005)',
   'url':'https://mayadecipherment.com/2013/09/18/maya-hieroglyphic-syllabary/','pdf':'https://mayadecipherment.com/wp-content/uploads/2013/09/maya-syllabary-v2.pdf',
   'style':'Late Classic, c. 700 AD (drawings by Stuart)'},
 'wayeb-handbook-2025':{'title':'Introduction to Maya Hieroglyphs (Workshop Handbook)','authors':['Harri Kettunen','Christophe Helmke'],'year':2025,'edition':'20th revised edition',
   'url':'https://www.wayeb.org/resources-links/wayeb-resources/workshop-handbook/','pdf':'https://www.wayeb.org/wp-content/uploads/2025/11/Kettunen_Helmke_2025_WH_English_20th_ed.pdf',
   'style':'mixed periods; drawings credited in the handbook (pp. 151-152)'}}
RIGHTS={
 'stuart-syllabary-v2':{'holder':'David Stuart','terms':'chart says: for study or teaching, do not publish without permission',
   'permission':'granted by David Stuart to Derek Lomas, 2026-10-18 (scope being confirmed)','credit':'Drawing © David Stuart, used with permission'},
 'wayeb-handbook-2025':{'holder':'Harri Kettunen, Christophe Helmke / Wayeb; individual drawings per the handbook credits','terms':'free download from wayeb.org; no licence stated',
   'permission':'not yet asked: private research use only; ask the authors before showing to readers','credit':'Kettunen & Helmke 2025, Wayeb Workshop Handbook'}}
recs=[]
def png(im):
    if im.mode in('RGBA','LA','P'):
        im=im.convert('RGBA'); bg=Image.new('RGBA',im.size,'white'); bg.alpha_composite(im); im=bg
    im=im.convert('L'); b=io.BytesIO(); im.save(b,'PNG',optimize=True); d=b.getvalue()
    return d, im.size
def put(rec, data, size):
    h=hashlib.sha256(data).hexdigest(); slug=re.sub(r'[^a-z0-9]+','-',rec['_id'].lower()).strip('-')
    fn=f"{slug}-{h[:8]}.png"; open(f'{OUT}/img/{fn}','wb').write(data)
    rec['image']={'file':fn,'key':f"reference/maya/{rec['source']}/{fn}",'sha256':h,'w':size[0],'h':size[1]}
def syl_split(v):
    v=v.replace('’',"'"); return (v[:-1] or "'", v[-1])
# --- Stuart
m=json.load(open(f'{STU}/crops/manifest.json'))
for c in m['cells']:
    base={'source':'stuart-syllabary-v2','kind':'syllabogram','value':c['syllable'],'consonant':c['consonant'],'vowel':c['vowel'],
          'uncertain':{0:None,1:'?',2:'??'}[c['uncertain']],'note':c.get('note'),'src_page':{'pdf_page':c['page']}}
    if not c['crops']:
        recs.append(base|{'_id':f"stuart2013:{c['syllable']}:empty",'variant':0,'empty':True,'image':None}); continue
    for cr in c['crops']:
        im=Image.open(f"{STU}/crops/{cr['file']}"); d,s=png(im)
        r=base|{'_id':f"stuart2013:{c['syllable']}:{cr['n']}",'variant':cr['n'],'empty':False,'src_page':{'pdf_page':c['page'],'box_px_150ppi':cr['box']}}
        put(r,d,s); recs.append(r)
# --- Wayeb
W=json.load(open(f'{WAY}/wayeb-records.json'))
cnt=collections.Counter()
seen_syl=set()
for r in W:
    if r['kind']=='syllabogram':
        v=r['value']; cnt[('s',v)]+=1; n=cnt[('s',v)]; seen_syl.add(v); co,vo=syl_split(v)
        x={'_id':f"wayeb2025:syl:{v}:{n}",'source':'wayeb-handbook-2025','kind':'syllabogram','value':v,'consonant':co,'vowel':vo,'variant':n,'empty':False,
           'src_page':{'pdf_page':r['pdf_page'],'printed_page':r['printed_page'],'box_pt':[r['img'][k] for k in('left','top','width','height')]}}
        d,s=png(Image.open(f"{WAY}/x/{r['img']['src']}")); put(x,d,s); recs.append(x)
    elif r['kind']=='confusable':
        im=r['img']; cnt['c']+=1; n=cnt['c']
        top=im['top']; row=min([104,179,247,316,381,453,513,624,698],key=lambda t:abs(t-top))
        grp=f"row{row}" if row>=513 and row not in(513,) else f"row{row}-{'L' if im['left']<300 else 'R'}"
        x={'_id':f"wayeb2025:confusable:{n}",'source':'wayeb-handbook-2025','kind':'confusable','value':r['value'],'variant':1,'empty':False,'confusable_group':grp,
           'src_page':{'pdf_page':r['pdf_page'],'printed_page':r['printed_page'],'box_pt':[im[k] for k in('left','top','width','height')]}}
        d,s=png(Image.open(f"{WAY}/x/{im['src']}")); put(x,d,s); recs.append(x)
    else:
        tl=r['transliteration']; note=None
        if 'can be rendered' in tl:
            note='this image illustrates a spelling note under AJAW; the entry text is that note, not a dictionary row'; tl='AJAW'
            r=r|{'transcription':'ajaw','translation':['(1) lord (n)','(2) king (n)'],'alternatives':[]}
        for im in r['imgs']:
            cnt[('l',tl)]+=1; n=cnt[('l',tl)]
            x={'_id':f"wayeb2025:logo:{tl}:{n}",'source':'wayeb-handbook-2025','kind':'logogram','value':tl,'transliteration':tl,'transcription':r['transcription'],
               'translation':r['translation'],'alternatives':r['alternatives'],'variant':n,'empty':False,'note':note,
               'src_page':{'pdf_page':r['pdf_page'],'printed_page':r['printed_page'],'box_pt':[im[k] for k in('left','top','width','height')]}}
            d,s=png(Image.open(f"{WAY}/x/{im['src']}")); put(x,d,s); recs.append(x)
for x in recs:
    x['source_ref']=SRC[x['source']]; x['rights']=RIGHTS[x['source']]; x['checked']=CHECK
with open(f'{OUT}/signs.jsonl','w') as f:
    for x in recs: f.write(json.dumps(x,ensure_ascii=False)+'\n')
print(collections.Counter((x['source'],x['kind'],x['empty']) for x in recs)); print(len(recs),'records; ids unique:',len({x['_id'] for x in recs})==len(recs))
