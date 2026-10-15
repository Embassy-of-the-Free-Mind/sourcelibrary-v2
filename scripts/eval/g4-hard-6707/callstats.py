# PRIOR ART: ocr-pareto-6293/cli-cost.mjs (meter seconds) — this also counts the #6523 tool-gate refusals per page, which no script tallies.
import json,sys,statistics as st,collections
S='/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'
out={}
for p in sys.argv[1:]:
    rows={}
    for l in open(f'{S}/raw/G4L-{p}.raw.jsonl'):
        r=json.loads(l); rows[r['uid']]=r
    R=list(rows.values()); secs=sorted(r['secs'] for r in R); den=[r['gate_denials'] or 0 for r in R]
    tools=collections.Counter(c.split(':')[0] for r in R for c in (r['gate_calls'] or []) if c.endswith(':deny'))
    q=lambda xs,f: xs[int(f*(len(xs)-1))]
    out[p]={'n':len(R),'median_secs':round(st.median(secs),1),'iqr_secs':[round(q(secs,.25),1),round(q(secs,.75),1)],'max_secs':max(secs),
      'refused_tool_calls_total':sum(den),'pages_with_refused_tool_call':sum(d>0 for d in den),'median_refused_per_page':st.median(den),'max_refused_per_page':max(den),
      'refused_by_tool':dict(tools),'denials_hist':dict(sorted(collections.Counter(den).items())),'nudged':sum(bool(r['nudged']) for r in R),'attempts_gt1':sum(r['attempts']>1 for r in R),
      'wrapper':dict(collections.Counter(str(r['wrapper']) for r in R)),'blocked_by_filter':sum(bool(r['blocked']) for r in R),'errors':sum(bool(r['error']) for r in R),
      'overlapped_other_job':sum(r['overlapped_other_job']>0 for r in R)}
json.dump(out,open(f'{S}/an/callstats.json','w'),indent=1)
for p,v in out.items(): print(p,v)
