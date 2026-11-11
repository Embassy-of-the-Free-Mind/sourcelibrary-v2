#!/usr/bin/env python3
# PRIOR ART: build.py before #8283 — this IS its k/n decision path (git 0cc5d4e0f), moved, not rewritten. v3_sim.py replays
# the V3 multiplicity simulation through it; the table no longer decides with it (build.py decide_defects does).
"""The retired k/n decision (#8283). Only v3_sim.py reads it, so that V3's published error rates can be reproduced. A
simulation of the defect rule itself is v3_sim.py's default (--rule defects); this one runs under --rule kn."""
from build import floor_ok, in_force, is_bar, within_p  # noqa: F401  (the helpers the frozen code calls)


def within_ind(r, best, within):
    """Per draw: is acc_r >= acc_best - within (paired draws where r and best share pages, else the two posteriors)."""
    pd = r.get('_pd', {}).get(best['id'])
    if pd is not None: return [d >= -within for d in pd]
    return [u >= v - within for u, v in zip(r['_d'], best['_d'])]


def gate_p(P, K):
    """The posterior probability a candidate must reach when K candidates are gated together (V3, #7263;
    rules.json switch.multiplicity). none: switch.p, whatever K. bonferroni: 1 - alpha / K. sidak: (1 - alpha)^(1/K)."""
    mu = P['switch'].get('multiplicity') or {}
    m, a = mu.get('method', 'none'), mu.get('alpha')
    if m == 'bonferroni': return 1 - a / max(K, 1)
    if m == 'sidak': return (1 - a) ** (1 / max(K, 1))
    return P['switch']['p']


def gate(M, P, wt_max, within):
    """The quality gate: measured routes with P(acc >= acc_best - within) >= the gate's p and wrong text <= the bar.
    With switch.bar = opus, acc_best is the best measured Opus route's (the best measured route's when no Opus route is
    measured) and only the other routes are candidates. A route judged on the same pages as acc_best's route is
    compared PAIRED (within_p; the cell's `paired` entries in rules.json).
    Multiplicity (V3): the cheapest passer of K candidates is picked, so each is gated at gate_p(P, K), not switch.p;
    method joint passes the largest set S (by marginal P, descending) whose JOINT posterior P(every route in S within the
    margin) >= 1 - alpha, so the pick, whichever of S it is, is within the margin with that probability; method
    max-bonferroni compares each candidate with the per-draw maximum of the reference set (below)."""
    best = max([r for r in M if is_bar(r, P)] or M, key=lambda r: r['mean'])
    cand = [r for r in M if not is_bar(r, P) and r is not best]
    wt_ok = lambda r: r['wrate'] <= wt_max(best)
    mu = P['switch'].get('multiplicity') or {}
    if mu.get('method') == 'max-bonferroni':
        # every route that can be picked (the best by mean too, where no bar is measured) against the per-draw MAXIMUM of
        # the reference set (the bar routes, else every other measured route), at 1 - alpha / K: the reference is not
        # chosen by the same draws it is compared with, so a lucky route cannot pass by being its own reference
        refs = [r for r in M if is_bar(r, P)]
        cand = [r for r in M if not is_bar(r, P)]
        pk = 1 - mu['alpha'] / max(len(cand), 1)
        ok = []
        for r in cand:
            others = [s for s in (refs or M) if s is not r]
            if not others: pr = 1.0
            elif len(others) == 1: pr = within_p(r, others[0], within)
            else:
                mx = [max(t) for t in zip(*[s['_d'] for s in others])]
                pr = sum(u >= v - within for u, v in zip(r['_d'], mx)) / len(mx)
            r['_gate_p'] = pr
            if pr >= pk and wt_ok(r): ok.append(r)
        return best, ok
    if mu.get('method') == 'joint':
        ind = {r['id']: within_ind(r, best, within) for r in cand}
        S, joint = [], None
        for r in sorted(cand, key=lambda r: -sum(ind[r['id']])):
            j = ind[r['id']] if joint is None else [a and b for a, b in zip(joint, ind[r['id']])]
            if sum(j) / len(j) < 1 - mu['alpha']: break
            S.append(r); joint = j
        ok = [r for r in S if wt_ok(r)]
    else:
        pk = gate_p(P, len(cand))
        ok = [r for r in cand if within_p(r, best, within) >= pk and wt_ok(r)]
    if not is_bar(best, P) and wt_ok(best): ok = [best] + ok   # the reference itself is within the margin of itself
    return best, ok


def pick(ok, cur, cost):
    """Lowest median dollars per accepted page; a tie (two routes free) goes to the higher acceptance."""
    return min(ok, key=lambda r: (cost(r), -r['mean'])) if ok else cur


def good_read_usd(M, P):
    """The cell's cheapest good-read cost (rules.json loss): the lowest median dollars per accepted page among its
    measured, priced routes that clear the absolute bar (the Opus bar routes included: they are what a good read costs
    today), else among all its measured priced routes. None when no measured route is priced (every route free)."""
    pr = [r for r in M if r.get('_usd_raw') and r['_usd_acc'] != float('inf')]
    good = [r for r in pr if r.get('p_abs', 0) >= P['absolute_bar']['p']] if in_force(P, 'absolute_bar') else pr
    return min(r['_usd_acc'] for r in (good or pr)) if pr else None


def loss(r, cost, c0, P):
    """The priced loss (Derek, 2026-11-01): cost + lambda x P(wrong text), lambda = lambda_multiple x c0, c0 the cell's
    cheapest good-read cost. P(wrong text) = the posterior mean wrong-text rate (book-scaled, rules.json loss.wrong_text_prior).
    c0 None (no route priced): every cost is 0, so the loss orders by P(wrong text) alone."""
    return cost(r) + P['loss']['lambda_multiple'] * (c0 or 1.0) * r['pw']


def needs_engine(M, P):
    """The absolute bar (Derek, 2026-11-01): no pickable measured route has P(acc >= absolute_bar.acc) >= absolute_bar.p.
    Returns the label, or None when a route clears it (or the bar is off). 'evidence' when the best route's posterior mean
    is over the bar but its pages are too few to show it; 'engine' when even its mean is below."""
    if not in_force(P, 'absolute_bar') or not M: return None
    A = P['absolute_bar']; cand = [r for r in M if not is_bar(r, P)]
    if any(r['p_abs'] >= A['p'] for r in cand): return None
    b = max(cand or M, key=lambda r: r['p_abs'])
    why = 'evidence' if b['mean'] >= A['acc'] else 'engine'
    only_bar = any(r['p_abs'] >= A['p'] for r in M if is_bar(r, P))
    return f"NEEDS-ENGINE ({why}: best {b['id']} P(acc >= {A['acc']:g}) = {b['p_abs']:.2f}, mean {b['mean']:.2f}" + ('; only the Opus bar clears it' if only_bar else '') + ')'


def decide(cell, M, cur, P, cost, wt_max, within=None, c0=None):
    """keep / switch / HOLD / NEEDS-ENGINE. With rules.json loss in force (c0 = the cell's good-read cost, good_read_usd),
    the pick among the gate's passers is the lowest priced loss, and the wrong-text margin is not applied (the loss
    prices wrong text); with absolute_bar in force a passer must also clear the absolute bar, and a cell where no
    pickable route does is NEEDS-ENGINE. Neither in force: the rule of #7888 (margins, cheapest per accepted page).
    The rules of 2026-11-02 (#7263; each its own flag, --off <name>):
      no_absolute_gate: NEEDS-ENGINE and HOLD do not block; the cell is decided and the flag rides on the row
        (needs_engine_flag), the route labelled with its measured rate.
      hard_floor: a route whose invented-or-wrong-leaf rate is over the floor (hard_floor_block) cannot be picked.
      no_served_privilege: when no candidate passes the gate the cell does not keep its current route: it takes the
        lowest-loss measured agy / GPU route that clears the hard floor, else (only then) the lowest-loss Opus route that
        does, else HOLD (hard floor)."""
    if cell.get('held'): return 'held', cur
    if not M: return 'keep (UNTESTED)', cur
    NA = in_force(P, 'no_absolute_gate')
    cand = [r for r in M if not is_bar(r, P)]
    ne = needs_engine(M, P)
    if ne and not NA: return ne, max(cand or M, key=lambda r: r['p_abs'])
    if not NA and not any(r['p80'] >= P['hold']['p'] for r in M): return 'HOLD', max(cand, key=lambda r: r['mean']) if cand else cur
    priced = in_force(P, 'loss')
    ok = gate(M, P, (lambda best: float('inf')) if priced else wt_max, P['switch']['within'] if within is None else within)[1]
    if in_force(P, 'absolute_bar') and not NA: ok = [r for r in ok if r['p_abs'] >= P['absolute_bar']['p']]
    ok = [r for r in ok if floor_ok(r, P)]
    by_loss = lambda rs: min(rs, key=lambda r: (loss(r, cost, c0, P), cost(r), -r['mean'])) if priced else pick(rs, None, cost)
    if ok: p = by_loss(ok)
    elif not in_force(P, 'no_served_privilege'): p = cur
    else:
        # Opus last in every cell, a manuscript's too (where it is a candidate, not the bar): by channel, not by is_bar
        opus = lambda r: is_bar(r, P) or (r.get('channel') == 'claude' and not r.get('candidate'))   # a stage marked candidate (Sonnet, #7263) is an ordinary route
        alt = [r for r in M if not opus(r) and floor_ok(r, P)]
        bar = [r for r in M if opus(r) and floor_ok(r, P)]
        if not (alt or bar): return 'HOLD (hard floor: no measured route clears it)', max(cand or M, key=lambda r: r['mean'])
        p = by_loss(alt or bar)
        return ('keep' if p is cur else 'switch') + ((' (fallback: none passes the gate; the best candidate route, Sonnet)' if p.get('candidate') else ' (fallback: none passes the gate; the best agy / GPU route)') if alt else
                                                     ' (fallback: no agy / GPU route clears the hard floor; Opus)'), p
    return ('keep' if p is cur else 'switch'), p
