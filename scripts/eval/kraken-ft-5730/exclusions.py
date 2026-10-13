# PRIOR ART: none that lists every book any benchmark, reference or bake-off cell uses - looked in scripts/eval/benchmark-*.mjs
# and open-engine-print-5660.mjs. Writes the training EXCLUSION list for #5730 (no test book may be trained on).
import json, glob, os, re
R='/root/sourcelibrary/.claude/worktrees/job-kraken-latin-ft-5730/scripts/eval'
S='/root/sourcelibrary/.claude/worktrees/job-ocr-bakeoff-5660c/scripts/eval'
ids=set(); why={}
def add(i,w):
    if i: ids.add(i); why.setdefault(i,w)
for f in glob.glob(R+'/benchmark/*.json'):
    d=json.load(open(f))
    for p in [x for k in ('pages','rows') if isinstance(d.get(k),list) for x in d[k] if isinstance(x,dict)]:
        add(p.get('book_id'), 'benchmark:'+os.path.basename(f))
for base in (R,S):
    for f in glob.glob(base+'/benchmark/refs/ed-*.json'):
        m=re.match(r'ed-(.+)-p\d+\.json',os.path.basename(f)); 
        if m:
            b=m.group(1)
            if len(b)==32: b='%s-%s-%s-%s-%s'%(b[:8],b[8:12],b[12:16],b[16:20],b[20:])
            add(b,'ed-ref:'+('sibling' if base==S else 'main'))
for f in ['/root/ocr-bakeoff-5660c/tcp/cand.tsv','/root/ocr-bakeoff-5660c/tcp/chosen.tsv']:
    for l in open(f):
        if l.strip(): add(l.split('\t')[0],'bakeoff-5660c:'+os.path.basename(f))
for p in json.load(open(R+'/results/open-engine-print-5660/cells.json'))['pages']:
    add(p.get('book_id'),'cells-5660')
json.dump({'n':len(ids),'books':sorted(ids),'why':why},open('/root/kraken-ft-5730/exclusions.json','w'),indent=0)
print(len(ids))
