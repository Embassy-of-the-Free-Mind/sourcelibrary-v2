# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Stage 3: same rubric question on the page's <summary> (+<keywords>) only, for the stage-1 sample.
import json,re,os,concurrent.futures as cf
from jevlib import ask,RUBRIC,spent,Budget,S
R=[json.loads(l) for l in open(S+'/stage1.jsonl')]
OUT=S+'/stage3.jsonl'; done=set()
if os.path.exists(OUT): done={json.loads(l)['id'] for l in open(OUT)}
items=[]
for r in R:
    if r['id'] in done: continue
    bid,p=r['id'].rsplit(':',1); p=int(p)
    for l in open(f'/Users/dereklomas/sl-corpus/books/{bid}.jsonl'):
        x=json.loads(l)
        if x['p']==p:
            t=x.get('tr') or ''; m=re.search(r'<summary>(.*?)</summary>',t,re.S); k=re.search(r'<keywords>(.*?)</keywords>',t,re.S)
            if m: items.append((r['id'],m.group(1).strip()+('\nKeywords: '+k.group(1).strip() if k else '')))
            break
print(len(items),'pages with summary',flush=True)
Q={'instr_sum':{'type':'noul','instructions':'This is a summary of one page. '+RUBRIC.replace('This page is','The page is')}}
out=open(OUT,'a')
try:
    with cf.ThreadPoolExecutor(10) as ex:
        for s in range(0,len(items),400):
            ch=items[s:s+400]
            for (i,st),res in zip(ch,ex.map(lambda x: ask(x[1],Q,2000),ch)):
                if res: out.write(json.dumps({'id':i,'instr_sum':res['instr_sum']})+'\n')
            out.flush(); print(s+len(ch),'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
