import json,os
exec(open('/private/tmp/claude-501/-Users-user/b99ad9bc-2539-41b5-8ffd-c6a77139434b/scratchpad/snap.py').read().split("S=[")[0])
R=json.load(open(OUT+'../sorting.json'))['records']
idx=json.load(open(OUT+'_index.json'))
for r in sorted([x for x in R if x['source']=='collection' and x['proposed'] in('collection','historic_library')],key=lambda x:-(x.get('books') or 0)):
    s=r['slug']
    if os.path.exists(OUT+s+'.json'): continue
    c=get(f'/api/collections/{s}?limit=60')
    if not c or (c.get('collection') or {}).get('visible') is False: continue
    g=get(f'/api/gallery?collection={s}&limit=120&sort=quality')
    if g: g={k:g.get(k) for k in('items','total')}
    json.dump({'c':c,'g':g},open(OUT+s+'.json','w'),ensure_ascii=False); print('ok',s,flush=True)
print('done3',flush=True)
