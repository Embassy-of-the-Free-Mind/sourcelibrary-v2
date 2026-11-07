#!/usr/bin/env python3
# PRIOR ART: the #7263 audit of 2026-11-01 simulated the gate at n = 30 a route by hand (a route at the margin passes
# ~15%, one of 6 ~49%) and committed nothing; test_pick.py pins single picks, not error rates. This runs build.py's own
# decide() / gate() (imported, not re-implemented) at each cell's real n and route count.
"""V3 (#7263, #8283): how often does the router's decision rule pick a route that is truly worse than the bar by more than
the margin? Stdlib only, no model calls, no DB.

  python3 scripts/eval/estimator/router-table/v3_sim.py <table.json> [--reps 1000] [--procs 8] [--out <file.json>] [--annotate]
      (repo root: decide_defects, the rule in force; below)
  ... v3_sim.py <table.json> --rule kn [--draws 2000] [--variants all|in_force]      (the frozen k/n rule; this docstring's rest)

THE ONE RULE (--rule defects, the default; defects_main). For every cell build.decide_defects compared routes in (its
row has `defects_rule.picks`), the routes stay as the row has them: acceptance n (eff), each defect rate's exposure (the
gamma posterior's b less the prior's: phi-scaled words, so the sim sees what the posterior sees), price, hard-floor block,
menu. Each replicate draws k ~ Binomial(n, acc) and scaled defects ~ Poisson(rate x exposure) per route and runs
decide_defects itself. The bar is the live route when rated, else the row's lowest wrong text; its true rates are its
posterior means. A FALSE PICK is a keep or switch to a route whose true gap beyond the bar exceeds the gate's margin.
  boundary-wrong   every other rated route truly wrong_text_delta + 0.01 above the bar (after the re-check's deflation),
                   level on misleads and acceptance: gate 1 alone protects.
  boundary-accept  every other rated route truly accept_floor.within + 0.01 below the acceptance reference, level on
                   defects: gate 2 alone protects.
  (with no text served: truly 0.01 over the wrong-text ceiling, or 0.01 under the hold bar.)
  false_pick_boundary = the larger of the two: the V3 number, pass bar <= 5% per cell. estimates = every route at its
  posterior means. power = the cheapest other route truly level with the bar, P(the rule picks it).
Paired evidence is simulated as independent, as below. A cell the rule did not compare (menu default, too few pages, held,
planned) has no pick to be false: v3 null. --annotate writes rows[].v3 and a section in the .md.

THE FROZEN RULE (--rule kn):

For every cell the k/n rule can decide (a reference route and >= 1 candidate measured; not held / planned / thin), the
cell's measured routes are kept as they are in the table: their book-scaled n (eff, what the posterior sees), their prior
(a, b), their price per raw page (rules.json stages + page sizes at the default plan fee, as build.py computes it; dollars
stay in memory) and which route is the bar. Each replicate draws k ~ Binomial(n, p_true) per route, forms the Beta
posterior with `draws` draws, and runs build.decide() with the rule variant. Wrong text is set to 0 for every route (the
wrong-text gate passes everyone: the least favourable case for this check).

True rates, three configurations:
  boundary   the reference at its posterior mean (clipped to [0.5, 0.97]); EVERY candidate at reference - margin - 0.01.
             Any route the gate passes is a false pick. This is the least favourable configuration for a candidate at a
             gap beyond the margin, so its rate is the V3 number (pass bar: <= 5% per cell decision).
  estimates  every route at its posterior mean in the table: the rate if the table's estimates were the truth.
  power      the cheapest candidate AT the reference's rate, the others at the boundary: P(the rule picks the good one).
A false pick is a route the GATE passed and the rule picked (keep or switch) whose true gap exceeds the margin; the
fallback (nothing passes: keep the current route) is not a pick. Paired evidence is simulated as independent (paired
draws are tighter, so a paired cell's real rate is lower for a route that truly ties and similar at the boundary).

--annotate writes each cell's in-force boundary rate into the table (.json rows[].v3 and a section in the .md).
"""
import copy, importlib.util, json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(HERE, 'build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
sys.path.insert(0, HERE)
import kn_rule as K_RULE   # the frozen k/n decision (#8283): --rule kn only
arg = lambda f, d=None: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d

VARIANTS = {
    'none (p 0.9)': {'method': 'none'},
    **{f'bonferroni a {a:g}': {'method': 'bonferroni', 'alpha': a} for a in (0.10, 0.05, 0.03, 0.02)},
    **{f'sidak a {a:g}': {'method': 'sidak', 'alpha': a} for a in (0.05, 0.03)},
    **{f'joint a {a:g}': {'method': 'joint', 'alpha': a} for a in (0.10, 0.05, 0.03, 0.02)},
    **{f'max-bonferroni a {a:g}': {'method': 'max-bonferroni', 'alpha': a} for a in (0.10, 0.05, 0.03, 0.02, 0.01)},
}


def binom(rng, n, p):
    return sum(rng.random() < p for _ in range(n))


def cells_of(T, P):
    """The cells the k/n rule can decide, with their measured routes as the sim needs them."""
    S, Z = P['stages'], P['size_model']
    sizes = json.load(open(P['inputs']['page_sizes']))['cells']; K = B.fit_rate(Z, sizes)
    rates, _ = B.fee_rates(P, None)
    out = []
    for row in T['rows']:
        if cls(row['decision']) in ('held', 'planned', 'UNTESTED') or cls(row.get('decision_kn', row['decision'])) in ('held', 'planned'): continue
        few = lambda r: row.get('script') in ('manuscript', 'unknown') and r['n'] < P['script_split']['min_manuscript_pages']
        M = []
        for r in row['routes']:
            if not r['tested'] or few(r) or not r.get('eff') or r['eff'][1] <= 0: continue
            st0 = S[r['stage']]; sp = B.size_points(st0, sizes[row['id']], Z, K) if st0.get('size') and row['id'] in sizes else None
            st = dict(st0, points=sp['central'], draw=sp['central'] / 100) if sp else st0
            bar = P['switch'].get('bar') == 'opus' and st0['channel'] == 'claude' and not (row.get('script') == 'manuscript' and P['switch'].get('bar_scope') == 'print')
            M.append(dict(id=r['id'], n=max(1, round(r['eff'][1])), prior=r['prior'], usd=B.usd_per_page(st, rates), _bar=bar, est=r['mean']))
        if not M: continue
        ref = max([r for r in M if r['_bar']] or M, key=lambda r: r['est'])
        cand = [r for r in M if not r['_bar'] and r is not ref]
        if not cand: continue
        out.append(dict(id=row['id'], current=row['current'], routes=M, ref=ref['id'], K=len(cand), decision=row['decision'], route=row['route']))
    return out


cls = lambda d: d.split(' (')[0].strip()


def sim_cell(job):
    c, P, reps, N, seed, variants = job
    W = P['switch']['within']; rng = random.Random(f'{seed}:{c["id"]}')
    ref = next(r for r in c['routes'] if r['id'] == c['ref'])
    pref = min(max(ref['est'], 0.5), 0.97); bad = max(pref - W - 0.01, 0.01)
    cand = [r for r in c['routes'] if r['id'] != ref['id'] and not r['_bar']]
    cheapest = min(cand, key=lambda r: r['usd'])['id']
    truth = {
        'boundary': {r['id']: (pref if r['id'] == ref['id'] or r['_bar'] else bad) for r in c['routes']},
        'estimates': {r['id']: r['est'] for r in c['routes']},
        'power': {r['id']: (pref if r['id'] in (ref['id'], cheapest) or r['_bar'] else bad) for r in c['routes']},
    }
    WT = lambda best: 1.0
    cost = lambda r: r['_usd_acc']
    res = {v: {k: dict(false=0, picks=0, good=0, hold=0) for k in truth} for v in variants}
    Ps = {v: dict(P, switch=dict(P['switch'], multiplicity=m)) for v, m in variants.items()}
    for conf, tr in truth.items():
        top = max(tr[r['id']] for r in c['routes'] if r['id'] == ref['id'] or r['_bar'])
        for _ in range(reps):
            M = []
            for r in c['routes']:
                k = binom(rng, r['n'], tr[r['id']]); a, b = r['prior'][0] + k, r['prior'][1] + r['n'] - k
                d = [rng.betavariate(a, b) for _ in range(N)]; med = sorted(d)[N // 2]
                M.append(dict(id=r['id'], _bar=r['_bar'], mean=sum(d) / N, _d=d, wrate=0.0, wrong=0, n=r['n'],
                              p80=sum(x >= P['hold']['acc'] for x in d) / N, _usd_acc=r['usd'] / med if med > 0 else float('inf')))
            cur = next((r for r in M if r['id'] == c['current']), None) or M[0]
            for v, Pv in Ps.items():
                dec, pk = K_RULE.decide({}, M, cur, Pv, cost, WT)
                o = res[v][conf]
                if dec == 'HOLD': o['hold'] += 1; continue
                ok = K_RULE.gate(M, Pv, WT, W)[1]
                if not any(pk is r for r in ok): continue
                o['picks'] += 1
                gap = top - tr[pk['id']]
                if gap > W + 1e-9: o['false'] += 1
                if conf == 'power' and pk['id'] == cheapest: o['good'] += 1
    out = {}
    for v in variants:
        r = res[v]
        out[v] = dict(boundary=r['boundary']['false'] / reps, estimates=r['estimates']['false'] / reps, power=r['power']['good'] / reps,
                      boundary_hold=r['boundary']['hold'] / reps)
    return c['id'], dict(K=c['K'], n={r['id']: r['n'] for r in c['routes']}, ref=c['ref'], ref_rate=pref, rates=out)


def poisson(rng, lam):
    if lam > 30: return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    k, p, L = 0, rng.random(), math.exp(-lam)
    while p > L: k += 1; p *= rng.random()
    return k


def defect_cells(T, P, D):
    """The cells decide_defects compared, with their routes as the sim needs them."""
    S, Z = P['stages'], P['size_model']
    sizes = json.load(open(P['inputs']['page_sizes']))['cells']; K = B.fit_rate(Z, sizes)
    rates, _ = B.fee_rates(P, None); out = []
    for row in T['rows']:
        di = row.get('defects_rule') or {}
        if 'picks' not in di or 'rule_alone' in row or row['decision'].split(' (')[0] in ('held', 'planned'): continue   # rule_alone: a person's planned decision
        few = lambda r: row.get('script') in ('manuscript', 'unknown') and r['n'] < P['script_split']['min_manuscript_pages']
        rs = []
        for r in row['routes']:
            st0 = S[r['stage']]; sp = B.size_points(st0, sizes[row['base']], Z, K) if st0.get('size') and row.get('base') in sizes else None
            st = dict(st0, points=sp['central'], draw=sp['central'] / 100) if sp else st0
            x = dict(id=r['id'], stage=r['stage'], channel=r['channel'], _bar=B.is_bar(dict(r, _bar=P['switch'].get('bar') == 'opus' and st0['channel'] == 'claude' and not st0.get('candidate') and not (row.get('script') == 'manuscript' and P['switch'].get('bar_scope') == 'print')), P),
                     hard_floor_block=r.get('hard_floor_block'), tested=r['tested'], _usd_raw=B.usd_per_page(st, rates), prior=r['prior'], mean=r['mean'], p80=r['p80'], n=r.get('n'),
                     measured=bool(r['tested'] and not few(r) and B.on_menu(r, P) and r.get('eff') and r['eff'][1] > 0), acc_n=max(1, round(r['eff'][1])) if r.get('eff') else 0)
            d = r.get('defects')
            if d:
                task = 'translation' if d.get('task') == 'translation' else 'ocr'
                x['d'] = dict(books=d['books'], words=d['median_words_per_page'], **{s: dict(mean=d[f'{s}_per_1k_posterior'][1], a0=D[f'{task}/{s}']['prior_alpha'], b=d[f'{s}_per_1k_gamma'][1],
                              E=max(d[f'{s}_per_1k_gamma'][1] - D[f'{task}/{s}']['prior_beta'], 1e-6)) for s in ('misleads', 'wrong_text')})
            rs.append(x)
        out.append(dict(id=row['id'], current=row['current'], live=row['live'], routes=rs))
    return out


_rate_memo = {}
def memo_p_rate_le(g, x, seed, n=2000):
    """p_rate_le with one result per (a, b, x): a simulated cell repeats the same k many times. No text served only."""
    key = (round(g[0], 3), round(g[1], 3), x)
    if key not in _rate_memo: _rate_memo[key] = _p_rate_le(g, x, 'memo', n)
    return _rate_memo[key]
_p_rate_le = B.p_rate_le


def sim_defects(job):
    c, P, reps, seed = job
    R, D_, rng = P['decision_rule'], c['routes'], random.Random(f'{seed}:{c["id"]}')
    B.p_rate_le = memo_p_rate_le
    cal = json.load(open(P['inputs']['defect_rates']))['recheck']; cw = cal.get('wrong_text', 1.0)
    M0 = [r for r in D_ if r['measured']]
    live, no_text = next((r for r in D_ if r['id'] == c['live']), None), c['live'] == 'scans-only'
    agy_left = any(r['channel'] == 'agy' and B.on_menu(r, P) and B.floor_ok(r, P) for r in D_)
    rated = [r for r in M0 if r.get('d') and r['d']['books'] >= R['min_books'] and B.floor_ok(r, P) and (not B.is_bar(r, P) or r is live or not agy_left)]   # decide_defects' candidates
    ptw = lambda r: r['d']['wrong_text']['mean']; pml = lambda r: r['d']['misleads']['mean']
    bar = None if no_text else live if live in rated else min(rated, key=lambda r: (ptw(r), -r['mean'])) if rated else None
    ref = live if live in M0 else max(M0, key=lambda r: r['mean']) if M0 else None
    others = [r for r in rated if r is not bar and not r['id'] == c['live']]
    if not others: return c['id'], None
    cheapest = min(others, key=lambda r: r['_usd_raw'])
    wb, mb, ab = (ptw(bar), pml(bar), bar['mean']) if bar else (R['ceiling_per_1k'] / cw, 0.0, P['hold']['acc'])
    aref = min(max(ref['mean'], 0.5), 0.97) if ref else ab
    level = dict(wt=wb, ml=mb, acc=aref)
    truth = {
        'boundary_wrong': {r['id']: dict(level, wt=wb + ((0.01 if no_text else R['wrong_text_delta_per_1k'] + 0.01) / cw)) for r in others},
        'boundary_accept': {r['id']: dict(level, acc=(P['hold']['acc'] - 0.01 if no_text else aref - R['accept_floor']['within'] - 0.01)) for r in others},
        'estimates': {r['id']: dict(wt=ptw(r), ml=pml(r), acc=r['mean']) for r in others},
        'power': {r['id']: (dict(level) if r is cheapest else dict(level, wt=wb + (R['wrong_text_delta_per_1k'] + 0.01) / cw)) for r in others},
    }
    res = {}
    for conf, tr in truth.items():
        false = good = 0; memo = {}
        base = {r['id']: dict(wt=ptw(r) if r.get('d') else None, ml=pml(r) if r.get('d') else None, acc=r['mean']) for r in D_}
        if ref is not None: base[ref['id']] = dict(base[ref['id']], acc=aref)
        if bar is not None: base[bar['id']] = dict(base[bar['id']], wt=wb, ml=mb, acc=aref if bar is ref else ab)
        true = {**base, **tr}
        for _ in range(reps):
            rs, M = [], []
            for r in D_:
                t, x = true[r['id']], {k: v for k, v in r.items() if k not in ('d',)}
                if r['measured']:
                    k = binom(rng, r['acc_n'], t['acc']); a, b = r['prior'][0] + k, r['prior'][1] + r['acc_n'] - k
                    key = (r['id'], k)
                    if key not in memo:
                        dr = [rng.betavariate(a, b) for _ in range(800)]
                        memo[key] = (dr, sum(dr) / 800, sum(v >= P['hold']['acc'] for v in dr) / 800)
                    x['_d'], x['mean'], x['p80'] = memo[key]
                if r.get('d'):
                    dd = dict(books=r['d']['books'], median_words_per_page=r['d']['words'])
                    for s, tv in (('misleads', t['ml']), ('wrong_text', t['wt'])):
                        q = r['d'][s]; a = q['a0'] + poisson(rng, max(tv, 0) * q['E'] / 1.0)
                        dd[f'{s}_per_1k_posterior'] = [None, a / q['b'], None]; dd[f'{s}_per_1k_gamma'] = [a, q['b']]
                    x['defects'] = dd
                else: x['defects'] = None
                rs.append(x)
                if r['measured']: M.append(x)
            cur = next((x for x in rs if x['id'] == c['current']), rs[0])
            dec, pk, _ = B.decide_defects(dict(id=c['id']), rs, M, cur, c['live'], P, cal)
            if not dec or not dec.startswith(('keep', 'switch')) or pk is None or pk['id'] == c['live'] or (bar is not None and pk['id'] == bar['id']): continue
            tp = true[pk['id']]
            gap = (tp['wt'] is not None and cw * (tp['wt'] - wb) > (0 if no_text else R['wrong_text_delta_per_1k']) + 1e-9) or tp['acc'] < (P['hold']['acc'] if no_text else aref - R['accept_floor']['within']) - 1e-9
            if conf == 'power' and pk['id'] == cheapest['id']: good += 1
            elif gap: false += 1
        res[conf] = dict(false=false / reps, good=good / reps)
    fp = max(res['boundary_wrong']['false'], res['boundary_accept']['false'])
    return c['id'], dict(candidates=len(others), bar=bar['id'] if bar else 'scans-only', false_pick_boundary=round(fp, 4), boundary_wrong=round(res['boundary_wrong']['false'], 4), boundary_accept=round(res['boundary_accept']['false'], 4),
                         false_pick_estimates=round(res['estimates']['false'], 4), power=round(res['power']['good'], 4), reps=reps, rule='decide_defects', passes=fp <= V3_BAR)


V3_BAR = 0.05


def defects_main(path, T, P):
    D = json.load(open(P['inputs']['defect_rates']))['priors']; reps, procs = int(arg('--reps', 1000)), int(arg('--procs', 8))
    cells = defect_cells(T, P, D)
    import multiprocessing as mp
    res = {}
    with mp.get_context('fork').Pool(procs) as pool:
        for i, (cid, r) in enumerate(pool.imap_unordered(sim_defects, [(c, P, reps, P['seed']) for c in cells])):
            if r: res[cid] = r
            sys.stderr.write(f'\r{i + 1}/{len(cells)} cells'); sys.stderr.flush()
    sys.stderr.write('\n')
    over = sorted(c for c, r in res.items() if not r['passes'])
    print(f"decide_defects: {len(res)} cells compared, {reps} replicates a cell; over {V3_BAR:.0%} at the boundary: {len(over)}")
    for row in T['rows']:
        r = res.get(row['id'])
        if r: print(f"{row['id']:38s} {row['decision'].split(' (')[0]:7s} {row['route']:34s} K={r['candidates']} boundary {r['false_pick_boundary']:.1%} (wrong {r['boundary_wrong']:.1%}, accept {r['boundary_accept']:.1%}) estimates {r['false_pick_estimates']:.1%} power {r['power']:.1%} {'pass' if r['passes'] else 'FAIL'}")
    if arg('--out'): open(arg('--out'), 'w').write(json.dumps(dict(table=path, reps=reps, bar=V3_BAR, by_cell=res), indent=1) + '\n')
    if '--annotate' in sys.argv:
        for row in T['rows']: row['v3'] = res.get(row['id'])
        json.dump(T, open(path, 'w'), indent=1, ensure_ascii=False)
        lines = ['', f"**V3: how often the rule picks a route truly worse than the bar by more than the gate's margin** (#8283, v3_sim.py, {reps} replicates a cell at its real n). *Boundary*: the worst of every other route truly just past gate 1 (wrong text) or gate 2 (acceptance). *Estimates*: the table's posterior means as the truth. *Power*: the cheapest other route truly level, P(it is picked). "
                     f"**A cell over {V3_BAR:.0%} at the boundary is not auto-bound.** A cell the rule did not compare has no pick to be false, and is not listed.", '',
                 '| cell | decision → route | candidates | false pick at the boundary (wrong text / acceptance) | at the estimates | power | V3 |', '|---|---|---|---|---|---|---|']
        for row in T['rows']:
            v = row.get('v3')
            if v: lines.append(f"| {row['id']} | {row['decision'].split(' (')[0]} → {row['route']} | {v['candidates']} | {v['false_pick_boundary']:.1%} ({v['boundary_wrong']:.1%} / {v['boundary_accept']:.1%}) | {v['false_pick_estimates']:.1%} | {v['power']:.1%} | {'pass' if v['passes'] else '**not auto-bound**'} |")
        open(path[:-5] + '.md', 'a').write('\n'.join(lines) + '\n')


def main():
    path = next(a for a in sys.argv[1:] if a.endswith('.json') and a != arg('--out'))
    T = json.load(open(path)); P = json.load(open(B.D + 'rules.json'))   # retired sections off: the margin rule V3 measured (the sim's routes carry no p_abs / pw)
    if arg('--rule', 'defects') == 'defects': return defects_main(path, T, P)
    reps, N, procs = int(arg('--reps', 1000)), int(arg('--draws', 2000)), int(arg('--procs', 8))
    inforce = P['switch'].get('multiplicity') or {'method': 'none'}
    variants = VARIANTS if arg('--variants', 'all') == 'all' else {'in force': inforce}
    cells = cells_of(T, P)
    jobs = [(c, P, reps, N, P['seed'], variants) for c in cells]
    import multiprocessing as mp
    res = {}
    with mp.get_context('fork').Pool(procs) as pool:
        for i, (cid, r) in enumerate(pool.imap_unordered(sim_cell, jobs)):
            res[cid] = r; sys.stderr.write(f'\r{i + 1}/{len(jobs)} cells'); sys.stderr.flush()
    sys.stderr.write('\n')
    summ = {}
    for v in variants:
        b = [res[c]['rates'][v]['boundary'] for c in res]
        summ[v] = dict(max_boundary=max(b), mean_boundary=sum(b) / len(b), cells_over_5pct=sum(x > 0.05 for x in b),
                       mean_power=sum(res[c]['rates'][v]['power'] for c in res) / len(res),
                       mean_estimates=sum(res[c]['rates'][v]['estimates'] for c in res) / len(res))
    doc = dict(table=path, reps=reps, draws=N, margin=P['switch']['within'], in_force=inforce, cells=len(res), summary=summ,
               by_cell=dict(sorted(res.items())))
    if arg('--out'): open(arg('--out'), 'w').write(json.dumps(doc, indent=1) + '\n')
    for v, s in summ.items():
        print(f"{v:22s} boundary max {s['max_boundary']:.3f} mean {s['mean_boundary']:.3f} cells>5% {s['cells_over_5pct']:2d} | estimates mean {s['mean_estimates']:.3f} | power mean {s['mean_power']:.3f}")
    if '--annotate' in sys.argv:
        v0 = next(iter(variants))
        for row in T['rows']:
            r = res.get(row['id'])
            row['v3'] = None if not r else dict(rule=inforce, false_pick_boundary=round(r['rates'][v0]['boundary'], 4), false_pick_estimates=round(r['rates'][v0]['estimates'], 4),
                                                power=round(r['rates'][v0]['power'], 4), candidates=r['K'], reps=reps)
        json.dump(T, open(path, 'w'), indent=1, ensure_ascii=False)
        md = path[:-5] + '.md'
        lines = ['', f"**V3: how often the rule picks a route truly worse than the bar by more than the margin** (#7263, v3_sim.py; rule in force: {json.dumps(inforce)}; "
                     f"{reps} replicates a cell at its real book-scaled n and candidate count K). *Boundary*: every candidate truly {P['switch']['within']} + 0.01 below the reference (the least favourable case; pass bar <= 5%). "
                     "*Estimates*: the table's posterior means taken as the truth. *Power*: the cheapest candidate truly equal to the reference, P(it is picked).", '',
                 '| cell | K | false pick at the boundary | false pick at the estimates | power | V3 |', '|---|---|---|---|---|---|']
        for row in T['rows']:
            v = row.get('v3')
            if v: lines.append(f"| {row['id']} | {v['candidates']} | {v['false_pick_boundary']:.1%} | {v['false_pick_estimates']:.1%} | {v['power']:.1%} | {'pass' if v['false_pick_boundary'] <= 0.05 else '**fail**'} |")
        open(md, 'a').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
