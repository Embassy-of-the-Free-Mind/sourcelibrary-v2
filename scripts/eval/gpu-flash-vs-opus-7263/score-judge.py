#!/usr/bin/env python3
"""score-judge.py — #7263 per-cell, per-arm judged outcomes and the preregistered decision rule (PREREG.md).

PRIOR ART: scripts/eval/euro-gpu-correct-7567/judge-table.py (usable / misleading / worse-than-draft from the 7522 judge's
verdicts through a label key) and scripts/eval/flash-reread-5924 (Wilson intervals). This adds the no-answer outcome,
the faults-weighted worse-than-draft of the prereg, the non-inferiority rule against arm O and the A-vs-A noise floor.

  score-judge.py <J> <set> [--arms=O,C,...] [--ref=O] [--draft=X] [--floor=C,C2] [--script=print] [--ref-delivered=1] [--out=FILE.json]
Pages enter only when the judge returned a verdict and every arm in --arms (default: the key's) ran on the page.
"""
import json, math, os, random, sys

J, SET = sys.argv[1], sys.argv[2]
opt = dict(a[2:].split('=', 1) for a in sys.argv[3:] if a.startswith('--'))
REF, DRAFT = opt.get('ref', 'O'), opt.get('draft', 'X')
FLOOR = opt.get('floor', 'C,C2').split(',')
MARGIN = 0.05
base = os.path.join(J, f'judge-{SET}')
key = json.load(open(os.path.join(base, 'key.json')))
ARMS = opt['arms'].split(',') if 'arms' in opt else list(key['arms'])
SERIOUS = ['omissions', 'additions', 'cross_page_bleed', 'order_errors']


def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 1.0)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


rows = []  # per page: {arm: outcome dict}
for s, k in key['pages'].items():
    if not k['labels'] or any(a in k['missing'] for a in ARMS): continue
    f = os.path.join(base, 'judge', 'out', f'{s}.json')
    if not os.path.exists(f): continue
    v = (json.load(open(f)).get('verdict') or {}).get('versions')
    if not v: continue
    r = {'slug': s, 'lang': k['lang']}
    for lab, who in k['labels'].items():
        x = v[lab]; faults = 3 * sum(len(x.get(c) or []) for c in SERIOUS) + len(x.get('misreads') or [])
        for a in who:
            r[a] = {'out': 'usable' if x.get('usable') else 'misleading', 'faults': faults, 'serious': sum(len(x.get(c) or []) for c in SERIOUS), 'misreads': len(x.get('misreads') or [])}
    for a in k['not_delivered']: r[a] = {'out': 'no-answer', 'faults': None}
    rows.append(r)
# --script=print|manuscript|unknown keeps that script type only (script-type.json, prereg amendment 2 §3);
# --ref-delivered drops pages where the ref arm gave no answer (a sensitivity row, never the rule's own table)
if 'script' in opt:
    st = json.load(open(os.path.join(J, 'script-type.json')))
    rows = [r for r in rows if st.get(r['slug'], {}).get('script_type', 'unknown') == opt['script']]
if 'ref-delivered' in opt:
    rows = [r for r in rows if r.get(REF, {}).get('out') != 'no-answer']


def cell(rs, arm):
    n = len(rs); u = sum(1 for r in rs if r[arm]['out'] == 'usable'); m = sum(1 for r in rs if r[arm]['out'] == 'misleading')
    na = n - u - m
    worse = None
    if arm not in (DRAFT, REF, 'S') and all(DRAFT in r for r in rs):
        worse = sum(1 for r in rs if (r[DRAFT]['out'] == 'usable' and r[arm]['out'] != 'usable')
                    or (r[arm]['faults'] is not None and r[DRAFT]['faults'] is not None and r[arm]['faults'] > r[DRAFT]['faults']))
    return {'n': n, 'usable': u, 'misleading': m, 'no_answer': na, 'usable_ci': wilson(u, n), 'misleading_ci': wilson(m, n), 'worse_than_draft': worse,
            'misreads_mean': round(sum((r[arm].get('misreads') or 0) for r in rs) / n, 2) if n else None}


def paired_boot(rs, a, b, B=4000, seed=7263):
    if not rs: return None
    d = [(r[a]['out'] == 'usable') - (r[b]['out'] == 'usable') for r in rs]; rng = random.Random(seed); n = len(d)
    bs = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return (sum(d) / n, bs[int(0.025 * B)], bs[int(0.975 * B)])


arms_present = [a for a in ARMS if all(a in r for r in rows)]
out = {'set': SET, 'pages': len(rows), 'arms': arms_present, 'cells': {}}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    rs = [r for r in rows if lang == 'all' or r['lang'] == lang]
    if not rs: continue
    c = {a: cell(rs, a) for a in arms_present}
    nf = max(1, abs(c[FLOOR[0]]['misleading'] - c[FLOOR[1]]['misleading'])) if all(f in c for f in FLOOR) else 1
    for a in arms_present:
        if a in (REF, DRAFT, 'S') or REF not in c: continue
        o = c[REF]; x = c[a]
        lb = x['usable_ci'][0]; okU = lb >= o['usable'] / o['n'] - MARGIN; okM = x['misleading'] - o['misleading'] <= nf
        x['vs_ref'] = {'usable_lb': round(lb, 3), 'ref_usable_rate': round(o['usable'] / o['n'], 3), 'need_lb_at_least': round(o['usable'] / o['n'] - MARGIN, 3),
                       'misleading_diff': x['misleading'] - o['misleading'], 'noise_floor_pages': nf, 'pass_usable': okU, 'pass_misleading': okM,
                       'verdict': 'replaces O' if okU and okM else 'keeps O', 'paired_usable_diff': paired_boot(rs, a, REF)}
    out['cells'][lang] = c
json.dump(out, open(opt.get('out', os.path.join(base, 'score.json')), 'w'), indent=1)
pct = lambda lo, hi: f'{100*lo:.0f}–{100*hi:.0f}%'
for lang, c in out['cells'].items():
    print(f'== {lang} (n {next(iter(c.values()))["n"]})')
    for a, x in c.items():
        v = x.get('vs_ref'); extra = f"  LB {v['usable_lb']:.3f} vs {v['need_lb_at_least']:.3f}, mis Δ {v['misleading_diff']:+d} (NF {v['noise_floor_pages']}) → {v['verdict']}" if v else ''
        print(f"  {a:6s} usable {x['usable']}/{x['n']} ({pct(*x['usable_ci'])}) mis {x['misleading']} ({pct(*x['misleading_ci'])}) no-ans {x['no_answer']} worse {x['worse_than_draft']} misreads/pg {x['misreads_mean']}{extra}")
