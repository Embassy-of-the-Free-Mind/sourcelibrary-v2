#!/usr/bin/env python3
# PRIOR ART: scripts/eval/jev/additions-screen.py asks Jev the opposite question (words added); this reuses its client, threshold rule and
# report shape for omissions, and replaces its 6,000-character truncation with overlapping chunks (#6061 asks for long pages to be split).
"""#6061 Jev screen for omissions: does the served English leave out part of the source? Usage:
   python3 scripts/eval/jev/omission-screen.py <env file with VERCEL_OIDC_TOKEN> [--dry]
Needs work/live-items.jsonl from omission-screen-fetch.mjs (the 321 #5695 pages and their judges' omission labels).
Controls are built here: on 40 clean pages (no omission flagged, fidelity >= 4), one sentence of the English is deleted.
Writes results/jev-omissions-2026-10/{scores,summary}.json (ids and scores only: no page text, no token)."""
import json,sys,os,time,urllib.request,urllib.error,re,random,math
O=os.environ.get('OUT_DIR') or os.path.join(os.path.dirname(os.path.abspath(__file__)),'../results/jev-omissions-2026-10/')
DRY='--dry' in sys.argv
TOK=None if DRY else [l.split('=',1)[1].strip().strip('"') for l in open(sys.argv[1]) if l.startswith('VERCEL_OIDC_TOKEN')][0]
MAXC=6000      # characters of EACH of source and translation per call; longer pages are split into chunks
OVERLAP=0.12   # each chunk reaches this share of a chunk past its neighbours' edges, so a sentence cut at a seam is still seen whole once
CAP_USD=1.0
Q={
 'w1':{'type':'noul','instructions':'The translation leaves out at least one sentence or clause of the source text: some words of the source are not rendered anywhere in the translation. Text cut off at the very start or end of either excerpt does not count.'},
 'w2':{'type':'noul','instructions':'The translation renders the whole source text: every sentence and clause of the source has a counterpart in the translation, and nothing has been left out. Text cut off at the very start or end of either excerpt does not count.'},
}
DROP=re.compile(r'<(note|gloss|summary|meta|keywords|image-desc|page-type)\b[^>]*>.*?</\1>',re.S|re.I)
SRC_META=re.compile(r'<(language|page-type|columns|script|warning|scan-quality|vocab|meta|image-desc|sig)\b[^>]*>.*?</\1>',re.S|re.I)
def squeeze(t):
    # OCR pads lines with runs of &nbsp; (one Latin page: 19,377 characters, 2,000 of them words); left in, they skew the
    # proportional chunk cuts so the source and English excerpts no longer cover the same passage
    return re.sub(r'[ \t]+',' ',re.sub(r'(&nbsp;)+',' ',t)).strip()
def clean_src(src):
    return squeeze(SRC_META.sub('',src))  # the OCR's own metadata is not text a translation should render
def clean_tr(tr):
    tr=DROP.sub('',tr)                 # translator's notes and page metadata render nothing of the source
    return squeeze(re.sub(r'</?[a-z][\w-]*[^>]*>','',tr))  # keep the words inside <term>, <heading> etc., drop the markup
def cut(text,k,i):
    """chunk i of k by proportional position, widened by OVERLAP and snapped to whitespace"""
    n=len(text); w=n/k; a=max(0,int(i*w-OVERLAP*w)); b=min(n,int((i+1)*w+OVERLAP*w))
    if a>0: a=text.find(' ',a)+1 or a
    if b<n: b=(text.rfind(' ',a,b) if text.rfind(' ',a,b)>a else b)
    return text[a:b]
def states(src,tr):
    k=max(1,math.ceil(max(len(src),len(tr))/MAXC))
    head='SOURCE TEXT (original or OCR):\n{}\n\nTRANSLATION:\n{}'
    if k==1: return [head.format(src,tr)]
    return [f'(Part {i+1} of {k} of a long page: both excerpts are cut at about the same place.)\n'+head.format(cut(src,k,i),cut(tr,k,i)) for i in range(k)]
tot={'usd':0.0,'tok':0,'calls':0}
def ask(st):
    if DRY: tot['calls']+=1; tot['tok']+=len(st)//3; return {'w1':0.5,'w2':0.5}
    if tot['usd']>=CAP_USD: raise SystemExit(f'cap ${CAP_USD} reached')
    body=json.dumps({'model':'typesafe-ai/jev','state':st,'questions':Q}).encode()
    for i in range(4):
        try:
            r=urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone',data=body,headers={'Authorization':'Bearer '+TOK,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=90))
            tot['usd']+=float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0); tot['tok']+=j['usage']['input_tokens']; tot['calls']+=1
            return {k:v['noul'] for k,v in j['answers'].items()}
        except urllib.error.HTTPError as e:
            if e.code in (401,403): raise
            time.sleep(2*(i+1))
        except Exception: time.sleep(2*(i+1))
    return None
def score_page(src,tr):
    per=[ask(s) for s in states(src,tr)]
    if any(a is None for a in per): return None
    return {'w1':max(a['w1'] for a in per),'w2':max(1-a['w2'] for a in per),'chunks':len(per)}  # a page omits if any part does
def auc(pos,neg):
    return sum((p>n)+0.5*(p==n) for p in pos for n in neg)/(len(pos)*len(neg)) if pos and neg else None
SENT=re.compile(r'(?<=[.;:!?])\s+')
def plant(tr,rng):
    """delete one English sentence of >= 8 words, not the first or last, from the cleaned translation; None if the page has no such sentence"""
    s=SENT.split(clean_tr(tr).strip())
    cand=[i for i in range(1,len(s)-1) if len(s[i].split())>=8]
    if not cand: return None
    i=rng.choice(cand)
    return ' '.join(s[:i]+s[i+1:]),s[i]
jl=lambda f:[json.loads(l) for l in open(f) if l.strip()]
live=jl(O+'work/live-items.jsonl')
rng=random.Random(6061)
clean=[x for x in live if not x['label'] and x['fidelity']>=4]
rng.shuffle(clean)
ctrl=[]
for x in clean:
    p=plant(x['translation'],rng)
    if not p: continue
    ctrl.append({'id':x['id'],'lang':x['lang'],'translation_planted':p[0],'dropped_words':len(p[1].split())})
    if len(ctrl)==40: break
S={'live':[],'controls':[]}
for x in live:
    a=score_page(clean_src(x['source']),clean_tr(x['translation']))
    if a: S['live'].append({k:x[k] for k in('id','track','lang','label','fidelity','changed_since_judged','prompt_version')}|a|{'src_chars':len(clean_src(x['source'])),'tr_chars':len(clean_tr(x['translation']))})
byid={x['id']:x for x in live}
for c in ctrl:
    a=score_page(clean_src(byid[c['id']]['source']),c['translation_planted'])
    if a: S['controls'].append({'id':c['id'],'lang':c['lang'],'dropped_words':c['dropped_words']}|a)
# A/A: the same 20 pages (10 control, 10 live) asked again
lv={x['id']:x for x in S['live']}; cv={x['id']:x for x in S['controls']}
aa=[]
for cid in [c['id'] for c in rng.sample(ctrl,10)]:
    c=next(z for z in ctrl if z['id']==cid); a=score_page(clean_src(byid[cid]['source']),c['translation_planted'])
    if a and cid in cv: aa.append({w:abs(a[w]-cv[cid][w]) for w in('w1','w2')})
for x in rng.sample(live,10):
    a=score_page(clean_src(x['source']),clean_tr(x['translation']))
    if a and x['id'] in lv: aa.append({w:abs(a[w]-lv[x['id']][w]) for w in('w1','w2')})
summ={'n_calls':tot['calls'],'input_tokens':tot['tok'],'cost_usd_gateway':round(tot['usd'],5),'max_chars_each':MAXC,'overlap':OVERLAP,
      'pages_chunked':sum(1 for x in S['live'] if x['chunks']>1),'n_live':len(S['live']),'n_controls':len(S['controls'])}
summ['aa']={w:round(sum(x[w] for x in aa)/max(1,len(aa)),4) for w in('w1','w2')}|{'n':len(aa),'max_w1':round(max([x['w1'] for x in aa] or [0]),4)}
f_of={'w1':lambda x:x['w1'],'w2':lambda x:x['w2'],'mean':lambda x:(x['w1']+x['w2'])/2}
for w,f in f_of.items():
    ids={c['id'] for c in S['controls']}
    neg=sorted(f(lv[i]) for i in ids if i in lv)   # the same pages unmodified: a paired control
    pos=[f(x) for x in S['controls']]
    thr=neg[int(len(neg)*0.9)-1]                   # about 10% of clean pages scored above it
    def live_block(rows):
        lp=[f(x) for x in rows if x['label']]; ln=[f(x) for x in rows if not x['label']]; fl=[x for x in rows if f(x)>thr]
        return {'auc':None if auc(lp,ln) is None else round(auc(lp,ln),3),'n_omission':len(lp),'n_none':len(ln),'flagged':len(fl),
                'true_among_flagged':sum(x['label'] for x in fl),'precision':round(sum(x['label'] for x in fl)/max(1,len(fl)),3),
                'recall':round(sum(p>thr for p in lp)/max(1,len(lp)),3)}
    rows=S['live']; unchanged=[x for x in rows if not x['changed_since_judged']]
    summ[w]={'threshold':round(thr,4),
      'controls':{'auc':round(auc(pos,neg),3),'n_planted':len(pos),'n_clean':len(neg),'recall':round(sum(p>thr for p in pos)/len(pos),3),'clean_flagged':sum(n>thr for n in neg)},
      'live':live_block(rows),'live_unchanged_since_judged':live_block(unchanged),
      'live_single_chunk':live_block([x for x in rows if x['chunks']==1]),
      'live_by_track':{t:live_block([x for x in rows if x['track']==t]) for t in sorted({x['track'] for x in rows})}}
os.makedirs(O,exist_ok=True)
if not DRY:
    json.dump(S,open(O+'scores.json','w'),indent=1); json.dump(summ,open(O+'summary.json','w'),indent=1)
print(json.dumps({k:summ[k] for k in('n_calls','input_tokens','cost_usd_gateway','pages_chunked','n_live','n_controls','aa')}))
for w in f_of: print(w,json.dumps({k:summ[w][k] for k in('threshold','controls','live','live_unchanged_since_judged')}))
