# True-label check (#5664, mongol-selfgt): score test 1 and test 2 against the 628 real Kanjur columns that
# mongol-realgt-5664 confirmed (kept.jsonl: published transliterations aligned to columns, Opus-confirmed).
# Labels are CC BY-NC-ND: read on gex45, never copied; only counts leave the box.
# PRIOR ART: attach_reads.py / align.py (same DP, here fed the true label instead of the LoRA read).
import json, sys, random, re
from collections import defaultdict, Counter
sys.path.insert(0, '.')
from align import align, mwords
from lexicons import key
from score_manchu import rkey
KEPT = '/root/jobs/mongol-realgt-5664/kept.jsonl'
W = defaultdict(list)
for l in open('words-realgt/words.jsonl'):
    r = json.loads(l); W[r['col']].append(r)
true = {}; n_cols = 0
for l in open(KEPT):
    k = json.loads(l); segs = sorted(W.get(k['id'], []), key=lambda x: x['i'])
    ws = mwords(k['label'])
    if not segs or not ws: continue
    n_cols += 1
    for i_w, i, j, c in align([(s['x0'], s['x1']) for s in segs], ws):
        if j - i == 1: true[segs[i]['wid']] = ws[i_w]
lora = {json.loads(l)['wid']: json.loads(l)['read'] for l in open('pairs-realgt.jsonl')}
print(f'true-labelled single-segment crops: {len(true)} from {n_cols} columns')
def report(name, pairs):   # pairs: (pred_key_or_word, true_word, is_key)
    if not pairs: print(name, 'n=0'); return
    pool = [t for _, t, _ in pairs]; random.seed(0)
    def ok(p, t, isk): return (p == key(t)) if isk else (p == t)
    hit = sum(ok(p, t, k) for p, t, k in pairs) / len(pairs)
    ctl = sum(ok(p, random.choice(pool), k) for p, t, k in pairs) / len(pairs)
    print(f'{name:48} n {len(pairs):5}  match {hit:.3f}  (vs a random true word {ctl:.3f})')
both = [(w, lora[w], true[w]) for w in true if w in lora]
for lo in (1, 4):
    s = [(r, t) for w, r, t in both if len(t) >= lo]
    report(f'LoRA word == true word (true len>={lo})', [(r, t, False) for r, t in s])
    report(f'LoRA shape key == true shape key (len>={lo})', [(key(r), t, True) for r, t in s])
M = [json.loads(l) for l in open('reads-manchu.jsonl')]
mk = {m['wid']: rkey(m['roman'])[0] for m in M if m['set'] == 'kanjur' and m.get('flip', 0) == 0}
for lo in (1, 4):
    report(f'Manchu shape key == true shape key (len>={lo})', [(mk[w], true[w], True) for w in true if w in mk and len(true[w]) >= lo])
    report(f'  LoRA on the same crops (len>={lo})', [(key(lora[w]), true[w], True) for w in true if w in mk and w in lora and len(true[w]) >= lo])
# clusters: purity by true label (pairs of true-labelled members in the same cluster that share a shape key)
for tag in ('pixcore', 'pix'):
    CL = defaultdict(list)
    for l in open(f'words-realgt/clusters-{tag}.jsonl'):
        r = json.loads(l)
        if r['wid'] in true: CL[r['c']].append(true[r['wid']])
    same = tot = 0; rnd = 0; allw = [t for v in CL.values() for t in v]; random.seed(1)
    for v in CL.values():
        for a in range(len(v)):
            for b in range(a + 1, len(v)):
                tot += 1; same += key(v[a]) == key(v[b]); rnd += key(random.choice(allw)) == key(random.choice(allw))
    print(f'cluster {tag}: clusters with >=2 true-labelled members {sum(len(v) >= 2 for v in CL.values())}, member pairs {tot}, '
          f'same true shape key {same / max(1, tot):.3f} (random pairs {rnd / max(1, tot):.3f})')
    lens = [len(t) for v in CL.values() if len(v) >= 2 for t in v]
    print(f'   true word length in those clusters: median {sorted(lens)[len(lens)//2] if lens else None}')
# voted labels (B core) vs the true words of their members
for tag in ('pixcore',):
    hits = n = 0; rows = []
    for l in open(f'vote-{tag}-labels.jsonl'):
        v = json.loads(l); ts = [true[w] for w in v['members'] if w in true]
        if not ts: continue
        n += len(ts); hits += sum(key(t) == v['key'] for t in ts); rows.append((v['surface'], Counter(ts).most_common(2), len(ts)))
    print(f'voted label shape key == member true shape key: {hits}/{n}')
