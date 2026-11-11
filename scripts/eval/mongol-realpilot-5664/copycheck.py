# PRIOR ART: scripts/eval/mongol-realpilot-5664/score_pilot.py (pooled CER only; this adds the per-column distribution and a
# regurgitation test). Runs on gex45 beside the labels. Prints scores only, never a label or read string (#5664).
# Scores only: per-column CER distribution on v23, and whether a read is closer to some real TRAINING label than to its own ref (regurgitation).
import json, sys, statistics
sys.path.insert(0, '/root/jobs/mongol-realpilot-5664/code')
from score_pilot import norm, lev
R='/root/jobs/mongol-realpilot-5664/run'
refs={r['id']:r for r in map(json.loads,open(R+'/realeval/refs.jsonl')) if r['set']=='real-prose'}
train=sorted({norm(r['text']) for r in map(json.loads,open(R+'/traindata/labels.jsonl')) if r.get('src')!='synth'})
print('distinct real train labels', len(train))
def cer(h,r): return lev(h,r)/max(1,len(r))
for f in ['reads-a-reread.jsonl','reads-pilot.jsonl']:
    rd={r['id']:r for r in map(json.loads,open('/root/jobs/gpu-queue/07-mongol-real-pilot/'+f)) if r['set']=='real-prose'}
    cs=[];closer=0;exact_train=0;wc=0;emp=0
    for i,r in refs.items():
        h=norm(rd[i]['text']); ref=norm(r['ref'])
        c=cer(h,ref); cs.append(c)
        if not h: emp+=1
        if len(h.split())==len(ref.split()): wc+=1
        # nearest training label, normalised by read length
        best=min(lev(h,t)/max(1,len(h)) for t in train) if h else 1
        if best==0: exact_train+=1
        if best < lev(h,ref)/max(1,len(h)): closer+=1
    cs.sort(); n=len(cs)
    print(f, 'n',n,'median',round(statistics.median(cs),3),'<=10%',sum(c<=.1 for c in cs),'<=25%',sum(c<=.25 for c in cs),'>=75%',sum(c>=.75 for c in cs),
          'wordcount_match',wc,'empty',emp,'read==a_train_label',exact_train,'closer_to_train_than_ref',closer)
