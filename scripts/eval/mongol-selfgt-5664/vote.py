# PRIOR ART: shapekey.py (session research) — the same shape-key lexicon hit, here on voted labels with a random-group control.
# Test 1b (#5664, mongol-selfgt): majority-vote the LoRA reads per cluster, by shape key; snap the winning key to the
# lexicon's most frequent spelling. "Hit" = the voted shape key is a lexicon key (snapping only picks the spelling,
# so it cannot create a hit). Compared with single reads, and with a control: random groups of the same sizes.
import json, sys, random, re
from collections import Counter, defaultdict
D, tag, pairs, lexname, out = sys.argv[1:6]
sys.path.insert(0, '.'); from lexicons import key, load
lex, lexk = load(lexname)
print(f'--- lexicon {lexname}: {len(lex)} words, {len(lexk)} shape keys')
read = {}
for l in open(pairs):
    p = json.loads(l); read[p['wid']] = p['read']
CL = defaultdict(list)
for l in open(f'{D}/clusters-{tag}.jsonl'):
    r = json.loads(l); CL[r['c']].append(r['wid'])
import os
minw = int(os.environ.get('MINW', 0))   # secondary arm: only clusters whose median crop is >= MINW px long
if minw:
    wid_w = {}
    for l in open(f'{D}/words.jsonl'):
        r = json.loads(l); wid_w[r['wid']] = r['x1'] - r['x0']
    CL = {c: m for c, m in CL.items() if sorted(wid_w[w] for w in m)[len(m) // 2] >= minw}
top = sorted(CL, key=lambda c: -len(CL[c]))[:200]
def vote(ws):
    rs = [read[w] for w in ws if w in read]
    if len(rs) < 3: return None
    kc = Counter(key(r) for r in rs); k, n = kc.most_common(1)[0]
    surf = Counter(r for r in rs if key(r) == k).most_common(1)[0][0]
    snap = lexk[k].most_common(1)[0][0] if k in lexk else None
    return {'n_reads': len(rs), 'key': k, 'margin': round(n / len(rs), 3), 'surface': surf, 'label': snap,
            'key_hit': k in lexk, 'exact_hit': surf in lex, 'letters': len(surf)}
def summarise(V, name):
    V = [v for v in V if v]
    for lo in (1, 4):
        s = [v for v in V if v['letters'] >= lo]
        if not s: continue
        print(f'{name:22} len>={lo}: clusters {len(s):3}  voted key-hit {sum(v["key_hit"] for v in s)/len(s):.2f}  '
              f'voted exact-hit {sum(v["exact_hit"] for v in s)/len(s):.2f}  distinct labels {len(set(v["key"] for v in s))}  '
              f'median margin {sorted(v["margin"] for v in s)[len(s)//2]:.2f}')
V = {c: vote(CL[c]) for c in top}
summarise(V.values(), f'clusters {tag}')
# single reads of the same members, and of all aligned pairs
mem = [w for c in top for w in CL[c] if w in read]
for name, ws in [('single reads (members)', mem), ('single reads (all)', list(read))]:
    for lo in (1, 4):
        s = [read[w] for w in ws if len(read[w]) >= lo]
        print(f'{name:22} len>={lo}: reads {len(s):6}  key-hit {sum(key(r) in lexk for r in s)/len(s):.2f}  exact-hit {sum(r in lex for r in s)/len(s):.2f}')
# control: random groups with the same sizes, drawn from the same aligned crops
pool = [w for c in CL for w in CL[c] if w in read] or list(read)
ctl = []
for sd in range(5):
    random.seed(sd)
    for c in top:
        ctl.append(vote(random.sample(pool, min(len(pool), len(CL[c])))))
summarise(ctl, 'control random groups')
with open(out, 'w') as f:
    for c in top:
        if V[c]: f.write(json.dumps({'cluster': c, 'size': len(CL[c]), **V[c], 'members': CL[c]}, ensure_ascii=False) + '\n')
