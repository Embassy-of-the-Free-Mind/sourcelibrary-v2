# Bootstrap by page of the rule's two counts between arms (5000 draws, seed 7263), and the source-caused split by set. python3 bootstrap.py <job scratch>
# PRIOR ART: matrix.mjs score — it counts and applies the rule but gives no interval; this reads the same en/ files and changes no result.
import json,os,random,collections,sys
ROOT=sys.argv[1].rstrip('/')+'/'
S=ROOT+'en/'
vs={}
for l in open(S+'verdicts-opus.jsonl'):
    r=json.loads(l)
    if r.get('verdict'): vs[r['id']]=r['verdict']
tr={}
for l in open(S+'trace.jsonl'):
    r=json.loads(l); tr[r['tid']]=r
key=[k for k in json.load(open(S+'key.json')) if k['kind']=='item']
L=json.load(open(ROOT+'leaves.json'))
arms=['tS','tP','tF','tPO','tO','tPFL']
per=collections.defaultdict(dict); setof={}
for k in key:
    v=vs.get(k['judged_as'])
    if not v: continue
    src=0;tl=0
    for j,d in enumerate(v.get('defects',[])):
        if d.get('severity') in('misleads','wrong_text'):
            c=tr.get(f"{k['judged_as']}:{j}",{}).get('cause')
            if c=='source': src+=1
            elif c=='translator': tl+=1
    per[k['arm']][k['page_id']]=(src,tl,any(d.get('severity')=='wrong_text' for d in v.get('defects',[])))
    setof[k['page_id']]=k.get('set')
for a in arms:
    p=per[a]; xs=sorted((v[0] for v in p.values()),reverse=True)
    print(a,'src',sum(xs),'pages with any',sum(1 for x in xs if x),'top5',xs[:5],'setA',sum(v[0] for q,v in p.items() if setof[q]=='setA'),'setB',sum(v[0] for q,v in p.items() if setof[q]=='setB'),'translator',sum(v[1] for v in p.values()))
pids=list(per['tF'])
random.seed(7263)
def boot(a,b,idx=0):
    d=[per[a][q][idx]-per[b][q][idx] for q in pids]; o=sum(d); bs=sorted(sum(random.choices(d,k=len(d))) for _ in range(5000))
    return o,bs[125],bs[4875]
for a,b in [('tPO','tF'),('tPO','tO'),('tF','tO'),('tPFL','tPO'),('tS','tO')]:
    print(a,'-',b,'source diff, boot95',boot(a,b))
def wmd(a,b):
    d=[int(per[a][q][2])-int(per[b][q][2]) for q in pids]; bs=sorted(sum(random.choices(d,k=len(d))) for _ in range(5000)); return sum(d),bs[125],bs[4875]
for a,b in [('tPO','tF'),('tPO','tO'),('tPFL','tF'),('tPFL','tO')]: print(a,'-',b,'wrong-meaning diff, boot95',wmd(a,b))
rep=[(k) for k in json.load(open(S+'key.json')) if k['kind']=='repeat']
print('repeat',[(k['arm'],vs[k['judged_as']]['accept'],vs[k['of']]['accept'],vs[k['judged_as']]['fidelity'],vs[k['of']]['fidelity']) for k in rep])
# POST HOC, not the frozen M: the frozen cutoff sent 4/30 on set B, so what would the same signal do sending the top third of set B? Hypothesis-forming only.
sig=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'results/signal-setB.json')))['rows']
for label,top in [('frozen',[r['key'][3:] for r in sig if r['send']]),('top10',[r['key'][3:] for r in sorted(sig,key=lambda r:-r['signal'])[:10]])]:
    for arm in ['tPO','tO']:
        rows=[per[arm if r['key'][3:] in top else 'tPFL'][r['key'][3:]] for r in sig]
        print('M set B',label,'n sent',len(top),arm,'wrong-meaning',sum(x[2] for x in rows),'source',sum(x[0] for x in rows),'translator',sum(x[1] for x in rows))
