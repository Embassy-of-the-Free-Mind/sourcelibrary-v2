#!/usr/bin/env python3
# PRIOR ART: the #7263 audit of 2026-11-01 simulated the gate at n = 30 a route by hand (a route at the margin passes
# ~15%, one of 6 ~49%) and committed nothing; test_pick.py pins single picks, not error rates. This runs build.py's own
# decide() / gate() (imported, not re-implemented) at each cell's real n and route count.
"""V3 (#7263): how often does the router's decision rule pick a route that is truly worse than the bar by more than the
margin? Stdlib only, no model calls, no DB.

  python3 scripts/eval/estimator/router-table/v3_sim.py <table.json> [--reps 1000] [--draws 2000] [--procs 8]
      [--variants all|in_force] [--out <file.json>] [--annotate]          (repo root)

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
        if cls(row['decision']) in ('held', 'planned', 'UNTESTED') or cls(row['decision_kn']) in ('held', 'planned'): continue
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
                dec, pk = B.decide({}, M, cur, Pv, cost, WT)
                o = res[v][conf]
                if dec == 'HOLD': o['hold'] += 1; continue
                ok = B.gate(M, Pv, WT, W)[1]
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


def main():
    path = next(a for a in sys.argv[1:] if a.endswith('.json') and a != arg('--out'))
    T = json.load(open(path)); P = json.load(open(B.D + 'rules.json'))
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
