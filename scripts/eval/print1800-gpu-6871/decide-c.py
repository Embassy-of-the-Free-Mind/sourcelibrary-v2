#!/usr/bin/env python3
"""decide-c.py — #6871 use (c): GPU draft → agy Flash (arm c) against lite → agy Flash (arm a) on the TYPED panel.

PRIOR ART: scripts/eval/euro-gpu-correct-7567/e2-table.py (the E2 rule: mean folded CER difference with a 95% paired
bootstrap CI, judged against a noise floor; here no a2 floor, so the preregistered fixed bound +0.25 points) and
score.py (imported unchanged). An arm with no 'final' text on a page (no draft, CONTAIN, no answer) is catastrophic.
  decide-c.py <typed dir> <e2 dir> <out.json>
"""
import gzip, json, os, random, statistics, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'euro-gpu-correct-7567'))
from score import score_page  # noqa: E402

T, E, OUT = sys.argv[1:4]
pages = json.load(open(f'{T}/panel.json'))['pages']
refs = {json.loads(l)['slug']: json.loads(l)['ref_text'] for l in gzip.open(f'{T}/refs.jsonl.gz', 'rt')}
arm = lambda a: {f[:-5]: json.load(open(f'{E}/{a}/{f}')) for f in os.listdir(f'{E}/{a}')} if os.path.isdir(f'{E}/{a}') else {}
A, C = arm('a'), arm('c')


def sc(s, r):
    t = (r or {}).get('final') or ''
    if not t.strip(): return {'folded': 1.0, 'cat': True, 'missing': True}
    x = score_page(refs[s], {'text': t}); x['cat'] = x['folded'] > 0.5; return x


def boot(d, n=4000, seed=6871):
    rng = random.Random(seed); m = len(d)
    st = sorted(statistics.mean(rng.choice(d) for _ in range(m)) for _ in range(n))
    return st[int(0.025 * n)], st[int(0.975 * n) - 1]


res = {}
for lang in ['en', 'de', 'la', 'all']:
    sl = [p['slug'] for p in pages if lang in ('all', p['lang'])]
    a = {s: sc(s, A.get(s)) for s in sl}; c = {s: sc(s, C.get(s)) for s in sl}
    both = [s for s in sl if not a[s].get('missing') and not c[s].get('missing')]
    d = [c[s]['folded'] - a[s]['folded'] for s in both]
    ci = boot(d) if d else (None, None)
    r = {'n': len(sl), 'both': len(both), 'mean_delta': statistics.mean(d) if d else None, 'ci': ci,
         'median_a': statistics.median(a[s]['folded'] for s in sl), 'median_c': statistics.median(c[s]['folded'] for s in sl),
         'cat_a': sum(a[s]['cat'] for s in sl), 'cat_c': sum(c[s]['cat'] for s in sl),
         'delivered_a': sum(not a[s].get('missing') for s in sl), 'delivered_c': sum(not c[s].get('missing') for s in sl)}
    r['pass'] = bool(d and ci[1] <= 0.0025 and r['cat_c'] <= r['cat_a'])
    res[lang] = r
    print(f"{lang:4s} n={r['n']:3d} both={r['both']:3d} Δ(c−a) {r['mean_delta']*100 if d else 0:+.2f} [{ci[0]*100 if d else 0:+.2f},{ci[1]*100 if d else 0:+.2f}] "
          f"median a {r['median_a']*100:.2f} c {r['median_c']*100:.2f} cat a {r['cat_a']} c {r['cat_c']} delivered a {r['delivered_a']} c {r['delivered_c']}  {'PASS' if r['pass'] else 'fail'}")
json.dump(res, open(OUT, 'w'), indent=1)
