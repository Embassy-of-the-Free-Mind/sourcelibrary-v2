# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Stage 1: one random translated page per book, up to N books — unbiased base rate + kind distribution.
import json,os,random,glob,sys,concurrent.futures as cf
from jevlib import ask,RUBRIC,KIND,spent,Budget,S
N=int(sys.argv[1]) if len(sys.argv)>1 else 30000
OUT=S+'/stage1.jsonl'; done=set()
if os.path.exists(OUT): done={json.loads(l)['id'].split(':')[0] for l in open(OUT)}
meta={}
for l in open('/Users/dereklomas/sl-corpus/books.jsonl'):
    r=json.loads(l); meta[r['id']]=(r.get('language'),r.get('published'),(r.get('display_title') or r.get('title') or '')[:80],r.get('visible'))
files=glob.glob('/Users/dereklomas/sl-corpus/books/*.jsonl'); random.seed(24); random.shuffle(files)
def pick():
    n=len(done)
    for f in files:
        if n>=N: return
        bid=os.path.basename(f)[:-6]
        if bid in done: continue
        rows=[]
        for l in open(f):
            r=json.loads(l); t=r.get('tr') or ''
            if len(t)>600 and r.get('type') not in ('front-cover','back-cover','blank'): rows.append((r['p'],t))
        if not rows: continue
        p,t=random.choice(rows); n+=1
        yield bid,p,t
Q={'instr':{'type':'noul','instructions':RUBRIC},'kind':KIND}
out=open(OUT,'a'); k=0
def work(x):
    bid,p,t=x; return bid,p,t,ask(t,Q)
try:
    with cf.ThreadPoolExecutor(10) as ex:
        it=pick(); stop=False
        while not stop:
            chunk=[]
            for x in it:
                chunk.append(x)
                if len(chunk)>=200: break
            if not chunk: break
            for bid,p,t,res in ex.map(work,chunk):
                if res is None: continue
                m=meta.get(bid,(None,None,'',None))
                out.write(json.dumps({'id':f'{bid}:{p}','lang':m[0],'year':m[1],'title':m[2],'visible':m[3],**res,'snippet':t[:400]},ensure_ascii=False)+'\n'); out.flush(); k+=1
            print(k,'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
print('done',k,'spent',round(spent(),3))
