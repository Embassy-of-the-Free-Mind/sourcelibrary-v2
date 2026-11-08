# Pictures for the All subjects page: 10 per broad subject, 2 per specific one. Public gallery API only, slow.
import json,time,urllib.request,urllib.error,urllib.parse,os
D='/Users/user/Projects/sourcelibrary-v2/.claude/worktrees/collections-revamp/src/app/revamp/_data/'
OUT=D+'snap/_subject-images.json'
S=json.load(open(D+'subjects.json'))['subjects']
def get(path):
    for i in range(8):
        try:
            r=urllib.request.urlopen(urllib.request.Request('https://sourcelibrary.org'+path,headers={'User-Agent':'sourcelibrary-revamp'}),timeout=40)
            time.sleep(4); return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(int(e.headers.get('retry-after') or 60)+3); continue
            print('ERR',path,e.code,flush=True); time.sleep(3); return None
        except Exception as e:
            print('ERR',path,e,flush=True); time.sleep(5)
    return None
out=json.load(open(OUT)) if os.path.exists(OUT) else {}
def save(): json.dump(out,open(OUT,'w'),ensure_ascii=False)
def pick(items,n):
    bad=('binding','cover','spine','title','bookplate','stamp')
    res=[]
    for i in items or []:
        if any(b in (i.get('type') or '').lower() for b in bad): continue
        res.append({'src':i.get('cardUrl') or i.get('thumbnailUrl'),'aspect':i.get('aspect'),'label':i.get('description')})
        if len(res)>=n: break
    return res
def tries(s):
    c=(s.get('countSource') or {}).get('images') or ''
    q=[]
    if c.startswith('topic:'): q.append('topic='+urllib.parse.quote(c[6:]))
    if c.startswith('subject:'): q.append('subject='+urllib.parse.quote(c[8:]))
    q.append('subject='+urllib.parse.quote(s['label']))
    return q
order=[s for s in S if s['level']==1]+[s for s in S if s['level']==2]
for s in order:
    if s['id'] in out: continue
    n=10 if s['level']==1 else 2
    got=[]
    for q in tries(s):
        j=get(f'/api/gallery?{q}&limit=30&sort=quality')
        got=pick((j or {}).get('items'),n)
        if len(got)>=min(n,2): break
    out[s['id']]=got; save(); print(s['id'],len(got),flush=True)
print('done',flush=True)
