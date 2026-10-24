"""Whish 147 Kraken line model (#7119): can the Kraken read pick the good Opus draw? (no new model calls)
PRIOR ART: ../whish147-stability-recall-2026-10-23/score.py (#7203) — its scores.json holds each stored Opus/Fable
draw's per-leaf edit count against the edition (d, chars); there, a majority or central read picked the poor mode and
only high self-agreement predicted accuracy. This asks the same question of an independent reader: per leaf, take the
draw that disagrees least with the Kraken read (each draw row's best-window CER inside the Kraken leaf text), and pool
the chosen draws' CER against the edition. No edition text is used to choose.
Usage: JOB_SCRATCH=… python voter.py <kraken preds.json> <stability-recall dir> [label]
"""
import json, os, re, sys
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from score_lib import norm, mal2iast, best, VERSE  # noqa: E402

def rows_of(f):
    if not os.path.exists(f): return None
    return [norm(mal2iast(m.group(1))) for m in re.finditer(r'^ROW\s+\d+\s*\|\s*(.*)$', open(f).read(), re.M)]

def main():
    preds = json.load(open(sys.argv[1])); SR = Path(sys.argv[2]); label = sys.argv[3] if len(sys.argv) > 3 else 'all'
    sc = json.load(open(SR / 'scores.json'))['per_read']
    kr = {}
    for k in sorted(preds):
        leaf = k.rpartition('-r')[0]; kr[leaf] = kr.get(leaf, '') + norm(mal2iast(preds[k]))
    out = {}
    for model in ('opus', 'fable', 'sonnet'):
        pick = dict(d=0, n=0); oracle = dict(d=0, n=0); pool = dict(d=0, n=0); per = {}
        for leaf in VERSE:
            cands = []
            for i in (1, 2, 3):
                st = f'{model}-{i}'
                f = SR / 'reads' / st / f'{leaf}.final.txt'
                f = f if f.exists() else SR / 'reads' / st / f'{leaf}.txt'
                rows = [x for x in (rows_of(str(f)) or []) if len(x) >= 8]
                s = sc.get(f'{st}|{leaf}')
                if not rows or not s or not s['chars']: continue
                dis = sum(best(x, kr[leaf])[0] for x in rows) / sum(len(x) for x in rows)
                cands.append((dis, s['d'], s['chars'], st))
            if not cands: continue
            for c in cands: pool['d'] += c[1]; pool['n'] += c[2]
            ch = min(cands); pick['d'] += ch[1]; pick['n'] += ch[2]
            orc = min(cands, key=lambda c: c[1] / c[2]); oracle['d'] += orc[1]; oracle['n'] += orc[2]
            per[leaf] = dict(chosen=ch[3], chosen_cer=round(ch[1] / ch[2], 3), kraken_disagreement={c[3]: round(c[0], 3) for c in cands},
                             cer={c[3]: round(c[1] / c[2], 3) for c in cands})
        r = lambda x: round(x['d'] / x['n'], 3) if x['n'] else None
        mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None
        hits = sum(1 for v in per.values() if v['chosen_cer'] == min(v['cer'].values()))
        out[model] = dict(pooled_all_draws=r(pool), kraken_picked=r(pick), best_of_3=r(oracle),
                          leaf_mean_picked=mean([v['chosen_cer'] for v in per.values()]),
                          leaf_mean_best_of_3=mean([min(v['cer'].values()) for v in per.values()]),
                          leaf_mean_all=mean([x for v in per.values() for x in v['cer'].values()]),
                          picked_the_best=f"{hits}/{len(per)}", per_leaf=per)
        o = out[model]
        print(f"{model}: chars pooled — all draws {r(pool)}, kraken-picked {r(pick)}, best-of-3 {r(oracle)}; leaf means — all {o['leaf_mean_all']}, picked {o['leaf_mean_picked']}, best {o['leaf_mean_best_of_3']}; picked the best draw on {o['picked_the_best']} leaves")
    json.dump(out, open(HERE / f'voter-{label}.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
