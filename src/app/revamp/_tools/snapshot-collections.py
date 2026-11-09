import json,time,urllib.request,urllib.error,os,sys
OUT='/Users/user/Projects/sourcelibrary-v2/.claude/worktrees/collections-revamp/src/app/revamp/_data/snap/'
os.makedirs(OUT,exist_ok=True)
def get(path):
    for i in range(8):
        try:
            r=urllib.request.urlopen(urllib.request.Request('https://sourcelibrary.org'+path,headers={'User-Agent':'sourcelibrary-revamp'}),timeout=40)
            time.sleep(4); return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(int(e.headers.get('retry-after') or 60)+3); continue
            print('ERR',path,e.code,flush=True); time.sleep(3); return None
    return None
S=sys.argv[1:] or ['slime-moulds','mycology','harmony-east-west','signs-in-the-sky','sibyls','sacred-plants','druids-megaliths','hogwarts-library','jungs-library','javanese-kraton','index-librorum-prohibitorum','yoga','alchemy','balinese-narrative-drawings','shwep']
if not os.path.exists(OUT+'_index.json'):
    json.dump(get('/api/collections'),open(OUT+'_index.json','w'),ensure_ascii=False)
for s in S:
    if os.path.exists(OUT+s+'.json'): continue
    c=get(f'/api/collections/{s}?limit=60'); g=get(f'/api/gallery?collection={s}&limit=120&sort=quality')
    if not c: continue
    if g: g={k:g.get(k) for k in('items','total')}
    json.dump({'c':c,'g':g},open(OUT+s+'.json','w'),ensure_ascii=False); print('ok',s,flush=True)
g=get('/api/gallery/collections/chinese-woodcuts')
if g: json.dump(g,open(OUT+'_set-chinese-woodcuts.json','w'),ensure_ascii=False)
l=get('/api/gallery/collections?featured=true')
if l: json.dump(l,open(OUT+'_sets.json','w'),ensure_ascii=False)
print('done',flush=True)
