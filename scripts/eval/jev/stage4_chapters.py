# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Stage 4: chapter-level screen. Chapter "summary" = the chapter title + the <summary> of each of its pages (capped).
import json,re,os,concurrent.futures as cf
from jevlib import ask,spent,Budget,S
R={json.loads(l)['id']:json.loads(l) for l in open(S+'/stage1.jsonl')}
CH={}
for l in open(S+'/chapters.jsonl'):
    b=json.loads(l); CH[b['id']]=b
OUT=S+'/stage4.jsonl'; done=set()
if os.path.exists(OUT): done={json.loads(l)['id'] for l in open(OUT)}
items=[]
for pid,r in R.items():
    if pid in done: continue
    bid,p=pid.rsplit(':',1); p=int(p); b=CH.get(bid)
    if not b: continue
    chs=sorted([c for c in b['chapters'] if c.get('pageNumber')],key=lambda c:c['pageNumber'])
    cur=None
    for i,c in enumerate(chs):
        end=c.get('endPage') or (chs[i+1]['pageNumber']-1 if i+1<len(chs) else 10**6)
        if c['pageNumber']<=p<=end: cur=(c,end)
    if not cur: continue
    c,end=cur; sums=[]; npages=0
    for l in open(f'/Users/dereklomas/sl-corpus/books/{bid}.jsonl'):
        x=json.loads(l)
        if c['pageNumber']<=x['p']<=end:
            npages+=1; m=re.search(r'<summary>(.*?)</summary>',x.get('tr') or '',re.S)
            if m: sums.append(f"p{x['p']}: "+m.group(1).strip())
    if not sums: continue
    st=f"Book: {b.get('display_title') or b.get('title')}\nChapter: {c.get('title')}\n"+'\n'.join(sums)
    items.append((pid,st,npages,len(sums)))
print(len(items),'sample pages with a summarised chapter',flush=True)
Q={'chap':{'type':'noul','instructions':'These are page-by-page summaries of one chapter. The chapter contains at least one INSTRUCTION PAGE for a body practice: a page that tells the reader what to DO with the body (posture, breath, steps, prostration, dance, exercise, gesture, ritual placement of the body) — the order of actions, where the limbs go, how many times, or when. Merely naming, praising, or reporting a practice does not count.'}}
out=open(OUT,'a')
try:
    with cf.ThreadPoolExecutor(10) as ex:
        for s in range(0,len(items),300):
            ch=items[s:s+300]
            for (i,st,np,ns),res in zip(ch,ex.map(lambda x: ask(x[1],Q,12000),ch)):
                if res: out.write(json.dumps({'id':i,'chap':res['chap'],'chapter_pages':np,'summarised':ns,'chars':len(st)})+'\n')
            out.flush(); print(s+len(ch),'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
