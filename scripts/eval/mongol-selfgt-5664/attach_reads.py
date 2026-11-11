# PRIOR ART: align.py (this file only applies it to a reads file).
# Attach LoRA reads to word crops via align.py; writes word-level pairs (#5664, mongol-selfgt).
# Only single-segment alignments are kept as crop<->word pairs (a crop is one segment).
import json, sys
from collections import defaultdict
from align import align, mwords
D, reads, out = sys.argv[1], sys.argv[2], sys.argv[3]
W = defaultdict(list)
for l in open(f'{D}/words.jsonl'):
    r = json.loads(l); W[r['col']].append(r)
n_col = n_ok = n_pairs = n_words = 0
with open(out, 'w') as f:
    for l in open(reads):
        r = json.loads(l); segs = sorted(W.get(r['id'], []), key=lambda x: x['i'])
        if not segs: continue
        ws = mwords(r['text']); n_col += 1; n_words += len(ws)
        al = align([(s['x0'], s['x1']) for s in segs], ws)
        if al: n_ok += 1
        for k, i, j, c in al:
            if j - i == 1:
                f.write(json.dumps({'wid': segs[i]['wid'], 'read': ws[k], 'cost': round(c, 3), 'col': r['id']}, ensure_ascii=False) + '\n'); n_pairs += 1
print(f'columns {n_col} aligned {n_ok} read-words {n_words} single-segment pairs {n_pairs}')
