# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Stage 2: book-level screen from catalog title + summary + categories (only books with translated pages in the mirror).
import json,os,sys,concurrent.futures as cf,ast
from jevlib import ask,spent,Budget,S
have={f[:-6] for f in os.listdir('/Users/dereklomas/sl-corpus/books')}
tr={}
for l in open('/Users/dereklomas/sl-corpus/books.jsonl'):
    r=json.loads(l)
    if (r.get('pages_translated') or 0)>0: tr[r['id']]=r
OUT=S+'/stage2.jsonl'; done=set()
if os.path.exists(OUT): done={json.loads(l)['id'] for l in open(OUT)}
items=[]
for l in open('/Users/dereklomas/sl-corpus/catalog.jsonl'):
    r=json.loads(l); i=r.get('id')
    if i not in have or i not in tr or i in done: continue
    st=f"Title: {r.get('display_title') or r.get('title')}\nEnglish title: {r.get('english_title') or ''}\nAuthor: {r.get('author') or ''}\nLanguage: {r.get('language')} Year: {r.get('published') or r.get('year')}\nCategories: {r.get('categories') or ''} {r.get('collections') or ''}\nSummary: {r.get('summary') or ''}"
    items.append((i,st))
print(len(items),'books',flush=True)
Q={'book':{'type':'noul','instructions':'This book probably contains at least one passage that instructs the reader in a bodily practice: posture, breathing, exercise, bowing or prostration, dance, gesture, ritual movement or placement of the body, drill or combat, penance, or a daily bodily regimen.'}}
out=open(OUT,'a'); k=0
try:
    with cf.ThreadPoolExecutor(8) as ex:
        for s in range(0,len(items),400):
            ch=items[s:s+400]
            for (i,st),res in zip(ch,ex.map(lambda x: ask(x[1],Q,3000),ch)):
                if res: out.write(json.dumps({'id':i,'book':res['book']})+'\n'); k+=1
            out.flush(); print(k,'spent',round(spent(),3),flush=True)
except Budget as e: print('STOP',e)
print('done',k)
