#!/usr/bin/env python3
# PRIOR ART: scripts/eval/caseless-drift-7503/calibrate.mjs (sets a threshold on single-page-lane pages as the noise
# floor, the same idea, for a clause-level rule). This calibrates the LaBSE margin for a whole-leaf slide (#5021 Part B).
"""
analyse.py SAMPLE.jsonl.gz SIMS.jsonl OUT.json [--fpr 0.01]
margin m = s_own - max(s_prev, s_next). Threshold t: the --fpr quantile of m on pages written ALONE (block false: a
single-page call cannot slide). Recall on synthetic slides: a floor page's English set on its neighbour scores
s_next - s_own (or s_prev - s_own) as that neighbour's margin. Candidates: block-written pages with m < t, by script;
pairs: two candidates on adjacent page numbers of one book.
"""
import gzip, json, sys, random
fpr = float(sys.argv[sys.argv.index('--fpr') + 1]) if '--fpr' in sys.argv else 0.01
rows = {}
for l in gzip.open(sys.argv[1], 'rt'):
    r = json.loads(l); rows[r['page_id']] = {k: r[k] for k in ('fam', 'book_id', 'n', 'block', 'page_type', 'model', 'enLen', 'srcLen')}
for l in open(sys.argv[2]):
    s = json.loads(l); rows[s['page_id']].update(s)
out = {'fpr_target': fpr, 'by_fam': {}}
cands = []
for fam in ('han', 'tibetan'):
    R = [r for r in rows.values() if r['fam'] == fam and 's_own' in r]
    m = lambda r: r['s_own'] - max(r['s_prev'], r['s_next'])
    floor = sorted(m(r) for r in R if not r['block'])
    t = floor[int(len(floor) * fpr)]
    synth = [r['s_next'] - r['s_own'] for r in R if not r['block']] + [r['s_prev'] - r['s_own'] for r in R if not r['block']]
    recall = sum(x < t for x in synth) / len(synth)
    blk = [r for r in R if r['block']]
    c = [r for r in blk if m(r) < t]
    for r in c: r['margin'] = round(m(r), 3); cands.append(r)
    key = {(r['book_id'], r['n']) for r in c}
    pairs = [r for r in c if (r['book_id'], r['n'] + 1) in key]
    books = len({r['book_id'] for r in c})
    out['by_fam'][fam] = {'floor_pages': len(floor), 'threshold': round(t, 3), 'synthetic_recall': round(recall, 3), 'floor_median_margin': round(floor[len(floor) // 2], 3),
                          'block_pages': len(blk), 'candidates': len(c), 'candidate_rate': round(len(c) / max(1, len(blk)), 4), 'excess_over_floor': round(len(c) / max(1, len(blk)) - fpr, 4),
                          'candidate_books': books, 'adjacent_pairs': len(pairs), 'books_sampled': len({r['book_id'] for r in blk})}
random.seed(5021)
out['candidates'] = sorted(cands, key=lambda r: r['margin'])
json.dump(out, open(sys.argv[3], 'w'), indent=1)
print(json.dumps(out['by_fam'], indent=1))
