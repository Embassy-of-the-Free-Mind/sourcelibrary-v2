#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/chain/allocate_v2.py — its pages waiting and channel capacity are kept, read from its
# outputs; its decision rule ("cheapest route that matches Opus", else Opus) is what this replaces, because the route-judge
# pilot (#7376) measured routes by acceptance against the image and Opus is the judge there, not the reference. Its
# idle_shares() (the share of an account's week projected unused at the reset) is the idle rule used here.
# ocr/route_ocr_v1.py — CER against a reference panel, not acceptance; used here only as a weak prior. Its --fees file
# (agy_month_usd, claude_usd_per_weekly_point) is the fee file read here.
"""The router table (#6740): one row per cell, Beta-binomial posteriors on acceptance. Stdlib only, no model calls.

  python3 scripts/eval/estimator/router-table/build.py [--pilot <score.json>] [--fees <private fee file>]
      [--name <out name>] [--before <an earlier table's .json>] [--page-sizes <page-size.mjs output>]   (repo root)

THE DECISION (#8283, Derek 2026-11-06: one rule): decide_defects, severity-weighted defects per 1,000 words against the
live route, from defect-rates.json (scripts/eval/route-evidence.mjs: every judged page of a lane, a test or a QA draw that
can be tied to the text it judged). k/n acceptance is only the floor under it. Around it stay the hard floor, the menu,
menu_default and the judge-validity gate. What other rules would have done is decision_diff.py's job, not the table's.

Writes <as_of>.json and .md beside this file (--name: <name>.json/.md). A route's evidence is the pilot cell's route
(`pilot`) plus every entry of its `evidence` list ({score, cell, route[, use: name_check]}), pooled as k of n (the posterior and the wrong-text gate scale each source by its books / pages); a route listed with no entry takes the k/n of its defect verdicts. `--before`
shows each cell's earlier decision beside the new one. Every parameter is in rules.json.
A '-written' route (the pages the route wrote; a refused page stays scans-only) is scored over the pages DRAWN (#8111):
each of its evidence entries carries `written_of_drawn` ('written/drawn' in that test) and its judged pages scale by
drawn / written, refusals not accepted; an entry without one is refused (over_drawn).

VALIDATION (#7263; .claude/docs/router-optimization-paper.md). V1: the prior mean of every route is the partially pooled
logit of #7878 (rules.json prior.pooled; pooled_prior.py writes the means). V2: in a stratum where the judge prefers its
own family's text (rules.json judge_validity), an Opus-written route cannot win keep or switch on it alone (judge_gate).
BINDING (#8283): every row carries `bound_route`, what the cell runs, by bind(). --off v1,v2,hard-floor,menu turns a step off for attribution builds (decision_diff.py); --out-dir writes them outside the repo.

A route's price: a subscription stage costs its Claude points (or agy calls) per page x the plan's dollars per point (or
call); a paid API stage its list dollars per page; a draft already made costs 0. Fees come from --fees (the private fee
file) when present, else every plan is rules.json fees.default_plan_month_usd. Dollars go to stdout only: the committed
table keeps points, agy calls and quota shares.
"""
import json, math, os, random, re, sys
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
    if st.get('paid'):   # a paid stage with no list price (api_usd None) is unpriced: it can never be the cheapest
        return float('inf') if st.get('api_usd') is None else st['api_usd']
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


def is_bar(r, P):
    """switch.bar = opus (Derek, 2026-10-28 11:24Z): a Claude route is the bar to match, never a candidate. A route built
    by main() carries _bar: in a MANUSCRIPT cell Opus is a candidate (switch.bar_scope = print, Derek 2026-10-28 12:06Z)."""
    if '_bar' in r: return r['_bar']
    return P['switch'].get('bar') == 'opus' and r.get('channel') == 'claude'


def pool_sources(xs, cluster, inv_classes=()):
    """A route's judged pages pooled over its sources (each {accept: 'k/n', wrong_text_pages, books, classes_k_of_n
    [, _group, _w, judge_planted]}): accept / wrong text / books / classes, and eff = the book-scaled (accepted, judged,
    wrong-text) pages the posterior sees. None when nothing was judged. inv / inv_eff: pages with a class in
    inv_classes (rules.json hard_floor: invented or wrong-leaf text), raw and book-scaled; a page with two such classes
    counts twice, capped at the source's n, so the count is an upper bound."""
    # a source with no judged pages (n = 0) carries nothing and would divide by zero in the book scaling below
    xs = [x for x in xs if int(x['accept'].split('/')[1]) > 0]
    if not xs: return None
    kn = lambda f: [sum(int(x[f].split('/')[i]) for x in xs) for i in (0, 1)]
    (k, n), (w, _) = kn('accept'), kn('wrong_text_pages')
    cl = {}
    for x in xs:
        for c, v in x['classes_k_of_n'].items(): cl[c] = cl.get(c, 0) + int(v.split('/')[0])
    # book clustering per source (#7263 backfill): a source with 25 pages a book counts its books, and does not
    # outweigh a one-page-a-book source pooled with it. Accepted, judged and wrong-text pages are all scaled so; equal
    # to the pooled scaling (and to wrong / n) when a route has one source.
    # book group (#7263 backfill-all): sources drawn from the SAME books (the pilot's 30 Latin pages are 30 of #5924's
    # 250) are scaled together, by the group's books / its pages, so no book is counted twice. weight: an entry measured
    # under another prompt or model than the route's pages (rules.json evidence_rules) counts at that share of its books.
    nn = lambda x: int(x['accept'].split('/')[1])
    grp = {}
    for x in xs:
        if x.get('_group'): g = grp.setdefault(x['_group'], [0, 0]); g[0] = max(g[0], x['books']); g[1] += nn(x)
    f = lambda x: (min(1, grp[x['_group']][0] / grp[x['_group']][1]) if x.get('_group') else min(1, x['books'] / nn(x))) * x.get('_w', 1) if cluster else x.get('_w', 1)
    eff = [sum(int(x[fl].split('/')[i]) * f(x) for x in xs) for fl, i in (('accept', 0), ('accept', 1), ('wrong_text_pages', 0))]
    if eff[1] <= 0: return None   # no books behind the pages (books 0, or weight 0): nothing to pool
    # the judge's planted-error catch rate (#7611), from any source that measured it (lane-judge-sampler's planted controls)
    jp = [x['judge_planted'] for x in xs if x.get('judge_planted')]
    inv_x = lambda x: min(nn(x), sum(int(v.split('/')[0]) for c, v in x['classes_k_of_n'].items() if c in inv_classes))
    inv = sum(inv_x(x) for x in xs)
    return dict(accept=f'{k}/{n}', wrong_text_pages=f'{w}/{n}', books=sum(x['books'] for x in xs if not x.get('_group')) + sum(g[0] for g in grp.values()), classes_k_of_n={c: f'{v}/{n}' for c, v in cl.items()}, sources=len(xs), eff=eff,
                judge_planted=jp[0] if len(jp) == 1 else None, inv=f'{inv}/{n}', inv_eff=sum(inv_x(x) * f(x) for x in xs))


UNSPLIT = set()  # evidence sources with no by-script file (expand_by_script): they enter /unknown only
NO_SHARE = set()  # '-written' evidence with no written_of_drawn (#8111): refused, never pooled


def over_drawn(y, wd):
    """A '-written' source scored over the pages DRAWN (#8111; router paper "Failures count"). Its k/n counts only the
    pages the route wrote; wd = 'written/drawn' in the test it came from. A page the route refused is not accepted and
    not wrong text (it stays scans-only), so the judged pages scale by drawn / written: n, wrong-text and books (one
    page a book) grow, k does not. A by-script cut takes the unsplit test's share. Exact where the cut is the test."""
    w, dn = map(int, wd.split('/'))
    n = int(y['accept'].split('/')[1])
    if w <= 0: return dict(y, accept=f"0/{dn}", wrong_text_pages=f"0/{dn}", books=dn, classes_k_of_n={}, written_of_drawn=wd)
    if n <= 0: return y
    s = dn / w; nt = round(n * s)
    rescale = lambda v: f"{v.split('/')[0]}/{nt}"
    return dict(y, accept=rescale(y['accept']), wrong_text_pages=rescale(y['wrong_text_pages']), books=max(y['books'], round(y['books'] * s)),
                classes_k_of_n={c: rescale(v) for c, v in y['classes_k_of_n'].items()}, written_of_drawn=wd)


def expand_by_script(P):
    """Each cell becomes one cell per script type (Derek, inbox 2026-10-28 11:54Z: print vs manuscript): `<id>/print`,
    `<id>/manuscript`, `<id>/unknown`. A variant's evidence is the same sources cut to its pages' script type (the
    by-script score files, split_evidence.py); its pages waiting are the cell's times the share waiting-split.mjs
    measured; a manuscript variant takes no v1/v2 prior (those models were fitted on print) and no pilot shortcut. A
    variant with neither evidence nor pages waiting is dropped. `planned` names a route the router takes as decided."""
    X = P['script_split']; W = json.load(open(X['waiting']))['cells']
    v2 = {c['id']: c for c in json.load(open(P['inputs']['v2']))['cells']}
    bs = lambda f: X['evidence_dir'] + (os.path.basename(os.path.dirname(f)) + '--score.json' if os.path.basename(f) == 'score.json' else os.path.basename(f))
    files = {}
    has = lambda f, c, r: r in files.setdefault(f, json.load(open(f)) if os.path.exists(f) else {'cells': {}})['cells'].get(c, {}).get('routes', {})
    out = []
    for cell in P['cells']:
        pw = cell.get('pages_waiting', v2.get(cell.get('v2'), {}).get('pages_waiting', 0)) or 0
        for s in X['scripts']:
            # a cell may carry its own measured split (`script_share`, #7263 eu cells) where waiting-split.mjs never ran
            share = (cell.get('script_share') or W.get(cell['id'], {}).get('share') or {}).get(s)
            routes = []
            for r in cell['routes']:
                ev = ([dict(score=bs(P['inputs']['pilot']), cell=f"{cell['pilot']}|{s}", route=r['pilot'], **({'book_group': cell['pilot_book_group']} if cell.get('pilot_book_group') else {}))] if r.get('pilot') else []) \
                    + [dict(e, score=bs(e['score']), cell=f"{e['cell']}|{s}") for e in r.get('evidence', [])]
                # A source never split by script type (no by-script file: e.g. lane-judge-sampler.score.json, added by its
                # nightly rebuild) enters the UNKNOWN variant whole, never print or manuscript, and is named in the table.
                ev = [e for e in ev if has(e['score'], e['cell'], e['route'])]
                for e0 in r.get('evidence', []):
                    if not os.path.exists(bs(e0['score'])):
                        UNSPLIT.add(e0['score'])
                        if s == 'unknown': ev.append(e0)
                r2 = {k: v for k, v in r.items() if k not in ('pilot', 'evidence') and not (s == 'manuscript' and k == 'v2')}
                routes.append(dict(r2, evidence=ev))
            pl = X.get('planned', {}).get(f"{cell['id']}/{s}")
            if pl and not any(r['id'] == pl['route'] for r in routes): routes.append(dict(id=pl['route'], stage=pl['stage'], evidence=[]))
            pages = round(pw * share) if share else 0
            if not any(r['evidence'] for r in routes) and not pages: continue
            c2 = {k: v for k, v in cell.items() if k not in ('pilot', 'pilot_book_group', 'routes', 'pages_waiting', 'paired', 'script_share') and not (s == 'manuscript' and k == 'v1')}
            # paired evidence (#7701): the same score cut to this script type, where its by-script file holds that pair
            pr = [dict(pe, score=bs(pe['score']), cell=f"{pe['cell']}|{s}") for pe in cell.get('paired', [])]
            pr = [pe for pe in pr if os.path.exists(pe['score']) and pe['pair'] in files.setdefault(pe['score'], json.load(open(pe['score'])))['cells'].get(pe['cell'], {}).get('paired', {})]
            if pr: c2['paired'] = pr
            out.append(dict(c2, id=f"{cell['id']}/{s}", base=cell['id'], script=s, title=f"{cell['title']} [{s}]", routes=routes, pages_waiting=pages,
                            pages_waiting_share=share, **({'planned': pl} if pl else {})))
    return out


def paired_draws(c, N, rng, scale=1.0):
    """PAIRED evidence (#7701): two routes judged on the SAME pages. c = {both, a_only, b_only, neither} accepted-page
    counts; Dirichlet(1 + scale x counts) over the four outcomes; returns N draws of acc_a - acc_b = p(a_only) - p(b_only).
    Two arms that share pages share the page's difficulty, so their difference is far tighter than two independent
    Beta posteriors say: #7701's German read@4 and read@4>correct had identical k/n (23/24) and the independent gate
    still refused the cheaper one at 0.08."""
    al = [1 + scale * c[k] for k in ('both', 'a_only', 'b_only', 'neither')]
    out = []
    for _ in range(N):
        g = [rng.gammavariate(a, 1) for a in al]; s = sum(g)
        out.append((g[1] - g[2]) / s)
    return out


def within_p(r, best, within):
    """P(acc_r >= acc_best - within): from the paired draws when r and best were judged on the same pages, else from
    their two independent posteriors (the rule before #7701)."""
    pd = r.get('_pd', {}).get(best['id'])
    if pd is not None: return sum(d >= -within for d in pd) / len(pd)
    return sum(u >= v - within for u, v in zip(r['_d'], best['_d'])) / len(best['_d'])


def in_force(P, k):
    return bool((P.get(k) or {}).get('in_force'))


def hard_floor_block(r, P, seed):
    """The hard floor (rules.json hard_floor, Derek 2026-11-02, #7263 rule 2): (blocked, P(rate > hard_floor.rate)). The
    rate is the route's invented-or-wrong-leaf pages, book-scaled like acceptance, under Beta(prior + pages). A route
    with fewer than min_pages such pages (raw) is never blocked: an unmeasured rate directs a test, it does not block."""
    H = P.get('hard_floor') or {}
    if not H or r.get('inv') is None: return False, None
    k_raw = int(r['inv'].split('/')[0]); a0, b0 = H['prior']; ke, ne = r['inv_eff'], r['eff'][1]
    rng = random.Random(seed)
    pr = sum(rng.betavariate(a0 + ke, b0 + max(ne - ke, 0)) > H['rate'] for _ in range(H['draws'])) / H['draws']
    return k_raw >= H['min_pages'] and pr >= H['p'], round(pr, 3)


def floor_ok(r, P):
    """A route the hard floor does not block (always, with hard_floor off)."""
    return not in_force(P, 'hard_floor') or not r.get('hard_floor_block')


def on_menu(r, P):
    """Derek 2026-11-06 (#8283): a route is agy or Opus, alone or over a draft (a stored read, or a GPU draft). rules.json
    menu.off_menu_stages names the stages that are not (Sonnet, a new flash-lite translation); they are never picked."""
    return not in_force(P, 'menu') or r.get('stage') not in P['menu']['off_menu_stages']


def menu_default(cell, fdec, M, rs, P, failed=()):
    """No default to the status quo (rules.json menu.default, #8283: "an untested cell gets agy, never the incumbent").
    Only a cell the evidence has not decided: UNTESTED, too few pages, or nothing rated to compare or passing. It takes
    the plainest agy route: measured first, then fewest stages, then posterior mean, and a measured one must pass the k/n floor
    against the best measured route, and a route the rule just failed (`failed`) is not a default. Held, planned, hard-floor, judge-gate and rated decisions are untouched. (decision,
    route) or None."""
    if not in_force(P, 'menu') or cell.get('held') or cell.get('planned'): return None
    if not ('UNTESTED' in fdec or 'pages a route' in fdec or 'no defect verdicts' in fdec or 'no rated route passes' in fdec): return None
    d = agy_default(cell, M, rs, P, failed)
    if not d: return None
    ev = 'measured here' if d in M else 'too few pages here' if d.get('tested') else 'unmeasured here'
    return f"{'keep' if d['id'] == cell['current'] else 'switch'} (default: agy, {ev}; was {fdec.split(' (')[0].replace('UNTESTED', 'untested')})", d   # the default decided it: readers match /UNTESTED/ as undecided


def agy_default(cell, M, rs, P, failed=()):
    """The plainest agy route the cell may take: measured first, then fewest stages, then posterior mean. On the menu, clear
    of the hard floor, not a route the rule just failed; a measured one passes the k/n floor against the best measured route."""
    A, best = P['decision_rule']['accept_floor'], max(M, key=lambda r: r['mean'], default=None)
    near = lambda r: r not in M or r is best or within_p(r, best, A['within']) >= A['p']
    cand = [r for r in rs if r.get('channel') == 'agy' and on_menu(r, P) and floor_ok(r, P) and near(r) and r['id'] not in failed]
    return min(cand, key=lambda r: (r not in M, r['id'].count('>') + r['id'].count('+'), -r['mean'])) if cand else None


def bind(cell, fdec, fpk, live_id, M, rs, P, failed=()):
    """What the cell runs (#8283; Derek took the default, 2026-11-07): (bound route, why). A keep or switch binds its route. A HOLD
    or UNTESTED cell keeps its live route only if that route is on the menu and clears the hard floor; otherwise it takes
    agy_default. menu.keep_live names a cell that keeps its live route whatever the rule says. A held cell or a plain `planned`
    binds nothing: a person owns it, and None makes the routers fall to their default."""
    if cell.get('held') or (cell.get('planned') and not cell['planned'].get('decision')): return None, 'held or planned: a person owns it'
    if cell['id'] in P.get('menu', {}).get('keep_live', {}): return live_id, 'menu.keep_live'
    if fdec.startswith(('keep', 'switch')) and 'UNTESTED' not in fdec: return fpk['id'], 'decided'
    live = next((r for r in rs if r['id'] == live_id), None)
    if live and on_menu(live, P) and floor_ok(live, P): return live_id, 'undecided: the live route is on the menu and clears the floor'
    d = agy_default(cell, M, rs, P, failed)
    return (d['id'], 'undecided: the live route is off the menu or blocked, the plainest agy route') if d else (None, 'undecided: no live route or agy route may run')


def judge_stratum(cell):
    """The judge-calibration stratum of a cell (#7880): task (ocr / translate) / script type."""
    base = cell.get('base') or cell['id'].split('/')[0]
    return f"{'translate' if re.search(r'-tr(-|$)', base) else 'ocr'}/{cell.get('script') or 'print'}"


def judge_gate(cell, dec, pk, P, S):
    """V2 (#7263, #7880): where the judge fails its self-preference check (rules.json judge_validity: the stratum's DBG
    interval excludes 0), a route whose text the judge's own model family wrote cannot win keep or switch on that judge
    alone. It becomes HOLD unless a judge of another family agrees (judge_validity.second_judges: that judge's k/n on the
    route clears the hold bar, P(acc >= hold.acc) >= hold.p). Returns (decision, info); info None where nothing applies."""
    JV = P.get('judge_validity')
    if not JV or not JV.get('in_force'): return dec, None
    key = judge_stratum(cell); st = JV['strata'].get(key) or {}
    valid = st.get('self_preference_valid')
    info = dict(stratum=key, self_preference_valid=valid, dbg=st.get('dbg'))
    won = dec.startswith(('keep', 'switch')) and 'UNTESTED' not in dec
    if not (won and valid is False and S[pk['stage']]['channel'] == JV['judge_family']): return dec, info
    for e in JV.get('second_judges', []):
        if e['cell'] == cell['id'] and e['route'] == pk['id'] and e['family'] != JV['judge_family']:
            k, n = map(int, e['accept'].split('/')); rng = random.Random(f"{cell['id']}:{pk['id']}:{e['judge']}")
            pa = sum(rng.betavariate(1 + k, 1 + n - k) >= P['hold']['acc'] for _ in range(4000)) / 4000
            if pa >= P['hold']['p']:
                return dec, dict(info, second_judge=dict(judge=e['judge'], accept=e['accept'], p_hold=round(pa, 3), agrees=True))
            info = dict(info, second_judge=dict(judge=e['judge'], accept=e['accept'], p_hold=round(pa, 3), agrees=False))
    return 'HOLD (judge not valid: self-preference)', dict(info, held=f"{dec.split(' (')[0]} {pk['id']}")


def p_rate_le(g, x, seed, n=4000):
    """P(lambda <= x) under the gamma posterior g = [a, b] (rate per 1,000 words)."""
    rng = random.Random(seed)
    return sum(rng.gammavariate(g[0], 1 / g[1]) <= x for _ in range(n)) / n


def decide_defects(cell, rs, M, cur, live_id, P, cal):
    """The one rule (#8283; rules.json decision_rule; #7824's S1). rs: the cell's routes, each with `defects`
    (defect-rates.json fields or None) and `_usd_raw` (dollars per raw page); M: its measured on-menu routes.
    Rated = measured, with verdicts from >= min_books books, not blocked by the hard floor. Opus on print stays a bar, not a
    candidate, unless it is live or nothing else is rated. The bar is the live route when it is rated; an unrated or
    blocked live route has no privilege, and the best rated route is the bar. Gate 1: wrong text no more than the bar's +
    delta (no text served: under the ceiling). Gate 2, the k/n floor: acceptance not below the live route's, or the best
    measured route's (no text served: the hold bar). Pick: lowest price per raw page + weight x defects per page; a pick
    that moves across the weight's range is HOLD. (decision, route, info); decision None = nothing to compare, info['why']."""
    R, cm, cw = P['decision_rule'], cal.get('misleads', 1.0), cal.get('wrong_text', 1.0)
    rated = [r for r in M if r.get('defects') and r['defects']['books'] >= R['min_books']]
    pool = [r for r in rated if floor_ok(r, P)]
    live, no_text = next((r for r in rs if r['id'] == live_id), None), live_id == 'scans-only'
    # Opus only where agy fails the hard floor (#8283 plan): every agy route on the menu blocked, tested or not
    agy_left = any(r.get('channel') == 'agy' and on_menu(r, P) and floor_ok(r, P) for r in rs)
    cand = [r for r in pool if not is_bar(r, P) or r is live or not agy_left]
    if rated and not pool:
        clear = [r for r in M if floor_ok(r, P)]
        return f"HOLD (hard floor: no {'rated' if clear else 'measured'} route clears it)", max(clear or rated, key=lambda r: r['mean']), dict(why='every rated route is blocked', rated=[r['id'] for r in rated])
    if live in rated and live not in pool and not any(r.get('channel') == 'agy' for r in M) and len(cand) <= 1:
        # the live route fails the floor and agy was never measured here: an open test (#8283 plan, question 2), not a default
        b = (cand or pool)[0]
        return f"HOLD (hard floor: only {b['id']} clears it)", b, dict(why=f"the live {live_id} is blocked; agy is unmeasured", rated=[r['id'] for r in rated])
    if not cand: return None, None, dict(why="only Opus is rated, and agy clears the floor" if pool else f"no route with verdicts from {R['min_books']} books")
    if not no_text and len(cand) == 1 and cand[0].get('channel') != 'agy':
        return None, None, dict(why=f"only {cand[0]['id']} is rated: compared with nothing")
    mean = lambda r, s: r['defects'][f'{s}_per_1k_posterior'][1]
    bar = live if live in cand else min(cand, key=lambda r: (mean(r, 'wrong_text'), -r['mean']))
    ref = live if live in M else max(M, key=lambda r: r['mean'])
    W = sorted(r['defects']['median_words_per_page'] for r in cand)[len(cand) // 2]
    gates = {}
    for r in cand:
        if no_text:   # nothing served now: an absolute ceiling, and the hold bar for acceptance
            pw = p_rate_le(r['defects']['wrong_text_per_1k_gamma'], R['ceiling_per_1k'] / cw, f"{cell['id']}:{r['id']}")
            gates[r['id']] = dict(wrong_text=pw >= R['ceiling_p'], p_wrong_text_below_ceiling=round(pw, 3), accept=r['p80'] >= P['hold']['p'])
        else:
            pa = 1.0 if r is ref else within_p(r, ref, R['accept_floor']['within'])
            gates[r['id']] = dict(wrong_text=cw * mean(r, 'wrong_text') <= cw * mean(bar, 'wrong_text') + R['wrong_text_delta_per_1k'], accept=pa >= R['accept_floor']['p'], p_accept_floor=round(pa, 3))
    ok = [r for r in cand if gates[r['id']]['wrong_text'] and gates[r['id']]['accept']]
    err = {r['id']: W / 1000 * (cm * mean(r, 'misleads') + R['wrong_text_weight'] * cw * mean(r, 'wrong_text')) for r in cand}
    cost = lambda r, wm: r['_usd_raw'] + wm * err[r['id']]
    wms = sorted({R['misleads_usd'], *R['misleads_usd_sensitivity']})
    picks = {wm: (min(ok, key=lambda r: (cost(r, wm), -r['mean'])) if ok else None) for wm in wms}
    pk = picks[R['misleads_usd']]
    info = dict(bar=bar['id'] + (' (no text served: ceiling)' if no_text else '' if bar is live else f' (the live {live_id} is not rated)'), words_per_page=W, gates=gates,
                defects_per_page={k: round(v, 4) for k, v in err.items()}, picks={str(wm): r and r['id'] for wm, r in picks.items()}, passing=[r['id'] for r in ok])
    if not pk:
        if no_text: return 'keep' if live is cur else 'switch', live, info
        return 'HOLD (defects: no rated route passes)', bar, info
    if pk is not live and len({r['id'] for r in picks.values()}) > 1:   # a switch only when every weight agrees
        return 'HOLD (defects: the pick moves with the misleads weight, ' + ', '.join(f"${wm:g} → {r['id']}" for wm, r in picks.items()) + ')', pk, info
    return 'keep' if pk is cur else 'switch', pk, info


def decide(cell, rs, M, cur, live_id, P, cal):
    """The cell's decision: held, a person's planned one, too little evidence, or the one rule. (decision, route, info)."""
    dec, pk, info = decide_defects(cell, rs, M, cur, live_id, P, cal)
    if cell.get('planned'):
        # planned.decision (#7263): a person's decision that binds like a rule's; plain `planned` only names the route
        return cell['planned'].get('decision', 'planned'), next(r for r in rs if r['id'] == cell['planned']['route']), info
    if cell.get('held'): return 'held', cur, None
    if not M:
        # Derek 11:54Z: too little manuscript or unknown-script evidence says so, never inherits print numbers
        if cell.get('script') in ('manuscript', 'unknown'):
            return (f"HOLD ({cell['script']}: < {P['script_split']['min_manuscript_pages']} pages a route)" if any(r['tested'] for r in rs) else f"UNTESTED ({cell['script']})"), cur, info
        return 'keep (UNTESTED)', cur, info
    if dec: return dec, pk, info
    clear = [r for r in M if floor_ok(r, P)]
    return f"HOLD (no defect verdicts: {info['why']})", max([r for r in clear if not is_bar(r, P)] or clear or M, key=lambda r: r['mean']), info


def main():
    P = json.load(open(D + 'rules.json'))
    # --off v1,v2,hard-floor,menu: the attribution builds of #7263 (which change moved a decision); never the committed table
    OFF = set((arg('--off') or '').split(',')) - {''}
    if 'v1' in OFF: sys.argv.append('--legacy-prior')
    for name, k in (('v2', 'judge_validity'), ('hard-floor', 'hard_floor'), ('menu', 'menu')):
        if name in OFF and P.get(k): P[k]['in_force'] = False
    DRF = json.load(open(P['inputs']['defect_rates']))
    DR, CAL = DRF['cells'], DRF['recheck']
    # the bar of the defect rule is the LIVE route: what the table current.json names runs now in each cell
    CUR = json.load(open(D + 'current.json'))
    LIVE_T = json.load(open(D + CUR['table'] + '.json'))
    # current.json `cells` (#7853): a cell moved to a newer build alone takes its live row from that build
    live_rows = {r['id']: r for r in LIVE_T['rows']}
    for cid, c in CUR.get('cells', {}).items():
        if not c['table']: live_rows.pop(cid, None); continue   # a new cell not bound yet (planBind)
        live_rows[cid] = next(r for r in json.load(open(D + c['table'] + '.json'))['rows'] if r['id'] == cid)
    # a build with bound_route says what the cell runs; an older one says it by switch or current; nothing bound: the current route
    LIVE = {r['id']: r.get('bound_route') or (r['route'] if r['decision'].startswith('switch') else r['current']) for r in live_rows.values()}
    if P.get('script_split', {}).get('on') and '--no-script-split' not in sys.argv: P['cells'] = expand_by_script(P)
    L = lambda k: json.load(open(arg('--' + k) or P['inputs'][k]))  # --pilot <path> until #7376 is on main
    pilot, v1, v2, cap = L('pilot')['cells'], L('v1')['cells'], {c['id']: c for c in L('v2')['cells']}, L('capacity')['channels']
    free = {ch: c['per_week'] * c['free_share'] for ch, c in cap.items()}           # claude: account-weeks; agy: calls
    rng, N, S = random.Random(P['seed']), P['draws'], P['stages']
    share = lambda st: st['draw'] / free[st['channel']] if st['channel'] else 0.0
    # page size (inbox 2026-10-26 17:21Z / 17:22Z): Claude points per page from the page's tokens, not one flat figure
    Z = P['size_model']; sizes = json.load(open(arg('--page-sizes') or P['inputs']['page_sizes']))['cells']; K = fit_rate(Z, sizes)
    rates, fee_src = fee_rates(P, arg('--fees'))
    # V1 (#7263, #7878): the prior mean of every route from the partially pooled logit (pooled_prior.py, leave one base
    # out), worth prior.pooled.pages; the v1/v2 prior below stays as the sensitivity ('the other prior')
    PP = P['prior'].get('pooled') if '--legacy-prior' not in sys.argv else None
    PPM = json.load(open(P['inputs']['pooled_prior']))['means'] if PP and PP.get('in_force') else None
    pp_missing = []
    def prior(cell, r):
        """(the prior in force, the other one: a sensitivity), each (a, b)."""
        leg, other = prior_v1v2(cell, r)
        if PPM is None: return leg, other
        m = PPM.get(cell['id'], {}).get(r['id'])
        pbp[cell['id'], r['id']] = m
        if m is None:
            pp_missing.append(f"{cell['id']} / {r['id']}"); return P['prior']['flat'], leg
        mc = min(max(m, P['prior']['clip'][0]), P['prior']['clip'][1])
        return [mc * PP['pages'], (1 - mc) * PP['pages']], leg

    pb, pbp = {}, {}  # (cell, route) -> the v1/v2 model mean and basis (for fit_prior.py); the pooled mean
    def prior_v1v2(cell, r):  # (a, b), a + b = rules.json prior.pages_measured / pages_pooled, or flat
        d = next((x for c in v1 if cell.get('v1') and [c['chart'], c['fame']] == cell['v1'][:2]
                  for x in c['routes'] if x['engine'] == cell['v1'][2]), None)
        g = next((x for x in v2[cell['v2']]['routes'] if x['corrector'] == r.get('v2')), None) if cell.get('v2') else None
        if r['stage'] == 'none': m, meas = (d['p_floors'], d['basis'] == 'measured') if d else (None, False)
        elif g: b0 = d['p_floors'] if d else 0.5; m, meas = b0 + (1 - b0) * max(0, g['gain'][1]), bool(d) and d['basis'] == 'measured' and g['measured']
        else: m = None
        pb[cell['id'], r['id']] = (m, 'flat' if m is None else 'measured' if meas else 'pooled')
        if m is None: return P['prior']['flat'], P['prior']['flat']
        w, mc = P['prior']['pages_measured' if meas else 'pages_pooled'], min(max(m, P['prior']['clip'][0]), P['prior']['clip'][1])
        unc = [mc * w, (1 - mc) * w]
        C = P['prior'].get('calibration')  # (#7263 router-next) logistic(alpha + beta x logit m), worth C['pages']
        if not C: return unc, unc
        cm = min(max(1 / (1 + math.exp(-(C['alpha'] + C['beta'] * math.log(mc / (1 - mc))))), P['prior']['clip'][0]), P['prior']['clip'][1])
        cal = [cm * C['pages'], (1 - cm) * C['pages']]
        return (cal, unc) if C['in_force'] else (unc, cal)  # (the prior in force, the other one: a sensitivity)

    _scores = {}
    def evidence(cell, r):
        """The route's judged pages pooled over the pilot and every `evidence` entry: accept / wrong text / books / classes."""
        xs = [dict(pilot[cell['pilot']]['routes'][r['pilot']], _group=cell.get('pilot_book_group'))] if r.get('pilot') else []
        for e in r.get('evidence', []):
            sc = _scores.setdefault(e['score'], json.load(open(e['score'])))
            y = dict(sc['cells'][e['cell']]['routes'][e['route']], _group=e.get('book_group'), _w=e.get('weight', 1))
            if e.get('use') == 'name_check':  # a page whose accepted text drops a name the image prints is wrong text too
                nc = y['name_check']; y['accept'] = nc['accept_after_name_check']
                w0, n0 = map(int, y['wrong_text_pages'].split('/')); y['wrong_text_pages'] = f"{w0 + nc['with_name_error']}/{n0}"
            if e['route'].endswith('-written'):
                wd = e.get('written_of_drawn') or y.get('written_of_drawn')
                if not wd:
                    NO_SHARE.add(f"{e['score']} {e['cell'].split('|')[0]} {e['route']}"); continue
                y = over_drawn(y, wd)
            xs.append(y)
        x = pool_sources(xs, P['cluster_by_book'], (P.get('hard_floor') or {}).get('classes', ()))
        wds = [y['written_of_drawn'] for y in xs if y.get('written_of_drawn')]
        if x and wds:   # the share of drawn pages the route wrote, over its tests (#8111)
            x['written_of_drawn'] = '/'.join(str(sum(int(v.split('/')[i]) for v in wds)) for i in (0, 1))
        return x

    rows = []
    for cell in P['cells']:
        rs = []
        for r in cell['routes']:
            st0 = S[r['stage']]; sp = size_points(st0, sizes[cell['id']], Z, K) if st0.get('size') and cell['id'] in sizes else None
            st = dict(st0, points=sp['central'], draw=sp['central'] / 100) if sp else st0
            (a0, b0), _ = prior(cell, r); a, b = a0, b0
            d = DR.get(cell['id'], {}).get(r['id'])
            # a route listed with no evidence entry (a test it was measured in reached only the store): its verdicts' k/n
            # never for a '-written' route: its verdicts count only the pages it wrote (#8111)
            x = evidence(cell, r) or (not r['id'].endswith('-written') and d and d.get('accept') and pool_sources([dict(d, _group=None)], P['cluster_by_book'], (P.get('hard_floor') or {}).get('classes', ())))
            k = n = w = None; wrate = None; top = []
            if x:
                (k, n), w = map(int, x['accept'].split('/')), int(x['wrong_text_pages'].split('/')[0])
                ke, ne, we = x['eff']; wrate = we / ne
                a, b = a + ke, b + (ne - ke)
                top = sorted(x['classes_k_of_n'].items(), key=lambda kv: -int(kv[1].split('/')[0]))[:3]
            dr = [rng.betavariate(a, b) for _ in range(N)]; m = sum(dr) / N; u = usd_per_page(st, rates)
            rs.append(dict(id=r['id'], stage=r['stage'], channel=st['channel'], lane=st.get('lane'),
                           _bar=P['switch'].get('bar') == 'opus' and st['channel'] == 'claude' and not st.get('candidate') and not (cell.get('script') == 'manuscript' and P['switch'].get('bar_scope') == 'print'), candidate=bool(st.get('candidate')), points=st.get('points'), points_flat=st0.get('points'),
                           size=None if not sp else {k: round(v, 5) for k, v in sp.items()}, tested=bool(x), prior=[round(a0, 2), round(b0, 2)], prior_model=dict(zip(('mean', 'basis'), pb[cell['id'], r['id']])),
                           prior_pooled=pbp.get((cell['id'], r['id'])), eff=x and [round(v, 4) for v in x['eff']],
                           k=k, n=n, written_of_drawn=x and x.get('written_of_drawn'), wrong=w, wrate=wrate, top=top, judge_planted=x and x.get('judge_planted'), mean=m, ci90=[q(dr, .05), q(dr, .95)], var=a * b / ((a + b) ** 2 * (a + b + 1)),
                           p80=sum(v >= P['hold']['acc'] for v in dr) / N, share=share(st), units=units_per_page(st), _d=dr,
                           cost=None if not st['channel'] else [units_per_page(st) / q(dr, p) for p in (.95, .5, .05)],
                           api=None if st['api_usd'] is None else st['api_usd'] / m,
                           _usd_raw=u, _usd_acc=u / q(dr, .5), _usd_ci=[u / q(dr, p) for p in (.95, .05)],
                           defects=d, **({} if d or not x else {'defects_missing': 'tested, but no stored verdict with severity and a tie to the text (or < 10 pages): the floor only'})))
            # the hard floor's count (rules.json hard_floor): its own random stream, so the draws above do not move
            rr = rs[-1]; rr['inv'], rr['inv_eff'] = (x['inv'], round(x['inv_eff'], 4)) if x else (None, None)
            rr['hard_floor_block'], rr['p_inv_over_floor'] = hard_floor_block(rr, P, f"{P['seed']}:{cell['id']}:{r['id']}:floor")
        # Derek 11:54Z: in a manuscript or unknown-script cell a route with too few judged pages of that type is not
        # measured (it would decide on print's prior); the cell says UNTESTED / HOLD below
        few = lambda r: cell.get('script') in ('manuscript', 'unknown') and r['n'] < P['script_split']['min_manuscript_pages']
        # paired evidence (#7701): {routes: [a, b], score, cell, pair}: the score's cells[cell].paired[pair] counts of the
        # pages both routes were judged on (both / a_only / b_only / neither accepted), scaled by books / pages as above
        for pe in cell.get('paired', []):
            ra, rb = (next((r for r in rs if r['id'] == i), None) for i in pe['routes'])
            if not (ra and rb): continue
            c = _scores.setdefault(pe['score'], json.load(open(pe['score'])))['cells'][pe['cell']]['paired'][pe['pair']]
            sc = min(1, c['books'] / c['n']) if P['cluster_by_book'] else 1
            pd = paired_draws(c, N, random.Random(f"{P['seed']}:{cell['id']}:{ra['id']}|{rb['id']}"), sc)
            ra.setdefault('_pd', {})[rb['id']] = pd; rb.setdefault('_pd', {})[ra['id']] = [-d for d in pd]
            ra.setdefault('paired', {})[rb['id']] = rb.setdefault('paired', {})[ra['id']] = f"{c['a_only']} vs {c['b_only']} of {c['n']} paired"
        cur = next(r for r in rs if r['id'] == cell['current']); M = [r for r in rs if r['tested'] and not few(r) and on_menu(r, P)]
        live_id = LIVE.get(cell['id'], cur['id'])
        dec, pk, dinfo = decide(cell, rs, M, cur, live_id, P, CAL)
        fdec, jinfo = judge_gate(cell, dec, pk, P, S)
        failed = [i for i, g in (dinfo or {}).get('gates', {}).items() if not all(v for k, v in g.items() if k in ('wrong_text', 'accept'))]
        md = menu_default(cell, fdec, M, rs, P, failed)
        fdec, fpk = md or (fdec, pk)
        bound, bound_why = bind(cell, fdec, fpk, live_id, M, rs, P, failed)
        pages = cell.get('pages_waiting', v2.get(cell.get('v2'), {}).get('pages_waiting', 0))
        alone = decide_defects(cell, rs, M, cur, live_id, P, CAL) if (cell.get('planned') or {}).get('decision') else None
        rows.append(dict(id=cell['id'], base=cell.get('base'), script=cell.get('script'), title=cell['title'], pages_waiting=pages, current=cur['id'], decision=fdec, route=fpk['id'], rule='defects', live=live_id, bound_route=bound, bound_why=bound_why,
                         # what the rule alone picks under a person's planned decision, so the table shows both
                         **({'rule_alone': f"{alone[0]} {alone[1]['id']}" if alone[0] else f"undecided: {alone[2]['why']}"} if alone else {}),
                         hard_floor_blocked=[r['id'] for r in rs if r.get('hard_floor_block') and in_force(P, 'hard_floor')], defects_rule=dinfo, judge_validity=jinfo,
                         weeks_to_clear=pages * fpk['share'], v2_weeks=v2.get(cell.get('v2'), {}).get('weeks_to_drain'),
                         test_score=max([pages * r['share'] * r['var'] for r in rs if r['share'] and r['channel'] != 'claude'] or [0]),  # no new Opus arm (switch.bar; brief: never a new Opus read)
                         caveat=cell.get('caveat') or cell.get('held'), routes=rs))
    for i, r in enumerate(sorted([r for r in rows if r['test_score'] and r['decision'] != 'held'], key=lambda r: -r['test_score'])[:P['test_next']['n']]):
        r['test_next'] = i + 1
    T = P['test_next']; tests = []
    for row in sorted([r for r in rows if r.get('test_next')], key=lambda r: r['test_next']):
        cand = [r for r in row['routes'] if r['channel'] != 'claude']
        rs = [r for r in cand if not r['tested']] or [max(cand, key=lambda r: r['share'] * r['var'])]
        pts = T['pages_per_test'] * (len(rs) * T['judge_points_per_output'] + sum(r['points'] or 0 for r in rs))
        agy = T['pages_per_test'] * sum(S[r['stage']]['draw'] for r in rs if S[r['stage']]['channel'] == 'agy')
        tests.append(dict(rank=row['test_next'], cell=row['id'], routes=[r['id'] for r in rs], pages=T['pages_per_test'], claude_points=pts, agy_calls=agy,
                          account_week_share=pts / 100 / free['claude'], agy_week_share=agy / free['agy']))

    NAME = arg('--name') or P['as_of']
    OUT = arg('--out-dir') or D   # --out-dir: an attribution build (V1-V3 on / off) written outside the repo
    if not OUT.endswith('/'): OUT += '/'
    before = {r['id']: r for r in json.load(open(arg('--before')))['rows']} if arg('--before') else {}
    fmt = lambda d, rt: d + (f" → {rt}" if d.startswith(('switch', 'HOLD', 'planned', 'NEEDS-ENGINE')) else '')
    for row in rows:
        b = before.get(row['id']) or before.get(row.get('base')); row['before'] = fmt(b['decision'], b['route']) if b else None
    calib = [(row['id'], r['id'], r['prior'], f"{r['k']}/{r['n']}") for row in rows for r in row['routes'] if r['tested']]
    pub = lambda rs: [{k: v for k, v in r.items() if not k.startswith('_')} for r in rs]  # no dollars in the repo
    json.dump(dict(as_of=P['as_of'], rules=P['inputs'], fees=fee_src, size_rate=K, evidence=DRF.get('coverage'),
                   rows=[dict(row, routes=pub(row['routes'])) for row in rows], tests=tests, prior_vs_pilot=calib),
              open(OUT + NAME + '.json', 'w'), indent=1, ensure_ascii=False)

    def cost(r):
        if r['cost'] is None: return '0'
        u = ' pts' if S[r['stage']]['channel'] == 'claude' else ' agy calls'
        z = r['size']
        sz = (f"; {r['points']:.3g} pts a page [{z['low']:.3g}, {z['high']:.3g}] at {z['pages_per_call']:.1f} pages a call (flat {r['points_flat']:g})" if z else '')
        return f"{r['cost'][1]:.3g}{u} [{r['cost'][0]:.3g}, {r['cost'][2]:.3g}]" + sz + (f" / API ${r['api']:.3f}" if r['api'] else '')
    R, sw, h = P['decision_rule'], P['switch'], P['hold']
    lanes = '; '.join(f"{k}: {v['lane']}" for k, v in S.items() if v['channel'] == 'claude')
    size_txt = (f"**Page size** (inbox 2026-10-26, Derek: \"10 pages are not the same in all books\"). A Claude page costs k x (overhead / pages per call + the page's own tokens), tokens weighted input + {Z['output_weight']} x output; "
                f"page sizes per cell from `{P['inputs']['page_sizes']}`. Overhead {K['overhead_eq']:,.0f} weighted tokens a call; k central per kind of call " + ', '.join(f"{k} {v:.2e}" for k, v in K['central'].items()) + f", range [{K['low']:.2e}, {K['high']:.2e}]. **The Claude weekly quota is not published per token: this is an estimate.**")
    if pp_missing: print(f"WARNING: {len(pp_missing)} routes have no pooled prior mean (flat prior; rerun pooled_prior.py):", ', '.join(pp_missing))
    split_txt = ('' if not UNSPLIT else "**Not split by script type** (no by-script file; their pages enter the `/unknown` cells only until "
                 "scripts/eval/router-next-7263/ evidence_pages.py, classify-evidence.mjs and split_evidence.py are rerun): " + ', '.join(f'`{u}`' for u in sorted(UNSPLIT)) + '.')
    if UNSPLIT: print('WARNING: evidence not split by script type, in /unknown only:', ', '.join(sorted(UNSPLIT)))
    share_txt = ("**'-written' rows are scored over the pages drawn** (#8111): a page the route refused counts as not accepted, so acceptance and the cost per accepted page are over the pages tried. "
                 "Each '-written' evidence entry carries `written_of_drawn` (rules.json, or the score file); "
                 + ("refused, with none: " + ', '.join(f'`{u}`' for u in sorted(NO_SHARE)) + '.' if NO_SHARE else 'none is refused for lacking it.'))
    if NO_SHARE: print("WARNING: '-written' evidence with no written_of_drawn, refused (#8111):", ', '.join(sorted(NO_SHARE)))
    H = P.get('hard_floor') or {}
    hf = [r for r in rows if r['hard_floor_blocked']]
    wms = sorted({R['misleads_usd'], *R['misleads_usd_sensitivity']})
    out = [f"# Router table {NAME} (#6740, #8283)", '', f"Generated by `build.py` from `rules.json` and `{P['inputs']['defect_rates']}`. Opus is the judge, reading each output against the page image. ● = the route the router assigns now.", '',
           f"**The rule** (#8283): severity-weighted defects per 1,000 words against the live route (bar: `current.json` → `{CUR['table']}`; an unrated live route has no privilege, the best rated route is the bar). Rated = >= {R['min_books']} books of verdicts tied to the text judged. "
           f"Gate 1: wrong text <= the bar's + {R['wrong_text_delta_per_1k']} per 1,000 words (no text served: P(wrong text <= {R['ceiling_per_1k']}) >= {R['ceiling_p']}). "
           f"Gate 2, the floor: P(acc >= acc_live - {R['accept_floor']['within']}) >= {R['accept_floor']['p']}, paired where judged on the same pages. "
           f"Pick: lowest price per raw page + ${R['misleads_usd']:g} x words/1000 x (misleads + {R['wrong_text_weight']} x wrong text), labels deflated by the re-check (misleads x {CAL['misleads']}, wrong text x {CAL['wrong_text']}); a pick that moves across ${wms[0]:g}-${wms[-1]:g} is HOLD. "
           f"Fees: {fee_src}; dollars are not committed. Opus lanes: {lanes}.", '',
           f"**Around it.** *Hard floor*: a route is blocked when P(invented or wrong-leaf rate > {H.get('rate', 0):g}) >= {H.get('p', 0):g}, with at least {H.get('min_pages', 0)} such page seen. *Menu* (#8283): an undecided cell takes the plainest agy route that passes the floor, never the incumbent. *Judge validity* (V2): below. A person's `planned` decision and a `held` cell stand.", '', size_txt, '', split_txt, '', share_txt, '',
           '| cell | pages waiting | current | route | lane | acceptance [90%] | wrong text | defects per 1,000 words: misleads / wrong text (books) | cost per accepted page | weeks to clear | decision |', '|' + '---|' * 11]
    for row in rows:
        for j, r in enumerate(row['routes']):
            acc = (f"**{r['k']}/{r['n']}** → {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]" if r['tested']
                   else f"UNTESTED: prior {r['mean']:.2f} [{r['ci90'][0]:.2f}, {r['ci90'][1]:.2f}]")
            if r.get('written_of_drawn'): acc += f"; over the drawn pages: it wrote {r['written_of_drawn']}"
            if r.get('judge_planted'): acc += f"; judge caught {r['judge_planted']['caught']} planted" + (' (judge-unvalidated)' if r['judge_planted'].get('validated') is False else '')
            d = r.get('defects')
            dcol = f"{d['misleads_per_1k_posterior'][1]:.2f} / {d['wrong_text_per_1k_posterior'][1]:.2f} ({d['books']})" if d else '—'
            dec = (fmt(row['decision'], row['route']) + (f"; **test next #{row['test_next']}**" if row.get('test_next') else '')
                   + (f"; before: {row['before']}" if row['before'] and row['before'] != fmt(row['decision'], row['route']) else '')) if j == 0 else ''
            out.append(f"| {row['title'] if j == 0 else ''} | {f'{row['pages_waiting']:,}' if j == 0 else ''} | {'●' if r['id'] == row['current'] else ''} | {r['id']} | {r['lane'] or '—'} | {acc} | "
                       f"{f'{r['wrong']}/{r['n']}' if r['tested'] else '—'}{f'; invented / wrong leaf {r['inv']}' + (' **(hard floor)**' if r.get('hard_floor_block') and in_force(P, 'hard_floor') else '') if r.get('inv') and r['inv'][0] != '0' else ''} | {dcol} | {cost(r)} | "
                       f"{f'{row['pages_waiting'] * r['share']:.1f}' if r['share'] else '—'} | {dec} |")
        if row['caveat']: out.append(f"| | | | | | *{row['caveat']}* | | | | | |")
    JV = P.get('judge_validity')
    if JV and JV.get('in_force'):
        f3 = lambda v: '—' if v is None else f"{v[0]:.2f} ({v[1]:.2f}–{v[2]:.2f})" if isinstance(v, list) else f"{v:.2f}"
        out += ['', f"**Judge validity** (V2, #7263; rules.json `judge_validity`, from {JV['source']}). Where a stratum's self-preference (DBG) interval excludes 0, "
                f"a route the judge's own family ({JV['judge_family']}) wrote cannot win keep or switch on that judge alone: **HOLD (judge not valid: self-preference)**, "
                "unless a judge of another family clears it (judge_validity.second_judges). A stratum with no calibration is shown as unmeasured and does not hold.", '',
                '| stratum | sensitivity | specificity | κ | self-preference (DBG) | V2 | cells |', '|' + '---|' * 7]
        for k, st in JV['strata'].items():
            if k.startswith('_'): continue
            cs = [r['id'] for r in rows if (r.get('judge_validity') or {}).get('stratum') == k]
            v = {True: 'self-preference: pass', False: '**self-preference: fail**', None: 'unmeasured'}[st.get('self_preference_valid')]
            out.append(f"| {k} | {f3(st.get('sensitivity'))} | {f3(st.get('specificity'))} | {f3(st.get('kappa'))} | {f3(st.get('dbg'))} | {v} | {len(cs)} |")
        held = [r for r in rows if (r.get('judge_validity') or {}).get('held')]
        out += ['', f"Cells held by the judge gate: {len(held)}" + (': ' + '; '.join(f"{r['id']} (was {r['judge_validity']['held']})" for r in held) if held else '') + '.']
    out += ['', f"Blocked by the hard floor: {sum(len(r['hard_floor_blocked']) for r in hf)} routes in {len(hf)} cells" + (': ' + '; '.join(f"{r['id']} ({', '.join(r['hard_floor_blocked'])})" for r in hf) if hf else '') + '.']
    undec = [r for r in rows if r['bound_route'] != r['route']]
    out += ['', f"**What runs where the decision does not bind** (#8283, `bound_route`): {len(undec)} cells" + (': ' + '; '.join(f"{r['id']} runs {r['bound_route'] or 'its router default'} ({r['bound_why']})" for r in undec) if undec else '') + '.']
    out += ['', '**The rule, cell by cell**', '', '| cell | bar | words / page | passing | weighted defects a page | pick at ' + ' / '.join(f'${w:g}' for w in wms) + ' | decision |', '|' + '---|' * 7]
    for row in rows:
        di = row['defects_rule']
        if not di: continue
        if 'picks' not in di: out.append(f"| {row['id']} | {row['live']} | — | — | — | {di['why']} | {fmt(row['decision'], row['route'])} |"); continue
        out.append(f"| {row['id']} | {di['bar']} | {di['words_per_page']:g} | {', '.join(di['passing']) or 'none'} | {', '.join(f'{k} {v:.2f}' for k, v in di['defects_per_page'].items())} | {' / '.join(str(di['picks'][str(w)]) for w in wms)} | {fmt(row['decision'], row['route'])} |")
    out += ['', '**Test next** (proposals; score = pages waiting x share of the channel\'s free week per page x Var(acceptance)):', '']
    out += [f"{t['rank']}. {t['cell']}: {', '.join(t['routes'])}, {t['pages']} pages each, judged by Opus against the image: {t['claude_points']:.2f} Claude points ({t['account_week_share']:.2%} of the free Claude week)" + (f" + {t['agy_calls']:.0f} agy calls ({t['agy_week_share']:.2%} of agy's)" if t['agy_calls'] else '') for t in tests]
    out += ['', '**Prior against the pilot** (prior mean, worth a + b pages → what the judge accepted):', '']
    out += [f"- {c} / {r}: {a / (a + b):.2f} ({a + b:.0f} pages) → {kn}" for c, r, (a, b), kn in calib]
    open(OUT + NAME + '.md', 'w').write('\n'.join(out) + '\n')
    # PRIVATE: dollars, stdout only (paste into the issue comment, never into the repo)
    print(f"# dollars per 1K accepted pages, steady [90%] — fees: {fee_src}")
    for row in rows:
        for r in row['routes']:
            if r['cost'] or S[r['stage']].get('paid'):
                print(row['id'], r['id'], f"${r['_usd_acc'] * 1000:.2f} [{r['_usd_ci'][0] * 1000:.2f}, {r['_usd_ci'][1] * 1000:.2f}]")
    print('\n'.join(out))


if __name__ == '__main__':
    main()
