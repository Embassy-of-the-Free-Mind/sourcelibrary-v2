#!/usr/bin/env python3
# PRIOR ART: v3_sim.py — simulates build.decide() at a cell's fixed n with independent draws, no repeated looks;
# build.paired_draws() — the paired posterior this reuses (validated against it below, not re-specified).
"""Sequential stop rule for a paired route test (#7263, Derek 2026-11-04: "stop rule 0.99 / 0.90 / cap 100 subject to
simulation"). Stdlib only, no model calls, no DB.

  python3 scripts/eval/estimator/router-table/stop_sim.py [--reps 20000] [--out <file.json>]          (repo root)

The rule, on pages judged under both routes (the candidate and the reference), one page a book:
  start at `start` pages, then look after every `batch` more; at each look form build.paired_draws()'s posterior
  (Dirichlet(1 + counts) over both / candidate only / reference only / neither) on d = acc_cand - acc_ref, and
    PASS  (candidate within the margin)  when P(d >= -within) >= p_win;
    WORSE (stop testing the candidate)   when P(d <  -within) >= p_worse;
    at `cap` pages with neither: no decision (the cell keeps its route).
within = rules.json switch.within (0.08).

P(d >= -m) is computed exactly rather than by draws: (p_cand_only, p_ref_only, rest) ~ Dirichlet(a1, a2, a0), so with
s = p_cand_only + p_ref_only ~ Beta(a1 + a2, a0) and u = p_ref_only / s ~ Beta(a2, a1), d = s (1 - 2u) and
P(d >= -m) = E_s[ I_{min(1, (1 + m / s) / 2)}(a2, a1) ]. --check compares it with paired_draws() at 40,000 draws.

Truth: each page is a pair of Bernoulli outcomes with the reference's rate, the candidate's rate and a link phi (the
correlation of the two outcomes on one page, measured per route pair type in the route-free record). Reported:
  false pass   P(PASS) when the candidate is truly within + 0.01 below the reference (bar: <= 5%);
  power        P(PASS) when the candidate truly ties the reference;
  mean pages   pages judged under both routes before the rule stops (or the cap).
"""
import functools, importlib.util, json, math, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(HERE, 'build.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
arg = lambda f, d=None: sys.argv[sys.argv.index(f) + 1] if f in sys.argv else d


def betacf(a, b, x):
    """Continued fraction for the regularized incomplete beta (modified Lentz)."""
    qab, qap, qam = a + b, a + 1, a - 1
    c, d = 1.0, 1 - qab * x / qap
    d = 1 / (d if abs(d) > 1e-300 else 1e-300); h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1 + aa / c; c = c if abs(c) > 1e-300 else 1e-300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1 + aa * d; d = 1 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1 + aa / c; c = c if abs(c) > 1e-300 else 1e-300
        de = d * c; h *= de
        if abs(de - 1) < 1e-12: break
    return h


def ibeta(x, a, b):
    if x <= 0: return 0.0
    if x >= 1: return 1.0
    lb = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    if x < (a + 1) / (a + b + 2): return math.exp(lb) * betacf(a, b, x) / a
    return 1 - math.exp(lb) * betacf(b, a, 1 - x) / b


@functools.lru_cache(maxsize=None)
def p_within(cand_only, ref_only, n, m, grid=600):
    """P(acc_cand - acc_ref >= -m) under Dirichlet(1 + counts), exactly up to the quadrature over s."""
    a1, a2 = 1 + cand_only, 1 + ref_only; a0 = 2 + n - cand_only - ref_only
    A, Bb = a1 + a2, a0
    lnorm = math.lgamma(A + Bb) - math.lgamma(A) - math.lgamma(Bb)
    tot = w = 0.0
    for i in range(grid):  # midpoint rule on s in (0, 1)
        s = (i + 0.5) / grid
        pdf = math.exp(lnorm + (A - 1) * math.log(s) + (Bb - 1) * math.log(1 - s))
        tot += pdf * ibeta(min(1.0, (1 + m / s) / 2), a2, a1); w += pdf
    return tot / w


def check(m):
    rng = random.Random(1)
    out = []
    for n, co, ro in ((20, 1, 3), (30, 2, 5), (50, 3, 8), (100, 4, 12), (40, 0, 6), (60, 10, 4)):
        c = dict(both=n - co - ro - 2, a_only=co, b_only=ro, neither=2)
        d = B.paired_draws(c, 40000, rng)
        mc = sum(x >= -m for x in d) / len(d)
        out.append(dict(n=n, cand_only=co, ref_only=ro, exact=round(p_within(co, ro, n, m), 4), paired_draws=round(mc, 4)))
    return out


def joint(pr, pc, phi):
    """Page outcome probabilities (both, cand only, ref only, neither) for rates pr, pc and link phi (clipped)."""
    p11 = pr * pc + phi * math.sqrt(pr * (1 - pr) * pc * (1 - pc))
    p11 = min(max(p11, max(0.0, pr + pc - 1)), min(pr, pc))
    return p11, pc - p11, pr - p11, 1 - pr - pc + p11


def run_rule(rule, pr, pc, phi, reps, rng, m):
    p11, p10, p01, _ = joint(pr, pc, phi)
    c1, c2 = p11 + p10, p11 + p10 + p01
    res = dict(pass_=0, worse=0, none=0, pages=0)
    looks = list(range(rule['start'], rule['cap'] + 1, rule['batch']))
    for _ in range(reps):
        co = ro = n = 0; out = 'none'
        for L in looks:
            while n < L:
                u = rng.random(); n += 1
                if p11 <= u < c1: co += 1
                elif c1 <= u < c2: ro += 1
            pw = p_within(co, ro, n, m)
            if pw >= rule['p_win']: out = 'pass_'; break
            if 1 - pw >= rule['p_worse']: out = 'worse'; break
        res[out] += 1; res['pages'] += n
    return dict(false_or_power=res['pass_'] / reps, worse=res['worse'] / reps, no_decision=res['none'] / reps, mean_pages=round(res['pages'] / reps, 1))


def main():
    P = json.load(open(os.path.join(HERE, 'rules.json')))
    m = P['switch']['within']
    reps = int(arg('--reps', 20000))
    doc = dict(within=m, reps=reps, check=check(m))
    rule0 = dict(start=20, batch=10, p_win=0.99, p_worse=0.90, cap=100)
    refs = [0.95, 0.90, 0.80, 0.70]
    phis = [0.0, 0.13, 0.30, 0.45]
    rng = random.Random(7263)

    def grid(rule):
        rows = []
        for pr in refs:
            for phi in phis:
                fp = run_rule(rule, pr, pr - m - 0.01, phi, reps, rng, m)
                pw = run_rule(rule, pr, pr, phi, reps, rng, m)
                rows.append(dict(ref=pr, phi=phi, phi_effective=round(eff_phi(pr, pr - m - 0.01, phi), 3), false_pass=round(fp['false_or_power'], 4),
                                 false_pass_mean_pages=fp['mean_pages'], false_stop_worse=round(fp['worse'], 3),
                                 power_tie=round(pw['false_or_power'], 4), tie_stopped_worse=round(pw['worse'], 4), tie_no_decision=round(pw['no_decision'], 3), tie_mean_pages=pw['mean_pages']))
        return rows

    doc['rule'] = rule0; doc['grid'] = grid(rule0)
    doc['rule_max_false_pass'] = max(r['false_pass'] for r in doc['grid'])
    # nearest rules: tighten one dial at a time, then the fixed-n comparison (one look at the cap)
    alts = [dict(rule0, p_win=0.995), dict(rule0, p_win=0.999), dict(rule0, start=30), dict(rule0, start=30, p_win=0.995),
            dict(rule0, cap=150), dict(rule0, batch=20), dict(start=100, batch=10, p_win=0.99, p_worse=0.90, cap=100),
            dict(start=30, batch=10, p_win=0.90, p_worse=0.90, cap=30)]
    doc['alternatives'] = []
    for a in alts:
        g = grid(a)
        doc['alternatives'].append(dict(rule=a, max_false_pass=max(r['false_pass'] for r in g), grid=g))
        sys.stderr.write(f"{a} max false pass {max(r['false_pass'] for r in g):.3f}\n")
    s = json.dumps(doc, indent=1)
    if arg('--out'): open(arg('--out'), 'w').write(s + '\n')
    print(json.dumps(dict(check=doc['check'], rule=rule0, max_false_pass=doc['rule_max_false_pass'], grid=doc['grid']), indent=1))


def eff_phi(pr, pc, phi):
    p11 = joint(pr, pc, phi)[0]
    return (p11 - pr * pc) / math.sqrt(pr * (1 - pr) * pc * (1 - pc))


if __name__ == '__main__':
    if '--check' in sys.argv:
        print(json.dumps(check(json.load(open(os.path.join(HERE, 'rules.json')))['switch']['within']), indent=1)); sys.exit()
    main()
