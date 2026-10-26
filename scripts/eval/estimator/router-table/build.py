#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/chain/allocate_v2.py — its pages waiting and channel capacity are kept, read from its
# outputs; its decision rule ("cheapest route that matches Opus", else Opus) is what this replaces, because the route-judge
# pilot (#7376) measured routes by acceptance against the image and Opus is the judge there, not the reference. Its
# idle_shares() (the share of an account's week projected unused at the reset) is the idle rule used here.
# ocr/route_ocr_v1.py — CER against a reference panel, not acceptance; used here only as a weak prior. Its --fees file
# (agy_month_usd, claude_usd_per_weekly_point) is the fee file read here.
"""The router table (#6740): one row per cell, Beta-binomial posteriors on acceptance. Stdlib only, no model calls.

  python3 scripts/eval/estimator/router-table/build.py [--pilot <score.json>] [--fees <private fee file>]
      [--weekly <climits json>] [--idle claude=<share>,agy=<share>] [--name <out name>] [--before <an earlier table's .json>]
      [--page-sizes <page-size.mjs output>]   (repo root)

Writes <as_of>.json and .md beside this file (--name: <name>.json/.md). A route's evidence is the pilot cell's route
(`pilot`) plus every entry of its `evidence` list ({score, cell, route[, use: name_check]}), pooled as k of n; `--before`
shows each cell's earlier decision beside the new one. Every parameter is in rules.json.

The pick is ONE unit: expected dollars per ACCEPTED page (Derek, 2026-10-26). A subscription stage costs its Claude
points (or agy calls) per page x the plan's dollars per point (or call); a paid API stage its list dollars per page; a
draft already made costs 0; each divided by the acceptance draw, and the median over draws decides. Fees come from
--fees (the private fee file) when present, else every plan is rules.json fees.default_plan_month_usd. Dollars go to
stdout only: the committed table keeps points, agy calls and quota shares.

Idle quota is free: the share of this week's quota projected to go unused at the reset (climits for Claude; the agy
meter for agy). The tests take it first, then the decided cells in order of value per unit of capacity; a cell's pages
that fit inside what is left cost 0, the rest pay the full price. Each cell gets two decisions: this week (idle free)
and steady state (no idle).
"""
import datetime as dt, json, os, random, sys
D = 'scripts/eval/estimator/router-table/'
q = lambda xs, p: sorted(xs)[int(p * (len(xs) - 1))]
arg = lambda f: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else None


def fee_rates(P, path):
    """(dollars per Claude weekly point, dollars per month of the agy plan), and which source gave them."""
    if path and os.path.exists(path):
        f = json.load(open(path))
        return dict(claude=f['claude_usd_per_weekly_point'], agy_month=f['agy_month_usd']), 'private fee file'
    m = P['fees']['default_plan_month_usd']  # one account-week = 100 points; a month = 52/12 weeks
    return dict(claude=m * 12 / 52 / 100, agy_month=m), 'default plan fee (rules.json fees, the v2 / #7417 convention)'


def units_per_page(st):
    """What a page draws from its channel, in the channel's idle unit: Claude points, agy calls."""
    return st.get('points', 0.0) if st['channel'] == 'claude' else st['draw'] if st['channel'] else 0.0


def usd_per_page(st, rates):
    """Dollars per RAW page. A draft already made costs 0."""
    if st.get('paid'):
        return st['api_usd']
    if st['channel'] == 'claude':
        return st['points'] * rates['claude']
    if st['channel'] == 'agy':
        return st['draw'] * st['agy_share'] * rates['agy_month']
    return 0.0


def page_eq(z, kind, Z):
    """One page's size in output-weighted tokens (input + output_weight x output), median and p90 (Derek, 2026-10-26:
    "10 pages are not the same in all books"). correct: the image + the draft read in, the corrected draft written out.
    translate: the source text read in, the English written out. Text tokens = characters / characters per token:
    Gemini's own count on the cell's pages where >= 30 pages record it, else the language default."""
    g = z['gemini_chars_per_output_token']
    cpt = g['median'] if g['n'] >= Z['min_pages_for_measured_cpt'] else Z['chars_per_token_default'].get(z['language'], Z['chars_per_token_default']['other'])
    out = {}
    for p in ('median', 'p90'):
        t = z['draft_chars'][p] / cpt
        if kind == 'translate':
            out[p] = t + Z['output_weight'] * z['translation_chars'][p] / Z['english_chars_per_token']
        else:
            out[p] = z['image_tokens'][p] + t + Z['output_weight'] * t
    return out


def pages_per_call(st, z, Z):
    """A lane that batches by layout: 10 single-column pages a call, 5 multi-column (Derek, 2026-10-26), mixed by the
    cell's measured multi-column share; batching saves the overhead only. A one-page lane: 1."""
    if st.get('pages_per_call') != 'layout':
        return st.get('pages_per_call', 1)
    s, b = z['multi_column_share'] or 0.0, Z['pages_per_call']
    return 1 / (s / b['multi'] + (1 - s) / b['single'])


def fit_rate(Z, sizes):
    """Claude weekly points per output-weighted token, one value per meter reading. The quota is NOT published per
    token: each value is what one reading implies under this model, and their spread is the range."""
    O = Z['overhead']['in'] + Z['output_weight'] * Z['overhead']['out']
    ks = {}
    for r in Z['readings']:
        if not r.get('used', True):
            continue
        if 'calls' in r:
            ks[r['id']] = r['points'] / r['calls'] / (r['in_per_call'] + Z['output_weight'] * r['out_per_call'])
        else:
            e = page_eq(sizes[r['cell']], r['kind'], Z)['median']
            ks[r['id']] = r['points_per_page'] * r['pages_per_call'] / (O + r['pages_per_call'] * e)
    v = sorted(ks.values())
    kind = lambda r: r.get('kind', 'correct')
    by_kind = {}
    for r in Z['readings']:
        if r['id'] in ks: by_kind.setdefault(kind(r), []).append(ks[r['id']])
    # central per kind of call (the median of that kind's readings); the range spans every reading
    return dict(by_reading=ks, low=v[0], central={k: sorted(x)[len(x) // 2] for k, x in by_kind.items()}, high=v[-1], overhead_eq=O)


def size_points(st, z, Z, K):
    """Points per page = k x (overhead / pages per call + the page's own tokens): central (median page, central k),
    low (median page, lowest k), high (p90 page, highest k)."""
    e, ppc = page_eq(z, st['size'], Z), pages_per_call(st, z, Z)
    f = lambda k, p: k * (K['overhead_eq'] / ppc + e[p])
    return dict(central=f(K['central'][st['size']], 'median'), low=f(K['low'], 'median'), high=f(K['high'], 'p90'), pages_per_call=ppc)


def idle_claude(paths):
    """Claude points projected to go unused at each account's reset at the current pace (allocate_v2.idle_shares),
    from the first meter that reads; accounts whose reset has passed are left out (their new week is unread)."""
    for p in paths:
        try:
            d = json.load(open(p)); t = dt.datetime.fromisoformat(d['as_of']); pts = 0.0
            for a in d['accounts']:
                left = (dt.datetime.fromisoformat(a['resets_at']) - t).total_seconds() / (7 * 86400)
                if left > 0:
                    pts += 100 * max(0.0, 1 - a['weekly_percent'] / 100 / max(1 - left, 1e-3))
            return pts, p, d['as_of']
        except (OSError, KeyError, ValueError, TypeError):
            continue
    return 0.0, None, None


def gate(M, P, wt_max, within):
    """The quality gate: measured routes with P(acc >= acc_best - within) >= switch.p and wrong text <= the bar."""
    best = max(M, key=lambda r: r['mean'])
    ok = [r for r in M if sum(u >= v - within for u, v in zip(r['_d'], best['_d'])) / len(best['_d']) >= P['switch']['p']
          and r['wrong'] / r['n'] <= wt_max(best)]
    return best, ok


def pick(ok, cur, cost):
    """Lowest median dollars per accepted page; a tie (two routes free) goes to the higher acceptance."""
    return min(ok, key=lambda r: (cost(r), -r['mean'])) if ok else cur


def decide(cell, M, cur, P, cost, wt_max, within=None):
    if cell.get('held'): return 'held', cur
    if not M: return 'keep (UNTESTED)', cur
    best = max(M, key=lambda r: r['mean'])
    if not any(r['p80'] >= P['hold']['p'] for r in M): return 'HOLD', best
    p = pick(gate(M, P, wt_max, P['switch']['within'] if within is None else within)[1], cur, cost)
    return ('keep' if p is cur else 'switch'), p


def main():
    P = json.load(open(D + 'rules.json'))
    L = lambda k: json.load(open(arg('--' + k) or P['inputs'][k]))  # --pilot <path> until #7376 is on main
    pilot, v1, v2, cap = L('pilot')['cells'], L('v1')['cells'], {c['id']: c for c in L('v2')['cells']}, L('capacity')['channels']
    free = {ch: c['per_week'] * c['free_share'] for ch, c in cap.items()}           # claude: account-weeks; agy: calls
    rng, N, S = random.Random(P['seed']), P['draws'], P['stages']
    share = lambda st: st['draw'] / free[st['channel']] if st['channel'] else 0.0
    # page size (inbox 2026-10-26 17:21Z / 17:22Z): Claude points per page from the page's tokens, not one flat figure
    Z = P['size_model']; sizes = json.load(open(arg('--page-sizes') or P['inputs']['page_sizes']))['cells']; K = fit_rate(Z, sizes)
    rates, fee_src = fee_rates(P, arg('--fees'))
    # idle: --idle overrides, else the meters. Shares of the WHOLE week's quota, turned into points / calls
    I = P['idle']; ov = dict(kv.split('=') for kv in arg('--idle').split(',')) if arg('--idle') else {}
    week = {'claude': cap['claude']['per_week'] * 100, 'agy': cap['agy']['per_week']}
    if 'claude' in ov: ic, ic_src, ic_at = float(ov['claude']) * week['claude'], '--idle', None
    else: ic, ic_src, ic_at = idle_claude([arg('--weekly')] if arg('--weekly') else I['claude']['meters'])
    ia = float(ov.get('agy', I['agy']['share'])) * week['agy']
    idle = {'claude': dict(share=ic / week['claude'], units=ic, unit='points', meter=ic_src, as_of=ic_at),
            'agy': dict(share=ia / week['agy'], units=ia, unit='calls', meter='--idle' if 'agy' in ov else I['agy']['why'])}

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

    _scores = {}
    def evidence(cell, r):
        """The route's judged pages pooled over the pilot and every `evidence` entry: accept / wrong text / books / classes."""
        xs = [pilot[cell['pilot']]['routes'][r['pilot']]] if r.get('pilot') else []
        for e in r.get('evidence', []):
            sc = _scores.setdefault(e['score'], json.load(open(e['score'])))
            y = dict(sc['cells'][e['cell']]['routes'][e['route']])
            if e.get('use') == 'name_check':  # a page whose accepted text drops a name the image prints is wrong text too
                nc = y['name_check']; y['accept'] = nc['accept_after_name_check']
                w0, n0 = map(int, y['wrong_text_pages'].split('/')); y['wrong_text_pages'] = f"{w0 + nc['with_name_error']}/{n0}"
            xs.append(y)
        if not xs: return None
        kn = lambda f: [sum(int(x[f].split('/')[i]) for x in xs) for i in (0, 1)]
        (k, n), (w, _) = kn('accept'), kn('wrong_text_pages')
        cl = {}
        for x in xs:
            for c, v in x['classes_k_of_n'].items(): cl[c] = cl.get(c, 0) + int(v.split('/')[0])
        return dict(accept=f'{k}/{n}', wrong_text_pages=f'{w}/{n}', books=sum(x['books'] for x in xs), classes_k_of_n={c: f'{v}/{n}' for c, v in cl.items()}, sources=len(xs))

    # wrong-text bar (#7461): relative = at most the best route's rate + wrong_text_max; the other bar is a sensitivity
    rel = P['switch'].get('wrong_text_bar', 'absolute') == 'relative'
    bars = {'absolute': lambda best: P['switch']['wrong_text_max'], 'relative': lambda best: best['wrong'] / best['n'] + P['switch']['wrong_text_max']}
    wt_abs, wt_rel = bars['relative' if rel else 'absolute'], bars['absolute' if rel else 'relative']  # wt_abs = the bar in force
    steady = lambda r: r['_usd_acc']
    rows, ctx = [], {}
    for cell in P['cells']:
        rs = []
        for r in cell['routes']:
            st0 = S[r['stage']]; sp = size_points(st0, sizes[cell['id']], Z, K) if st0.get('size') and cell['id'] in sizes else None
            st = dict(st0, points=sp['central'], draw=sp['central'] / 100) if sp else st0
            a0, b0 = a, b = prior(cell, r); x = evidence(cell, r)
            k = n = w = None; top = []
            if x:
                (k, n), w = map(int, x['accept'].split('/')), int(x['wrong_text_pages'].split('/')[0])
                f = min(1, x['books'] / n) if P['cluster_by_book'] else 1
                a, b = a + k * f, b + (n - k) * f
                top = sorted(x['classes_k_of_n'].items(), key=lambda kv: -int(kv[1].split('/')[0]))[:3]
            dr = [rng.betavariate(a, b) for _ in range(N)]; m = sum(dr) / N; u, u0 = usd_per_page(st, rates), usd_per_page(st0, rates)
            rs.append(dict(id=r['id'], stage=r['stage'], lane=st.get('lane'), points=st.get('points'), points_flat=st0.get('points'),
                           size=None if not sp else {k: round(v, 5) for k, v in sp.items()}, tested=bool(x), prior=[round(a0, 2), round(b0, 2)],
                           k=k, n=n, wrong=w, top=top, mean=m, ci90=[q(dr, .05), q(dr, .95)], var=a * b / ((a + b) ** 2 * (a + b + 1)),
                           p80=sum(v >= P['hold']['acc'] for v in dr) / N, share=share(st), units=units_per_page(st), _d=dr,
                           cost=None if not st['channel'] else [units_per_page(st) / q(dr, p) for p in (.95, .5, .05)],
                           api=None if st['api_usd'] is None else st['api_usd'] / m,
                           _usd_acc=u / q(dr, .5), _usd_ci=[u / q(dr, p) for p in (.95, .05)], _usd_acc_flat=u0 / q(dr, .5)))
        cur = next(r for r in rs if r['id'] == cell['current']); M = [r for r in rs if r['tested']]
        dec, pk = decide(cell, M, cur, P, steady, wt_abs)
        alt = decide(cell, M, cur, P, steady, wt_rel) if M else (dec, pk)
        dflat, pflat = decide(cell, M, cur, P, lambda r: r['_usd_acc_flat'], wt_abs)  # one flat points-per-page figure, for comparison
        # sensitivity: margin 0.10 instead of 0.05. Reported only; the default margin is not changed.
        sens = None
        if dec in ('keep', 'switch'):
            d10, p10 = decide(cell, M, cur, P, steady, wt_abs, within=P['switch']['sensitivity_within'])
            best = max(M, key=lambda r: r['mean'])
            if p10 is pk: sens = 'no change'
            else:
                ratio = steady(pk) / steady(p10) if steady(p10) else float('inf')
                sens = (f"{d10} {p10['id']}: acceptance {p10['mean'] - best['mean']:+.2f} against the best, "
                        f"{'free' if ratio == float('inf') else f'{ratio:.1f}x cheaper'} per accepted page"
                        + (' (the 0.05-0.10 band, >= 5x cheaper)' if 0.05 <= best['mean'] - p10['mean'] <= 0.10
                           and ratio >= P['switch']['sensitivity_cheaper'] else ''))
        pages = cell.get('pages_waiting', v2.get(cell.get('v2'), {}).get('pages_waiting', 0))
        ctx[cell['id']] = (cell, M, cur, pages)
        rows.append(dict(id=cell['id'], title=cell['title'], pages_waiting=pages, current=cur['id'], decision=dec, route=pk['id'],
                         decision_flat_price=f"{dflat} {pflat['id']}",
                         other_wrong_text_bar=None if alt[0] == dec and alt[1] is pk else f"{alt[0]} {alt[1]['id']}",
                         margin_010=sens, weeks_to_clear=pages * pk['share'], v2_weeks=v2.get(cell.get('v2'), {}).get('weeks_to_drain'),
                         test_score=max([pages * r['share'] * r['var'] for r in rs if r['share']] or [0]),
                         caveat=cell.get('caveat') or cell.get('held'), routes=rs))
    for i, r in enumerate(sorted([r for r in rows if r['test_score'] and r['decision'] != 'held'], key=lambda r: -r['test_score'])[:P['test_next']['n']]):
        r['test_next'] = i + 1
    T = P['test_next']; tests = []
    for row in sorted([r for r in rows if r.get('test_next')], key=lambda r: r['test_next']):
        rs = [r for r in row['routes'] if not r['tested']] or [max(row['routes'], key=lambda r: r['share'] * r['var'])]
        pts = T['pages_per_test'] * (len(rs) * T['judge_points_per_output'] + sum(r['points'] or 0 for r in rs))
        agy = T['pages_per_test'] * sum(S[r['stage']]['draw'] for r in rs if r['stage'] == 'agy')
        tests.append(dict(rank=row['test_next'], cell=row['id'], routes=[r['id'] for r in rs], pages=T['pages_per_test'], claude_points=pts, agy_calls=agy,
                          account_week_share=pts / 100 / free['claude'], agy_week_share=agy / free['agy']))

    # THIS WEEK: the tests take the idle quota first, then the decided cells by value per unit of capacity
    # (accepted pages gained over the draft per point or call, the best qualifying route's), as the queue orders them.
    left = {ch: v['units'] for ch, v in idle.items()}
    for t in tests:
        left['claude'] = max(0.0, left['claude'] - t['claude_points']); left['agy'] = max(0.0, left['agy'] - t['agy_calls'])
    idle_after_tests = dict(left)
    def value(row):
        cell, M, cur, pages = ctx[row['id']]
        d0 = next((r['mean'] for r in row['routes'] if r['stage'] == 'none'), 0.0)
        ok = gate(M, P, wt_abs, P['switch']['within'])[1]
        return max([(r['mean'] - d0) / r['units'] for r in ok if r['units']] or [0.0])
    for row in rows:
        row['decision_week'], row['route_week'] = row['decision'], row['route']
    for row in sorted([r for r in rows if r['decision'] in ('keep', 'switch')], key=lambda r: -value(r)):
        cell, M, cur, pages = ctx[row['id']]
        for r in row['routes']:
            ch, need = S[r['stage']]['channel'], pages * r['units']
            r['idle_fit'] = 1.0 if not ch or need <= 0 else min(1.0, left[ch] / need)
        dec, pk = decide(cell, M, cur, P, lambda r: r['_usd_acc'] * (1 - r['idle_fit']), wt_abs)
        row['decision_week'], row['route_week'] = dec, pk['id']
        ch = S[pk['stage']]['channel']
        if ch: left[ch] = max(0.0, left[ch] - pages * pk['units'])

    NAME = arg('--name') or P['as_of']
    before = {r['id']: r for r in json.load(open(arg('--before')))['rows']} if arg('--before') else {}
    fmt = lambda d, rt: d + (f" → {rt}" if d in ('switch', 'HOLD') else '')
    for row in rows:
        b = before.get(row['id']); row['before'] = fmt(b['decision'], b['route']) if b else None
    calib = [(row['id'], r['id'], r['prior'], f"{r['k']}/{r['n']}") for row in rows for r in row['routes'] if r['tested']]
    pub = lambda rs: [{k: v for k, v in r.items() if not k.startswith('_')} for r in rs]  # no dollars in the repo
    json.dump(dict(as_of=P['as_of'], rules=P['inputs'], fees=fee_src, size_rate=K, idle=idle, idle_after_tests=idle_after_tests,
                   rows=[dict(row, routes=pub(row['routes'])) for row in rows], tests=tests, prior_vs_pilot=calib),
              open(D + NAME + '.json', 'w'), indent=1, ensure_ascii=False)

    def cost(r):
        if r['cost'] is None: return '0'
        u = ' pts' if S[r['stage']]['channel'] == 'claude' else ' agy calls'
        z = r['size']
        sz = (f"; {r['points']:.3g} pts a page [{z['low']:.3g}, {z['high']:.3g}] at {z['pages_per_call']:.1f} pages a call (flat {r['points_flat']:g})" if z else '')
        return f"{r['cost'][1]:.3g}{u} [{r['cost'][0]:.3g}, {r['cost'][2]:.3g}]" + sz + (f" / API ${r['api']:.3f}" if r['api'] else '')
    sw, h = P['switch'], P['hold']
    lanes = '; '.join(f"{k}: {v['lane']}" for k, v in S.items() if v['channel'] == 'claude')
    size_txt = (f"**Page size** (inbox 2026-10-26, Derek: \"10 pages are not the same in all books\"; \"maybe 5 when it is multi column\"). A Claude page costs "
                f"k x (overhead / pages per call + the page's own tokens), tokens weighted input + {Z['output_weight']} x output; page sizes per cell from "
                f"`{P['inputs']['page_sizes']}` (draft characters, image tokens by pixel size, multi-column share). Overhead {K['overhead_eq']:,.0f} weighted tokens a call. "
                "k, points per weighted token, from each meter reading: " + '; '.join(f"{i} {v:.2e}" for i, v in K['by_reading'].items())
                + f". Central per kind of call (its own readings): " + ', '.join(f"{k} {v:.2e}" for k, v in K['central'].items()) + f"; range [{K['low']:.2e}, {K['high']:.2e}]. **The Claude weekly quota is not published per token: this is an estimate.** "
                "Pages per call: 10 single-column, 5 multi-column, mixed by the cell's share (neither lane switches on layout today). "
                "The cost column shows the size-based points a page, [lowest k on the median page, highest k on the p90 page], against the flat figure it replaces.")
    meter = (f"{idle['claude']['units']:.1f} Claude points ({idle['claude']['share']:.1%} of the week; {idle['claude']['meter']}"
             + (f", as of {idle['claude']['as_of']}" if idle['claude']['as_of'] else '') + f"), {idle['agy']['units']:,.0f} agy calls ({idle['agy']['meter']})")
    out = [f"# Router table {NAME} (#6740)", '', "Generated by `build.py` from `rules.json`. Acceptance = the Opus judge reading each output against the page image "
           "(route-judge pilot, #7376); Opus is the judge, not the reference. Posterior Beta(a + k, b + n - k), k and n scaled by books / pages; "
           "the v1/v2 prior is worth at most 5 pages. ● = the route the router assigns now (v2's choice; the served route for translation). "
           "Cost is marginal (the draft is already paid): Claude weekly points or agy calls per ACCEPTED page, median [90%]; "
           f"API list = dollars at list price. Opus lanes: {lanes}. "
           f"Weeks to clear = pages waiting x draw per page / the channel's free week ({free['claude']:g} Claude account-weeks, {free['agy']:,.0f} agy calls; v2 capacity), the cell alone on its channel.", '',
           f"Rules: the quality gate keeps measured routes with P(acc >= acc_best - {sw['within']}) >= {sw['p']} and wrong-text pages <= {"the best route's rate + " if rel else ''}{sw['wrong_text_max']:.0%}; "
           "among them the pick is the lowest median **expected dollars per accepted page**, one unit for every channel (points or agy calls x the plan's "
           f"price per point or call, a paid API at list, a made draft 0, / acceptance). Fees: {fee_src}; the dollar figures are not committed. "
           f"**switch** when the pick is not the current route, else **keep**; **HOLD** when no measured route has P(acc >= {h['acc']}) >= {h['p']}; "
           "**test next** ranks cells by pages waiting x share of the channel's week per page x Var(acceptance).", '',
           f"**Two decisions.** *Steady* prices every page in full. *This week* treats idle quota as free: {meter}. "
           f"The tests take it first; what is left after them ({idle_after_tests['claude']:.1f} points, {idle_after_tests['agy']:,.0f} agy calls) goes to the decided cells "
           "in order of accepted pages gained per point or call; a cell's pages inside it cost 0, the rest pay in full. "
           f"*Margin {sw['sensitivity_within']}* is a sensitivity only: what the pick would be if the gate allowed {sw['sensitivity_within']} instead of {sw['within']}.", '', size_txt, '',
           '| cell | pages waiting | current | route | lane | acceptance [90%] | wrong text | top defects | cost per accepted page (full / API list) | weeks to clear | decision |', '|' + '---|' * 11]
    for row in rows:
        for j, r in enumerate(row['routes']):
            acc = (f"**{r['k']}/{r['n']}** → {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]" if r['tested']
                   else f"UNTESTED: prior {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]")
            dw = '' if (row['decision_week'], row['route_week']) == (row['decision'], row['route']) else f"; this week: {row['decision_week']} → {row['route_week']}"
            dec = (row['decision'] + (f" → {row['route']}" if row['decision'] in ('switch', 'HOLD') else '') + dw
                   + (f"; margin {sw['sensitivity_within']}: {row['margin_010']}" if row['margin_010'] else '')
                   + ('' if row['decision_flat_price'] == f"{row['decision']} {row['route']}" else f"; with the flat price: {row['decision_flat_price']}")
                   + (f"; **test next #{row['test_next']}**" if row.get('test_next') else '')
                   + (f" ({'absolute' if rel else 'relative'} wrong-text bar: {row['other_wrong_text_bar']})" if row['other_wrong_text_bar'] else '')
                   + (f"; before: {row['before']}" if row['before'] and row['before'] != fmt(row['decision'], row['route']) else '')) if j == 0 else ''
            out.append(f"| {row['title'] if j == 0 else ''} | {f'{row['pages_waiting']:,}' if j == 0 else ''} | {'●' if r['id'] == row['current'] else ''} | {r['id']} | {r['lane'] or '—'} | {acc} | "
                       f"{f'{r['wrong']}/{r['n']}' if r['tested'] else '—'} | {', '.join(f'{c} {v}' for c, v in r['top']) or '—'} | {cost(r)} | "
                       f"{f'{row['pages_waiting'] * r['share']:.1f}' if r['share'] else '—'} | {dec} |")
        if row['caveat']: out.append(f"| | | | | | *{row['caveat']}* | | | | | |")
    out += ['', '**Test next** (proposals; score = pages waiting x share of the channel\'s free week per page x Var(acceptance)):', '']
    out += [f"{t['rank']}. {t['cell']}: {', '.join(t['routes'])}, {t['pages']} pages each, judged by Opus against the image: {t['claude_points']:.2f} Claude points ({t['account_week_share']:.2%} of the free Claude week)" + (f" + {t['agy_calls']:.0f} agy calls ({t['agy_week_share']:.2%} of agy's)" if t['agy_calls'] else '') for t in tests]
    out += ['', '**Prior against the pilot** (prior mean, worth a + b pages → what the judge accepted):', '']
    out += [f"- {c} / {r}: {a / (a + b):.2f} ({a + b:.0f} pages) → {kn}" for c, r, (a, b), kn in calib]
    open(D + NAME + '.md', 'w').write('\n'.join(out) + '\n')
    # PRIVATE: dollars, stdout only (paste into the issue comment, never into the repo)
    print(f"# dollars per 1K accepted pages, steady [90%] / this week — fees: {fee_src}")
    for row in rows:
        for r in row['routes']:
            if r['cost'] or S[r['stage']].get('paid'):
                print(row['id'], r['id'], f"flat ${r['_usd_acc_flat'] * 1000:.2f} -> size ${r['_usd_acc'] * 1000:.2f} [{r['_usd_ci'][0] * 1000:.2f}, {r['_usd_ci'][1] * 1000:.2f}]",
                      f"/ week ${r['_usd_acc'] * (1 - r.get('idle_fit', 0)) * 1000:.2f}")
    print('\n'.join(out))


if __name__ == '__main__':
    main()
