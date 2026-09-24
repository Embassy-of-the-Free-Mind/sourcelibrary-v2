# Part of the 2026-09-24 Jev search-pattern test; see scripts/eval/EXPERIMENTS.md. Paths assume a scratch dir with .env.gw (vercel env pull) beside it.
# Shared Jev client: budget ledger with a hard stop, retries, checkpointed output.
import json,os,time,urllib.request,threading
S=os.path.dirname(os.path.abspath(__file__))
TOK=[l.split('=',1)[1].strip().strip('"') for l in open(S+'/../.env.gw') if l.startswith('VERCEL_OIDC_TOKEN')][0]
LEDGER=S+'/ledger.json'; CAP=float(os.environ.get('JEV_CAP','9.0')); _lk=threading.Lock()
RUBRIC='This page is an INSTRUCTION PAGE for a body practice: it tells the reader what to DO with the body (posture, breath, steps, prostration, dance, exercise) — the order of actions, where the limbs go, how many times, or when. A rubric, manual, or a witness\'s step-by-step account counts even if a detail is missing. A page that only names, praises, lists, argues about, or reports a practice without the steps does NOT count.'
KIND={'type':'choice','instructions':'What kind of bodily practice does this page instruct or describe, if any?','criteria':{
 'breath':'breathing methods, breath retention or counting','posture':'seated or standing postures, meditation seats, asanas',
 'exercise':'exercise, gymnastics, walking, running, massage, bathing regimen','bowing':'bowing, kneeling, prostration, genuflection',
 'dance':'dance or choreographed movement','gesture':'hand gestures, mudras, signs made with the hands',
 'ritual':'a ritual or magical procedure placing the body (facing, circling, standing in a circle, anointing)',
 'combat':'combat, drill, wrestling, fencing, sport','penance':'flagellation, fasting, vigils, mortification','none':'no bodily practice'}}
import sys,glob as _g
MYLEDGER=S+'/ledger-'+os.path.basename(sys.argv[0]).replace('.py','')+'.json'
_mine={'usd':0.0,'tokens':0}
if os.path.exists(MYLEDGER):
    try: _mine=json.load(open(MYLEDGER))
    except Exception: pass
BASE_USD=0.075  # spent before per-process ledgers (pilot $0.019 + first stage-1 minutes); conservative
def spent():
    tot=BASE_USD
    for f in _g.glob(S+'/ledger-*.json'):
        if f==MYLEDGER: continue
        try: tot+=json.load(open(f))['usd']
        except Exception: pass
    return tot+_mine['usd']
def add(usd,tok):
    with _lk:
        _mine['usd']+=usd; _mine['tokens']+=tok
        tmp=MYLEDGER+'.tmp'; json.dump(_mine,open(tmp,'w')); os.replace(tmp,MYLEDGER)
class Budget(Exception): pass
def ask(state,questions,maxchars=5000):
    if spent()>=CAP: raise Budget(f'cap {CAP} reached')
    body=json.dumps({'model':'typesafe-ai/jev','state':state[:maxchars],'questions':questions}).encode()
    for i in range(4):
        try:
            r=urllib.request.Request('https://ai-gateway.vercel.sh/typesafe/v1/systemone',data=body,headers={'Authorization':'Bearer '+TOK,'Content-Type':'application/json'})
            j=json.load(urllib.request.urlopen(r,timeout=60))
            cost=float(j.get('provider_metadata',{}).get('gateway',{}).get('marketCost',0) or 0)
            add(cost,j['usage']['input_tokens'])
            out={}
            for k,v in j['answers'].items():
                out[k]=v.get('noul') if v['type']=='noul' else {'choice':v.get('choice'),'p':v.get('probabilities')} if v['type']=='choice' else v.get('score')
            return out
        except urllib.error.HTTPError as e:
            if e.code in (401,403): raise
            time.sleep(2*(i+1))
        except Exception: time.sleep(2*(i+1))
    return None
