#!/usr/bin/env python3
# PRIOR ART: scripts/eval/plain-6728/score.py — parse_obj, decode (with pareto-6182/score-xl.py `norm`), boot (2,000
# draws by work), locate() and the plant-located rule are its code (copied: that module reads its own scratch on
# import). New here: one packet per engine with four arms, the wrong-page / duplicate gate, cells per language group,
# the named pools with the heterogeneity check, and the pre-registered non-inferiority rule
# (scripts/eval/PREREGISTRATION-bench-translation-7499.md), which this file applies and does not choose.
"""
score.py [--look 1|2] — $0. Scores every engine with a judge output in $W/judge/<engine>/out.jsonl.
Writes scripts/eval/results/bench-translation-7499/{scores.json, per-page-<engine>.jsonl} (numbers; no source,
reference or candidate text) and prints the per-cell table. --look 1 uses 99% intervals for the decision (interim);
--look 2 (default) 95%.
"""
import importlib.util, json, os, random, re, statistics, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('scorexl', os.path.join(HERE, '..', 'pareto-6182', 'score-xl.py'))
sx = importlib.util.module_from_spec(spec); spec.loader.exec_module(sx)

W = os.environ.get('BENCH_W', os.environ.get('JOB_SCRATCH', '') + '/w')
RESULTS = os.path.join(HERE, '..', 'results', 'bench-translation-7499')
LOOK = int(sys.argv[sys.argv.index('--look') + 1]) if '--look' in sys.argv else 2
LEVEL = 0.99 if LOOK == 1 else 0.95
DELTA, MIN_EFFECT, NB, SEED = 0.15, 0.25, 2000, 7499
GROUPS = ['latin', 'vernacular', 'greek', 'hebrew-aramaic', 'arabic', 'persian', 'sanskrit-pali', 'chinese']
POOLS = {'all': GROUPS, 'latin-script': ['latin', 'vernacular'], 'non-latin': ['greek', 'hebrew-aramaic', 'arabic', 'persian', 'sanskrit-pali', 'chinese']}
SENT = re.compile(r'<<<\s*BEGIN\s*>>>([\s\S]*?)(<<<\s*END\s*>>>|$)')
BODIES = json.load(open(f'{W}/bodies.json'))
MAN = {p['id']: p for p in json.load(open(os.path.join(HERE, 'manifest.json')))['pages']}
mean = lambda x: sum(x) / len(x) if x else None
r3 = lambda v: None if v is None else round(v, 3)


def parse_obj(raw):
    m = SENT.search(raw or ''); t = m.group(1) if m else (raw or '')
    m = re.search(r'\{[\s\S]*\}', t)
    if not m: return None
    try: return json.loads(m.group(0))
    except ValueError: return None


def decode(o, labels):
    tier = {}
    for t, grp in enumerate(o.get('ranking') or []):
        for l in (grp if isinstance(grp, list) else [grp]): tier[l] = t
    res = {}
    for l, s in (o.get('scores') or {}).items():
        if l not in labels or not isinstance(s, dict): continue
        try: n = sx.norm(s, tier.get(l))
        except Exception: continue
        try: n['fid'] = float(n['fid']) if n['fid'] is not None else None
        except (TypeError, ValueError): n['fid'] = None
        n['spans'] = [x for x in (s.get('spans') or []) if isinstance(x, dict) and x.get('quote')]
        n['inv'] = [x for x in (s.get('invention') or []) if isinstance(x, dict)]
        n['revq'] = (s.get('reversal') or {}).get('candidate') if isinstance(s.get('reversal'), dict) else None
        n['label'] = l
        res[labels[l]] = n
    return res


def boot(pages, stat, level=0.95, seed=SEED):
    if len(pages) < 2: return None
    rng = random.Random(seed); vals = []
    for _ in range(NB):
        v = stat([pages[rng.randrange(len(pages))] for _ in pages])
        if v is not None: vals.append(v)
    vals.sort(); a = (1 - level) / 2
    return [round(vals[int(a * len(vals))], 3), round(vals[int((1 - a) * len(vals)) - 1], 3)] if vals else None


norm_ws = lambda s: re.sub(r'\s+', ' ', s).strip().lower()


def locate(quote, text):
    t = norm_ws(text); q = norm_ws(quote).strip('"\'“”‘’.…')
    if not q: return None
    k = t.find(q)
    if k < 0:
        w = q.split(' ')
        for n in (6, 4, 3):
            if len(w) >= n:
                k = t.find(' '.join(w[:n]))
                if k >= 0: break
    return None if k < 0 else (k, k + len(q))


def engine(E):
    J = f'{W}/judge/{E}'
    key = json.load(open(f'{J}/key.json')); items = key['items']; texts = json.load(open(f'{J}/texts.json'))
    rows = {}
    if os.path.exists(f'{J}/out.jsonl'):
        for l in open(f'{J}/out.jsonl', encoding='utf-8'):
            if l.strip():
                r = json.loads(l)
                if r.get('text') or r['uid'] not in rows: rows[r['uid']] = r
    dec, unparsed = {}, []
    for i, r in rows.items():
        if i not in items: continue
        o = parse_obj(r.get('raw') or r.get('text'))
        d = decode(o, items[i]['labels']) if o else None
        if not d or any(v['fid'] is None for v in d.values()) or len(d) != len(items[i]['labels']): unparsed.append(i); continue
        dec[i] = d
    A = lambda a: f'{E}-{a}'
    page = {}   # uid -> {arm: decoded}
    for i, k in items.items():
        if k['kind'] == 'ARMS' and i in dec: page[k['page_id']] = {a.split('-', 1)[1]: v for a, v in dec[i].items()}
    fid = lambda u, a: (page.get(u, {}).get(a) or {}).get('fid')

    # ── gate ──
    gate = {'plants': [], 'wrong': [], 'dup': []}
    for i, k in items.items():
        if i not in dec: continue
        if k['kind'] == 'PLANT':
            d = dec[i].get(A('v13_PLANT')); text = texts[i][d['label']]; pl = k['plant']
            pos = norm_ws(text).find(norm_ws(pl['new'])[:60])
            region = (pos, pos + len(norm_ws(pl['new']))) if pos >= 0 else None
            quotes = [s['quote'] for s in d['spans']] + ([d['revq']] if d['revq'] else [])
            located = bool(region) and any((lambda loc: loc and loc[0] < region[1] + 20 and loc[1] > region[0] - 20)(locate(q, text)) for q in quotes)
            gate['plants'].append({'item': i, 'group': k['group'], 'kind': pl['kind'], 'located': located, 'fid': d['fid'], 'rev': d['rev']})
        elif k['kind'] == 'WRONG':
            gate['wrong'].append({'item': i, 'fid': dec[i][A('WRONG')]['fid']})
        elif k['kind'] == 'DUP':
            a, b = dec[i][A('v13')], dec[i][A('v13_DUP')]
            gate['dup'].append({'item': i, 'same_fid': a['fid'] == b['fid'], 'same_tier': a['tier'] == b['tier'], 'same_om': a['om'] == b['om']})
    np_, nl = len(gate['plants']), sum(p['located'] for p in gate['plants'])
    gate['pass'] = {'plants_located': f'{nl}/{np_}', 'plants_ok': np_ > 0 and nl / np_ >= 0.8,
                    'wrong_ok': bool(gate['wrong']) and all(w['fid'] <= 2 for w in gate['wrong']),
                    'dup_ok': len(gate['dup']) >= 4 and sum(d['same_fid'] for d in gate['dup']) >= 3}
    gate['pass']['all'] = gate['pass']['plants_ok'] and gate['pass']['wrong_ok'] and gate['pass']['dup_ok']

    # ── floor (v13b − v13) ──
    fl = [u for u in page if fid(u, 'v13b') is not None and fid(u, 'v13') is not None]
    fd = lambda s: mean([fid(u, 'v13b') - fid(u, 'v13') for u in s])
    rate = lambda s, a: mean([page[u][a]['rev'] for u in s])
    floor = {'n': len(fl), 'mean': r3(fd(fl)), 'ci95': boot(fl, fd), 'rev_v13': sum(page[u]['v13']['rev'] for u in fl) if fl else None,
             'rev_v13b': sum(page[u]['v13b']['rev'] for u in fl) if fl else None,
             'd_floor_rev': r3(abs(rate(fl, 'v13b') - rate(fl, 'v13'))) if fl else None,
             'om_v13': sum(page[u]['v13']['om'] for u in fl) if fl else None, 'om_v13b': sum(page[u]['v13b']['om'] for u in fl) if fl else None}
    d_floor = floor['d_floor_rev'] or 0.0
    floor_ci = floor['ci95'] or [0, 0]

    def arm_tab(us, a):
        us = [u for u in us if fid(u, a) is not None]
        if not us: return None
        g = lambda u: page[u][a]
        acc = lambda u: [s for s in g(u)['spans'] if s.get('type') == 'accuracy']
        inv_k = {}
        for u in us:
            for x in g(u)['inv']: inv_k[x.get('kind')] = inv_k.get(x.get('kind'), 0) + 1
        st = BODIES['stats'].get(A(a), {})
        ot = [st[u]['out_tok'] for u in us if u in st and st[u]['out_tok'] is not None]
        th = [st[u]['think_tok'] for u in us if u in st and st[u].get('think_tok') is not None]
        return {'n': len(us), 'fidelity': r3(mean([fid(u, a) for u in us])), 'ci95': boot(us, lambda s: mean([fid(u, a) for u in s])),
                'reversal_pages': sum(g(u)['rev'] for u in us), 'omission_pages': sum(g(u)['om'] for u in us),
                'invention_pages': sum(1 for u in us if g(u)['inv']), 'invention_by_kind': inv_k,
                'fill_pages': sum(g(u)['fill'] for u in us),
                'acc_spans_per_page': r3(mean([len(acc(u)) for u in us])),
                'major_acc_spans_per_page': r3(mean([len([s for s in acc(u) if s.get('severity') == 'major']) for u in us])),
                'out_tok_mean': r3(mean(ot)), 'think_tok_mean': r3(mean(th)) if th else None,
                'body_chars_mean': r3(mean([st[u]['body_chars'] for u in us if u in st]))}

    def paired(us, x):
        us = [u for u in us if fid(u, x) is not None and fid(u, 'v13') is not None]
        if not us: return None
        d = lambda s: mean([fid(u, x) - fid(u, 'v13') for u in s])
        w = sum(1 for u in us if fid(u, x) > fid(u, 'v13')); lo = sum(1 for u in us if fid(u, x) < fid(u, 'v13'))
        ci95, ci_dec = boot(us, d, 0.95), boot(us, d, LEVEL)
        m = d(us); n = len(us)
        rev_rise = sum(page[u][x]['rev'] for u in us) - sum(page[u]['v13']['rev'] for u in us)
        allowed = max(1, round(n * d_floor))
        rev_ok = rev_rise <= allowed
        if ci_dec and ci_dec[0] > -DELTA and rev_ok: verdict = 'pass'
        elif (ci_dec and ci_dec[1] < 0) or (not rev_ok and m <= 0): verdict = 'inferior'
        else: verdict = 'inconclusive'
        superior = bool(ci95 and ci95[0] > 0 and not (floor_ci[0] <= m <= floor_ci[1]) and m >= MIN_EFFECT)
        grade = 'decision' if n >= 50 else 'directional' if n >= 30 else 'exploratory'
        return {'n': n, 'mean': r3(m), 'ci95': ci95, f'ci{int(LEVEL * 100)}': ci_dec, 'wins': w, 'losses': lo, 'ties': n - w - lo,
                'rev_rise': rev_rise, 'rev_allowed': allowed, 'rev_ok': rev_ok,
                'om_change': sum(page[u][x]['om'] for u in us) - sum(page[u]['v13']['om'] for u in us),
                'verdict': verdict, 'superior': superior, 'grade': grade}

    def rec(c):
        p, v = c['plain-v13'], c['v20-v13']
        if p and p['verdict'] == 'pass': return 'switch to PLAIN (after the notes pass, #5942)'
        if v and v['verdict'] == 'pass': return 'switch to v20'
        if (p and p['verdict'] == 'inconclusive') or (v and v['verdict'] == 'inconclusive'): return 'test-next'
        return 'keep v13'

    def cell(us):
        c = {'arms': {a: arm_tab(us, a) for a in ('v13', 'v20', 'plain', 'v13b')},
             'v20-v13': paired(us, 'v20'), 'plain-v13': paired(us, 'plain')}
        c['recommendation'] = rec(c) if c['v20-v13'] or c['plain-v13'] else None
        return c

    cells = {}
    for g in GROUPS:
        us = [u for u in page if MAN[u]['group'] == g]
        if us: cells[g] = cell(us)
    pools = {}
    for name, gs in POOLS.items():
        us = [u for u in page if MAN[u]['group'] in gs]
        if not us: continue
        pools[name] = cell(us)
        het = {}
        for x in ('v20', 'plain'):
            pm = (pools[name][f'{x}-v13'] or {}).get('mean')
            big = [g for g in gs if g in cells and (cells[g][f'{x}-v13'] or {}).get('n', 0) >= 10]
            same_sign = all(((cells[g][f'{x}-v13']['mean'] or 0) >= 0) == ((pm or 0) >= 0) for g in big)
            inside = all(cells[g][f'{x}-v13']['ci95'] and cells[g][f'{x}-v13']['ci95'][0] <= pm <= cells[g][f'{x}-v13']['ci95'][1] for g in big) if pm is not None else False
            het[x] = {'groups_ge10': big, 'same_sign': same_sign, 'pooled_inside_each_ci': inside, 'pass': same_sign and inside}
        pools[name]['heterogeneity'] = het
    per_page = []
    for u, d in sorted(page.items()):
        row = {'id': u, 'group': MAN[u]['group'], 'lang': MAN[u]['lang'], 'medium': MAN[u]['medium'], 'century': MAN[u]['century'], 'url': MAN[u]['url']}
        for a, v in d.items(): row[a] = {'fid': v['fid'], 'rev': v['rev'], 'om': v['om'], 'inv': len(v['inv']), 'fill': v['fill'], 'tier': v['tier']}
        per_page.append(row)
    return {'judge': key['judge'], 'items': len(items), 'judged': len(dec), 'unparsed': unparsed, 'look': LOOK, 'decision_level': LEVEL,
            'gate': gate, 'floor': floor, 'cells': cells, 'pools': pools,
            'did_not_read': {a: len(v) for a, v in BODIES['dnr'].items() if a.startswith(E + '-')}}, per_page


if __name__ == '__main__':
    os.makedirs(RESULTS, exist_ok=True)
    S = {'issue': 7499, 'rule': 'scripts/eval/PREREGISTRATION-bench-translation-7499.md', 'delta': DELTA, 'engines': {}}
    for E in ('lite', 'flash38', 'opus'):
        if not os.path.exists(f'{W}/judge/{E}/out.jsonl'): continue
        S['engines'][E], pp = engine(E)
        with open(f'{RESULTS}/per-page-{E}.jsonl', 'w') as f:
            for r in pp: f.write(json.dumps(r) + '\n')
    json.dump(S, open(f'{RESULTS}/scores.json', 'w'), indent=1)
    fmt = lambda p: '—' if not p else f"{p['mean']:+.2f} {p['ci95']} {p['verdict']}{' SUP' if p['superior'] else ''} rev{p['rev_rise']:+d}/{p['rev_allowed']}"
    for E, s in S['engines'].items():
        g = s['gate']['pass']; f = s['floor']
        print(f"\n== {E} (judge {s['judge']}): {s['judged']}/{s['items']} judged, unparsed {len(s['unparsed'])}; gate {g}; floor v13b−v13 {f['mean']} {f['ci95']} n={f['n']} d_floor_rev {f['d_floor_rev']}")
        for name, c in list(s['cells'].items()) + [(f'POOL {k}', v) for k, v in s['pools'].items()]:
            a = c['arms']
            if not a['v13']: continue
            print(f"{name:20s} n={a['v13']['n']:3d} v13 {a['v13']['fidelity']:.2f}  v20 {fmt(c['v20-v13'])}  plain {fmt(c['plain-v13'])}  → {c['recommendation']}"
                  + f"  | rev v13/v20/plain {a['v13']['reversal_pages']}/{(a['v20'] or {}).get('reversal_pages')}/{(a['plain'] or {}).get('reversal_pages')}"
                  + f" om {a['v13']['omission_pages']}/{(a['v20'] or {}).get('omission_pages')}/{(a['plain'] or {}).get('omission_pages')}")
