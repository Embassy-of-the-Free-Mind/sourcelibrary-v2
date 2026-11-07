#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/ocr/route_ocr_v1.py (§3a per cell: the cheapest measured route clearing the bar
# with P >= 0.9; capacity not modelled, reads only, no correction stage) and planner_v0.py (a quarter's capacity used
# only as a filter: an engine whose subscription cannot carry a language's WHOLE queue is dropped, which is how Opus
# fell out of Chinese, #7357). Neither allocates a week of each channel across cells. This does (#6740, #7263).
"""Estimator v2 router: chained correction routes per cell, then each channel's weekly capacity allocated (#6740).

  allocate_v2.py --draws $S/chain-v2.npz --volumes $S/volumes-by-draft.jsonl \
      --out results/allocation-v2.json --md results/allocation-v2.md

No plan fee enters: capacity is allocated in each channel's own units (Claude account-weeks, agy calls, Batch dollars),
so nothing private is read or written. Dollars per page, where wanted, are route_ocr_v1.py's job with the private
fee file.

Objective (Derek, 2026-10-25 21:20Z: "Assume Opus is ok; we are mostly looking for enhanced cost"): per cell, the
CHEAPEST route whose output a reader would accept as matching Opus, priced per usable page and per unit of capacity;
Opus is the reference (an assumption, not a measurement) and the fallback in every cell. Per route, as the cell's
gate instrument sees it, in the Opus-reference fit (no Gemini-judged rows, no judge-family term):
  P(worse), P(better)   pages made worse / better than the draft
  net gain              P(better) - harm_weight x P(worse), per corrected page (net pages improved)
  P(matches Opus)       share of draws with net gain >= Opus's - max(0.05, 10% of Opus's)
  draw                  capacity per page per channel (capacity.json), plus retranslation of the cell's translated share
'none' (serve the draft) is a route too: it costs nothing and matches Opus where Opus gains little.
Route = the cheapest measured route with P(matches Opus) >= 0.9 (cost = share of the free week per page), else Opus.
A cheaper route at P(matches Opus) 0.5-0.9 gets the route-judge-6740 test (30 pages, one Opus reader), reserved from
the same budget.
Allocation (a linear programme, scipy HiGHS, over horizons of 1 to 260 weeks):
  maximise  sum over (cell, route, read tier) of read weight x E[net gain] x pages
  subject to  each channel's free capacity x H weeks, less the tests reserved from it; each tier's pages
  read weight = (book read_count + 1) / (corpus mean + 1); a cell's books in 20 tiers of equal pages, most-read first
Every route that matches Opus, and Opus, enters, so a cell moves to another channel when its own is full. Weeks to
drain = the first horizon at which 99% of the cell is done.
"""
import argparse, collections, datetime as dt, json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chain_v2 as cv  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]
PROVISIONAL = 0.5    # a cheaper route at P(matches Opus) >= 0.5 is worth a test
DELTA_ABS, DELTA_REL = 0.05, 0.10   # "matches Opus": net gain within max(0.05, 10% of Opus's) per page


def load_volumes(path, mean_reads):
    """(language, draft, zh_guarded, dice) -> {book: [pages, weight]}"""
    out = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0.0]))
    for l in open(path):
        r = json.loads(l)
        w = ((r['book_reads'] or 0) + 1) / (mean_reads + 1)
        key = (r['language'], r['draft'], bool(r['zh_guarded']), r['dice'])
        out[key][r['book_id']][0] += r['pages']
        out[key][r['book_id']][1] = w
    return out


def cell_books(cell, vol):
    c = cell.get('census')
    if not c:
        return None
    books = collections.defaultdict(lambda: [0, 0.0])
    for (lang, draft, g, dice), bk in vol.items():
        if lang != c['language'] or draft != c['draft']:
            continue
        if 'zh_guarded' in c and g != c['zh_guarded']:
            continue
        if 'dice' in c and dice != c['dice']:
            continue
        for b, (n, w) in bk.items():
            books[b][0] += n
            books[b][1] = w
    return books


def measured_cells(rows):
    n = collections.Counter()
    for r in rows:
        if r['rate'] == 'made_worse' and not r.get('mix'):
            n[(r['draft'], r['corrector'], r['language'], r['kind'])] = max(n[(r['draft'], r['corrector'], r['language'], r['kind'])], r['n'])
    return {c for c, v in n.items() if v >= 20}


def route_draws(post, ix, cell, corr, bind):
    j = ix.ci[(cell['draft'], corr, cell['language'], cell['kind'])]
    io = cv.inst_offsets(post)
    bi = cv.INSTR.index(bind)
    eta = post['eta']
    pw = 1 / (1 + np.exp(-(eta[:, 0, j] + io[:, 0, bi])))
    pb = 1 / (1 + np.exp(-(eta[:, 1, j] + io[:, 1, bi])))
    pm = 1 / (1 + np.exp(-eta[:, 2, j]))
    return pw, pb, pm


def stage_draw(cap, stage, tshare):
    s = cap['stages'][stage]
    d = {s['channel']: s['per_page']}
    d['claude'] = d.get('claude', 0.0) + tshare * cap['stages']['opus-translate@10']['per_page']
    return d


def free_week(cap, ch, scale=None):
    c = cap['channels'][ch]
    return c['per_week'] * c['free_share'] * ((scale or {}).get(ch, 1.0))


def evaluate(cells, post, ix, measured, cap, harm, threshold, stage_scale=None, scale=None):
    """Per cell: every candidate route, the draft as served ('none'), and Opus as the reference and the fallback.
    A route MATCHES OPUS when, in >= threshold of the posterior draws, its net gain is within DELTA of Opus's
    (DELTA = max(0.05, 10% of Opus's gain): 5 pages in 100). The choice is the cheapest measured route that matches
    Opus, by share of the free week per page; Opus when none does (Derek, 2026-10-25 21:20Z)."""
    out = []
    for cell in cells:
        tshare = cap['translated_share'].get(cell.get('translated_share_key', cell['language']), 0.0)
        routes = []
        for corr, stage in cell['routes']:
            pw, pb, pm = route_draws(post, ix, cell, corr, cell['bind'])
            g = pb - harm * pw
            draw = stage_draw(cap, stage, tshare)
            if stage_scale and stage in stage_scale:
                draw = {k: v * (stage_scale[stage] if k == cap['stages'][stage]['channel'] else 1) for k, v in draw.items()}
            share = sum(v / free_week(cap, k, scale) for k, v in draw.items())
            eg = float(g.mean())
            routes.append(dict(corrector=corr, stage=stage, channel=cap['stages'][stage]['channel'],
                               measured=(cell['draft'], corr, cell['language'], cell['kind']) in measured,
                               p_worse=q(pw), p_better=q(pb), gain=q(g), gain_mean=round(eg, 4),
                               p_worse_under_bar=round(float((pw <= cell['bar_worse']).mean()), 3),
                               draw_per_page=draw, share_per_page=share,
                               cost_per_net_page=({k: v / eg for k, v in draw.items()} if eg > 0 else None),
                               share_per_net_page=(share / eg if eg > 0 else None), _g=g, _pw=pw))
        S = routes[0]['_g'].shape[0]
        routes.append(dict(corrector='none', stage='serve the draft', channel=None, measured=True,
                           p_worse=[0.0] * 3, p_better=[0.0] * 3, gain=[0.0] * 3, gain_mean=0.0, p_worse_under_bar=1.0,
                           draw_per_page={}, share_per_page=0.0, cost_per_net_page=None, share_per_net_page=None,
                           _g=np.zeros(S), _pw=np.zeros(S)))
        opus = [r for r in routes if r['corrector'].startswith('opus') and r['measured']] or \
               [r for r in routes if r['corrector'].startswith('opus')]
        ref = max(opus, key=lambda r: r['gain_mean'])
        delta = np.maximum(DELTA_ABS, DELTA_REL * ref['_g'])
        for r in routes:
            r['p_matches_opus'] = 1.0 if r is ref else round(float((r['_g'] >= ref['_g'] - delta).mean()), 3)
            r['tier'] = ('opus' if r is ref else
                         'matches opus' if r['measured'] and r['p_matches_opus'] >= threshold else
                         'to test' if r['p_matches_opus'] >= PROVISIONAL and r['corrector'] != 'none'
                         and (r['share_per_page'] < ref['share_per_page'] or r['channel'] != ref['channel']) else 'no')
        meas = [r for r in routes if r['measured'] and r['corrector'] != 'none']
        if meas:
            G = np.stack([r['_g'] for r in meas], 1)
            pbest = np.bincount(G.argmax(1), minlength=len(meas)) / G.shape[0]
            for r, p in zip(meas, pbest):
                r['p_best'] = round(float(p), 3)
        ok = [r for r in routes if r['tier'] in ('opus', 'matches opus')]
        choice = min(ok, key=lambda r: (r['share_per_page'], -r['gain_mean']))
        tier = 'held' if cell.get('hold') else ('opus (fallback)' if choice is ref else 'cheaper route matches opus')
        out.append(dict(cell=cell, routes=routes, choice=None if cell.get('hold') else choice, tier=tier, ref=ref))
    return out


def route_test(e, r, cap):
    """The route-judge-6740 design: 30 pages per route, judged by one Opus reader against Opus on the same page
    (188 Opus calls for 150 pages in its pilot: 1.25 a page), plus the route's own 30 reads."""
    n = 30
    draw = collections.Counter()
    if r['channel']:
        draw[r['channel']] += n * cap['stages'][r['stage']]['per_page']
    draw['claude'] += n * 1.25 * cap['stages']['opus-5.5@1']['per_page']
    return dict(cell=e['cell']['id'], corrector=r['corrector'], basis='measured' if r['measured'] else 'pooled',
                p_matches_opus_now=r['p_matches_opus'], n=n, instrument='one Opus reader against Opus (route-judge-6740)',
                draw=dict(draw))


HORIZONS = [1, 2, 3, 4, 6, 8, 10, 13, 17, 21, 26, 34, 43, 52, 65, 78, 104, 130, 156, 208, 260]


def tiers(books, T=20):
    """A cell's books in T read tiers of about equal pages, most-read first: [(pages, read-weighted pages)]."""
    bk = sorted(books.values(), key=lambda t: -t[1])
    tot = sum(n for n, _ in bk) or 1
    out = [[0, 0.0] for _ in range(T)]
    cum = 0
    for n, w in bk:
        t = min(int(cum / tot * T), T - 1)
        out[t][0] += n
        out[t][1] += n * w
        cum += n
    return [tuple(t) for t in out if t[0] > 0]


def lp(evals, tiers_of, cap, H, scale=None, reserve=None, absolute=None):
    """Maximise sum over (cell, route, tier) of read weight x E[net gain] x pages, subject to each channel's free
    capacity over H weeks (less the tests reserved from it) and each tier's pages. Routes: every MEASURED route of a
    cell that matches Opus, and Opus itself (not only the cell's choice, so a cell can move to an idle channel)."""
    from scipy.optimize import linprog
    var, cov = [], {}
    for e in evals:
        if (e['tier'] == 'held' or (e['choice'] and e['choice']['corrector'] == 'none')) and not any(r.get('forced') for r in e['routes']):
            continue        # held, or the draft as served already matches Opus: no capacity needed
        rts = [r for r in e['routes'] if r.get('forced')] or [
            r for r in e['routes'] if r['tier'] in ('opus', 'matches opus') and r['corrector'] != 'none']
        for ti, (n, rw) in enumerate(tiers_of[e['cell']['id']]):
            cov[(e['cell']['id'], ti)] = n
            for r in rts:
                var.append((e['cell']['id'], ti, r, rw / n * r.get('priority', 1.0)))
    chans = sorted({k for _, _, r, _ in var for k in r['draw_per_page']})
    if not var:
        return {}
    c = np.array([-w * r['gain_mean'] for _, _, r, w in var])
    rows, b = [], []
    ck = list(cov)
    for key in ck:
        rows.append([1.0 if (v[0], v[1]) == key else 0.0 for v in var])
        b.append(cov[key])
    for ch in chans:
        rows.append([v[2]['draw_per_page'].get(ch, 0.0) for v in var])
        b.append(max((absolute or {}).get(ch, 0.0) if absolute is not None else
                     free_week(cap, ch, scale) * H - (reserve or {}).get(ch, 0.0), 0.0))
    res = linprog(c, A_ub=np.array(rows), b_ub=np.array(b), bounds=[(0, None)] * len(var), method='highs')
    assert res.status == 0, (res.status, res.message, H)
    out = collections.defaultdict(lambda: dict(pages=0.0, rw=0.0, by_route=collections.Counter(),
                                               draw=collections.Counter()))
    for (cid, ti, r, w), x in zip(var, res.x):
        if x <= 1e-6:
            continue
        o = out[cid]
        o['pages'] += x
        o['rw'] += x * w / r.get('priority', 1.0)
        o['by_route'][r['corrector']] += x
        for k, v in r['draw_per_page'].items():
            o['draw'][k] += x * v
    return out


def schedule(evals, tiers_of, cap, scale=None, reserve=None):
    """LP at each horizon; per cell: pages and read-weighted pages done by week H."""
    return {H: lp(evals, tiers_of, cap, H, scale, reserve) for H in HORIZONS}


def idle_shares(path):
    """Per account: the share of its week projected to go unused at the reset at the current pace (used / elapsed
    share of the week), and when it expires. Perishable: worth nothing after the reset."""
    d = json.load(open(path))
    now = dt.datetime.fromisoformat(d['as_of'])
    out = []
    for a in d['accounts']:
        reset = dt.datetime.fromisoformat(a['resets_at'])
        left = (reset - now).total_seconds() / (7 * 86400)
        elapsed = max(1 - left, 1e-3)
        projected = a['weekly_percent'] / elapsed
        out.append(dict(account=a['account'], used_percent=a['weekly_percent'], resets_at=a['resets_at'],
                        week_elapsed=round(elapsed, 3), projected_percent_at_reset=round(projected, 1),
                        idle_account_weeks=round(max(0.0, 1 - projected / 100), 3), hours_left=round(left * 7 * 24, 1)))
    return out


def weeks_until(sched, cid, frac, total, key='pages'):
    for H in HORIZONS:
        if sched[H].get(cid, {}).get(key, 0.0) >= frac * total - 1e-6 * total:
            return H
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--obs', default=os.path.join(HERE, '../ocr/failure-observations.jsonl'))
    ap.add_argument('--draws', required=True)
    ap.add_argument('--volumes', required=True)
    ap.add_argument('--cells', default=os.path.join(HERE, 'cells.json'))
    ap.add_argument('--capacity', default=os.path.join(HERE, 'capacity.json'))
    ap.add_argument('--mean-reads', type=float, default=2.0110600646588397, help='planner/results/volumes-2026-10-23.json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--md', required=True)
    ap.add_argument('--census-out', help='per language x draft totals of the volume census (committed summary)')
    ap.add_argument('--weekly', default=os.path.join(HERE, 'results/claude-weekly-2026-10-25.json'),
                    help='per-account weekly use and reset (climits), for the idle share (Derek, 2026-10-26)')
    a = ap.parse_args()
    cv.OPUS_REFERENCE = True     # routing reads the Opus-reference fit (chain_v2.py fit --opus-reference)
    C = json.load(open(a.cells))
    cap = json.load(open(a.capacity))
    rows = cv.load(a.obs)
    ix_fit = cv.Index(rows)
    extra = {(c['draft'], corr, c['language'], c['kind']) for c in C['cells'] for corr, _ in c['routes']}
    ix = cv.Index(rows, extra)
    full = dict(np.load(a.draws))
    full.pop('cells')
    post = cv.extend(full, ix_fit, ix, np.random.default_rng(6740))
    measured = measured_cells(rows)
    vol = load_volumes(a.volumes, a.mean_reads)
    if a.census_out:
        summ = collections.defaultdict(lambda: dict(books=0, pages=0, read_weighted=0.0))
        for (lang, d, g, dice), bk in vol.items():
            k = f"{lang}|{d}" + ('|zh-guarded' if g else '') + (f'|dice {dice}' if dice != 'na' else '')
            for n, w in bk.values():
                summ[k]['books'] += 1
                summ[k]['pages'] += n
                summ[k]['read_weighted'] += n * w
        json.dump(dict(generated_by='scripts/eval/estimator/chain/volumes-by-draft.mjs (read-only census, 2026-10-25)',
                       weight='(book read_count + 1) / (corpus mean 2.011 + 1)',
                       cells={k: dict(v, read_weighted=round(v['read_weighted'])) for k, v in sorted(summ.items())}),
                  open(a.census_out, 'w'), indent=1)
    zh_w = [w for (lang, d, g, _), bk in vol.items() if lang == 'Chinese' and d == 'paddle' for (_, w) in bk.values()]
    books_of = {}
    for c in C['cells']:
        bk = cell_books(c, vol)
        books_of[c['id']] = bk if bk is not None else {'(fixed)': [c['fixed_pages'], float(np.mean(zh_w)) if zh_w else 1.0]}
    tiers_of = {cid: tiers(bk) for cid, bk in books_of.items()}
    H_, T = C['harm_weight'], C['threshold']
    base = evaluate(C['cells'], post, ix, measured, cap, H_, T)

    # the planner's tests come out of the same budget: in each cell, every route cheaper than Opus whose P(matches
    # Opus) is 0.5 to 0.9 (measured) or >= 0.5 (pooled) gets the route-judge-6740 test
    tests, reserve = [], collections.Counter()
    for e in base:
        if e['tier'] == 'held':
            continue
        for r in e['routes']:
            if r['tier'] == 'to test':
                t = route_test(e, r, cap)
                tests.append(t)
                for k, v in t['draw'].items():
                    reserve[k] += v

    sched = schedule(base, tiers_of, cap, reserve=reserve)
    sens = {'agy x0.7': schedule(base, tiers_of, cap, scale={'agy': 0.7}, reserve=reserve),
            'agy x1.3': schedule(base, tiers_of, cap, scale={'agy': 1.3}, reserve=reserve)}
    # what the tests would buy: every route under test taken as matching Opus
    confirmed = [dict(e, routes=[dict(r, tier='matches opus') if r['tier'] == 'to test' else r for r in e['routes']]) for e in base]
    sens['if every test confirms'] = schedule(confirmed, tiers_of, cap, reserve=reserve)
    sens['tests confirm, agy x0.7'] = schedule(confirmed, tiers_of, cap, scale={'agy': 0.7}, reserve=reserve)
    sens['tests confirm, agy x1.3'] = schedule(confirmed, tiers_of, cap, scale={'agy': 1.3}, reserve=reserve)
    lo, hi = cap['stages']['opus-5.5@10']['range']
    for nm, v in (('Opus@10 draw low', lo), ('Opus@10 draw high', hi)):
        e2 = evaluate(C['cells'], post, ix, measured, cap, H_, T, stage_scale={'opus-5.5@10': v / cap['stages']['opus-5.5@10']['per_page']})
        sens[nm] = schedule(e2, tiers_of, cap, reserve=reserve)
    for h in (1.0, 4.0):
        sens[f'harm weight {h:g}'] = schedule(evaluate(C['cells'], post, ix, measured, cap, h, T), tiers_of, cap, reserve=reserve)

    def forced(cid, corr, first=False):
        ev = [dict(x, routes=[dict(r, forced=(r['corrector'] == corr), priority=(1e3 if first else 1.0))
                              if x['cell']['id'] == cid else r for r in x['routes']]) for x in base]
        return schedule(ev, tiers_of, cap, reserve=reserve)

    def value(sc, H=13, skip=()):
        return {cid: v['rw'] for cid, v in sc[H].items() if cid not in skip}

    gain_of = {e['cell']['id']: {r['corrector']: r['gain_mean'] for r in e['routes']} for e in base}

    def displaced(sc, cid, H=13):
        """Other cells' read-weighted pages corrected in the first H weeks, scenario minus base, and the net pages
        improved (read-weighted pages x the route's gain) they give up."""
        out = {}
        for k in set(sched[H]) | set(sc[H]):
            if k == cid:
                continue
            b, s_ = sched[H].get(k, {}), sc[H].get(k, {})
            gb = sum(gain_of[k][r] * v for r, v in b.get('by_route', {}).items())
            gs = sum(gain_of[k][r] * v for r, v in s_.get('by_route', {}).items())
            if abs(b.get('pages', 0) - s_.get('pages', 0)) > 1:
                out[k] = dict(pages=round(s_.get('pages', 0) - b.get('pages', 0)), net_pages_improved=round(gs - gb))
        return out

    scenarios = {}
    for name, cid, corr, why, first in (
            ('5924: Opus corrects lite Latin (by reads)', 'latin-lite', 'opus-5.5', '#5924 DECISION', False),
            ('5924: Opus corrects lite Latin, ahead of every other cell', 'latin-lite', 'opus-5.5', '#5924 DECISION', True),
            ('6560: Flash-low correction pass over Yigdzin Tibetan, now', 'tibetan-yigdzin', 'agy-3.8-flash-low', '#6560 Flash-low pass', True),
            ('6561/6871: Opus corrects the newly read Paddle tables (by reads)', 'zh-frame-6871', 'opus-5.5', 'Paddle -> Opus for the new Chinese tables', False),
            ('6561/6871: Opus corrects the newly read Paddle tables, now', 'zh-frame-6871', 'opus-5.5', 'Paddle -> Opus for the new Chinese tables', True)):
        sc = forced(cid, corr, first)
        pages = sum(n for n, _ in books_of[cid].values())
        rw = sum(n * w for n, w in books_of[cid].values())
        r13 = sc[13].get(cid, {})
        scenarios[name] = dict(cell=cid, corrector=corr, decision=why, first=first,
                               share_week1={k: round(v / free_week(cap, k), 4) for k, v in sc[1].get(cid, {}).get('draw', {}).items()},
                               quarter_pages=round(r13.get('pages', 0)),
                               weeks_top_read_weighted={str(f): weeks_until(sc, cid, f, rw, 'rw') for f in (0.1, 0.25, 0.5, 1.0)},
                               weeks_to_drain=weeks_until(sc, cid, 0.99, pages),
                               whole_cell_draw={k: round(pages * v, 3) for k, v in next(r for r in next(x for x in base if x['cell']['id'] == cid)['routes'] if r['corrector'] == corr)['draw_per_page'].items()},
                               displaced_in_quarter=displaced(sc, cid))
        # the same cell with the WHOLE free week of its channel to itself, most-read first (no other cell competes)
        ch = next(r for r in next(x for x in base if x['cell']['id'] == cid)['routes'] if r['corrector'] == corr)
        prim = ch['channel']
        cum, alone = 0.0, {}
        bks = sorted(books_of[cid].values(), key=lambda t: -t[1])
        tot_rw = sum(n * w for n, w in bks)
        acc = 0.0
        for n, w in bks:
            cum += n * ch['draw_per_page'][prim]
            acc += n * w
            for f in (0.1, 0.25, 0.5, 1.0):
                if str(f) not in alone and acc >= f * tot_rw * (1 - 1e-9):
                    alone[str(f)] = round(cum / free_week(cap, prim), 2)
        scenarios[name]['weeks_top_if_alone_on_channel'] = alone
        scenarios[name]['channel'] = prim

    # THIS WEEK: idle quota is free (Derek, 2026-10-26: "use the idle quota near resets as free"). Each account's idle
    # share goes first to the tests (they decide which cells can leave Claude), then to the highest value per unit
    # of capacity, on that account only. agy's idle share is not readable from this box (main's meter): 0 here.
    idle = idle_shares(a.weekly)
    idle_plan = []
    t_claude = reserve.get('claude', 0.0)
    for acc in sorted(idle, key=lambda x: x['hours_left']):
        left = acc['idle_account_weeks']
        if left <= 0:
            continue
        to_tests = min(left, t_claude)
        t_claude -= to_tests
        p = lp(base, tiers_of, cap, 1, absolute={'claude': left - to_tests, 'agy': 0.0, 'batch': 0.0})
        idle_plan.append(dict(account=acc['account'], idle_account_weeks=left, expires=acc['resets_at'], to_tests=round(to_tests, 4),
                              cells={cid: dict(pages=round(v['pages']), read_weighted=round(v['rw']),
                                               by_route={k: round(x) for k, x in v['by_route'].items()}) for cid, v in p.items()}))

    out_cells = []
    for e in base:
        c, ch = e['cell'], e['choice']
        bk = books_of[c['id']]
        pages = sum(n for n, _ in bk.values())
        rw = sum(n * w for n, w in bk.values())
        w1 = sched[1].get(c['id'], {})
        q13 = sched[13].get(c['id'], {})
        row = dict(id=c['id'], title=c['title'], draft=c['draft'], language=c['language'], kind=c['kind'],
                   served=c['served'], bind=c['bind'], bar_worse=c['bar_worse'], pages_waiting=pages,
                   pages_waiting_read_weighted=round(rw), books=len(bk), decision=c.get('decision'), note=c.get('note'),
                   choice=ch['corrector'] if ch else None, tier=e['tier'], hold=c.get('hold'), opus_route=e['ref']['corrector'],
                   share_week1={k: round(v / free_week(cap, k), 4) for k, v in w1.get('draw', {}).items()},
                   pages_week1=round(w1.get('pages', 0)), quarter=dict(pages=round(q13.get('pages', 0)),
                                                                      read_weighted=round(q13.get('rw', 0)),
                                                                      by_route={k: round(v) for k, v in q13.get('by_route', {}).items()}),
                   weeks_to_drain=weeks_until(sched, c['id'], 0.99, pages),
                   weeks_top_read_weighted={str(f): weeks_until(sched, c['id'], f, rw, 'rw') for f in (0.1, 0.25, 0.5, 1.0)},
                   sensitivity={nm: dict(weeks_to_drain=weeks_until(s, c['id'], 0.99, pages),
                                         quarter_pages=round(s[13].get(c['id'], {}).get('pages', 0)),
                                         quarter_by_route={k: round(v) for k, v in s[13].get(c['id'], {}).get('by_route', {}).items()})
                                for nm, s in sens.items()},
                   routes=[{k: v for k, v in r.items() if not k.startswith('_')} for r in e['routes']])
        out_cells.append(row)
    chans = sorted({k for r in out_cells for k in r['share_week1']} | {'claude', 'agy'})
    channels = {k: dict(free_week=free_week(cap, k), reserved_for_tests=round(reserve.get(k, 0.0), 4),
                        quarter_used=round(sum(sched[13].get(r['id'], {}).get('draw', {}).get(k, 0) for r in out_cells) /
                                           (free_week(cap, k) * 13), 3)) for k in chans}
    # proposed routing-table rows for #7170 (a proposal file; scripts/lib/ocr-routing-table.json is not edited here)
    proposals = []
    for r in out_cells:
        if r['hold']:
            continue
        ch = next(x for x in r['routes'] if x['corrector'] == r['choice'])
        q13 = r['quarter']['by_route']
        proposals.append(dict(
            id=f"correct-{r['id']}", kind=r['title'], draft=r['draft'], corrector=ch['corrector'], stage=ch['stage'],
            fallback=r['opus_route'], retranslate='Opus CLI (claude-translate.mjs) where the page has English',
            status=('cheaper route matches Opus' if r['tier'] == 'cheaper route matches opus' else
                    'Opus (the assumed reference; no cheaper route matches it at P >= 0.9 yet)'),
            routed='no', check=f"matches Opus: net gain within max(0.05, 10%) of Opus's in {ch['p_matches_opus']:.2f} of draws ({r['bind']})",
            why=(f"net pages improved per page {ch['gain'][1]:.2f} [{ch['gain'][0]:.2f}, {ch['gain'][2]:.2f}], P(worse) {ch['p_worse'][1]:.3f}; "
                 f"{r['pages_waiting']:,} pages waiting; most-read first"),
            first_quarter=q13))
    res = dict(as_of=cap['as_of'], harm_weight=H_, threshold=T, provisional=PROVISIONAL, delta=[DELTA_ABS, DELTA_REL],
               objective='cheapest route that matches Opus (Opus the assumed reference and the fallback; Derek 2026-10-25 21:20Z)',
               horizons=HORIZONS,
               capacity=cap['channels'], channels=channels, idle_this_week=dict(accounts=idle, plan=idle_plan,
               note='idle = 1 - (used / elapsed share of the week), at the current pace; calls inside it cost 0, beyond it the full share'),
               tests=tests, scenarios=scenarios, proposed_rows=proposals, cells=out_cells,
               note='capacity in channel units (Claude account-weeks, agy calls, Batch dollars); plan fees are not used')
    json.dump(res, open(a.out, 'w'), indent=1, default=float)
    open(a.md, 'w').write(render(res) + '\n')
    print(render(res))


def fmt_draw(d, per=1000):
    u = {'claude': 'acct-wk', 'agy': 'agy calls', 'batch': '$', 'gpu-gex45': 'card-h'}
    return ' + '.join(f"{v * per:.3g} {u[k]}" for k, v in d.items() if v > 0)


def render(res):
    md = ['| cell | pages waiting (read-weighted) | route (cheapest that matches Opus; else Opus) | P(matches Opus) | net gain / page [90%] | '
          'P(worse) | capacity per 1K pages | share of the free week, week 1 | first quarter (pages by route) | weeks to drain | '
          'top 10% / 50% of reads done by week | what waits meanwhile |', '|' + '---|' * 12]
    for r in res['cells']:
        if r['hold']:
            ref = next(x for x in r['routes'] if x['corrector'] == r['opus_route'])
            md.append(f"| {r['title']} | {r['pages_waiting']:,} ({r['pages_waiting_read_weighted']:,}) | **held**: {r['hold'].split(';')[0]} | — | "
                      f"{ref['gain'][1]:.2f} (Opus) | {ref['p_worse'][1]:.3f} | {fmt_draw(ref['draw_per_page'])} | — | — | — | — | all on {r['served']} |")
            continue
        ch = next(x for x in r['routes'] if x['corrector'] == r['choice'])
        sw = ', '.join(f"{v:.0%} {k}" for k, v in r['share_week1'].items() if v >= 0.005) or '—'
        qr = '; '.join(f"{k} {v:,}" for k, v in r['quarter']['by_route'].items()) or '—'
        top = r['weeks_top_read_weighted']
        lab = ('**serve the draft** (it already matches Opus)' if ch['corrector'] == 'none' else
               f"**{ch['corrector']}**" + (' (Opus fallback)' if r['tier'] == 'opus (fallback)' else ''))
        md.append(f"| {r['title']} | {r['pages_waiting']:,} ({r['pages_waiting_read_weighted']:,}) | {lab} | {ch['p_matches_opus']:.2f} | "
                  f"{ch['gain'][1]:.2f} [{ch['gain'][0]:.2f}, {ch['gain'][2]:.2f}] | {ch['p_worse'][1]:.3f} | {fmt_draw(ch['draw_per_page']) or '0'} | {sw} | {qr} | "
                  f"{r['weeks_to_drain'] or ('0' if ch['corrector'] == 'none' else '> 260')} | {top['0.1'] or '—'} / {top['0.5'] or '—'} | "
                  f"{max(r['pages_waiting'] - r['quarter']['pages'], 0) if ch['corrector'] != 'none' else 0:,} pages after the quarter stay on {r['served']} |")
    md += ['', 'Tests reserved from the same budget (route-judge-6740 design: 30 pages per route, one Opus reader against Opus):', '',
           '| cell | route under test | basis | P(matches Opus) now | n | draw |', '|---|---|---|---|---|---|']
    for t in res['tests']:
        md.append(f"| {t['cell']} | {t['corrector']} | {t['basis']} | {t['p_matches_opus_now']:.2f} | {t['n']} | {fmt_draw(t['draw'], 1)} |")
    md += ['', 'This week: idle quota (projected unused at the reset, at the current pace), priced at 0:', '',
           '| account | used | resets | projected at reset | idle (account-weeks) | to the tests | then (pages, by cell) |', '|---|---|---|---|---|---|---|']
    plan = {p['account']: p for p in res['idle_this_week']['plan']}
    for acc in res['idle_this_week']['accounts']:
        p = plan.get(acc['account'])
        fill = '; '.join(f"{cid} {v['pages']:,}" for cid, v in (p['cells'].items() if p else []) if v['pages']) or '—'
        md.append(f"| {acc['account']} | {acc['used_percent']}% | {acc['resets_at'][:16]}Z ({acc['hours_left']} h) | {acc['projected_percent_at_reset']}% | "
                  f"{acc['idle_account_weeks']} | {p['to_tests'] if p else '—'} | {fill} |")
    md += ['', 'Decisions, in capacity terms (each forces one route on one cell; the LP re-plans everything else):', '',
           '| decision | cell, route | whole cell draws | top 10% / 25% / 50% / 100% of reads done by week (competing) | the same, with the channel to itself | pages in the first quarter | what it displaces in the quarter (pages; net pages improved) |',
           '|---|---|---|---|---|---|---|']
    for nm, sc in res['scenarios'].items():
        t, al = sc['weeks_top_read_weighted'], sc['weeks_top_if_alone_on_channel']
        dis = '; '.join(f"{k} {v['pages']:+,} ({v['net_pages_improved']:+,})" for k, v in sc['displaced_in_quarter'].items()) or 'nothing'
        md.append(f"| {nm} | {sc['cell']}, {sc['corrector']} | {fmt_draw(sc['whole_cell_draw'], 1)} | "
                  f"{' / '.join(str(t[k] or '>260') for k in ('0.1', '0.25', '0.5', '1.0'))} | "
                  f"{' / '.join(str(al.get(k, '—')) for k in ('0.1', '0.25', '0.5', '1.0'))} | {sc['quarter_pages']:,} | {dis} |")
    sens_names = list(next(r for r in res['cells'] if not r['hold'])['sensitivity'])
    md += ['', 'Sensitivity (weeks to drain; pages in the first quarter):', '', '| cell | base | ' + ' | '.join(sens_names) + ' |',
           '|' + '---|' * (2 + len(sens_names))]
    for r in res['cells']:
        if r['hold'] or r['choice'] == 'none':
            continue
        cells = [f"{r['weeks_to_drain'] or '>260'} wk; {r['quarter']['pages']:,}"]
        for nm in sens_names:
            s = r['sensitivity'][nm]
            cells.append(f"{s['weeks_to_drain'] or '>260'} wk; {s['quarter_pages']:,}" +
                         (f" ({', '.join(f'{k} {v:,}' for k, v in s['quarter_by_route'].items())})" if len(s['quarter_by_route']) > 1 else ''))
        md.append(f"| {r['id']} | " + ' | '.join(cells) + ' |')
    md += ['', 'Proposed routing-table rows (for #7170; the tables are not edited here):', '',
           '| id | draft → route (fallback) | status | check | why |', '|---|---|---|---|---|']
    for p in res['proposed_rows']:
        md.append(f"| {p['id']} | {p['draft']} → {p['corrector']} ({p['fallback']}) | {p['status']} | {p['check']} | {p['why']} |")
    md += ['', 'Every route per cell:', '',
           '| cell | route (stage) | basis | P(worse) [90%] | P(better) [90%] | net gain [90%] | P(matches Opus) | tier | P(best) | capacity per 1K pages |',
           '|' + '---|' * 10]
    for r in res['cells']:
        for x in r['routes']:
            md.append(f"| {r['id']} | {x['corrector']} ({x['stage']}) | {'measured' if x['measured'] else 'pooled'} | "
                      f"{x['p_worse'][1]:.3f} [{x['p_worse'][0]:.3f}, {x['p_worse'][2]:.3f}] | {x['p_better'][1]:.2f} [{x['p_better'][0]:.2f}, {x['p_better'][2]:.2f}] | "
                      f"{x['gain'][1]:.2f} [{x['gain'][0]:.2f}, {x['gain'][2]:.2f}] | {x['p_matches_opus']:.2f} | {x['tier']} | {x.get('p_best', '—')} | {fmt_draw(x['draw_per_page']) or '0'} |")
    return '\n'.join(md)


if __name__ == '__main__':
    sys.exit(main())
