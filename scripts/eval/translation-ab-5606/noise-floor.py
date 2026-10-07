#!/usr/bin/env python3
# PRIOR ART: scripts/eval/tibetan-mt-ab/score.mjs --pairs (this study's per-pair W/T/L, which it reads) and
# scripts/eval/lib/paired-stats.mjs (sign test / bootstrap for TWO arms). Neither answers "is flash's
# margin over lite larger than one lite run's margin over another": that needs the A-vs-A arm inside the
# test, so this is an exchangeability permutation over the three arms {flash, lite, lite-rerun} per page.
"""noise-floor.py --keys <dir with <Lang>-key.json> --verdicts <dir with verdicts-<judge>-<Lang>.jsonl> --out <json>

Per page and judge, s(a,b) = +1 if a ranks above b, -1 below, 0 same tier (ties). Statistic
T = mean over pages × judges of [s(flash,lite) + s(flash,lite-rerun)] / 2. Null: on each page the three
arm labels are exchangeable (flash is one more draw of lite) — permute them per page (same permutation
for both judges, since both read the same texts), 20,000 times, seed 5606. One-sided p = P(T* ≥ T).
Also reported: the A-vs-A net margin mean s(lite-rerun, lite) and flash's net margin against each run.
Decision rule (stated in the experiment file): flash wins a language beyond the noise floor iff p < 0.05
AND its net margin against EACH lite run exceeds |A-vs-A net margin|.
"""
import json, random, argparse, statistics as st
ap = argparse.ArgumentParser(); ap.add_argument('--keys'); ap.add_argument('--verdicts'); ap.add_argument('--out'); a = ap.parse_args()
ARMS = ['flash', 'lite', 'lite-rerun']
out = {}
for L in ('Pali', 'Sanskrit', 'Chinese'):
    key = json.load(open(f'{a.keys}/{L}-key.json'))
    pages = {}  # id -> judge -> arm -> tier index
    for J in ('opus', 'sonnet'):
        for l in open(f'{a.verdicts}/verdicts-{J}-{L}.jsonl'):
            r = json.loads(l)
            if r['id'] == key['positive_control_page']: continue
            m = key['pages'][r['id']]
            tier = {m[x]: i for i, t in enumerate(r['ranking']) for x in t}
            pages.setdefault(r['id'], {})[J] = {arm: tier[arm] for arm in ARMS}
    s = lambda t, x, y: (t[x] < t[y]) - (t[x] > t[y])
    def stat(perm_pages):
        v = [(s(t, 'flash', 'lite') + s(t, 'flash', 'lite-rerun')) / 2 for js in perm_pages for t in js.values()]
        return sum(v) / len(v)
    obs = stat(pages.values())
    rng = random.Random(5606); n_ge = 0; N = 20000
    for _ in range(N):
        perm = []
        for js in pages.values():
            p = ARMS[:]; rng.shuffle(p); mp = dict(zip(ARMS, p))
            perm.append({J: {mp[arm]: t[arm] for arm in ARMS} for J, t in js.items()})
        if stat(perm) >= obs - 1e-12: n_ge += 1
    net = lambda x, y: sum(s(t, x, y) for js in pages.values() for t in js.values()) / sum(len(js) for js in pages.values())
    aa = net('lite-rerun', 'lite'); fl1 = net('flash', 'lite'); fl2 = net('flash', 'lite-rerun')
    out[L] = {'pages': len(pages), 'judge_pages': sum(len(js) for js in pages.values()), 'T_obs': round(obs, 3), 'p_one_sided': round((n_ge + 1) / (N + 1), 4),
              'net_margin_flash_vs_lite': round(fl1, 3), 'net_margin_flash_vs_lite_rerun': round(fl2, 3), 'net_margin_A_vs_A (lite-rerun vs lite)': round(aa, 3),
              'beyond_floor': (n_ge + 1) / (N + 1) < 0.05 and min(fl1, fl2) > abs(aa)}
print(json.dumps(out, indent=1)); json.dump(out, open(a.out, 'w'), indent=1)
