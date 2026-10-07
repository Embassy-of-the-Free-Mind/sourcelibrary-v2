# Head-to-head: Jev vs Cloudflare Clef / Clef-flash on the 2026-09-24 instruction-page pilot items.
# PRIOR ART: scripts/eval/jev/instruction-page-pilot.py — same items, questions and metrics; it calls Jev only and its results were never committed, so all three models are re-run here on identical pages.
# Run with CF_ANALYTICS_TOKEN (has Workers AI scope) and VERCEL_OIDC_TOKEN (from `vercel env pull`) in env; OUT=<path>.
import json,glob,os,random,re,time,urllib.request,concurrent.futures as cf
S=os.path.dirname(os.path.abspath(__file__)); E='/Users/dereklomas/sl-corpus/eval-pictures'
CF_ACCOUNT='eb0562555fd5ce2a4ec0f29b6df10e7b'
PRICE={'clef':0.24,'clef-flash':0.09}  # $/M input tokens; output not billed
Q={
 'naive':{'type':'noul','instructions':'The text tells the reader how to position or move the body.'},
 'rubric':{'type':'noul','instructions':'This page is an INSTRUCTION PAGE for a body practice: it tells the reader what to DO with the body (posture, breath, steps, prostration, dance, exercise) — the order of actions, where the limbs go, how many times, or when. A rubric, manual, or a witness\'s step-by-step account counts even if a detail is missing. A page that only names, praises, lists, argues about, or reports a practice without the steps does NOT count.'},
}
def call(model,text):
    if model=='jev':
        url='https://ai-gateway.vercel.sh/typesafe/v1/systemone'; tok=os.environ['VERCEL_OIDC_TOKEN']; m='typesafe-ai/jev'
    else:
        url=f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/ai/run/@cf/cloudflare/{model}'; tok=os.environ['CF_ANALYTICS_TOKEN']; m=model
    body=json.dumps({'model':m,'state':text[:12000],'questions':Q}).encode()
    for i in range(3):
        try:
            t0=time.time()
            r=urllib.request.Request(url,data=body,headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=90)); dt=time.time()-t0
            if model!='jev': j=j['result']
            ntok=j['usage']['input_tokens']
            cost=float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0) if model=='jev' else ntok*PRICE[model]/1e6
            return {k:v['noul'] for k,v in j['answers'].items()},ntok,cost,dt
        except urllib.error.HTTPError as e:
            if e.code in (401,403): raise
            time.sleep(2*(i+1))
        except Exception: time.sleep(2*(i+1))
    return None,0,0,0
items=[]
lab={}
for f in glob.glob(E+'/instruction-v2-batch-*.verdicts.jsonl')+glob.glob(E+'/instruction-verdicts-r1-*.jsonl'):
    for l in open(f):
        try: r=json.loads(l); lab[r['id']]=(r['instruction'],r.get('confidence'))
        except: pass
seen=set()
for f in [E+'/instruction-candidates-v2.jsonl']+glob.glob(E+'/instruction-round1-*.jsonl'):
    for l in open(f):
        r=json.loads(l)
        if r['id'] in lab and r['id'] not in seen:
            seen.add(r['id']); items.append({'set':'labeled','id':r['id'],'label':lab[r['id']][0],'jconf':lab[r['id']][1],'text':r['text']})
doc=json.load(open(os.path.join(S,'..','..','..','src/app/blog/techniques-of-the-body/document.json')))['body']
for i,m in enumerate(re.findall(r'<p class="en">(.*?)</p>',doc,re.S)):
    t=re.sub('<[^>]+>','',m)
    if len(t)>60: items.append({'set':'page-positive','id':f'pos{i}','label':True,'text':t})
random.seed(7); files=random.sample(sorted(glob.glob('/Users/dereklomas/sl-corpus/books/*.jsonl')),400); n=0
for f in files:
    rows=[json.loads(l) for l in open(f)]; rows=[r for r in rows if r.get('tr') and len(r['tr'])>800]
    if not rows: continue
    r=random.choice(rows); items.append({'set':'random','id':os.path.basename(f)[:-6]+':'+str(r['p']),'label':None,'text':r['tr']}); n+=1
    if n>=150: break
print(len(items),{s:sum(1 for x in items if x['set']==s) for s in ('labeled','page-positive','random')},flush=True)
def auc(pos,neg):
    if not pos or not neg: return None
    return sum((p>q)+0.5*(p==q) for p in pos for q in neg)/(len(pos)*len(neg))
summary={}
for model in ('jev','clef-flash','clef'):
    tok=cost=0; lat=[]
    with cf.ThreadPoolExecutor(8) as ex:
        for it,(res,t,c,dt) in zip(items,ex.map(lambda x: call(model,x['text']),items)):
            it[model]=res; tok+=t; cost+=c
            if dt: lat.append(dt)
    lat.sort(); s={'tokens':tok,'cost_usd':round(cost,4),'failed':sum(1 for x in items if not x[model]),'median_latency_s':round(lat[len(lat)//2],3) if lat else None}
    L=[x for x in items if x['set']=='labeled' and x[model]]
    for q in Q:
        s['auc_'+q]=round(auc([x[model][q] for x in L if x['label']],[x[model][q] for x in L if not x['label']]),3)
        C=[x for x in L if (x['jconf'] or 0)>=0.85]
        s['auc_conf_'+q]=round(auc([x[model][q] for x in C if x['label']],[x[model][q] for x in C if not x['label']]),3)
    for th in (0.3,0.5):
        tp=sum(1 for x in L if x['label'] and x[model]['rubric']>=th); fp=sum(1 for x in L if not x['label'] and x[model]['rubric']>=th)
        fn=sum(1 for x in L if x['label'] and x[model]['rubric']<th); tn=len(L)-tp-fp-fn
        po=(tp+tn)/len(L); pe=((tp+fp)*(tp+fn)+(fn+tn)*(fp+tn))/len(L)**2
        s[f'rubric@{th}']={'acc':round(po,3),'prec':round(tp/(tp+fp),3) if tp+fp else None,'recall':round(tp/(tp+fn),3),'kappa':round((po-pe)/(1-pe),3)}
    s['random_flagged_rubric>=0.5']=sum(1 for x in items if x['set']=='random' and x[model] and x[model]['rubric']>=0.5)
    s['positive_ctrl_rubric>=0.5']=f"{sum(1 for x in items if x['set']=='page-positive' and x[model] and x[model]['rubric']>=0.5)}/{sum(1 for x in items if x['set']=='page-positive')}"
    summary[model]=s; print(model,json.dumps(s),flush=True)
L=[x for x in items if x['set']=='labeled' and all(x.get(m) for m in ('jev','clef','clef-flash'))]
def corr(a,b):
    ma=sum(a)/len(a); mb=sum(b)/len(b)
    return sum((x-ma)*(y-mb) for x,y in zip(a,b))/(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))**0.5
summary['pearson_rubric']={f'{a}~{b}':round(corr([x[a]['rubric'] for x in L],[x[b]['rubric'] for x in L]),3) for a,b in (('jev','clef'),('jev','clef-flash'),('clef','clef-flash'))}
print(json.dumps(summary['pearson_rubric']))
out=os.environ.get('OUT','clef-vs-jev-results.jsonl')
with open(out,'w') as o:
    for it in items:
        it2={k:v for k,v in it.items() if k!='text'}; it2['snippet']=it['text'][:300]; o.write(json.dumps(it2,ensure_ascii=False)+'\n')
json.dump(summary,open(out.replace('.jsonl','-summary.json'),'w'),indent=1)
