# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Stage 5 (the pattern at scale): book screen >= BT  ->  chapter-summary screen  ->  full pages of chapters >= CT.
import json,re,os,sys,concurrent.futures as cf
from jevlib import ask,RUBRIC,KIND,spent,Budget,S
BT=float(os.environ.get('BT','0.7')); CT=float(os.environ.get('CT','0.5'))
B={json.loads(l)['id']:json.loads(l)['book'] for l in open(S+'/stage2.jsonl')}
CHQ={'chap':{'type':'noul','instructions':'These are page-by-page summaries of one chapter. The chapter contains at least one INSTRUCTION PAGE for a body practice: a page that tells the reader what to DO with the body (posture, breath, steps, prostration, dance, exercise, gesture, ritual placement of the body) — the order of actions, where the limbs go, how many times, or when. Merely naming, praising, or reporting a practice does not count.'}}
PQ={'instr':{'type':'noul','instructions':RUBRIC},'kind':KIND}
OUTC=S+'/stage5-chapters.jsonl'; OUTP=S+'/stage5-pages.jsonl'
doneC={json.loads(l)['key'] for l in open(OUTC)} if os.path.exists(OUTC) else set()
doneP={json.loads(l)['id'] for l in open(OUTP)} if os.path.exists(OUTP) else set()
def book_pages(bid):
    return {json.loads(l)['p']:json.loads(l) for l in open(f'/Users/dereklomas/sl-corpus/books/{bid}.jsonl')}
def chapters_of(b):
    chs=sorted([c for c in b['chapters'] if c.get('pageNumber')],key=lambda c:c['pageNumber'])
    for i,c in enumerate(chs):
        end=c.get('endPage') or (chs[i+1]['pageNumber']-1 if i+1<len(chs) else 10**6)
        yield c,end
def gen():
    for l in open(S+'/chapters.jsonl'):
        b=json.loads(l)
        if B.get(b['id'],-1)<BT: continue
        if not os.path.exists(f'/Users/dereklomas/sl-corpus/books/{b["id"]}.jsonl'): continue
        P=book_pages(b['id'])
        for c,end in chapters_of(b):
            key=f"{b['id']}:{c['pageNumber']}"
            if key in doneC: continue
            sums=[f"p{p}: "+m.group(1).strip() for p in sorted(P) if c['pageNumber']<=p<=end for m in [re.search(r'<summary>(.*?)</summary>',P[p].get('tr') or '',re.S)] if m]
            if not sums: continue
            yield key,b,c,end,f"Book: {b.get('display_title') or b.get('title')}\nChapter: {c.get('title')}\n"+'\n'.join(sums)
out=open(OUTC,'a'); n=0; flagged=[]
try:
    with cf.ThreadPoolExecutor(10) as ex:
        g=gen()
        while True:
            ch=[x for _,x in zip(range(300),g)]
            if not ch: break
            for (key,b,c,end,st),res in zip(ch,ex.map(lambda x: ask(x[4],CHQ,12000),ch)):
                if res:
                    out.write(json.dumps({'key':key,'book':b['id'],'title':(b.get('display_title') or b.get('title') or '')[:80],'chapter':c.get('title'),'start':c['pageNumber'],'end':end,'chap':res['chap']},ensure_ascii=False)+'\n'); n+=1
            out.flush(); print('chapters',n,'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
# pages of flagged chapters
C=[json.loads(l) for l in open(OUTC)]
todo=[]
for c in sorted([c for c in C if c['chap']>=CT],key=lambda c:-c['chap']):
    P=book_pages(c['book'])
    for p in sorted(P):
        if c['start']<=p<=min(c['end'],c['start']+60):
            pid=f"{c['book']}:{p}"; t=P[p].get('tr') or ''
            if pid not in doneP and len(t)>300: todo.append((pid,c,t))
print('pages to score',len(todo),flush=True)
outp=open(OUTP,'a'); k=0
try:
    with cf.ThreadPoolExecutor(10) as ex:
        for s in range(0,len(todo),300):
            ch=todo[s:s+300]
            for (pid,c,t),res in zip(ch,ex.map(lambda x: ask(x[2],PQ),ch)):
                if res: outp.write(json.dumps({'id':pid,'title':c['title'],'chapter':c['chapter'],'chap':c['chap'],**res,'snippet':t[:500]},ensure_ascii=False)+'\n'); k+=1
            outp.flush(); print('pages',k,'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
print('done')
