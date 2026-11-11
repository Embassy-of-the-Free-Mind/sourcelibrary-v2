import json,glob,re,zlib,math,collections as C,numpy as np
from PIL import Image, ImageFilter
rows={(r['run'],r['book'],r['page']):r for r in json.load(open('rows.json'))}
recs=[]
for f in glob.glob('/root/jobs/spare-audit/spare-audit-2026111*/packets/*.json'):
    run=f.split('/')[4]; base='/root/jobs/spare-audit/'+run+'/'
    for b in json.load(open(f)):
        for p in b['pages']:
            r=rows.get((run,b['book_id'],int(p['page_number'])))
            if r: recs.append(dict(r=r,b=b['book'],p=p,img=base+p['image_file'] if p.get('image_file') else None))
def body_of(o): return re.sub(r'<(scan-quality|language|script|page-type|vocab|meta|image-desc|warning)>.*?</\1>','',o,flags=re.S)
def strip(o): return re.sub(r'<[^>]+>','',o)
tok=lambda s: re.findall(r'[^\W\d_]+',s.lower())
# leave-one-book-out vocab + char trigram per language
vocab=C.defaultdict(C.Counter); bookv=C.defaultdict(C.Counter); tri=C.defaultdict(C.Counter); booktri=C.defaultdict(C.Counter)
for x in recs:
    o=strip(body_of(x['p'].get('ocr') or '')); L=x['r']['lang']; x['body']=o; x['tok']=tok(o)
    if x['b']['id'] in bookv and bookv[x['b']['id']]: pass
    c=C.Counter(x['tok']); vocab[L].update(c); bookv[(L,x['b']['id'])].update(c)
    s=re.sub(r'\s+',' ',o); t=C.Counter(s[i:i+3] for i in range(len(s)-2)); tri[L].update(t); booktri[(L,x['b']['id'])].update(t)
def ent(s):
    c=C.Counter(s); n=sum(c.values()); return -sum(v/n*math.log2(v/n) for v in c.values()) if n else 0
BLOCKS={'Greek':(0x370,0x3FF,0x1F00,0x1FFF),'Chinese':(0x4E00,0x9FFF,0x3400,0x4DBF),'Arabic':(0x600,0x6FF,0x750,0x77F),'Hebrew':(0x590,0x5FF,0x590,0x5FF),'Japanese':(0x3040,0x30FF,0x4E00,0x9FFF)}
CONS=re.compile(r'[bcdfghjklmnpqrstvwxzſ]{6,}')
out=[]
for x in recs:
    r,b,p=x['r'],x['b'],x['p']; o=p.get('ocr') or ''; t=p.get('translation') or ''; body=x['body']; n=max(1,len(body)); w=x['tok']; L=r['lang']
    lines=[l.strip() for l in body.split('\n') if l.strip()]; lc=C.Counter(lines)
    tw=re.findall(r"[A-Za-z']+",t); tsent=[s.strip() for s in re.split(r'(?<=[.!?])\s+',t) if len(s.strip())>20]
    d={}
    # size / repetition
    d['ocr_chars']=len(body); d['tr_chars']=len(t); d['tr_ratio']=len(t)/n; d['ocr_words']=len(w)
    d['ocr_zlib']=len(zlib.compress(body.encode()))/max(1,len(body.encode())); d['tr_zlib']=len(zlib.compress(t.encode()))/max(1,len(t.encode()))
    d['max_line_repeat']=max(lc.values()) if lc else 0; d['dup_line_frac']=sum(v for v in lc.values() if v>1)/max(1,len(lines))
    ng=C.Counter(zip(w,w[1:],w[2:],w[3:])); d['max_4gram_repeat']=max(ng.values()) if ng else 0
    sc=C.Counter(tsent); d['tr_dup_sent']=sum(v-1 for v in sc.values())
    d['top_word_share']=C.Counter(w).most_common(1)[0][1]/len(w) if w else 0
    d['char_entropy']=ent(body); d['tr_entropy']=ent(t)
    # garbage rules
    d['garbage_cons']=len(CONS.findall(body.lower()))/max(1,len(w))*100
    d['garbage_samechar']=len(re.findall(r'(.)\1{3,}',body))
    d['mixed_alnum']=len(re.findall(r'\b(?=\w*\d)(?=\w*[^\W\d])\w+\b',body))/max(1,len(w))*100
    d['oneletter_frac']=sum(len(z)==1 for z in w)/max(1,len(w))
    # lexicality (leave-one-book-out)
    own=bookv[(L,b['id'])]; V=vocab[L]
    if w:
        other=[V[z]-own[z] for z in w]; d['oov_frac']=sum(c==0 for c in other)/len(w); d['mean_logfreq']=float(np.mean([math.log1p(c) for c in other]))
    # char trigram surprise
    T=tri[L]; OT=booktri[(L,b['id'])]; tot=sum(T.values())-sum(OT.values()); s=re.sub(r'\s+',' ',body)
    if tot>1000 and len(s)>10:
        V3=len(T)+1; d['tri_ppl']=float(np.mean([-math.log((T[s[i:i+3]]-OT[s[i:i+3]]+1)/(tot+V3)) for i in range(len(s)-2)]))
    # script consistency
    letters=[c for c in body if c.isalpha()]
    if L in BLOCKS and letters:
        a1,a2,b1,b2=BLOCKS[L]; d['in_block']=sum(a1<=ord(c)<=a2 or b1<=ord(c)<=b2 for c in letters)/len(letters)
    d['latin_letter_frac']=sum(c.isascii() for c in letters)/max(1,len(letters))
    # translation consistency
    on=set(re.findall(r'\d+',body)); tn=set(re.findall(r'\d+',t)); d['num_ocr']=len(on); d['num_tr']=len(tn); d['num_jacc']=len(on&tn)/max(1,len(on|tn)) if on|tn else 1
    d['tr_nonenglish']=sum(1 for z in tw if z.lower() in set(w))/max(1,len(tw))
    d['tr_avg_sent']=np.mean([len(s) for s in tsent]) if tsent else 0
    d['tr_notes']=len(re.findall(r'\[[^\]]{0,200}\]',t)); d['tr_unclear']=len(re.findall(r'illegible|unclear|uncertain|\[\?|\?\]',t,re.I))
    caps_o=len(re.findall(r'\b[A-Z][a-z]{3,}',body)); caps_t=len(re.findall(r'\b[A-Z][a-z]{3,}',t)); d['caps_ratio']=caps_t/max(1,caps_o)
    # metadata
    m=re.search(r'1[0-9]{3}',str(b.get('published'))); d['year']=int(m.group()) if m else np.nan
    pc=b.get('pages_count') or 0; pn=int(p['page_number']); d['pages_count']=pc; d['page_pos']=pn/max(1,pc); d['edge_page']=int(pn<=3 or pn>=pc-2)
    for k in ('unclear','warning','margin','column-break','columns','image-desc','header','sig','insert','gloss','note','leaf-break'): d['tag_'+k]=len(re.findall(f'<{k}[ >/]',o))
    cat={'lang':L,'ocr':str(r['ocr_model'])}
    for k in ('script','page-type','scan-quality'):
        mm=re.search(f'<{k}>(.*?)</{k}>',o); cat[k]=(mm.group(1).strip()[:20] if mm else 'NA')
    # image
    if x['img']:
        try:
            im=Image.open(x['img']); W,H=im.size; fb=__import__('os').path.getsize(x['img'])
            g=np.asarray(im.convert('L').resize((400,int(400*H/W))),dtype=np.float32)
            lap=np.asarray(im.convert('L').resize((400,int(400*H/W))).filter(ImageFilter.FIND_EDGES),dtype=np.float32)
            thr=g.mean()-1.5*g.std() if g.std()>0 else 0
            ink=(g<min(thr, g.mean()*0.6)).mean()
            d.update(img_w=W,img_h=H,img_aspect=W/H,img_bpp=fb/(W*H),img_mean=g.mean(),img_std=g.std(),img_sharp=lap.var(),img_ink=ink,
                     chars_per_ink=len(body)/max(1e-4,ink),trchars_per_ink=len(t)/max(1e-4,ink))
        except Exception as e: pass
    out.append(dict(y=int(r['serious']),book=b['id'],cat=cat,num=d,ocr_score=r['ocr_score'],tr_score=r['tr_score']))
json.dump(out,open('feats2.json','w'),default=float); print(len(out))
