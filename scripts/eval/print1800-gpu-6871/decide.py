#!/usr/bin/env python3
"""decide.py — #6871 1800+ print: the preregistered (a) and (b) tables on the TYPED panel.

PRIOR ART: scripts/eval/euro-gpu-correct-7567/score.py (imported: clean/letters/cer/score_page/flag_lengths, unchanged)
and e2-table.py (paired bootstrap). The rules are the experiment file's preregistration (2026-10-29-print1800-…-6871.md).
  decide.py <typed dir> <gpu out dir> <out.json>
Arms: L (lite) + every <gpu out>/<ARM>.jsonl with its <ARM>.guard.jsonl (guard-arm.mjs). A guard-refused read has no text.
"""
import json, os, random, statistics, sys, gzip
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'euro-gpu-correct-7567'))
from score import score_page, flag_lengths, load_arm  # noqa: E402

T, G, OUT = sys.argv[1:4]
pages = json.load(open(f'{T}/panel.json'))['pages']
refs = {json.loads(l)['slug']: json.loads(l)['ref_text'] for l in gzip.open(f'{T}/refs.jsonl.gz', 'rt')}
arms = {'L': load_arm(f'{T}/L.jsonl')}
guards = {}
for f in sorted(os.listdir(G)):
    if f.endswith('.jsonl') and not f.endswith('.guard.jsonl'):
        a = f[:-6]; arms[a] = load_arm(f'{G}/{f}')
        gp = f'{G}/{a}.guard.jsonl'
        guards[a] = {r['page_id']: r for r in map(json.loads, open(gp))} if os.path.exists(gp) else {}
extra = [a for a in sys.argv[4:]]   # NAME=path extra arms (e.g. MinerU on en), unguarded, descriptive
for e in extra:
    n, p = e.split('=', 1); arms[n] = load_arm(p)

per = {}
for p in pages:
    s = p['slug']; sc = {}
    for a, rows in arms.items():
        r = rows.get(s)
        if r is not None and a in guards and guards[a].get(s, {}).get('refuse'):
            r = {**r, 'text': '', 'guarded': guards[a][s]['reason']}
        x = score_page(refs[s], r)
        if not x.get('missing') and not (r.get('text') or '').strip(): x = {'missing': True}
        if r and r.get('guarded'): x['guarded'] = r['guarded']
        sc[a] = x
    flag_lengths(sc)
    for a, x in sc.items():
        if x.get('missing'): x.update(folded=1.0, raw=1.0, loop=False, trunc=False)
        x['cat'] = bool(x.get('missing') or x['folded'] > 0.5)
    lite_fail = sc['L'].get('missing', False)
    per[s] = {'lang': p['lang'], 'lite_failed': lite_fail, 'arms': sc}


def boot(d, n=4000, seed=6871):
    rng = random.Random(seed); m = len(d)
    if not m: return (None, None)
    st = sorted(statistics.median(rng.choice(d) for _ in range(m)) for _ in range(n))
    return (st[int(0.025 * n)], st[int(0.975 * n) - 1])


res = {'a': {}, 'b': {}}
for lang in ['en', 'de', 'la', 'all']:
    sl = [s for s, v in per.items() if lang in ('all', v['lang'])]
    L = [per[s]['arms']['L'] for s in sl]
    base = {'n': len(sl), 'median': statistics.median(x['folded'] for x in L), 'cat': sum(x['cat'] for x in L), 'loops': sum(bool(x.get('loop')) for x in L)}
    res['a'].setdefault(lang, {'L': base})
    for a in arms:
        if a == 'L': continue
        X = [per[s]['arms'][a] for s in sl]
        d = [per[s]['arms'][a]['folded'] - per[s]['arms']['L']['folded'] for s in sl]
        ans = [s for s in sl if not per[s]['arms'][a].get('missing') and not per[s]['arms']['L'].get('missing')]
        row = {'n': len(sl), 'median': statistics.median(x['folded'] for x in X), 'cat': sum(x['cat'] for x in X),
               'loops': sum(bool(x.get('loop')) for x in X), 'guarded': sum(bool(x.get('guarded')) for x in X),
               'median_delta': statistics.median(d), 'delta_ci': boot(d),
               'wins': sum(v < -0.002 for v in d), 'losses': sum(v > 0.002 for v in d),
               'answered_n': len(ans), 'answered_median': statistics.median(per[s]['arms'][a]['folded'] for s in ans) if ans else None,
               'answered_median_L': statistics.median(per[s]['arms']['L']['folded'] for s in ans) if ans else None}
        if a in guards:
            row['pass'] = bool(row['median'] <= base['median'] and row['cat'] <= base['cat'] and row['loops'] <= base['loops'])
        res['a'][lang][a] = row
    fl = [s for s in sl if per[s]['lite_failed']]
    if fl:
        res['b'][lang] = {}
        for a in arms:
            if a == 'L': continue
            X = [per[s]['arms'][a] for s in fl]
            row = {'n': len(fl), 'median': statistics.median(x['folded'] for x in X), 'cat': sum(x['cat'] for x in X)}
            if a in guards: row['pass'] = bool(row['median'] <= 0.02 and row['cat'] <= max(2, round(2 * len(fl) / 16)))
            res['b'][lang][a] = row
json.dump({'per_page': per, 'result': res}, open(OUT, 'w'), indent=1)
print('== (a) engine alone vs lite (median folded CER %, catastrophic, loops after guard, guard-refused)')
for lang, d in res['a'].items():
    b = d['L']; print(f"{lang:4s} L       n={b['n']:3d} med {b['median']*100:6.2f} cat {b['cat']:3d} loops {b['loops']}")
    for a, r in sorted(d.items(), key=lambda kv: kv[1]['median']):
        if a == 'L': continue
        ci = r['delta_ci']
        print(f"     {a:7s} med {r['median']*100:6.2f} cat {r['cat']:3d} loops {r['loops']} guarded {r['guarded']} "
              f"Δ {r['median_delta']*100:+.2f} [{ci[0]*100:+.2f},{ci[1]*100:+.2f}] W/L {r['wins']}/{r['losses']} "
              f"answered {r['answered_n']}: {r['answered_median']*100 if r['answered_median'] is not None else float('nan'):.2f} vs L {r['answered_median_L']*100 if r['answered_median_L'] is not None else float('nan'):.2f}  {'PASS' if r.get('pass') else ('fail' if 'pass' in r else '')}")
print('== (b) on lite-failed pages (median folded CER %, catastrophic)')
for lang, d in res['b'].items():
    for a, r in sorted(d.items(), key=lambda kv: kv[1]['median']):
        print(f"{lang:4s} {a:7s} n={r['n']:2d} med {r['median']*100:6.2f} cat {r['cat']}  {'PASS' if r.get('pass') else ('fail' if 'pass' in r else '')}")
