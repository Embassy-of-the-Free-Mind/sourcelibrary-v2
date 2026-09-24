# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Embedding probe distilled from Jev labels: train on page vectors, evaluate grouped by book, score the corpus.
import json,numpy as np,os,sys
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.metrics import roc_auc_score
S=os.path.dirname(os.path.abspath(__file__)); E='/Users/dereklomas/sl-corpus/emb'
B=np.load(S+'/rows_b.npy'); N=np.load(S+'/rows_n.npy'); T=np.load(S+'/rows_t.npy')
idx={(b,int(n)):i for i,(b,n) in enumerate(zip(B,N))}
V=np.memmap(E+'/vectors.i8',dtype=np.int8,mode='r',shape=(len(B),768))
lab={}; src={}
for f,s,key in (('stage1.jsonl','random','instr'),('stage5-pages.jsonl','sweep','instr'),('jev-results.jsonl','pilot',None)):
    if not os.path.exists(S+'/'+f): continue
    for l in open(S+'/'+f):
        r=json.loads(l)
        v=r[key] if key else (r.get('jev') or {}).get('rubric')
        if v is None or ':' not in r['id']: continue
        b,p=r['id'].rsplit(':',1)
        if not p.isdigit(): continue
        i=idx.get((b,int(p)))
        if i is not None: lab[i]=v; src[i]=s
ii=np.array(sorted(lab)); y=np.array([lab[i]>=0.5 for i in ii]); g=B[ii]; s=np.array([src[i] for i in ii])
X=V[ii].astype(np.float32)/127.0
print('labelled rows',len(ii),'pos',y.sum(),{k:int((s==k).sum()) for k in set(s)},flush=True)
oof=np.zeros(len(ii))
for tr,te in GroupKFold(5).split(X,y,g):
    m=LogisticRegression(C=1.0,max_iter=2000,class_weight='balanced').fit(X[tr],y[tr]); oof[te]=m.decision_function(X[te])
print('held-out-book AUC all',round(roc_auc_score(y,oof),3))
r=s=='random'; print('held-out-book AUC on random sample',round(roc_auc_score(y[r],oof[r]),3),'pos',y[r].sum())
# precision@k on the random sample (what fraction of the probe's top random pages Jev calls positive)
o=np.argsort(-oof[r]); yr=y[r][o]
for k in (50,100,200,500): print(f'  random sample top{k}: Jev-positive {yr[:k].mean():.0%} (base {y[r].mean():.1%})')
m=LogisticRegression(C=1.0,max_iter=2000,class_weight='balanced').fit(X,y)
np.save(S+'/probe_w.npy',np.r_[m.coef_[0],m.intercept_])
# score corpus
w=m.coef_[0].astype(np.float32)/127.0; b0=m.intercept_[0]; sc=np.empty(len(B),dtype=np.float32)
for s0 in range(0,len(B),250000):
    sc[s0:s0+250000]=V[s0:s0+250000].astype(np.float32)@w+b0
np.save(S+'/probe_scores.npy',sc)
print('corpus scored; >0:',int((sc>0).sum()),'of',len(sc))
