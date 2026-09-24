# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Fresh check of the embedding probe: its top pages (never labelled, <=3 per book) scored by Jev.
import json,numpy as np,os,collections,concurrent.futures as cf
from jevlib import ask,RUBRIC,KIND,spent,Budget,S
B=np.load(S+'/rows_b.npy'); N=np.load(S+'/rows_n.npy'); T=np.load(S+'/rows_t.npy'); sc=np.load(S+'/probe_scores.npy')
seen=set()
for f in ('stage1.jsonl','stage5-pages.jsonl','jev-results.jsonl','stage3.jsonl'):
    if os.path.exists(S+'/'+f):
        for l in open(S+'/'+f): seen.add(json.loads(l)['id'])
order=np.argsort(-sc); per=collections.Counter(); pick=[]
for i in order[:400000]:
    if not T[i]: continue
    b=str(B[i]); pid=f'{b}:{int(N[i])}'
    if pid in seen or per[b]>=3: continue
    per[b]+=1; pick.append((pid,float(sc[i])))
    if len(pick)>=1500: break
print('picked',len(pick),'books',len(per),'min score',round(pick[-1][1],2),flush=True)
def text(pid):
    b,p=pid.rsplit(':',1); p=int(p); f=f'/Users/dereklomas/sl-corpus/books/{b}.jsonl'
    if not os.path.exists(f): return None
    for l in open(f):
        r=json.loads(l)
        if r['p']==p: return r.get('tr')
Q={'instr':{'type':'noul','instructions':RUBRIC},'kind':KIND}
out=open(S+'/stage6.jsonl','w')
def work(x):
    t=text(x[0]); return (x,t,ask(t,Q) if t and len(t)>300 else None)
try:
    with cf.ThreadPoolExecutor(10) as ex:
        for (pid,s),t,res in ex.map(work,pick):
            if res: out.write(json.dumps({'id':pid,'probe':s,**res,'snippet':(t or '')[:500]},ensure_ascii=False)+'\n')
except Budget as e: print('STOP',e)
print('spent',round(spent(),3))
