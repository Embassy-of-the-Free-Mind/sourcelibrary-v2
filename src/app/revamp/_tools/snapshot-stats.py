import json,os
exec(open('/private/tmp/claude-501/-Users-user/b99ad9bc-2539-41b5-8ffd-c6a77139434b/scratchpad/snap.py').read().split("S=[")[0])
first=['slime-moulds','mycology','alchemy','harmony-east-west','sibyls','signs-in-the-sky','chinese-woodcuts']
seen=set()
while True:
    rest=[f[:-5] for f in sorted(os.listdir(OUT)) if not f.startswith('_') and f[:-5] not in seen]
    todo=[s for s in first if s in rest]+[s for s in rest if s not in first]
    if not todo:
        if 'done3' in open('/private/tmp/claude-501/-Users-user/b99ad9bc-2539-41b5-8ffd-c6a77139434b/scratchpad/snap3.log').read(): break
        time.sleep(30); continue
    s=todo[0]; seen.add(s)
    if os.path.exists(OUT+'_stats-'+s+'.json'): continue
    a=get(f'/api/catalog/stats?collection={s}'); b=get(f'/api/gallery/stats?collection={s}')
    json.dump({'books':a,'images':b},open(OUT+'_stats-'+s+'.json','w'),ensure_ascii=False); print('ok',s,flush=True)
print('done4',flush=True)
