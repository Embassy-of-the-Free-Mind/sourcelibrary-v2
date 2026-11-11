import json,glob,re,collections as C,random
random.seed(7)
tax=open('/root/sourcelibrary/.claude/docs/page-error-taxonomy.md').read()
defs={}
for m in re.finditer(r'^### ([IOTDE]\d+) · (.+?)(?: — (.*?))?$\n(.*?)(?=^### |\Z)',tax,re.M|re.S):
    code,name,status,body=m.groups()
    sees=re.search(r'\*\*Reader sees:\*\*\s*(.+)',body); 
    defs[code]=dict(name=name.strip(),status=(status or '').strip(),sees=(sees.group(1).strip()[:420] if sees else ''))
kind=json.loads(open('/dev/stdin').read())
rows={(r['run'],r['book'],r['page']):r for r in json.load(open('rows.json'))}
spec=C.defaultdict(list); cnt=C.defaultdict(C.Counter); pages=C.defaultdict(set); langs=C.defaultdict(C.Counter); unclassed=0; total=0
for f in glob.glob('/root/jobs/spare-audit/spare-audit-2026111*/readers/opus/reviews/*.json'):
    run=f.split('/')[4]
    for b in json.load(open(f)):
        for p in b['pages']:
            r=rows.get((run,b['book_id'],int(p['page_number'])))
            if not r: continue
            for key in ('ocr_errors','tr_errors','other'):
                for e in p.get(key) or []:
                    total+=1
                    m=re.search(r'\b([IOTDE]\d{1,2})\b',str(e.get('class') or ''))
                    if not m: unclassed+=1; continue
                    c=m.group(1); sev=e.get('severity') or 'minor'
                    cnt[c][sev]+=1; pages[c].add((run,b['book_id'],p['page_number'])); langs[c][r['lang']]+=1
                    bad=e.get('ocr') if key=='ocr_errors' else e.get('english') if key=='tr_errors' else None
                    good=e.get('image') if key=='ocr_errors' else e.get('source') if key=='tr_errors' else None
                    spec[c].append(dict(sev=sev,lang=r['lang'],title=b.get('title','')[:90],year=str(r.get('pub') or '')[:12],page=int(p['page_number']),
                        url=f"https://sourcelibrary.org/book/{b['book_id']}?page={p['page_number']}",ocr_model=r['ocr_model'],
                        problem=(e.get('problem') or e.get('note') or '')[:400],bad=(bad or '')[:240],good=(good or '')[:240],
                        badlabel='OCR' if key=='ocr_errors' else 'English' if key=='tr_errors' else '',goodlabel='On the page' if key=='ocr_errors' else 'Source' if key=='tr_errors' else ''))
order={'serious':0,'moderate':1,'minor':2}
out=[]
for c in sorted(set(defs)|set(cnt),key=lambda k:('IOTDE'.index(k[0]),int(k[1:]))):
    S=spec[c]; random.shuffle(S); S.sort(key=lambda s:order.get(s['sev'],3))
    picked=[];seenl=C.Counter();seenb=set()
    for s in S:
        if len(picked)>=8: break
        if s['url'] in seenb or seenl[s['lang']]>=3 or len(s['problem'])<25: continue
        picked.append(s);seenl[s['lang']]+=1;seenb.add(s['url'])
    d=defs.get(c,{'name':'(not in taxonomy doc)','status':'','sees':''})
    out.append(dict(code=c,lane=c[0],kind=kind.get(c,''),name=d['name'],status=d['status'],sees=d['sees'],
        n=sum(cnt[c].values()),sev=dict(cnt[c]),pages=len(pages[c]),langs=langs[c].most_common(4),specimens=picked))
meta=dict(total=total,unclassed=unclassed,pages=len(rows),runs=len({r['run'] for r in rows.values()}))
json.dump(dict(meta=meta,classes=out),open('zoo.json','w'),ensure_ascii=False)
print(meta, sum(1 for o in out if o['n']), 'classes seen;', sum(len(o['specimens']) for o in out),'specimens', len(json.dumps(out,ensure_ascii=False))//1024,'KB')
for o in out: print(o['code'],o['n'],o['pages'],o['name'][:50])
