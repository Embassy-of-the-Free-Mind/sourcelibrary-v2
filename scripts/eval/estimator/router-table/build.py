#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/chain/allocate_v2.py — its pages waiting and channel capacity are kept, read from its
# outputs; its decision rule ("cheapest route that matches Opus", else Opus) is what this replaces, because the route-judge
# pilot (#7376) measured routes by acceptance against the image and Opus is the judge there, not the reference.
# ocr/route_ocr_v1.py — CER against a reference panel, not acceptance; used here only as a weak prior.
"""The router table (#6740): one row per cell, Beta-binomial posteriors on acceptance. Stdlib only, no model calls.

  python3 scripts/eval/estimator/router-table/build.py [--pilot <score.json>] [--fees <private fee file>]   (repo root)

Writes 2026-10-26.json and .md beside this file. Every parameter is in rules.json. --fees (keys claude_usd_per_point,
agy_usd_per_call) prints a dollar column to stdout only: plan fees are never committed.
"""
import json, random, sys
D = 'scripts/eval/estimator/router-table/'
P = json.load(open(D + 'rules.json'))
arg = lambda f: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else None
L = lambda k: json.load(open(arg('--' + k) or P['inputs'][k]))  # --pilot <path> until #7376 is on main
pilot, v1, v2, cap = L('pilot')['cells'], L('v1')['cells'], {c['id']: c for c in L('v2')['cells']}, L('capacity')['channels']
free = {ch: c['per_week'] * c['free_share'] for ch, c in cap.items()}           # claude: account-weeks; agy: calls
rng, N, S = random.Random(P['seed']), P['draws'], P['stages']
q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))]
share = lambda r: S[r['stage']]['draw'] / free[S[r['stage']]['channel']] if S[r['stage']]['channel'] else 0.0

def prior(cell, r):  # (a, b), a + b <= 5
    d = next((x for c in v1 if cell.get('v1') and [c['chart'], c['fame']] == cell['v1'][:2]
              for x in c['routes'] if x['engine'] == cell['v1'][2]), None)
    g = next((x for x in v2[cell['v2']]['routes'] if x['corrector'] == r.get('v2')), None) if cell.get('v2') else None
    if r['stage'] == 'none': m, meas = (d['p_floors'], d['basis'] == 'measured') if d else (None, False)
    elif g: b0 = d['p_floors'] if d else 0.5; m, meas = b0 + (1 - b0) * max(0, g['gain'][1]), bool(d) and d['basis'] == 'measured' and g['measured']
    else: m = None
    if m is None: return P['prior']['flat']
    w, m = P['prior']['pages_measured' if meas else 'pages_pooled'], min(max(m, P['prior']['clip'][0]), P['prior']['clip'][1])
    return [m * w, (1 - m) * w]

rows = []
for cell in P['cells']:
    rs = []
    for r in cell['routes']:
        a0, b0 = a, b = prior(cell, r); x = pilot[cell['pilot']]['routes'][r['pilot']] if r.get('pilot') else None
        k = n = w = None; top = []
        if x:
            (k, n), w = map(int, x['accept'].split('/')), int(x['wrong_text_pages'].split('/')[0])
            f = min(1, x['books'] / n) if P['cluster_by_book'] else 1
            a, b = a + k * f, b + (n - k) * f
            top = sorted(x['classes_k_of_n'].items(), key=lambda kv: -int(kv[1].split('/')[0]))[:3]
        dr = [rng.betavariate(a, b) for _ in range(N)]; m = sum(dr) / N
        rs.append(dict(id=r['id'], stage=r['stage'], tested=bool(x), prior=[round(a0, 2), round(b0, 2)],
                       k=k, n=n, wrong=w, top=top, mean=m, ci90=[q(dr, .05), q(dr, .95)], var=a * b / ((a + b) ** 2 * (a + b + 1)),
                       p80=sum(v >= P['hold']['acc'] for v in dr) / N, share=share(r), _d=dr,
                       cost=None if not S[r['stage']]['channel'] else [(S[r['stage']].get('points') or S[r['stage']]['draw']) / q(dr, p) for p in (.95, .5, .05)],
                       api=None if S[r['stage']]['api_usd'] is None else S[r['stage']]['api_usd'] / m))
    cur = next(r for r in rs if r['id'] == cell['current']); M = [r for r in rs if r['tested']]
    def decide(wt_max):
        if cell.get('held'): return 'held', cur
        if not M: return 'keep (UNTESTED)', cur
        best = max(M, key=lambda r: r['mean'])
        if not any(r['p80'] >= P['hold']['p'] for r in M): return 'HOLD', best
        ok = [r for r in M if sum(u >= v - P['switch']['within'] for u, v in zip(r['_d'], best['_d'])) / N >= P['switch']['p']
              and r['wrong'] / r['n'] <= wt_max(best)]
        pick = min(ok, key=lambda r: r['share']) if ok else cur
        return ('keep' if pick is cur else 'switch'), pick
    dec, pick = decide(lambda best: P['switch']['wrong_text_max'])
    alt = decide(lambda best: best['wrong'] / best['n'] + P['switch']['wrong_text_max']) if M else (dec, pick)
    pages = cell.get('pages_waiting', v2.get(cell.get('v2'), {}).get('pages_waiting', 0))
    rows.append(dict(id=cell['id'], title=cell['title'], pages_waiting=pages, current=cur['id'], decision=dec, route=pick['id'],
                     relative_wrong_text=None if alt[0] == dec and alt[1] is pick else f"{alt[0]} {alt[1]['id']}",
                     weeks_to_clear=pages * pick['share'], v2_weeks=v2.get(cell.get('v2'), {}).get('weeks_to_drain'),
                     test_score=max([pages * r['share'] * r['var'] for r in rs if r['share']] or [0]),
                     caveat=cell.get('caveat') or cell.get('held'), routes=[{k: v for k, v in r.items() if k != '_d'} for r in rs]))
for i, r in enumerate(sorted([r for r in rows if r['test_score'] and r['decision'] != 'held'], key=lambda r: -r['test_score'])[:P['test_next']['n']]):
    r['test_next'] = i + 1
T = P['test_next']; tests = []
for row in sorted([r for r in rows if r.get('test_next')], key=lambda r: r['test_next']):
    rs = [r for r in row['routes'] if not r['tested']] or [max(row['routes'], key=lambda r: r['share'] * r['var'])]
    pts = T['pages_per_test'] * (len(rs) * T['judge_points_per_output'] + sum(S[r['stage']].get('points', 0) for r in rs))
    agy = T['pages_per_test'] * sum(S[r['stage']]['draw'] for r in rs if r['stage'] == 'agy')
    tests.append(dict(rank=row['test_next'], cell=row['id'], routes=[r['id'] for r in rs], pages=T['pages_per_test'], claude_points=pts, agy_calls=agy,
                      account_week_share=pts / 100 / free['claude'], agy_week_share=agy / free['agy']))
calib = [(row['id'], r['id'], r['prior'], f"{r['k']}/{r['n']}") for row in rows for r in row['routes'] if r['tested']]
json.dump(dict(as_of=P['as_of'], rules=P['inputs'], rows=rows, tests=tests, prior_vs_pilot=calib), open(D + P['as_of'] + '.json', 'w'), indent=1, ensure_ascii=False)
f3 = lambda v: '—' if v is None else f'{v:.3g}'
def cost(r):
    if r['cost'] is None: return '0'
    u = ' pts' if r['stage'].startswith('opus') else ' agy calls'
    return f"{r['cost'][1]:.3g}{u} [{r['cost'][0]:.3g}, {r['cost'][2]:.3g}] / idle 0" + (f" / API ${r['api']:.3f}" if r['api'] else '')
sw, h = P['switch'], P['hold']
out = [f"# Router table {P['as_of']} (#6740)", '', "Generated by `build.py` from `rules.json`. Acceptance = the Opus judge reading each output against the page image "
       "(route-judge pilot, #7376); Opus is the judge, not the reference. Posterior Beta(a + k, b + n - k), k and n scaled by books / pages; "
       "the v1/v2 prior is worth at most 5 pages. ● = the route the router assigns now (v2's choice; the served route for translation). "
       "Cost is marginal (the draft is already paid): Claude weekly points or agy calls per ACCEPTED page, median [90%]; idle quota costs 0; "
       "API list = dollars at list price. Opus image calls at 0.0124 points a page, an upper bound (correct.mjs at 10 pages a call measured 0.004). "
       f"Weeks to clear = pages waiting x draw per page / the channel's free week ({free['claude']:g} Claude account-weeks, {free['agy']:,.0f} agy calls; v2 capacity), the cell alone on its channel.", '',
       f"Rules: **switch** to the cheapest measured route with P(acc >= acc_best - {sw['within']}) >= {sw['p']} and wrong-text pages <= {sw['wrong_text_max']:.0%}, else **keep**; "
       f"**HOLD** when no measured route has P(acc >= {h['acc']}) >= {h['p']}; **test next** ranks cells by pages waiting x share of the channel's week per page x Var(acceptance).", '',
       '| cell | pages waiting | current | route | acceptance [90%] | wrong text | top defects | cost per accepted page (full / idle / API list) | weeks to clear | decision |', '|' + '---|' * 10]
for row in rows:
    for j, r in enumerate(row['routes']):
        acc = (f"**{r['k']}/{r['n']}** → {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]" if r['tested']
               else f"UNTESTED: prior {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]")
        dec = (row['decision'] + (f" → {row['route']}" if row['decision'] in ('switch', 'HOLD') else '') + (f"; **test next #{row['test_next']}**" if row.get('test_next') else '')
               + (f" (relative wrong-text bar: {row['relative_wrong_text']})" if row['relative_wrong_text'] else '')) if j == 0 else ''
        out.append(f"| {row['title'] if j == 0 else ''} | {f'{row['pages_waiting']:,}' if j == 0 else ''} | {'●' if r['id'] == row['current'] else ''} | {r['id']} | {acc} | "
                   f"{f'{r['wrong']}/{r['n']}' if r['tested'] else '—'} | {', '.join(f'{c} {v}' for c, v in r['top']) or '—'} | {cost(r)} | "
                   f"{f'{row['pages_waiting'] * r['share']:.1f}' if r['share'] else '—'} | {dec} |")
    if row['caveat']: out.append(f"| | | | | *{row['caveat']}* | | | | | |")
out += ['', '**Test next** (proposals; score = pages waiting x share of the channel\'s free week per page x Var(acceptance)):', '']
out += [f"{t['rank']}. {t['cell']}: {', '.join(t['routes'])}, {t['pages']} pages each, judged by Opus against the image: {t['claude_points']:.2f} Claude points ({t['account_week_share']:.2%} of the free Claude week)" + (f" + {t['agy_calls']:.0f} agy calls ({t['agy_week_share']:.2%} of agy's)" if t['agy_calls'] else '') for t in tests]
out += ['', '**Prior against the pilot** (prior mean, worth a + b pages → what the judge accepted):', '']
out += [f"- {c} / {r}: {a / (a + b):.2f} ({a + b:.0f} pages) → {kn}" for c, r, (a, b), kn in calib]
open(D + P['as_of'] + '.md', 'w').write('\n'.join(out) + '\n')
if '--fees' in sys.argv:
    fee = json.load(open(sys.argv[sys.argv.index('--fees') + 1]))
    for row in rows:
        for r in row['routes']:
            if r['cost']: print(row['id'], r['id'], *(f"${c * (fee['claude_usd_per_point'] if r['stage'].startswith('opus') else fee['agy_usd_per_call']) * 1000:.2f}/1K" for c in r['cost']))
print('\n'.join(out))
