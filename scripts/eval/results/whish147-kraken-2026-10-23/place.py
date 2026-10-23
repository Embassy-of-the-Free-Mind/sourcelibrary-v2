"""Whish 147 Kraken line model (#7119): place the unplaced leaves (pp. 131–221) in the Tattvakaumudī from Kraken reads.
PRIOR ART: ../whish147-best-attempt-2026-10-22/locate.mjs (Opus placed leaves leaf after leaf; it placed none of this
stretch, #7119 comment of 2026-10-22 22:56). This uses the Kraken read instead: each row (12+ characters, normalised
IAST) is aligned to the Tattvakaumudī print OCR (tk.txt) with rapidfuzz partial_ratio_alignment, then scored exactly
(score_lib.best) in a window round the hit. A leaf is PLACED when at least 4 rows and half of its rows have CER <= 0.45
and those rows' offsets lie within 2,500 characters of their median and run in reading order (Spearman >= 0.8).
Output is a proposal for a later locate/collate step, never a page write.
Usage: JOB_SCRATCH=… python place.py <preds.json> <segment log> [out.json]
"""
import json, os, sys
from pathlib import Path
from rapidfuzz import fuzz
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from score_lib import norm, mal2iast, best  # noqa: E402

def spearman(xs):
    if len(xs) < 3: return 1.0
    r = sorted(range(len(xs)), key=lambda i: xs[i]); rank = [0] * len(xs)
    for k, i in enumerate(r): rank[i] = k
    n = len(xs); d2 = sum((rank[i] - i) ** 2 for i in range(n))
    return 1 - 6 * d2 / (n * (n * n - 1))

def main():
    S = os.environ['JOB_SCRATCH']; preds = json.load(open(sys.argv[1]))
    tk = norm(open(f'{S}/editions/tk.txt').read())
    leaves = {}
    for k in sorted(preds):
        leaf, _, r = k.rpartition('-r'); leaves.setdefault(leaf, []).append((int(r), norm(mal2iast(preds[k]))))
    out = {}
    for leaf, rows in sorted(leaves.items(), key=lambda x: (int(x[0].split('-')[0]), x[0])):
        hits = []
        for r, x in rows:
            if len(x) < 12: continue
            a = fuzz.partial_ratio_alignment(x, tk)
            lo = max(0, a.dest_start - 40); hi = min(len(tk), a.dest_end + 40)
            d, off = best(x, tk[lo:hi]); hits.append(dict(row=r, cer=round(d / len(x), 3), offset=lo + off, chars=len(x)))
        good = [h for h in hits if h['cer'] <= 0.45]
        placed = False; span = None
        if len(good) >= 4 and len(good) >= len(hits) / 2:
            med = sorted(h['offset'] for h in good)[len(good) // 2]
            near = [h for h in good if abs(h['offset'] - med) <= 2500]
            if len(near) >= 4 and len(near) >= len(hits) / 2 and spearman([h['offset'] for h in near]) >= 0.8:
                placed = True; span = [min(h['offset'] for h in near), max(h['offset'] for h in near)]
        n = sum(h['chars'] for h in hits)
        out[leaf] = dict(rows=len(rows), scored_rows=len(hits), rows_cer_le_045=len(good), placed=placed, tk_span=span,
                         mean_cer=round(sum(h['cer'] * h['chars'] for h in hits) / n, 3) if n else None, hits=hits)
    seg = {l.split()[0]: int(l.split()[4]) for l in open(sys.argv[2]) if 'pitch' in l}
    p = [k for k, v in out.items() if v['placed']]
    json.dump(dict(placed=len(p), leaves=len(out), placed_leaves=p, per_leaf=out), open(sys.argv[3] if len(sys.argv) > 3 else HERE / 'place-tk.json', 'w'), indent=1)
    print(f'{len(p)}/{len(out)} leaves placed in the TK print:', ' '.join(f"{k}@{out[k]['tk_span'][0]}" for k in p))
    print('rows per placed leaf (segmenter):', [seg.get(k) for k in p][:40])
    print('unplaced mean CER:', sorted(v['mean_cer'] for v in out.values() if not v['placed'] and v['mean_cer'])[:10], '…')

if __name__ == '__main__':
    main()
