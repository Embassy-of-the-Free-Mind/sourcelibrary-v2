# Jev (TypeSafe System One model, via Vercel AI Gateway) as an instruction-page classifier.
# PRIOR ART: none — first Jev test; labels from ~/sl-corpus/eval-pictures instruction verdicts (Sonnet judges, 2026-09-13)
import json,glob,os,random,re,sys,urllib.request,concurrent.futures as cf
S=os.path.dirname(os.path.abspath(__file__)); E='/Users/dereklomas/sl-corpus/eval-pictures'
TOK=os.environ.get('AI_GATEWAY_API_KEY') or os.environ['VERCEL_OIDC_TOKEN']  # vck_ key, or a 12 h OIDC token from `vercel env pull`
Q={
 'naive':{'type':'noul','instructions':'The text tells the reader how to position or move the body.'},
 'rubric':{'type':'noul','instructions':'This page is an INSTRUCTION PAGE for a body practice: it tells the reader what to DO with the body (posture, breath, steps, prostration, dance, exercise) — the order of actions, where the limbs go, how many times, or when. A rubric, manual, or a witness\'s step-by-step account counts even if a detail is missing. A page that only names, praises, lists, argues about, or reports a practice without the steps does NOT count.'},
}
def call(text):
    body=json.dumps({'model':'typesafe-ai/jev','state':text[:12000],'questions':Q}).encode()
    for _ in range(3):
        try:
            r=urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone',data=body,headers={'Authorization':'Bearer '+TOK,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=60))
            return {k:v['noul'] for k,v in j['answers'].items()}, j['usage']['input_tokens'], float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0)
        except Exception as e: err=str(e)
    return None,0,0
items=[]
# 1. labeled
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
            seen.add(r['id']); items.append({'set':'labeled','id':r['id'],'label':lab[r['id']][0],'jconf':lab[r['id']][1],'concept':r.get('concept'),'text':r['text']})
# 2. positives: our page's quoted translations
doc=json.load(open(os.path.join(S,'..','..','..','src/app/blog/techniques-of-the-body/document.json')))['body']
for i,m in enumerate(re.findall(r'<p class="en">(.*?)</p>',doc,re.S)):
    t=re.sub('<[^>]+>','',m)
    if len(t)>60: items.append({'set':'page-positive','id':f'pos{i}','label':True,'text':t})
# 3. random corpus pages (negatives-ish)
random.seed(7); files=random.sample(glob.glob('/Users/dereklomas/sl-corpus/books/*.jsonl'),400); n=0
for f in files:
    rows=[json.loads(l) for l in open(f)]; rows=[r for r in rows if r.get('tr') and len(r['tr'])>800]
    if not rows: continue
    r=random.choice(rows); items.append({'set':'random','id':os.path.basename(f)[:-6]+':'+str(r['p']),'label':None,'text':r['tr']}); n+=1
    if n>=150: break
print(len(items),{s:sum(1 for x in items if x['set']==s) for s in ('labeled','page-positive','random')},flush=True)
tok=0;cost=0
with cf.ThreadPoolExecutor(8) as ex:
    for it,(res,t,c) in zip(items,ex.map(lambda x: call(x['text']),items)):
        it['jev']=res; tok+=t; cost+=c
out=open(os.environ.get('OUT','jev-results.jsonl'),'w')
for it in items:
    it2={k:v for k,v in it.items() if k!='text'}; it2['snippet']=it['text'][:300]; out.write(json.dumps(it2,ensure_ascii=False)+'\n')
print('tokens',tok,'cost$',round(cost,4),'failed',sum(1 for x in items if not x['jev']))
