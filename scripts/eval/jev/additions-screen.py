#!/usr/bin/env python3
# PRIOR ART: scripts/eval/jev/jevlib.py is the instruction-page client (hard-wired to that pilot's .env.gw and ledger, one rubric);
# scripts/eval/untagged-additions/detector.mjs is the Gemini sentence-level detector. Neither asks Jev whether a page carries an untagged addition.
"""#5982 Jev screen for untagged additions. Usage:
   python3 scripts/eval/jev/additions-screen.py <env.gw>
Needs work/controls-r2.jsonl (node scripts/eval/untagged-additions/build-controls.mjs --round 2) and work/live-items.jsonl
(node scripts/eval/jev/additions-screen-fetch.mjs). Writes results/jev-additions-2026-10/{scores,summary}.json (no page text, no token)."""
import json,sys,os,time,urllib.request,urllib.error,re,random
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../results/')
U=R+'untagged-additions-2026-10/'; O=R+'jev-additions-2026-10/'; os.makedirs(O,exist_ok=True)
TOK=[l.split('=',1)[1].strip().strip('"') for l in open(sys.argv[1]) if l.startswith('VERCEL_OIDC_TOKEN')][0]
MAXC=6000  # characters kept of EACH of source and translation (truncation noted in the experiment file)
Q={
 'w1':{'type':'noul','instructions':'The translation contains at least one sentence or clause that renders nothing in the source text: an explanation, definition, description or comment added by the translator.'},
 'w2':{'type':'noul','instructions':'The translation is a faithful rendering and ONLY a rendering of the source: every sentence of it corresponds to words in the source, and nothing has been added, explained, defined, described or summarised by the translator.'},
}
TAG=re.compile(r'<(note|gloss|summary|meta|keywords|image-desc)\b[^>]*>.*?</\1>',re.S|re.I)
def state(src,tr):
    tr=TAG.sub('',tr)  # tagged words are not "untagged additions"
    return f'SOURCE TEXT (original or OCR):\n{src[:MAXC]}\n\nTRANSLATION:\n{tr[:MAXC]}'
tot={'usd':0.0,'tok':0,'calls':0}
def ask(st):
    body=json.dumps({'model':'typesafe-ai/jev','state':st,'questions':Q}).encode()
    for i in range(4):
        try:
            r=urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone',data=body,headers={'Authorization':'Bearer '+TOK,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=60))
            tot['usd']+=float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0); tot['tok']+=j['usage']['input_tokens']; tot['calls']+=1
            return {k:v['noul'] for k,v in j['answers'].items()}
        except urllib.error.HTTPError as e:
            if e.code in (401,403): raise
            time.sleep(2*(i+1))
        except Exception: time.sleep(2*(i+1))
    return None
def auc(pos,neg):
    return sum((p>n)+0.5*(p==n) for p in pos for n in neg)/(len(pos)*len(neg))
def score(items):
    out=[]
    for it in items:
        a=ask(state(it['source'],it['translation']))
        if a is None: continue
        out.append({**{k:v for k,v in it.items() if k not in('source','translation')},'w1':a['w1'],'w2':1-a['w2']})
    return out
jl=lambda f:[json.loads(l) for l in open(f) if l.strip()]
ctrl=[c for c in jl(U+'work/controls-r2.jsonl') if not c['id'].startswith('named:')]
ctrl=[{'id':c['id'],'label':int(c['id'].startswith('pos:')),'source':c['source'],'translation':c['translation']} for c in ctrl]
live=jl(U+'work/live-items.jsonl')
S={'controls':score(ctrl),'live':score(live)}
random.seed(5982); aa_in=random.sample(ctrl,10)+random.sample(live,10)
byid={x['id']:x for x in S['controls']+S['live']}
aa=[]
for it in aa_in:
    a=ask(state(it['source'],it['translation']))
    if a and it['id'] in byid: aa.append({'w1':abs(a['w1']-byid[it['id']]['w1']),'w2':abs((1-a['w2'])-byid[it['id']]['w2'])})
summ={'n_calls':tot['calls'],'input_tokens':tot['tok'],'cost_usd_gateway':round(tot['usd'],5),'cost_usd_at_0.042_per_M':round(tot['tok']*0.042/1e6,5),'max_chars_each':MAXC}
summ['aa']={w:round(sum(x[w] for x in aa)/len(aa),4) for w in('w1','w2')}|{'n':len(aa)}
for w in('w1','w2','mean'):
    f=(lambda x:(x['w1']+x['w2'])/2) if w=='mean' else (lambda x,w=w:x[w])
    neg=sorted(f(x) for x in S['controls'] if not x['label']); pos=[f(x) for x in S['controls'] if x['label']]
    thr=neg[int(len(neg)*0.9)-1]  # at most 10% of clean controls score above it
    flagged=lambda x:f(x)>thr
    lp=[f(x) for x in S['live'] if x['label']]; ln=[f(x) for x in S['live'] if not x['label']]
    fl=[x for x in S['live'] if flagged(x)]
    summ[w]={'threshold':round(thr,4),'controls':{'auc':round(auc(pos,neg),3),'n_pos':len(pos),'n_neg':len(neg),'recall':round(sum(p>thr for p in pos)/len(pos),3),'clean_flagged':sum(n>thr for n in neg)},
      'live':{'auc':round(auc(lp,ln),3),'n_true':len(lp),'n_not':len(ln),'flagged':len(fl),'true_among_flagged':sum(x['label'] for x in fl),'precision':round(sum(x['label'] for x in fl)/max(1,len(fl)),3),'recall':round(sum(p>thr for p in lp)/len(lp),3),
        'unflagged_group_flagged_by_jev':sum(1 for x in S['live'] if x['group']=='unflagged' and flagged(x))}}
json.dump(S,open(O+'scores.json','w'),indent=1); json.dump(summ,open(O+'summary.json','w'),indent=1)
print(json.dumps(summ))
