"""Whish 147 Kraken line model (#7119): training splits from labels.py output and the segmentation log.
PRIOR ART: none for this book (ketos needs line image + .gt.txt pairs; the Mongol Kraken pilot of #5664 trained from
eScriptorium-free synthetic lines, scripts/eval/experiments/2026-10-19-mongol-real-pilot-prereg-5664.md).
A line enters only if its leaf segmented into exactly as many rows as the page text has (segment.py, K = label rows).
Validation = every line of 15 leaves drawn at random (seed 147); the learning curve takes nested random subsets of the
remaining training lines (~100, ~300, all). Tiers: strict = the brief's rule (fresh-read CER <= 0.15); anchored = every
row with no doubt mark (the edition text where the collation flagged nothing).
Usage: python splits.py <labels.json> <seg.log> <out.tsv>       (tsv: split, leaf-row image name, cer, Malayalam label)
"""
import json, random, sys
d = json.load(open(sys.argv[1])); ok = {}
for l in open(sys.argv[2]):
    f = l.split(); ok[f[0]] = f[4] == f[6]
lines = [x for x in d['lines'] if ok.get(x['key']) and x['mal'].strip()]
rnd = random.Random(147)
leaves = sorted({x['key'] for x in lines}); val = set(rnd.sample(leaves, 15))
tr = [x for x in lines if x['key'] not in val]; rnd.shuffle(tr)
out = open(sys.argv[3], 'w')
for x in lines:
    if x['key'] in val: sp = ['val']
    else:
        i = tr.index(x); sp = ['all'] + (['n300'] if i < 300 else []) + (['n100'] if i < 100 else []) + (['strict'] if x['cer'] <= 0.15 else [])
    for s in sp: out.write(f"{s}\t{x['key']}-r{x['row']:02d}\t{x['cer']}\t{x['mal']}\n")
print(len(lines), 'lines;', len(val), 'val leaves;', sum(1 for x in lines if x['key'] in val), 'val lines;', len(tr), 'train lines')
