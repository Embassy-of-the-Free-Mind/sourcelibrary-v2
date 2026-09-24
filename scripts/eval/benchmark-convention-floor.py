#!/usr/bin/env python3
"""
benchmark-convention-floor.py — how much of a Greek benchmark CER is the READER, and how much is
the reference edition's conventions and the page's furniture? (#4925 step 2 spot check, 2026-09-21)

PRIOR ART: scripts/eval/benchmark-score.mjs — it has cer and cer_folded (diacritics), but charges
  case, final sigma, running heads and footnote apparatus to the engine; this audit removes them
  one layer at a time so the floor is visible. It does not replace the scorer or any verdict.

Three measures per page and arm, Greek letters only:
  strict    NFC, case and accents kept (replicates the scorer's cer to within 0.01)
  folded    lower-cased, accents and breathings stripped, final sigma folded
  tolerant  folded + leading/trailing engine text is free (approximate-substring alignment), so a
            running head or a footnote apparatus the modern edition lacks is not an "insertion"

Usage:  python3 scripts/eval/benchmark-convention-floor.py <bench-images-root> [date] [strata,comma]
Needs numpy. Reads results/benchmark/<stratum>-<date>.json, benchmark/refs/, <root>/<stratum>/out/.
"""
import sys
import json,unicodedata,statistics as st,numpy as np
RT=sys.argv[1]
DATE=sys.argv[2] if len(sys.argv)>2 else '2026-09-21'
STRATA=(sys.argv[3] if len(sys.argv)>3 else 'greek,greek-ext').split(',')
L='gemini-3.1-flash-lite';P='gemini-3-flash-preview';K='kraken-greek-cllg'
def letters(s,fold):
    s=unicodedata.normalize('NFD' if fold else 'NFC',s)
    o=[]
    for c in s:
        if fold and unicodedata.category(c)=='Mn': continue
        if ('Ͱ'<=c<='Ͽ' or 'ἀ'<=c<='῿') and unicodedata.category(c)[0]=='L':
            if fold: c=c.lower().replace('ς','σ')
            o.append(c)
    return np.array([ord(c) for c in o],dtype=np.int32)
def dist(ref,got,infix):
    # rows over ref, columns over got; infix => free leading/trailing GOT text (headers, apparatus)
    n=len(got); ar=np.arange(n+1)
    prev=np.zeros(n+1,dtype=np.int64) if infix else ar.astype(np.int64).copy()
    for i,c in enumerate(ref,1):
        sub=prev[:-1]+(got!=c)
        cur=np.empty(n+1,dtype=np.int64); cur[0]=i
        cur[1:]=np.minimum(prev[1:]+1,sub)
        cur=np.minimum.accumulate(cur-ar)+ar
        prev=cur
    return int(prev.min() if infix else prev[-1])
pages=[]
for s in STRATA:
    for p in json.load(open(f'scripts/eval/results/benchmark/{s}-{DATE}.json'))['pages']: p['st']=s; pages.append(p)
def per(p):
    try:y=int(p.get('year'))
    except:return None
    return '1450-1699' if y<1700 else '1700-1799' if y<1800 else None
res={}
for p in pages:
    c=per(p)
    if not c or not p.get('has_ref') or p.get('script_class')!='typeset-print' or p.get('greek_share',0)<0.5: continue
    if not all('cer' in p['engines'].get(e,{}) for e in(L,P,K)): continue
    reft=open(f"scripts/eval/benchmark/refs/{p['slug']}.txt").read()
    row={'slug':p['slug']}
    for e in(L,P,K):
        gt=open(f"{RT}/{p['st']}/out/{e}/{p['slug']}.txt").read()
        r0,g0=letters(reft,False),letters(gt,False); r1,g1=letters(reft,True),letters(gt,True)
        row[e]=(dist(r0,g0,False)/len(r0), dist(r1,g1,False)/len(r1), dist(r1,g1,True)/len(r1))
    res.setdefault(c,[]).append(row)
json.dump(res,open(f'scripts/eval/results/benchmark/decisions/greek-convention-floor-{DATE}.json','w'))
for c,rows in res.items():
    print(c,len(rows))
    for e in(L,P,K):
        print(f"  {e:26s} strict {st.median(r[e][0] for r in rows):.3f} | case+accent folded {st.median(r[e][1] for r in rows):.3f} | + free header/apparatus {st.median(r[e][2] for r in rows):.3f}")
    for e in(P,K):
        for k,lab in((0,'strict'),(2,'tolerant')):
            dl=[r[e][k]-r[L][k] for r in rows]
            print(f"    Δ {e[:12]} vs lite [{lab}]: median {st.median(dl):+.3f}  W/L {sum(x<0 for x in dl)}/{sum(x>0 for x in dl)}  share≤-0.05 {sum(x<=-0.05 for x in dl)/len(dl):.2f}")
