# PRIOR ART: none — /root/tibetan-eval/kanjur_align.py scores identity only (matches / len(read)); this splits each read's matches into Derge-only vs leaf-only (Yigdzin).
# Does G4L read the leaf or recite Derge? Kanjur_align identity = matches / len(read): it rewards a read that agrees
# with Derge, whether from the leaf or from memory, and does not penalise omissions. Two checks per page:
#  coverage  syllables read / Yigdzin's syllables (Yigdzin = BDRC's served reader, 0.949 identity);
#  sides     at G4L syllables that match Derge but not Yigdzin (D-only) vs match Yigdzin but not Derge (Y-only).
#            A faithful reader's Y-only = witness variants it read off the leaf; a reciter's Y-only collapses.
import json, pickle, sys, statistics as st
sys.path.insert(0, '/root/tibetan-eval')
import kanjur_align as K
S='/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'; T='/root/engine-wave1-6011/tib'
idx=pickle.load(open('/root/tibetan-eval/etext-index-full.pkl','rb'))
def matched(a,b):
    n,m=len(a),len(b); prev=[j*K.NW_GAP for j in range(m+1)]; back=[[0]*(m+1) for _ in range(n+1)]
    for j in range(1,m+1): back[0][j]=2
    for i in range(1,n+1):
        cur=[i*K.NW_GAP]+[0]*m; back[i][0]=1; ai=a[i-1]; bi=back[i]
        for j in range(1,m+1):
            d=prev[j-1]+(K.NW_MATCH if ai==b[j-1] else K.NW_MISMATCH); u=prev[j]+K.NW_GAP; l=cur[j-1]+K.NW_GAP
            best=d if d>=u and d>=l else (u if u>=l else l); cur[j]=best; bi[j]=0 if best==d else (1 if best==u else 2)
        prev=cur
    M=set(); i,j=n,m
    while i>0 and j>0:
        if back[i][j]==0:
            if a[i-1]==b[j-1]: M.add(i-1)
            i,j=i-1,j-1
        elif back[i][j]==1: i-=1
        else: j-=1
    return M
def load(f,key='text'): return {json.loads(l)['id']:json.loads(l) for l in open(f)}
arms={'G4L':(load(f'{S}/an/tib-pages-G4L.jsonl'),load(f'{S}/an/tib-scores-G4L.jsonl')),
      'opus':(load(f'{T}/pages-claude-opus-5-5.jsonl'),load(f'{T}/scores-claude-opus-5-5.jsonl'))}
Y=load(f'{T}/pages-bdrc-yigdzin-v1.jsonl'); YS=load(f'{T}/scores-bdrc-yigdzin-v1.jsonl')
out={}
for name,(P,SC) in arms.items():
    rows=[]
    for i,p in P.items():
        s=SC[i]
        if not s.get('vol'): continue
        a=K.syllables(p['text']); y=K.syllables(Y[i]['text']); d=K.window_syllables(idx,s['vol'],s['imgnum'],2)
        MD=matched(a,d); MY=matched(a,y)
        rows.append({'id':i,'cov':len(a)/max(1,len(y)),'d_only':len(MD-MY)/len(a),'y_only':len(MY-MD)/len(a),'both':len(MD&MY)/len(a),'neither':1-len(MD|MY)/len(a),'ident':s['identity']})
    med=lambda k: round(st.median(r[k] for r in rows),3)
    out[name]={'n':len(rows),**{k:med(k) for k in ('cov','both','d_only','y_only','neither','ident')},
               'cov_lt_0.8':sum(r['cov']<0.8 for r in rows),'cov_gt_1.2':sum(r['cov']>1.2 for r in rows),'pages':rows}
    print(name,{k:v for k,v in out[name].items() if k!='pages'})
json.dump(out,open(f'{S}/an/tib-recite.json','w'))
