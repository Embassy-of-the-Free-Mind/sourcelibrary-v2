"""Parse every block reading ("A1:" + bold transliteration / italic transcription / plain translation) from
Stuart 2006, The Palenque Mythology. Usage: readings.py <pm.pdf> <work-dir>  ->  <work-dir>/readings.json
The three lines are told apart by font (Bold / Italic / Roman); the monument is the 20-pt temple title plus the
14-pt section heading. Date-table entries (all-roman lines holding Long Count numbers) are skipped."""
import pymupdf, re, json, sys, collections
PDF, WORK = sys.argv[1:3]
d=pymupdf.open(PDF)
COORD=r'p?[A-Z]{1,2}(?:p)?\d{0,2}'
LAB=re.compile(rf'^\s*({COORD}(?:\s*[-–]\s*{COORD})?)\s*[:;]\s*$')
LAB2=re.compile(rf'^\s*({COORD}(?:\s*[-–]\s*{COORD})?)\s*[:;]\s+(.*)$')
temple=None; section=None; out=[]
def fcls(s):
    f=s['font']
    return 'b' if 'Bold' in f else 'i' if 'Italic' in f else 'p'
for pn in range(23,106):
    p=d[pn-1]; spans=[]
    for b in p.get_text('dict')['blocks']:
        for l in b.get('lines',[]):
            for s in l['spans']:
                if s['text'].strip(): spans.append(dict(t=s['text'],x0=s['bbox'][0],y0=s['bbox'][1],x1=s['bbox'][2],y1=s['bbox'][3],c=fcls(s),sz=s['size']))
    printed=None
    for s in spans:
        if s['y0']>730 and s['t'].strip().isdigit(): printed=int(s['t'])
    for s in sorted(spans,key=lambda s:s['y0']):
        if s['sz']>=19: temple=s['t'].strip()
    # labels
    labs=[]
    for s in spans:
        if s['c']!='p' or s['sz']>11: continue
        m=LAB.match(s['t']) or LAB2.match(s['t'])
        if not m:
            m3=re.match(r'^\s*(p?[A-Z]{1,2}p?\d{1,2})\s*$',s['t'])
            if m3 and any(abs(s['x0']-x)<3 for x in (72,90,126,324)): m=m3
        if m and s['x0']<450:
            labs.append(dict(coord=re.sub(r'\s+','',m.group(1)).replace('–','-'),x0=s['x0'],y0=s['y0'],x1=s['x1'],sp=s,rest=(m.group(2) if m.re is LAB2 else '')))
    if not labs: 
        for s in spans:
            if 13<s['sz']<15: section=s['t'].strip()
        continue
    # heading per label: nearest section heading above on this page, else carried
    heads=[(s['y0'],s['t'].strip()) for s in spans if 13<s['sz']<15]
    for L in labs:
        col_right=min([l['x0'] for l in labs if l['x0']>L['x0']+40]+[612])
        same=[l for l in labs if abs(l['x0']-L['x0'])<40 and l['y0']>L['y0']+2]
        ylim=min([l['y0'] for l in same]+[792])
        cont=[s for s in spans if s is not L['sp'] and s['x0']>=L['x0']-1 and s['x0']<col_right-5 and L['y0']-2<=s['y0']<ylim-1 and s['sz']<11 and not (s['x0']<L['x1']+1 and abs(s['x0']-L['x0'])<3 and s['y0']>L['y0']+2)]
        # group into lines
        cont.sort(key=lambda s:(round(s['y0']),s['x0']))
        lines=[]
        for s in cont:
            if lines and abs(lines[-1]['y']-s['y0'])<2.5: lines[-1]['sp'].append(s)
            else: lines.append(dict(y=s['y0'],sp=[s]))
        # stop at big gap
        keep=[]; prev=L['y0']
        for ln in lines:
            if ln['y']-prev>16: break
            keep.append(ln); prev=ln['y']
        for ln in keep:
            ln['t']=''.join(s['t'] for s in ln['sp']).strip()
            w={'b':0,'i':0,'p':0}
            for s in ln['sp']: w[s['c']]+=len(re.sub(r'[\W\d_]','',s['t']))+0.1*len(s['t'].strip())
            ln['c']=max(w,key=w.get)
        if L['rest']: keep.insert(0,dict(t=L['rest'].strip(),c=fcls(L['sp']) if False else 'b?'))
        # assign
        tl=[];tc=[];tr=[]; stage=0
        for i,ln in enumerate(keep):
            c=ln['c']
            if c=='b' or (c=='b?'): 
                if stage<=0: tl.append(ln['t']); continue
            if c=='i' and stage<=1 and (tl or i>0):
                stage=1; tc.append(ln['t']); continue
            if not tl and stage==0: tl.append(ln['t']); stage=0; continue
            stage=2; tr.append(ln['t'])
        if len(keep)==3 and keep[0]['c']!='p':
            tl,tc,tr=[keep[0]['t']],[keep[1]['t']],[keep[2]['t']]
        isdate=any(re.match(r'^\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2}',ln['t']) for ln in keep[:1]) or all(ln['c']=='p' for ln in keep) and any(re.search(r'\d+\.\s*\d+',ln['t']) for ln in keep)
        if isdate: continue
        hd=[h for y,h in heads if y<L['y0']]
        sec=hd[-1] if hd else section
        out.append(dict(temple=temple,section=sec,coord=L['coord'],transliteration=' '.join(tl),transcription=' '.join(tc),translation=' '.join(tr),pdf_page=pn,printed_page=printed,lines=[(ln['c'],ln['t']) for ln in keep],y=round(L['y0']),x=round(L['x0'])))
    for s in spans:
        if 13<s['sz']<15: section=s['t'].strip()
json.dump(out,open(f'{WORK}/readings.json','w'),ensure_ascii=False,indent=0)
print(len(out)); print(collections.Counter((r['temple'],r['section']) for r in out).most_common())
