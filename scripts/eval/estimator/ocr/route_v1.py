#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/planner/ (planner v0: ranks TESTS by expected loss per quota, never picks a route);
# scripts/eval/estimator/routing/derive_routes.py (#7170: proposes routing-table rows from P(best) on CER alone);
# en-ocr-reference-5124.mjs report (the #4763 gate tables: raw counts per stratum, no posterior, no cost). None
# prices a route or follows a refused page down a chain. This does both, for the English number pages first (#6740).
"""OCR estimator v1, routing: per cell, the cheapest chain of readers whose share of USABLE pages clears the bar,
and its expected cost per usable page (#6740; design .claude/docs/quality-research-system.md §3a).

A chain is an ordered list of readers; a page one reader refuses goes to the next (the Archive's text never refuses,
it is already on disk). For each cell and chain:

  P(usable)   = sum_i P(reach reader i) * P(i reads) * P(severity <= 1 | i reads)
  E[cost]     = sum_i P(reach reader i) * cost_i
  cost/usable = E[cost] / P(usable)

P(reach) uses the refusal model's JOINT refusal on one page (refusal_v1.py: a page effect shared by the engines), so
"agy refused it" raises the chance that lite refuses it too. Severity is the comment-of-2026-10-24 scale, here a
MECHANICAL PROXY from scorePage fields until by-eye grades exist for this cell (see severity()); P(severity <= 1) is
a logistic fit per reader x cell with a page effect shared by readers (fit_usable says why not ordinal).

Costs per call, never from memory:
  archive  $0 (text already held)
  lite     list price: the measured cost_usd of #4780's realtime reads (median), halved for the Batch API
  agy      quota share = 1 / daily cap, the cap read from /root/agy-quota/status.json past_bursts (calls in the 24 h
           before each lock); dollars only when --fees names the PRIVATE plan-fee file (ops repo, never committed here)
  gpu      $0 on an idle card

  route_v1.py --scores agy-scores.jsonl [--scores gpu-scores.jsonl] --refusal results/refusal-v1-draws.npz \
      --agy-status status.json --lite-cost scripts/eval/results/ia-ocr-delivered-quality-2026-09-13.jsonl \
      [--fees plan-fees.json] [--bar 0.8] [--credibility 0.8] --out results/route-v1.json
"""
import argparse, collections, itertools, json, math, sys
import numpy as np

import numpyro
numpyro.set_host_device_count(4)
numpyro.enable_x64()
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402
from numpyro.diagnostics import summary  # noqa: E402

from refusal_v1 import ROUTES, LANGS, PERIODS, ERAS  # noqa: E402

CELLS = [('pre-1880', 0), ('pre-1880', 1), ('1880-1930', 0), ('1880-1930', 1)]
CELL_NAME = {('pre-1880', 0): 'English pre-1880 prose (S1)', ('pre-1880', 1): 'English pre-1880 date-dense (S2)',
             ('1880-1930', 0): 'English 1880-1930 prose (S3)', ('1880-1930', 1): 'English 1880-1930 date-dense (S4)'}
STRATUM = {'S1': ('pre-1880', 0), 'S2': ('pre-1880', 1), 'S3': ('1880-1930', 0), 'S4': ('1880-1930', 1)}
# The reader in the scores file -> the refusal model's route (None: never refuses; GPU failed reads are counted apart).
REFUSAL_ROUTE = {'ia-djvu': None, 'lite': 'lite+ctx', 'agy': 'agy-3.8-flash-low'}
NAME = {'ia-djvu': 'Archive text', 'lite': 'Flash-Lite 3.1 (Batch API)', 'agy': 'Gemini 3.8 Flash low (agy CLI)'}


def severity(r):
    """Mechanical proxy for the 0-4 scale (comment of 2026-10-24 on #6740). Thresholds are PROVISIONAL: they await a
    calibration against by-eye grades (#6420 weekly audit, #7243). 4 misleading, 3 structural, 2 meaning changed,
    1 recoverable, 0 cosmetic."""
    cer, nerr = r['cer'], r['num_sub'] + r['num_drop'] + r['num_ins']
    if cer >= 0.5:
        return 4  # mostly unplaceable against the reference: wrong leaf, recitation or a loop
    if cer >= 0.10 or r['num_drop'] >= 3:
        return 3  # lines or a number column lost
    if nerr >= 1 or cer >= 0.03:
        return 2  # a number changed, or enough word errors to change a reading
    if cer >= 0.005:
        return 1
    return 0


def fit_usable(rows, readers, samples):
    """P(severity <= 1 | read): logit = s[reader] + t[cell] + w[reader, cell] + v[page], v shared by the readers of a page.

    Binary on purpose. An ordered logistic with cutpoints shared by readers failed its in-sample check (Archive on S3:
    0.77 [0.68, 0.85] fitted vs 37/41 observed): the Archive's error mass is cosmetic (severity 1) and lite's is in
    numbers (severity 2), so one shape for all readers cannot fit both. Usable is the decision quantity; it is fitted
    directly, and the severity tallies are reported raw."""
    pages = sorted({r['page_id'] for r in rows})
    R = jnp.array([readers.index(r['engine']) for r in rows])
    C = jnp.array([CELLS.index(STRATUM[r['stratum']]) for r in rows])
    P = jnp.array([pages.index(r['page_id']) for r in rows])
    Y = jnp.array([float(severity(r) <= 1) for r in rows])

    def model():
        s = numpyro.sample('s', dist.Normal(0, 1.5).expand([len(readers)]))
        t = numpyro.sample('t', dist.Normal(0, 1.5).expand([len(CELLS)]))
        w = numpyro.sample('tau_w', dist.HalfNormal(1.5)) * numpyro.sample('z_w', dist.Normal(0, 1).expand([len(readers), len(CELLS)]))
        v = numpyro.sample('sigma_v', dist.HalfNormal(1.5)) * numpyro.sample('z_v', dist.Normal(0, 1).expand([len(pages)]))
        numpyro.sample('y', dist.Bernoulli(logits=s[R] + t[C] + w[R, C] + v[P]), obs=Y)

    mc = MCMC(NUTS(model, target_accept_prob=0.95), num_warmup=1000, num_samples=samples, num_chains=4,
              chain_method='parallel', progress_bar=False)
    mc.run(jax.random.PRNGKey(4763), extra_fields=('diverging',))
    by = {k: np.asarray(v) for k, v in mc.get_samples(group_by_chain=True).items()}
    post = {k: v.reshape((-1,) + v.shape[2:]) for k, v in by.items()}
    post['w'] = post['tau_w'][:, None, None] * post['z_w']
    post['v'] = post['sigma_v'][:, None] * post['z_v']
    rh = max(float(np.nanmax(np.atleast_1d(summary({k: v}, group_by_chain=True)[k]['r_hat']))) for k, v in by.items())
    # In-sample check: replicate each reader x cell's usable count from the fitted page effects.
    Rn, Cn, Pn, Yn = (np.asarray(x) for x in (R, C, P, Y))
    eta = post['s'][:, Rn] + post['t'][:, Cn] + post['w'][:, Rn, Cn] + post['v'][:, Pn]
    yrep = np.random.default_rng(1).random(eta.shape) < 1 / (1 + np.exp(-eta))
    check = []
    for ri, g in enumerate(readers):
        for ci, cell in enumerate(CELLS):
            ix = np.where((Rn == ri) & (Cn == ci))[0]
            if len(ix):
                rep = yrep[:, ix].sum(1)
                check.append(dict(reader=g, cell=CELL_NAME[cell], read=len(ix), usable=int(Yn[ix].sum()),
                                  replicated=[int(x) for x in np.percentile(rep, [5, 50, 95])]))
    return post, dict(divergences=int(np.asarray(mc.get_extra_fields()['diverging']).sum()), max_rhat=round(rh, 3)), check


def p_usable_given_read(post, ri, ci, v):
    """P(severity <= 1) per draw x page, for NEW pages of the cell: v is the (draws x pages) page effect."""
    eta = (post['s'][:, ri] + post['t'][:, ci] + post['w'][:, ri, ci])[:, None] + v
    return 1 / (1 + np.exp(-eta))


def refusal_logits(D, route, period, dense, gut, zdl):
    i, p, e = ROUTES.index(route), PERIODS.index(period), ERAS.index('pre-1880' if period == '1800-1879' else '1880-1930')
    return (D['a'][:, i] + D['b'][:, LANGS.index('English')] + D['c'][:, p] + D['d'][:, i, e] + D['g'][:, i] * gut
            + D['h'][:, i] * zdl + D['e'][:, i] * dense)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scores', action='append', required=True)
    ap.add_argument('--refusal', required=True)
    ap.add_argument('--agy-status', required=True)
    ap.add_argument('--lite-cost', required=True)
    ap.add_argument('--fees', default=None, help='PRIVATE {agy_month_usd, ...}; omit and costs stay in quota share')
    ap.add_argument('--bar', type=float, default=0.8, help='share of pages that must be usable')
    ap.add_argument('--credibility', type=float, default=0.8, help='posterior probability that the bar is met')
    ap.add_argument('--samples', type=int, default=1000)
    ap.add_argument('--out', required=True)
    ap.add_argument('--pages-per-draw', type=int, default=400)
    a = ap.parse_args()
    M = a.pages_per_draw
    rng = np.random.default_rng(6740)

    rows = [json.loads(l) for f in a.scores for l in open(f) if l.strip()]
    seen, uniq = set(), []
    for r in rows:  # the GPU file repeats the Archive and lite rows
        key = (r['page_id'], r['engine'])
        if key not in seen:
            seen.add(key); uniq.append(r)
    read = [r for r in uniq if r['cer'] is not None]
    readers = sorted({r['engine'] for r in uniq})
    post, sev_diag, usable_check = fit_usable(read, readers, a.samples)
    print('usable fit', sev_diag, flush=True)
    for c in usable_check:
        print(f"  in-sample {c['reader']:<8} {c['cell']:<36} usable {c['usable']:>2}/{c['read']:<2} replicated {c['replicated']}")

    D = dict(np.load(a.refusal))
    S = min(len(D['a']), len(post['s']))
    D = {k: (v[:S] if getattr(v, 'ndim', 0) and len(v) >= S else v) for k, v in D.items()}
    post = {k: v[:S] for k, v in post.items()}

    # Costs.
    lite_costs = sorted(float(json.loads(l)['cost_usd']) for l in open(a.lite_cost) if json.loads(l).get('cost_usd') not in (None, 'None'))
    lite_rt = lite_costs[len(lite_costs) // 2]
    status = json.load(open(a.agy_status))
    caps = sorted(b['prev24h'] for b in status.get('past_bursts', []) if b.get('prev24h'))
    agy_cap = caps[len(caps) // 2]
    fees = json.load(open(a.fees)) if a.fees else {}
    agy_usd = fees.get('agy_month_usd') / 30 / agy_cap if fees.get('agy_month_usd') else None
    cost = {'ia-djvu': dict(usd=0.0, quota=0.0, basis='text already held'),
            'lite': dict(usd=lite_rt / 2, quota=0.0, basis=f'#4780 median realtime cost_usd ${lite_rt:.4f}/page, halved for Batch'),
            'agy': dict(usd=agy_usd, quota=1 / agy_cap, basis=f'1/{agy_cap} of a day (median calls in the 24 h before a lock, n={len(caps)})')}
    for g in readers:
        if g not in cost:
            cost[g] = dict(usd=0.0, quota=0.0, basis='idle GPU card')

    def usd(c):  # a subscription call with no fee given is priced by its quota share only
        return c['usd'] if c['usd'] is not None else 0.0

    fame = {'typical (no Gutenberg text, median downloads)': (0.0, 0.0), 'well known (on Gutenberg, downloads +1 sd)': (1.0, 1.0)}
    out_cells = []
    for (era_, dense), ci in zip(CELLS, range(len(CELLS))):
        period = '1800-1879' if era_ == 'pre-1880' else '1880-1930'
        for fname, (gut, zdl) in fame.items():
            # M fresh pages per draw. A page's refusal effect u is shared by the engines (the joint refusal a chain
            # needs); its severity effect v is shared by the readers. The cell's share is the mean over the pages.
            u = rng.normal(0, 1, (S, M)) * D['sigma_page'][:, None]
            v = rng.normal(0, 1, (S, M)) * post['sigma_v'][:, None]
            p_ref = {g: (1 / (1 + np.exp(-(refusal_logits(D, REFUSAL_ROUTE[g], period, dense, gut, zdl)[:, None] + u)))
                         if REFUSAL_ROUTE.get(g) else np.zeros((S, M))) for g in readers}
            p_use = {g: p_usable_given_read(post, readers.index(g), ci, v) for g in readers}
            chains = [c for n in (1, 2, 3) for c in itertools.permutations(readers, n)
                      if 'ia-djvu' not in c[:-1]]  # the Archive never refuses, so nothing follows it
            res = []
            for ch in chains:
                reach, pu, ec, eq = np.ones((S, M)), np.zeros((S, M)), np.zeros((S, M)), np.zeros((S, M))
                for g in ch:
                    ec += reach * usd(cost[g]); eq += reach * cost[g]['quota']
                    pu += reach * (1 - p_ref[g]) * p_use[g]
                    reach = reach * p_ref[g]
                res.append(dict(chain=' -> '.join(ch), p_usable=pu.mean(1), cost=ec.mean(1), quota=eq.mean(1), unread=reach.mean(1)))
            best = np.argmax(np.stack([r['p_usable'] for r in res]), axis=0)
            rows_out = []
            for k, r in enumerate(res):
                cpu = r['cost'] / np.maximum(r['p_usable'], 1e-9)
                qpu = r['quota'] / np.maximum(r['p_usable'], 1e-9)
                rows_out.append(dict(chain=r['chain'],
                                     p_usable=[round(float(x), 3) for x in np.percentile(r['p_usable'], [5, 50, 95])],
                                     p_meets_bar=round(float((r['p_usable'] >= a.bar).mean()), 3),
                                     p_best=round(float((best == k).mean()), 3),
                                     unread=round(float(np.median(r['unread'])), 3),
                                     usd_per_usable=round(float(np.median(cpu)), 6), quota_per_usable=round(float(np.median(qpu)), 7)))
            ok = [r for r in rows_out if r['p_meets_bar'] >= a.credibility]
            pick = min(ok, key=lambda r: (r['usd_per_usable'] + 0 * r['quota_per_usable'], r['quota_per_usable'], len(r['chain']))) if ok else None
            out_cells.append(dict(cell=CELL_NAME[(era_, dense)], fame=fname, pick=pick['chain'] if pick else None,
                                  pick_row=pick, chains=sorted(rows_out, key=lambda r: -r['p_usable'][1])))

    # Raw per-reader severity and number tallies, for the write-up's tables.
    tally = []
    for g in readers:
        for st, cell in STRATUM.items():
            all_ = [r for r in uniq if r['engine'] == g and r['stratum'] == st]
            rd = [r for r in all_ if r['cer'] is not None]
            if not all_:
                continue
            sv = collections.Counter(severity(r) for r in rd)
            tally.append(dict(reader=g, stratum=st, pages=len(all_), read=len(rd), severity={k: sv.get(k, 0) for k in range(5)},
                              usable=sum(1 for r in rd if severity(r) <= 1),
                              numbers_printed=sum(r['num_ref'] for r in rd), misread=sum(r['num_sub'] for r in rd),
                              dropped=sum(r['num_drop'] for r in rd), spurious=sum(r['num_ins'] for r in rd)))
    res = dict(usable_fit=sev_diag, usable_check=usable_check, readers={g: NAME.get(g, g) for g in readers}, costs=cost, bar=a.bar,
               credibility=a.credibility, fees_given=bool(fees), cells=out_cells, tally=tally)
    json.dump(res, open(a.out, 'w'), indent=1)
    for c in out_cells:
        pr = c['pick_row']
        print(f"{c['cell']:<36} {c['fame'][:12]:<12} pick {c['pick']}  "
              + (f"P(usable) {pr['p_usable']} unread {pr['unread']} ${pr['usd_per_usable']}/usable quota {pr['quota_per_usable']}" if pr else 'NO CHAIN CLEARS THE BAR'))
        for r in c['chains'][:4]:
            print(f"      {r['chain']:<28} P(usable) {r['p_usable']} meets {r['p_meets_bar']} best {r['p_best']} ${r['usd_per_usable']} q {r['quota_per_usable']}")


if __name__ == '__main__':
    sys.exit(main())
