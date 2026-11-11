# Single-read lexicon hits of column reads, against both lexicons, with letter-shuffled controls (#5664, mongol-selfgt).
# PRIOR ART: shapekey.py (session research) — same measure on the training-label lexicon only; this repeats it on MC2.
import json, sys, random
sys.path.insert(0, '.')
from lexicons import key, load
from align import mwords
files = sys.argv[1:]
L = {n: load(n) for n in ('labels', 'mc2')}
for f in files:
    rows = [json.loads(l) for l in open(f)]
    for s in sorted({r['set'] for r in rows}):
        ws = [w for r in rows if r['set'] == s for w in mwords(r['text'])]; lw = [w for w in ws if len(w) >= 4]
        random.seed(1); sh = [''.join(random.sample(w, len(w))) for w in lw]
        out = []
        for n, (lex, lk) in L.items():
            out.append(f'{n}: exact {sum(w in lex for w in lw)/max(1,len(lw)):.2f} key {sum(key(w) in lk for w in lw)/max(1,len(lw)):.2f} '
                       f'(shuffled {sum(w in lex for w in sh)/max(1,len(sh)):.2f}/{sum(key(w) in lk for w in sh)/max(1,len(sh)):.2f})')
        print(f'{f.split("/")[-1]:18} {s:14} words {len(ws):5} len>=4 {len(lw):5} | ' + ' | '.join(out))
