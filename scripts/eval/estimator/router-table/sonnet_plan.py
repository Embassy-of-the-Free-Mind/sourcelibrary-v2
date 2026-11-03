#!/usr/bin/env python3
# PRIOR ART: planner/planner_v0.py (#6740): expected loss removed per quota-priced test, preposterior; its posteriors are
# v0 CER and 1-5 fidelity, and its pages are 2026-10-15, so it cannot rank router cells. The value-of-a-test idea and the
# capacity rule are kept, on the router's loss (build.py loss). heldout/heldout.py Design / fit / predict (#7878) and
# pooled_prior.py's factors and hyperparameters are imported, not refitted. build.py test_next ranks by variance x pages:
# no cost, no decision, and an engine with no route row is invisible to it.
"""Where would a Sonnet test change a router decision? (#7263). Stdlib, no model calls, no DB.

  python3 scripts/eval/estimator/router-table/sonnet_plan.py <table.json> [--out <file.json>] [--pts-per-usd 0.04]   (repo root)

Sonnet has no judged route, so the pooled logit has no level for it. Each role takes a measured reference engine's level
plus a BRIDGE from the records that did test Sonnet (BRIDGE below, every number sourced). Prediction per cell: eta ~
N(reference engine's fit in this cell + delta, model sd^2 + delta sd^2), p | eta ~ Beta at the prior's worth (5 pages, #7878).
Value of a test: preposterior, E[min loss after n judged pages] against min loss now, per page, x pages it can carry.
"""
import json, math, os, random, statistics as S, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'heldout'))
from factors import factors  # noqa: E402
from heldout import Design, fit, predict  # noqa: E402
arg = lambda f, d=None: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d
GROUPS = ('eng', 'draft', 'lang', 'wsys', 'stype')
expit = lambda x: 1 / (1 + math.exp(-x))
PRICE = dict(image_usd=0.0513, read_usd=float(arg('--read-usd', 0.0513)), text_usd=0.0406)   # list dollars a call, one page a call: 20 image corrections, 20 translations (this job); --read-usd 0.0277 is the 50 reads, measured after the plan fixed the test
JUDGE_PTS, W_PRIOR, N_TEST, LAM = 0.0124, 5, 30, 20   # rules.json test_next; prior.pooled.pages; a test; loss.lambda_multiple
USD_PER_POINT = 200 * 12 / 52 / 100   # rules.json fees.default_plan_month_usd
AGY_USD_PER_CALL = 4.45e-06 * 200   # rules.json stages agy_share x the plan fee
WRONG_PER_REJECT = 0.82   # median pw / (1 - acc) over 149 tested routes with n_eff >= 8 (2026-11-02-policy-7913)
BRIDGE = {
    'read': dict(ref='flash3', beta_cer=1.0, sd=0.6, why='#6011 paired CER: Sonnet ties 3 Flash on early English (27/11/22, +0.000), 0.940 vs 0.947 on Latin (mostly f for long s), worse off Latin script. delta = -1 logit per e-fold of its v1 chart CER against 3 Flash (a judgement: rules.json calibration slope 0.40 says the CER models run too extreme)'),
    'correct': dict(ref='agy-correct', delta=-0.25, sd=0.7, why='#6667: Sonnet gains 47% of what Opus gains on Paddle tables (3.8 Flash high 66%), makes 10/40 pages worse (Opus 1, Flash 2)'),
    'correct-tibt': dict(ref='agy-correct', delta=-1.5, sd=0.7, why='#6667: Sonnet returned the Tibetan draft unchanged on 29/30, left 28/30 plants'),
    'translate': dict(ref='tr-agy', delta=-0.5, sd=0.4, why='#6182: -0.16 [-0.22, -0.09] fidelity against Gemini 3.8 Flash, 2.6x its reversal pages; never better in #6331'),
}


def v1_cer(table_rules, v1_path):
    """chart -> ln(CER Sonnet / CER 3 Flash), from v1's medians (the only place all charts carry Sonnet)."""
    out = {}
    for c in json.load(open(v1_path))['cells']:
        by = {r.get('engine'): r.get('cer') for r in c['routes'] if r.get('cer')}
        s, f = by.get('claude-sonnet-5-5'), by.get('gemini-3-flash-preview')
        if s and f and s[1] > 0 and f[1] > 0:
            out[c.get('chart') or c.get('cell') or c.get('id')] = round(math.log(s[1] / f[1]), 3)
    return out


def usd_acc(x):
    """A route's median dollars per accepted page. build.py `cost` is in the channel's units: Claude points, agy calls."""
    if not x.get('cost'): return 0.0
    return x['cost'][1] * (USD_PER_POINT if x.get('channel') == 'claude' else AGY_USD_PER_CALL if x.get('channel') == 'agy' else 0.0)


def sample_p(rng, eta, sd):
    m = expit(rng.gauss(eta, sd))
    return rng.betavariate(max(m * W_PRIOR, 1e-3), max((1 - m) * W_PRIOR, 1e-3))


def main():
    path = next(a for a in sys.argv[1:] if a.endswith('.json') and a != arg('--out'))
    T = json.load(open(path)); P = json.load(open('scripts/eval/estimator/router-table/rules.json'))
    PPY = float(arg('--pts-per-usd', 0.04))
    PP = json.load(open(P['inputs']['pooled_prior']))
    ctx, train = {}, []
    for c in T['rows']:
        base = c.get('base') or c['id'].split('/')[0]
        ctx[c['id']] = dict(c, base=base, script=c.get('script') or 'print')
        for x in c['routes']:
            if x['tested'] and x.get('eff') and x['eff'][1] > 0:
                train.append(dict(row=c['id'], base=base, route=x['id'], f=factors(ctx[c['id']], x), k=x['eff'][0], n=x['eff'][1]))
    D = Design(train, GROUPS); F = fit(D, train, dict(PP['hyper']['sig'], mu=10.0), PP['hyper']['W'])
    cer = v1_cer(P, P['inputs']['v1'])
    v1cell = {c['id']: (c.get('v1') or [None])[0] for c in P['cells']}
    pts = {k: PRICE[f'{k}_usd'] * PPY for k in ('image', 'read', 'text')}
    cap_q = lambda p: 0.5 * 400 * 13 / p   # planner_v0's capacity rule: half of four accounts for a quarter
    rows = []
    for c in T['rows']:
        pages = c.get('pages_waiting') or 0
        if not pages or str(c.get('decision', '')).startswith(('held', 'planned')): continue
        cx = ctx[c['id']]
        tr = '-tr' in cx['base']
        roles = ['translate'] if tr else ['read', 'correct'] if '>' in str(c.get('current')) or cx['base'].split('-')[-1] in ('lite', 'flash3', 'paddle', 'yigdzin', 'gpu') else ['read']
        inc = next((x for x in c['routes'] if x['id'] == c.get('route')), None)
        if inc is None or not inc.get('tested'): inc_acc, inc_pw, inc_usd = None, None, 0.0
        else: inc_acc, inc_pw, inc_usd = inc['mean'], inc['pw'], usd_acc(inc)
        priced = [usd_acc(x) for x in c['routes'] if x.get('tested') and usd_acc(x) > 0]   # build.py good_read_usd: a free draft is not a price
        good = [usd_acc(x) for x in c['routes'] if x.get('tested') and usd_acc(x) > 0 and x.get('p_abs', 0) >= 0.9]
        c0 = min(good or priced or [0.001])
        bars = [x for x in c['routes'] if x.get('tested') and x.get('channel') == 'claude'] or [x for x in c['routes'] if x.get('tested')]
        bar = max((x['mean'] for x in bars), default=None)
        for role in roles:
            key = 'correct-tibt' if role == 'correct' and cx['base'].startswith(('tibetan', 'tengyur')) else role
            B = BRIDGE[key]
            fake = dict(id=(cx['base'].split('-')[-1] + '>agy-flash-low') if role == 'correct' else 'agy-flash-low@4' if tr else '3flash')
            try: f = factors(cx, fake)
            except KeyError: continue
            f['eng'] = B['ref']
            if role == 'read': f['draft'] = 'none'
            if any((g, f[g]) not in D.index for g in GROUPS if g in ('eng', 'draft')): continue
            r = dict(f=f, k=0, n=0)
            p = predict(D, F, r)
            ch = cer.get(v1cell.get(cx['base']))
            delta = -B['beta_cer'] * (ch if ch is not None else 0) if 'beta_cer' in B else B['delta']
            sd = math.hypot(p['eta_sd'], B['sd'] if ch is not None or 'beta_cer' not in B else 1.0)
            eta = p['eta'] + delta
            rng = random.Random(f"{c['id']}|{role}")
            kind = 'text' if tr else 'read' if role == 'read' else 'image'
            usd = PRICE[f'{kind}_usd'] * PPY * USD_PER_POINT
            draws = [sample_p(rng, eta, sd) for _ in range(2000)]
            m = S.mean(draws)
            lam = LAM * c0
            L = lambda acc: usd / max(acc, 0.02) + lam * WRONG_PER_REJECT * (1 - acc)
            Linc = (inc_usd + lam * inc_pw) if inc_pw is not None else None
            p_bar = sum(d >= bar - 0.08 for d in draws) / len(draws) if bar is not None else None
            # preposterior: a Beta matched to the draws, updated on n pages; switch if the posterior mean's loss beats the incumbent
            a0 = m * (m * (1 - m) / max(S.pvariance(draws), 1e-6) - 1); b0 = a0 * (1 - m) / m
            evoi = 0.0
            if Linc is not None:
                now = min(Linc, S.mean(L(d) for d in draws))
                after = 0.0
                for th in draws:
                    k = sum(rng.random() < th for _ in range(N_TEST))
                    post = (a0 + k) / (a0 + b0 + N_TEST)
                    after += L(th) if L(post) < Linc else Linc
                evoi = max(0.0, now - after / len(draws))
            # the acceptance at which Sonnet's loss meets the incumbent's: below it the router would not pick it at this price
            be = None
            if Linc is not None:
                lo, hi = 0.02, 1.0
                if L(hi) > Linc: be = 1.0
                elif L(lo) <= Linc: be = lo
                else:
                    for _ in range(40):
                        mid = (lo + hi) / 2
                        lo, hi = (mid, hi) if L(mid) > Linc else (lo, mid)
                    be = hi
            ppp = pts[kind]
            cap = min(pages, cap_q(ppp))
            test_pts = N_TEST * (ppp + JUDGE_PTS)
            script = cx['script']
            flag = 'V2: Claude-written text cannot win on the Opus judge alone here' if script == 'manuscript' else 'unknown script: decide on a split cell' if script == 'unknown' else None
            rows.append(dict(cell=c['id'], role=role, route=('sonnet-text@1' if tr else 'sonnet-read' if role == 'read' else f"{fake['id'].split('>')[0]}>sonnet"), pages=pages, decision=c.get('decision'), incumbent=c.get('route'), inc_acc=inc_acc and round(inc_acc, 3), inc_pw=inc_pw and round(inc_pw, 3),
                             pred=round(m, 3), pred_ci90=[round(sorted(draws)[int(.05 * 2000)], 2), round(sorted(draws)[int(.95 * 2000)], 2)], bar=bar and round(bar - 0.08, 3), p_clears_bar=p_bar and round(p_bar, 2), usd_per_1k=round(usd * 1000, 2), c0_per_1k=round(c0 * 1000, 2), break_even=be and round(be, 3), delta=round(delta, 2), v1_ln_cer=ch,
                             evoi_usd_per_1k=round(evoi * 1000, 4), value_usd=round(evoi * cap, 2), test_points=round(test_pts, 3), value_per_point=round(evoi * cap / test_pts, 2), flag=flag))
    rows.sort(key=lambda r: (r['flag'] is not None, -r['value_per_point']))
    res = dict(table=path, pts_per_usd=PPY, price=PRICE, bridge=BRIDGE, v1_ln_cer_sonnet_vs_flash3=cer, n_candidates=len(rows), rows=rows)
    if arg('--out'): open(arg('--out'), 'w').write(json.dumps(res, indent=1, ensure_ascii=False) + '\n')
    print(f"pts/$ {PPY}; {len(rows)} candidate tests; image ${PRICE['image_usd'] * PPY * USD_PER_POINT * 1000:.2f}/1K, text ${PRICE['text_usd'] * PPY * USD_PER_POINT * 1000:.2f}/1K")
    print(json.dumps({k: v for k, v in cer.items()}))
    for r in rows[:16]:
        print(f"{r['cell']:34s} {r['route']:18s} pages {r['pages']:7d} inc {str(r['incumbent'])[:22]:22s} {r['inc_acc']} pw {r['inc_pw']} | pred {r['pred']} {r['pred_ci90']} bar {r['bar']} P {r['p_clears_bar']} | ${r['value_usd']:9.2f} /pt {r['value_per_point']:9.2f} {r['flag'] or ''}")


if __name__ == '__main__':
    main()
