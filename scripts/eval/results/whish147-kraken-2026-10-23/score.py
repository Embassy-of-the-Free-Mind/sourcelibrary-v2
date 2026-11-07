"""Whish 147 Kraken line model (#7119): score Kraken line reads on the 9 held-out verse leaves and 3 hand-B leaves.
PRIOR ART: ../whish147-stability-recall-2026-10-23/score.py (#7203) — the per-row best-window CER against the leaf's
located edition span ±200 characters, rows of 8+ characters, the shuffled-text floor; norm/mal2iast/best/ref_for are
imported unchanged from score_lib.py (copied from that directory). Kraken writes Malayalam, so its rows go through the
same mal2iast -> norm as the Opus reads did; the Opus figures quoted next to these (pooled 0.34, best of 3 0.18) are
that test's.
Hand B has no located span: each row is scored against the best window anywhere in the Tattvakaumudī print OCR plus
the kārikās (tk.txt + sk.txt), with the same shuffled floor against that larger reference.
A collapsed model (one string for every line) scores below the floor on letter frequency alone, so the output also
reports how many rows are distinct.
Usage: JOB_SCRATCH=… python score.py <preds.json> [label]     (preds: {"<leaf>-rNN": text}) -> scores-<label>.json
"""
import json, os, random, sys
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from score_lib import norm, mal2iast, best, ref_for, VERSE  # noqa: E402

def rows_by_leaf(preds):
    out = {}
    for k in sorted(preds):
        leaf, _, r = k.rpartition('-r')
        out.setdefault(leaf, []).append(norm(mal2iast(preds[k])))
    return out

def score(rows, ref, full, rnd):
    d = n = fd = 0; per = []
    for x in rows:
        if len(x) < 8: continue
        dd, _ = best(x, ref); d += dd; n += len(x); per.append(round(dd / len(x), 3))
        j = rnd.randrange(0, len(full) - len(x)); sh = list(full[j:j + len(x)]); rnd.shuffle(sh); fd += best(''.join(sh), ref)[0]
    return dict(chars=n, d=d, fd=fd, cer=round(d / n, 3) if n else None, floor=round(fd / n, 3) if n else None, rows=per)

def main():
    preds = json.load(open(sys.argv[1])); label = sys.argv[2] if len(sys.argv) > 2 else Path(sys.argv[1]).stem
    S = os.environ['JOB_SCRATCH']; rnd = random.Random(7)
    ed = {w: norm(open(f'{S}/editions/{w}.txt').read()) for w in ('sk', 'jm', 'tk')}
    by = rows_by_leaf(preds); res = {}
    for leaf in VERSE:
        if leaf in by: res[leaf] = score(by[leaf], ref_for(leaf), ed['jm'], rnd)
    hb = {}
    for leaf in sorted(set(by) - set(VERSE)):
        hb[leaf] = score(by[leaf], ed['tk'] + ed['sk'], ed['jm'], rnd)
    def pool(r):
        n = sum(v['chars'] for v in r.values())
        return dict(cer=round(sum(v['d'] for v in r.values()) / n, 3) if n else None,
                    floor=round(sum(v['fd'] for v in r.values()) / n, 3) if n else None, chars=n, leaves=len(r))
    # a collapsed model writes one string for every line, and a common-letter string beats the shuffled floor; so say
    # how many of the rows are distinct before reading any CER
    allrows = [x for v in by.values() for x in v if len(x) >= 8]
    distinct = dict(rows=len(allrows), distinct=len(set(allrows)))
    out = dict(label=label, distinct=distinct, verse=dict(pooled=pool(res), per_leaf={k: dict(cer=v['cer'], chars=v['chars'], floor=v['floor']) for k, v in res.items()}),
               handB=dict(pooled=pool(hb), per_leaf={k: dict(cer=v['cer'], chars=v['chars'], floor=v['floor']) for k, v in hb.items()}),
               rows={k: v['rows'] for k, v in {**res, **hb}.items()})
    json.dump(out, open(HERE / f'scores-{label}.json', 'w'), indent=1)
    print(label, 'distinct rows', distinct, 'verse', out['verse']['pooled'], 'handB', out['handB']['pooled'])
    print('  ' + ' '.join(f"{k}={v['cer']}" for k, v in out['verse']['per_leaf'].items()))
    print('  ' + ' '.join(f"{k}={v['cer']}" for k, v in out['handB']['per_leaf'].items()))

if __name__ == '__main__':
    main()
