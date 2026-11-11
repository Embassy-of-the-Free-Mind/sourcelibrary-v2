import json,glob,os,re,collections as C
rows=[]
for run in sorted(glob.glob('spare-audit-2026111[01]-*/')):
    if not os.path.exists(run+'report.json'): continue
    rep=json.load(open(run+'report.json'))
    ser={(f['book_id'],int(f['page_number'])):f for f in rep['findings']}
    for p in glob.glob(run+'packets/*.json'):
        pk=json.load(open(p))[0]; pid=os.path.basename(p)[:-5]
        rv=run+'readers/opus/reviews/'+pid+'.json'
        if not os.path.exists(rv): continue
        r=json.load(open(rv))[0]
        for pg,rp in zip(pk['pages'],r['pages']):
            o=pg.get('ocr') or ''
            g=lambda t:(re.search(f'<{t}>(.*?)</{t}>',o) or [None,'?'])[1]
            f=ser.get((pk['book_id'],int(pg['page_number'])))
            rows.append(dict(page=int(pg["page_number"]),run=run[:-1],stratum=pk['stratum'],book=pk['book_id'],title=pk['book']['title'][:60],pub=str(pk['book'].get('published')),
              lang=pk['book']['language'],ocr_model=pg.get('ocr_model') or (f or {}).get('ocr_model','?'),
              tr_model=pg.get('translation_model','?'),scan=g('scan-quality'),script=g('script'),
              ocr_score=rp.get('ocr_score'),tr_score=rp.get('tr_score'),serious=bool(f),
              classes=[e['class'] for e in (f or {}).get('errors',[])],chars=len(o)))
json.dump(rows,open('/tmp/claude-0/-root-work/91f71155-58fc-54e4-b7ad-2ef02de4ab5a/scratchpad/rows.json','w'))
print(len(rows),'pages', len({r['book'] for r in rows}),'books', len({r['run'] for r in rows}),'runs')
print('page keys sample', list(json.load(open(glob.glob('spare-audit-20261111-17/packets/*.json')[0]))[0]['pages'][0].keys()))
