#!/usr/bin/env python3
# PRIOR ART: scripts/eval/results/florentine-compare-6865/score.py (paired A/B, order-averaged) — this one unblinds a
# three-arm judgement against a published reference: per-arm errors and fidelity, two-pass wins/ties/losses.
#   python3 score.py JUDGE.jsonl KEY.json
import json, sys, collections, math

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
key = {k['key']: k for k in json.load(open(sys.argv[2]))}
arms = ['twopass', 'opus', 'draft']
per = {a: collections.defaultdict(list) for a in arms}
disputed = 0
types = collections.Counter()
by_page = []
for r in rows:
    lab = key[r['key']]['labels']  # label -> arm
    disputed += bool(r.get('reference_disputed'))
    page = {}
    for L, arm in lab.items():
        j = r[L]
        for f in ('wrong', 'omission', 'addition', 'fidelity'):
            per[arm][f].append(float(j.get(f) or 0))
        per[arm]['errors'].append(sum(float(j.get(f) or 0) for f in ('wrong', 'omission', 'addition')))
        per[arm]['summarised'].append(1 if j.get('summarised') else 0)
        page[arm] = j
    for t in r.get('error_types_seen') or []:
        types[t.strip().lower()] += 1
    by_page.append((r['key'], page))

def mean_ci(v):
    n = len(v); m = sum(v) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1)) if n > 1 else 0
    return m, 1.96 * sd / math.sqrt(n) if n else 0

n = len(rows)
print(f'pages judged: {n}; reference disputed on {disputed}')
print('| arm | fidelity (1-5) | errors/page | wrong | omitted | added | summarised |')
print('|---|---|---|---|---|---|---|')
for a in arms:
    f, fc = mean_ci(per[a]['fidelity']); e, ec = mean_ci(per[a]['errors'])
    print(f"| {a} | {f:.2f} ±{fc:.2f} | {e:.2f} ±{ec:.2f} | {mean_ci(per[a]['wrong'])[0]:.2f} | {mean_ci(per[a]['omission'])[0]:.2f} | {mean_ci(per[a]['addition'])[0]:.2f} | {sum(per[a]['summarised'])}/{n} |")
for other in ('opus', 'draft'):
    w = t = l = 0; d = []
    for _, p in by_page:
        x = p['twopass']['fidelity'] - p[other]['fidelity']; d.append(x)
        w += x > 0; t += x == 0; l += x < 0
    m, c = mean_ci(d)
    print(f'two-pass vs {other}: fidelity {m:+.2f} (95% CI {m - c:+.2f}, {m + c:+.2f}); pages won/tied/lost {w}/{t}/{l}')
print('error types seen (judge phrases, top 15):')
for k, v in types.most_common(15):
    print(f'  {v:3d}  {k}')
