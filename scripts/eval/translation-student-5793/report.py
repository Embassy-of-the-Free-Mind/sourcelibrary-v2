# PRIOR ART: translation-vs-reference/score.mjs (#5702) computes everything here except the #5793 preregistered
# invention measure (unreadable_fill OR added_fact, paired) and the canonical/period strata of a three-arm paired Δ.
"""python3 report.py <results.json> <records.jsonl> → summary.json beside results.json (the #5793 gate, read from score.mjs output)."""
import json, random, statistics as st, sys, os
res, recs = sys.argv[1], sys.argv[2]
d = json.load(open(res))
meta = {f"{r['book_id']}_{str(r['page_number']).zfill(5)}": r for r in map(json.loads, open(recs))}
pp = d['per_page']
ARMS = ['lite', 'base', 'student']

def jm(p, arm, f):
    bj = p['arms'][arm]['by_judge']; v = [f(x) for x in bj.values()]
    return sum(v) / len(v)

inv = lambda x: 1 if any(i.get('kind') in ('unreadable_fill', 'added_fact') for i in x['invention']) else 0
rev = lambda x: 1 if x.get('reversal') else 0
fid = lambda x: x['fidelity']

def boot(vals, n=10000, seed=5793):
    rnd = random.Random(seed); m = len(vals)
    bs = sorted(sum(vals[rnd.randrange(m)] for _ in range(m)) / m for _ in range(n))
    return [round(bs[int(0.025 * n)], 3), round(bs[int(0.975 * n) - 1], 3)]

out = {'n': len(pp), 'arms': {}, 'paired': {}, 'strata': {}}
for a in ARMS:
    f = [jm(p, a, fid) for p in pp]
    out['arms'][a] = {'fidelity_mean': round(st.mean(f), 3), 'fidelity_ci': boot(f), 'fidelity_median': st.median(f),
                      'invention_fabricated_or_added': round(st.mean(jm(p, a, inv) for p in pp), 3),
                      'reversal': round(st.mean(jm(p, a, rev) for p in pp), 3),
                      'omission': d['arms'][a]['omission']['rate'], 'share_ge4': round(sum(x >= 4 for x in f) / len(f), 3)}
for a, b in [('student', 'lite'), ('base', 'lite'), ('student', 'base')]:
    df = [jm(p, a, fid) - jm(p, b, fid) for p in pp]
    di = [jm(p, a, inv) - jm(p, b, inv) for p in pp]
    out['paired'][f'{a}-{b}'] = {'fidelity_delta': round(st.mean(df), 3), 'ci': boot(df),
                                 'W_L_T_by_mean_fidelity': [sum(x > 0 for x in df), sum(x < 0 for x in df), sum(x == 0 for x in df)],
                                 'invention_delta': round(st.mean(di), 3), 'invention_ci': boot(di)}
def stratum(name, keep):
    ids = [p for p in pp if keep(p)]
    if not ids: return
    out['strata'][name] = {'n': len(ids), **{a: round(st.mean(jm(p, a, fid) for p in ids), 2) for a in ARMS},
                           'student-lite': round(st.mean(jm(p, 'student', fid) - jm(p, 'lite', fid) for p in ids), 2)}
stratum('canonical', lambda p: p['canonical'] is True)
stratum('non-canonical', lambda p: p['canonical'] is not True)
for per in sorted({m.get('period') for m in meta.values()}):
    stratum(f'period:{per}', lambda p, per=per: meta[p['id']].get('period') == per)
sl = out['paired']['student-lite']
inv_ok = out['arms']['student']['invention_fabricated_or_added'] <= out['arms']['lite']['invention_fabricated_or_added'] + 0.05 and sl['invention_ci'][0] <= 0
out['gate'] = {'fidelity_ci_lower': sl['ci'][0], 'fidelity_ok': sl['ci'][0] >= -0.25, 'invention_ok': inv_ok,
               'verdict': 'PASS' if sl['ci'][0] >= -0.25 and inv_ok else 'FAIL'}
json.dump(out, open(os.path.join(os.path.dirname(res), 'summary.json'), 'w'), indent=1)
print(json.dumps(out, indent=1))
