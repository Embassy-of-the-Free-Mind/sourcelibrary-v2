# PRIOR ART: scripts/eval/results/blind-judge-6559 (one transcription per item, OCR); this scores a PAIRED translation judge run in both A/B orders.
# Run from this directory: python3 score.py
import json,re,statistics as st,collections
def load(keyf,outf):
    key={k['uid']:k for k in json.load(open(keyf))}; res={}
    for l in open(outf):
        r=json.loads(l)
        if not r.get('text'): continue
        t=re.sub(r'^```[a-z]*\n|```$','',r['text'].strip()).strip()
        j=json.loads(t); k=key[r['uid']]
        o=j['A' if k['A']=='opus' else 'B']; g=j['A' if k['A']=='gemini' else 'B']
        bt=j['better']; better='tie' if bt=='tie' else k[bt]
        res[k['page_id']]=dict(book=k['title'][:28],p=k['page_number'],opusA=k['A']=='opus',o=o['fidelity'],g=g['fidelity'],better=better,o_n=[len(o[x]) for x in ('omitted','added','mistranslated')],g_n=[len(g[x]) for x in ('omitted','added','mistranslated')])
    return res
a=load('key.json','judge-out.jsonl'); b=load('key-swap.json','judge-out-swap.jsonl')
both=[pid for pid in a if pid in b]
print('pages judged in both orders:',len(both))
allA=[r for r in list(a.values())+list(b.values())]
pos=[r['o']-r['g'] for r in allA if r['opusA']]; neg=[r['o']-r['g'] for r in allA if not r['opusA']]
print(f"position: opus-gemini when opus is A {st.mean(pos):+.2f} (n={len(pos)}), when B {st.mean(neg):+.2f} (n={len(neg)})")
books=collections.defaultdict(list)
for pid in both:
    ra,rb=a[pid],b[pid]
    books[ra['book']].append(dict(o=(ra['o']+rb['o'])/2,g=(ra['g']+rb['g'])/2,wins_o=[ra['better'],rb['better']].count('opus'),wins_g=[ra['better'],rb['better']].count('gemini'),agree=ra['better']==rb['better'],
      o_n=[x+y for x,y in zip(ra['o_n'],rb['o_n'])],g_n=[x+y for x,y in zip(ra['g_n'],rb['g_n'])],p=ra['p']))
rows=[]
for bk,rs in list(books.items())+[('ALL',[r for rs in books.values() for r in rs])]:
    d=[r['o']-r['g'] for r in rs]
    print(f"| {bk} | {len(rs)} | {st.mean(r['o'] for r in rs):.2f} | {st.mean(r['g'] for r in rs):.2f} | {st.mean(d):+.2f} | {sum(r['wins_o'] for r in rs)}/{sum(r['wins_g'] for r in rs)} | {sum(r['agree'] for r in rs)}/{len(rs)} | {sum(r['o_n'][0] for r in rs)}/{sum(r['g_n'][0] for r in rs)} | {sum(r['o_n'][1] for r in rs)}/{sum(r['g_n'][1] for r in rs)} | {sum(r['o_n'][2] for r in rs)}/{sum(r['g_n'][2] for r in rs)} |")
alld=[r['o']-r['g'] for rs in books.values() for r in rs]
print('pages opus higher / equal / gemini higher:',sum(x>0 for x in alld),sum(x==0 for x in alld),sum(x<0 for x in alld))
# bootstrap CI of mean diff by page
import random; random.seed(1); bs=sorted(st.mean(random.choices(alld,k=len(alld))) for _ in range(5000)); print('95% CI',bs[125],bs[4875])
