"""Whish 147 stability / model test (#7119): accuracy, self-consistency, and whether agreement predicts accuracy.
PRIOR ART: ../whish147-best-attempt-2026-10-22/score-fresh.py (branch job-whish147-best) — norm(), mal2iast() and the
best-window per-row CER are copied unchanged (they are #7148's corrected instrument); the reference span is the leaf's
locate offsets ±200 characters in the job's edition files. That script scores one read per leaf; this one scores three
reads per model and compares reads with each other.
Usage: JOB_SCRATCH=<dir with editions/> python score.py   (writes scores.json, prints the tables)
"""
import os, re, json, random, unicodedata, itertools, statistics as st
from indic_transliteration import sanscript as s
from rapidfuzz.distance import Levenshtein

from score_lib import *  # noqa: F401,F403  (norm, mal2iast, best, read_rows, ref_for, constants)
from score_lib import HERE, S, VERSE, COMM, MODELS, LOC, ED

random.seed(7)
FULL = {w: norm(t) for w, t in ED.items()}
res, rowsdb = {}, []
for model, stages in MODELS.items():
    for leaf in VERSE + COMM:
        ref = ref_for(leaf); full = FULL[LOC[leaf]['work']]
        for stage in stages:
            rows = read_rows(stage, leaf)
            if rows is None: continue
            segs = [x for x in rows if len(x) >= 8]
            d = n = fd = 0
            for i, x in enumerate(segs):
                dd, _ = best(x, ref); d += dd; n += len(x)
                j = random.randrange(0, len(full) - len(x)); sh = list(full[j:j + len(x)]); random.shuffle(sh); fd += best(''.join(sh), ref)[0]
                rowsdb.append(dict(model=model, stage=stage, leaf=leaf, row=x, cer=dd / len(x)))
            res[f'{stage}|{leaf}'] = dict(model=model, stage=stage, leaf=leaf, rows=len(segs), chars=n, d=d, fd=fd, cer=round(d / n, 3) if n else None, floor=round(fd / n, 3) if n else None, nrows_raw=len(rows))

def pooled(model, leaves):
    vs = [v for v in res.values() if v['model'] == model and v['leaf'] in leaves and v['chars']]
    D = sum(v['d'] for v in vs); N = sum(v['chars'] for v in vs); F = sum(v['fd'] for v in vs)
    return (round(D / N, 3), round(F / N, 3), N, len(vs)) if N else (None, None, 0, 0)

# Self-consistency: pairwise normalised edit distance between a model's own reads of a leaf (whole leaf, rows joined).
def leaf_text(stage, leaf):
    r = read_rows(stage, leaf)
    return ''.join(r) if r else None
stab = {}
for model, stages in MODELS.items():
    per = {}
    for leaf in VERSE + COMM:
        ts = [t for t in (leaf_text(sg, leaf) for sg in stages) if t]
        if len(ts) < 2: continue
        ds = [Levenshtein.distance(a, b) / max(len(a), len(b), 1) for a, b in itertools.combinations(ts, 2)]
        per[leaf] = round(st.mean(ds), 3)
    # Coverage: characters each read wrote (rows of 8+ characters), so a disagreement that is only coverage shows up.
    cov = {leaf: [len(leaf_text(sg, leaf) or '') for sg in stages] for leaf in VERSE + COMM}
    # Accuracy spread: per leaf, the best and worst read's CER (the bimodality is per read, not per leaf).
    spread = {leaf: [res.get(f'{sg}|{leaf}', {}).get('cer') for sg in stages] for leaf in VERSE + COMM}
    flips = sum(1 for v in spread.values() if len([x for x in v if x is not None]) >= 2 and min(x for x in v if x is not None) < 0.2 and max(x for x in v if x is not None) > 0.4)
    stab[model] = dict(mean=round(st.mean(per.values()), 3) if per else None, per_leaf=per, chars_written=cov, leaves_flipping=flips)

# Agreement vs accuracy, at row level: a row's support is its best similarity to any row of each other read of the
# same leaf (same model: the other two reads; cross-model: the other models' first reads), averaged.
def support(row, others):
    sims = []
    for o in others:
        if not o: continue
        sims.append(max((1 - Levenshtein.distance(row, y) / max(len(row), len(y), 1)) for y in o) if o else 0)
    return st.mean(sims) if sims else None
agree = {}
for kind in ('self', 'cross'):
    buckets = {'high (>=0.8)': [0, 0], 'mid (0.5-0.8)': [0, 0], 'low (<0.5)': [0, 0]}
    for r in rowsdb:
        if kind == 'self':
            others = [read_rows(sg, r['leaf']) for sg in MODELS[r['model']] if sg != r['stage']]
        else:
            others = [read_rows(MODELS[m][0], r['leaf']) for m in MODELS if m != r['model']]
        others = [[x for x in o if len(x) >= 8] for o in others if o]
        sp = support(r['row'], others)
        if sp is None: continue
        b = 'high (>=0.8)' if sp >= 0.8 else 'mid (0.5-0.8)' if sp >= 0.5 else 'low (<0.5)'
        buckets[b][0] += r['cer'] * len(r['row']); buckets[b][1] += len(r['row'])
    agree[kind] = {b: dict(chars=n, cer=round(d / n, 3) if n else None) for b, (d, n) in buckets.items()}

out = dict(per_read=res, stability=stab, agreement=agree,
           pooled={m: dict(verse=pooled(m, VERSE), commentary=pooled(m, COMM)) for m in MODELS})
json.dump(out, open(f'{HERE}/scores.json', 'w'), indent=1)
print('ACCURACY (pooled CER vs edition, floor, chars, reads)')
for m in MODELS: print(f"  {m:7} verse {out['pooled'][m]['verse']}  commentary {out['pooled'][m]['commentary']}")
print('PER LEAF (mean CER over reads)')
for leaf in VERSE + COMM:
    print('  ' + leaf.ljust(6) + '  '.join(f"{m}={[res.get(f'{sg}|{leaf}', {}).get('cer') for sg in MODELS[m]]}" for m in MODELS))
print('SELF-CONSISTENCY (mean pairwise distance between a model\'s own reads; 0 = identical)')
for m in MODELS: print(f"  {m:7} {stab[m]['mean']}  leaves with one read <0.2 and another >0.4: {stab[m]['leaves_flipping']}  {stab[m]['per_leaf']}")
print('AGREEMENT vs ACCURACY (row level)')
for k, v in agree.items(): print(f'  {k}: {v}')
