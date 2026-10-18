"""Parse Kettunen & Helmke 2025 (Wayeb handbook, 20th ed.) pp.84-98 into sign records.
Each glyph is its own embedded image; pdftohtml -xml gives image and text positions."""
import sys, json, re, xml.etree.ElementTree as ET
D=sys.argv[1]
root=ET.parse(f'{D}/x/wh.xml').getroot()
SYL=re.compile(r"^(?:[a-z]{0,2}[’']?)?[aeiou]$")
recs=[]
def cx(b): return b['left']+b['width']/2
for pg in root.findall('page'):
    n=int(pg.get('number'))
    imgs=[{k:int(e.get(k)) for k in('top','left','width','height')}|{'src':e.get('src').split('/')[-1]} for e in pg.findall('image')]
    texts=[{'top':int(e.get('top')),'left':int(e.get('left')),'width':int(e.get('width')),'t':''.join(e.itertext()).strip()} for e in pg.findall('text')]
    texts=[t for t in texts if t['t'] and 60<t['top']<760]
    if 84<=n<=87:
        labels=[t for t in texts if SYL.match(t['t'])]
        for im in imgs:
            c=[l for l in labels if l['top']<im['top'] and abs(l['left']+l['width']/2-cx(im))<48]
            if not c: print('UNLABELLED',n,im); continue
            l=max(c,key=lambda l:l['top'])
            recs.append({'kind':'syllabogram','value':l['t'].replace('’',"'"),'pdf_page':n,'printed_page':n-2,'img':im})
    elif n==88:
        words=[{'left':float(a),'top':float(b),'width':float(c)-float(a),'t':w} for a,b,c,d,w in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)</word>',open(f'{D}/p88.html').read())]
        words=[w for w in words if 120<w['top']<770]
        for im in imgs:
            c=[w for w in words if w['top']>im['top']+im['height']-6 and abs(w['left']+w['width']/2-cx(im))<45]
            if not c: print('UNLABELLED',n,im); continue
            w=min(c,key=lambda w:w['top'])
            recs.append({'kind':'confusable','value':w['t'].replace('’',"'"),'pdf_page':n,'printed_page':n-2,'img':im})
    elif 89<=n<=98:
        body=[t for t in texts if t['top']>(125 if n==89 else 95) and not re.fullmatch(r'\d{3}',t['t']) and 'Table 25' not in t['t']]
        imgs.sort(key=lambda i:i['top'])
        # entries: images whose vertical spans overlap form one entry
        ents=[]
        for im in imgs:
            if ents and im['top']<ents[-1]['bottom']-4: ents[-1]['imgs'].append(im); ents[-1]['bottom']=max(ents[-1]['bottom'],im['top']+im['height'])
            else: ents.append({'imgs':[im],'top':im['top'],'bottom':im['top']+im['height']})
        for i,e in enumerate(ents):
            nxt=ents[i+1]['top'] if i+1<len(ents) else 10**6
            mine=[t for t in body if e['top']-10<=t['top']<nxt-10]
            col=lambda lo,hi:[t['t'] for t in sorted(mine,key=lambda t:t['top']) if lo<=t['left']<hi]
            recs.append({'kind':'logogram','transliteration':' '.join(col(160,245)),'transcription':' '.join(col(245,320)),
                'translation':col(320,440),'alternatives':' '.join(col(440,600)).rstrip(',').split(', ') if col(440,600) else [],
                'pdf_page':n,'printed_page':n-2,'imgs':e['imgs']})
json.dump(recs,open(f'{D}/wayeb-records.json','w'),indent=1,ensure_ascii=False)
import collections; print(collections.Counter(r['kind'] for r in recs))
