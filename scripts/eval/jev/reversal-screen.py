#!/usr/bin/env python3
# PRIOR ART: scripts/eval/jev/additions-screen.py asks Jev a page-level question (added words), not a sentence-level one;
# scripts/eval/translation-vs-reference/backtrans/ holds the reference-free reversal detectors D1-D3 (#5695) and their
# 150-page labelled set, which this reuses as ground truth (set.jsonl, raw/plants.json) without rebuilding it.
"""#6062 Jev screen for reversed meaning, one English sentence at a time. Usage:
   python3 scripts/eval/jev/reversal-screen.py <env.gw> [--max-usd 1.0] [--dry]
Reads scripts/eval/results/xlref-backtrans-2026-10/{set.jsonl,raw/plants.json}. Each item is the whole source page
(first 6,000 characters) and ONE sentence of our English; Jev answers two noul wordings. Sentence labels come from the
judges' quoted reversals (#5695); negatives are every sentence of the pages no judge marked reversed.
Writes scripts/eval/results/jev-reversals-2026-10/{scores.json,summary.json} (no page text, no token).
Calls are cached in results/jev-reversals-2026-10/work/cache.jsonl (not committed), so a re-run costs nothing."""
import json,sys,os,re,time,random,hashlib,ast,threading,urllib.request,urllib.error
from concurrent.futures import ThreadPoolExecutor
H=os.path.dirname(os.path.abspath(__file__)); R=H+'/../results/'
B=R+'xlref-backtrans-2026-10/'; O=R+'jev-reversals-2026-10/'; W=O+'work/'; os.makedirs(W,exist_ok=True)
TOK=[l.split('=',1)[1].strip().strip('"') for l in open(sys.argv[1]) if l.startswith('VERCEL_OIDC_TOKEN')][0]
MAXUSD=float(sys.argv[sys.argv.index('--max-usd')+1]) if '--max-usd' in sys.argv else 1.0
MAXC=6000
Q={
 'w1':{'type':'noul','instructions':'The ENGLISH SENTENCE reverses the meaning of the source text at the place it translates: it negates what the source affirms, affirms what the source denies, or says the opposite (for example never for always, outer for inner, permitted for forbidden).'},
 'w2':{'type':'noul','instructions':'The ENGLISH SENTENCE agrees in meaning with what the source text says at the place it translates: it does not negate, invert or contradict the source, even if its wording is free.'},
}
TAGX=re.compile(r'<(note|gloss|summary|meta|keywords|image-desc|page-type)\b[^>]*>.*?</\1>',re.S|re.I)
def clean(t): return re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',TAGX.sub(' ',t))).strip()
def sentences(t):
    """Split cleaned English into sentences; fragments under 25 characters join the next one."""
    parts=[p.strip() for p in re.split(r'(?<=[.!?;])\s+(?=[A-Z"“‘(\[])',t) if p.strip()]
    out=[];buf=''
    for p in parts:
        buf=(buf+' '+p).strip()
        if len(buf)>=25: out.append(buf);buf=''
    if buf:
        if out: out[-1]+=' '+buf
        else: out.append(buf)
    return out
norm=lambda s:' '.join(re.findall(r"[a-z0-9]+",s.lower()))
def matches(sent,quote):
    s,q=norm(sent),norm(quote.replace('…',' ').replace('...',' '))
    if not q: return False
    if q in s or (len(s)>=25 and s in q): return True
    qw=q.split(); sw=set(s.split())
    return len(qw)>=4 and sum(w in sw for w in qw)/len(qw)>=0.6

# ---- Jev client with cache and a hard spend stop ----
CACHE=W+'cache.jsonl'; cache={}; lk=threading.Lock(); tot={'usd':0.0,'tok':0,'calls':0}
if os.path.exists(CACHE):
    for l in open(CACHE):
        if l.strip(): x=json.loads(l); cache[x['k']]=x['a']
def ask(src,sent,tag='main'):
    st=f'SOURCE TEXT (original or OCR, the whole page):\n{src[:MAXC]}\n\nENGLISH SENTENCE (one sentence of our translation of this page):\n{sent}'
    k=hashlib.sha1((tag+'\0'+st+json.dumps(Q,sort_keys=True)).encode()).hexdigest()
    if k in cache: return cache[k]
    if tot['usd']>=MAXUSD: raise SystemExit(f'spend stop at ${tot["usd"]:.4f}')
    body=json.dumps({'model':'typesafe-ai/jev','state':st,'questions':Q}).encode()
    for i in range(4):
        try:
            r=urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone',data=body,headers={'Authorization':'Bearer '+TOK,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=60))
            a={kk:v['noul'] for kk,v in j['answers'].items()}
            with lk:
                tot['usd']+=float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0); tot['tok']+=j['usage']['input_tokens']; tot['calls']+=1
                cache[k]=a; open(CACHE,'a').write(json.dumps({'k':k,'a':a})+'\n')
            return a
        except urllib.error.HTTPError as e:
            if e.code in (401,403): raise
            time.sleep(2*(i+1))
        except Exception: time.sleep(2*(i+1))
    return None
sc=lambda a:{'w1':a['w1'],'w2':1-a['w2'],'mean':(a['w1']+1-a['w2'])/2}

# ---- items ----
rows=[json.loads(l) for l in open(B+'set.jsonl')]
for r in rows: r['L']=r['labels'] if isinstance(r['labels'],dict) else ast.literal_eval(r['labels'])
byrow={r['id']:r for r in rows}
items=[]; quotes=[]
for r in rows:
    pos_page=r['L']['reversal_judges']>0
    ss=sentences(clean(r['english']))
    qs=[q['english'] for q in r['L'].get('reversals',[]) if q.get('english')]
    for qi,q in enumerate(qs): quotes.append({'page':r['id'],'qi':qi,'sents':[i for i,s in enumerate(ss) if matches(s,q)]})
    for i,s in enumerate(ss):
        lab=1 if any(matches(s,q) for q in qs) else (0 if not pos_page else None)  # None: unquoted sentence on a reversed page
        items.append({'page':r['id'],'i':i,'track':r['track'],'lang':r['lang'],'label':lab,'src':r['source_text'],'sent':s})
plants=json.load(open(B+'raw/plants.json')); pitems=[]
for p in plants:
    r=byrow.get(p['id'])
    if not r or p['before_context'] not in r['english']: continue
    e2=r['english'].replace(p['before_context'],p['after_context'],1)
    a,b=sentences(clean(r['english'])),sentences(clean(e2))
    diff=[(x,y) for x,y in zip(a,b) if x!=y]
    if len(a)==len(b) and len(diff)==1: pitems.append({'page':p['id'],'op':p['op'],'src':r['source_text'],'orig':diff[0][0],'plant':diff[0][1]})

print('sentences',len(items),'pos',sum(x['label']==1 for x in items),'neg',sum(x['label']==0 for x in items),
      'unlabelled',sum(x['label'] is None for x in items),'quotes',len(quotes),'quotes matched',sum(bool(q['sents']) for q in quotes),'plants',len(pitems))
if '--dry' in sys.argv: sys.exit(0)

with ThreadPoolExecutor(8) as ex:
    res=list(ex.map(lambda x:ask(x['src'],x['sent']),items))
    pres=list(ex.map(lambda x:(ask(x['src'],x['orig']),ask(x['src'],x['plant'])),pitems))
for x,a in zip(items,res): x['s']=sc(a) if a else None
ok=[x for x in items if x['s']]
random.seed(6062); aa_in=random.sample(ok,60)
with ThreadPoolExecutor(8) as ex: aa=list(ex.map(lambda x:ask(x['src'],x['sent'],tag='aa'),aa_in))

# ---- scoring ----
def auc(pos,neg): return sum((p>n)+0.5*(p==n) for p in pos for n in neg)/(len(pos)*len(neg)) if pos and neg else None
S={'n_calls_new':tot['calls'],'input_tokens_new':tot['tok'],'cost_usd_gateway_new':round(tot['usd'],5),'max_chars_source':MAXC}
aap=[(x,sc(a)) for x,a in zip(aa_in,aa) if a]
S['aa']={w:round(sum(abs(s[w]-x['s'][w]) for x,s in aap)/len(aap),4) for w in('w1','w2','mean')}|{'n':len(aap)}
pages={}
for x in ok: pages.setdefault(x['page'],[]).append(x)
pp=[x for x in ok if byrow[x['page']]['L']['reversal_judges']>0]
pi=sum(x['label']==1 for x in pp)/len(pp)*0.108  # sentence base rate: quoted share on reversed pages x 10.8% page base rate
S['sentence_base_rate_est']=round(pi,4)
for w in('w1','w2','mean'):
    neg=sorted(x['s'][w] for x in ok if x['label']==0); pos=[x['s'][w] for x in ok if x['label']==1]
    d={'sentence':{'auc':round(auc(pos,neg),3),'n_pos':len(pos),'n_neg':len(neg)}}
    for fpr in(0.10,0.05,0.01):
        thr=neg[int(len(neg)*(1-fpr))-1]
        tp=sum(p>thr for p in pos); fp=sum(n>thr for n in neg)
        qfound=sum(1 for q in quotes if q['sents'] and any(y['s'][w]>thr for y in pages.get(q['page'],[]) if y['i'] in q['sents']))
        pf={pid:any(y['s'][w]>thr for y in ys) for pid,ys in pages.items()}
        wp=sum(byrow[p]['weight'] for p,f in pf.items() if f and byrow[p]['L']['reversal_judges']>0); wa=sum(byrow[p]['weight'] for p,f in pf.items() if f)
        tpr,fpr_=tp/len(pos),fp/len(neg)
        d[f'fpr{int(fpr*100)}']={'threshold':round(thr,4),'sent_recall':round(tpr,3),'sent_tp':tp,'sent_fp':fp,'sent_precision_pool':round(tp/max(1,tp+fp),3),
          'sent_precision_at_base_rate':round(pi*tpr/max(1e-9,pi*tpr+(1-pi)*fpr_),3),
          'quote_recall':f'{qfound}/{sum(1 for q in quotes if q["sents"])}','pages_flagged':f'{sum(pf.values())}/{len(pf)}',
          'reversed_pages_flagged':f'{sum(1 for p,f in pf.items() if f and byrow[p]["L"]["reversal_judges"]>0)}/{sum(1 for p in pf if byrow[p]["L"]["reversal_judges"]>0)}',
          'page_precision_reweighted':round(wp/max(1e-9,wa),3)}
    pm={pid:max(y['s'][w] for y in ys) for pid,ys in pages.items()}
    d['page_max_auc']=round(auc([v for p,v in pm.items() if byrow[p]['L']['reversal_judges']>0],[v for p,v in pm.items() if byrow[p]['L']['reversal_judges']==0]),3)
    pc=[(sc(a)[w],sc(b)[w]) for (a,b) in pres if a and b]
    d['planted']={'n':len(pc),'planted_above_original':sum(b>a for a,b in pc),'auc_planted_vs_original':round(auc([b for a,b in pc],[a for a,b in pc]),3),
                  'planted_above_fpr10_threshold':sum(b>d['fpr10']['threshold'] for a,b in pc),'mean_delta':round(sum(b-a for a,b in pc)/len(pc),4)}
    S[w]=d
S['by_track_sentence_auc_mean']={t:auc([x['s']['mean'] for x in ok if x['label']==1 and x['track']==t],[x['s']['mean'] for x in ok if x['label']==0 and x['track']==t]) for t in sorted({x['track'] for x in ok})}
S['by_track_sentence_auc_mean']={t:(round(v,3) if v is not None else None) for t,v in S['by_track_sentence_auc_mean'].items()}
S['n']={'sentences':len(ok),'pages':len(pages),'quotes':len(quotes),'quotes_matched_to_sentence':sum(bool(q['sents']) for q in quotes),'plants':len(pres)}
json.dump(S,open(O+'summary.json','w'),indent=1)
json.dump([{'page':x['page'],'i':x['i'],'track':x['track'],'lang':x['lang'],'label':x['label'],**{k:round(v,4) for k,v in x['s'].items()}} for x in ok],open(O+'scores.json','w'))
print(json.dumps({k:S[k] for k in('n_calls_new','cost_usd_gateway_new','aa','n')}))
