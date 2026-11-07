#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/stop_sim.py (p_within, the exact posterior the rule was simulated with;
# imported, not restated). It simulates the rule; this applies it to a run's verdict files.
"""Apply the stop rule. python3 look.py OUT CELL_JSON writes OUT/<cell>/looks.json, prints what stands and what to read next.
Rule (2026-11-04-route-free-analyses-7263.md section 6): first look at 20 pairs, then every 10; PASS at P(d >= -0.08) >= 0.99;
WORSE at P(d < -0.08) >= 0.90; cap 100. A failed read counts as not accepted, in n. A decided pair stays decided."""
import importlib.util, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('stop_sim', os.path.join(HERE, '../estimator/router-table/stop_sim.py'))
S = importlib.util.module_from_spec(spec); sys.modules['stop_sim'] = S; spec.loader.exec_module(S)
M, PASS, WORSE, START, STEP, CAP = 0.08, 0.99, 0.90, 20, 10, 100

def run(cdir, pairs):
    out = json.load(open(os.path.join(cdir, 'outcomes.json')))  # {arm: {key: true|false}} in draw order, key list under _order
    order = out['_order']; res = {}
    for cand, ref in pairs:
        name = f'{cand}|{ref}'; hist = []; state = None; n = START
        while n <= CAP:
            keys = order[:n]
            if len(keys) < n or any(k not in out.get(cand, {}) or k not in out.get(ref, {}) for k in keys): break
            co = sum(out[cand][k] and not out[ref][k] for k in keys); ro = sum(out[ref][k] and not out[cand][k] for k in keys)
            p = S.p_within(co, ro, n, M)
            hist.append(dict(n=n, cand=sum(out[cand][k] for k in keys), ref=sum(out[ref][k] for k in keys), cand_only=co, ref_only=ro, p_within=round(p, 4)))
            if p >= PASS: state = 'PASS'; break
            if 1 - p >= WORSE: state = 'WORSE'; break
            n += STEP
        if not state and hist and hist[-1]['n'] >= CAP: state = 'CANT_TELL'
        res[name] = dict(state=state, hist=hist)
    return res

if __name__ == '__main__':
    cdir, pairs = sys.argv[1], json.loads(sys.argv[2])
    res = run(cdir, pairs)
    json.dump(res, open(os.path.join(cdir, 'looks.json'), 'w'), indent=1)
    done = lambda r: r['state'] is not None
    for k, r in res.items(): print(k, r['state'], r['hist'][-1] if r['hist'] else 'no look yet')
    active = sorted({a for k, r in res.items() if not done(r) for a in k.split('|')})
    upto = max([(r['hist'][-1]['n'] + STEP) if r['hist'] else START for r in res.values() if not done(r)] or [0])
    print(json.dumps(dict(active=active, next_upto=upto)))
