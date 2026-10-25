#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/routing/derive_routes.py (route proposals from the translation estimator: the
# best-scoring route per cell, no cost and no failed reads) and scripts/eval/estimator/planner/planner_v0.py (expected
# loss of the current choice, priced in quality only). Neither prices a route by its call cost and its failed reads;
# this does, per .claude/docs/quality-research-system.md §3a (#6740). It writes a proposal file; it does not touch
# scripts/lib/ocr-routing-table.json (#7170 consumes the output).
"""OCR router v1: per cell, the cheapest route whose quality clears the bar with P >= threshold (#6740).

  route_ocr_v1.py --table $S/ocr-table-v1.jsonl --fit-dir $S/fit-v1 \
      --costs scripts/eval/estimator/ocr/route-costs.json --bars scripts/eval/estimator/ocr/quality-bars.json \
      --fees <PRIVATE plan-fee file> --out results/ocr-v1-routes.json --md results/ocr-v1-routes.md \
      --private-md $S/ocr-v1-routes-usd.md

Cell = chart x page kind (prose / number-dense, where measured) x fame (the text is a public web transcription or
not; English charts only, the others at their panels' majority) x alchemy (only charts with alchemical rows, #7341:
the alchemical books at their own panel, every other book of the chart as a new panel). For each route with a cost row whose engine is
measured (>= 5 pages read in the chart) or pooled (a family sibling is measured; general models only) in the cell:
  P(read)            1 - did-not-read, a new page of the cell
  E[CER]             among reads, the 100%-error point mass included
  number errors      per number printed (number-dense cells; only engines the #4763 gate read)
  P(clears bar)      share of posterior draws in which the route is within the bar's margin of the measured, enabled
                     route with the lowest posterior mean error
  cost per usable page = call cost / P(read) + P(not read) x next route's (call cost / P(read))
                     (§3a's formula; next = the cheapest other route that clears the bar, the route itself if none
                     does). Refusals of two Gemini routes on one page are correlated; the formula ignores that.
  P(best)            share of draws in which the route has the lowest error among MEASURED routes (numbers in
                     number-dense cells); a pooled route gets none
Only a MEASURED route is chosen or used as the next route. A pooled route is listed with its estimates (a candidate
to test); an untested engine is listed nowhere.
"""
import argparse, collections, json, os, pickle, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model_ocr_v1 import load, cell_cer, cell_fail, number_rate, stratum_pages, NUM  # noqa: E402

GATE_CHARTS = {'english-pre1880-prose': 'S1', 'english-pre1880-dense': 'S2', 'english-1880-1930-prose': 'S3',
               'english-1880-1930-dense': 'S4'}
MIN_PAGES = 5
# script-specific models (a Syriac Kraken model says nothing about Chinese) and the Archive's text: measured or nothing
NO_POOL = {'specialist', 'classic', 'archive-text'}
q = lambda x: [round(float(v), 4) for v in np.percentile(x, [5, 50, 95])]


UNITS = ['usd', 'agy_plan_share', 'claude_weekly_points']


def call_cost(r, c):
    """One call's cost as [paid dollars, share of the agy plan's monthly quota, Claude weekly points]. Fees never
    enter here: the committed results carry these units, and `price` turns them into dollars with the private fees."""
    sh, v = c['quota_shares'], np.zeros(3)
    if r['kind'] in ('free', 'paid_api'):
        v[0] = r['usd_per_page']
    elif r['kind'] == 'gpu':
        v[0] = 0.0 if c['gpu_state'] == 'idle' else r['busy_usd_per_1k'] / 1000
    elif r['plan'] == 'agy':
        v[1] = sh['agy_share_per_call'] * sh['unused_quota_value']
    else:   # Claude: points per PAGE, per model (a call may carry several pages); None = unmetered (#6740, 2026-10-26)
        pts = r.get('claude_points_per_page')
        v[2] = np.nan if pts is None else pts * sh['unused_quota_value']
    return v


def price(v, fees):
    """Dollars for a cost vector: agy share x the plan's monthly fee; a Claude point = 1% of one account-week."""
    return float(v[0] + v[1] * fees['agy_month_usd'] + v[2] * fees['claude_usd_per_weekly_point'])


def show_cost(v):
    # components under a thousandth of a call of their kind are the fallback term on a route that almost always reads
    parts = [f'${v[0]:.5f}' if v[0] >= 1e-6 else '', f'{v[1]:.2e} agy' if v[1] >= 5e-8 else '',
             f'{v[2]:.4f} Claude pt' if v[2] >= 3e-5 else '']
    return ' + '.join(p for p in parts if p) or '$0'


def basis(df, engine, chart, strata=None):
    d = df[df.chart == chart]
    if strata:
        d = d[d.stratum.isin(strata)]
    if d[d.engine == engine].page.nunique() >= MIN_PAGES:
        return 'measured'
    fam = df[df.engine == engine].engine_family.iloc[0] if (df.engine == engine).any() else None
    if fam in NO_POOL:
        return None
    sib = d[d.engine_family == fam].groupby('engine').page.nunique()
    return 'pooled' if (sib >= MIN_PAGES).any() else None


def fmt(p):
    return 'pooled' if p is None else f'{p:.2f}'


def mode(s):
    return s.value_counts().index[0]


def decide(rows, bars, threshold, margin_c, margin_n, dense, fees, scale=1.0):
    """rows: per route dict with draws cer, fail, num (or None). Adds p_bar, cost_usable, p_best; returns choice."""
    # a route with no metered price (a Claude image read, until it is metered) is never routed on cost
    routable = [r for r in rows if r['enabled'] and not np.isnan(r['cost']).any()]
    measured = [r for r in routable if r['basis'] == 'measured']
    if not measured:
        return None
    # the bar is set by the measured route with the lowest posterior mean error (a fixed route, so the bar does not
    # chase the luckiest route in each draw)
    best_c = min(measured, key=lambda r: float(r['cer'].mean()))['cer']
    with_num = [r for r in measured if r['num'] is not None]
    best_n = min(with_num, key=lambda r: float(r['num'].mean()))['num'] if dense and with_num else None
    margin_c = max(margin_c, scale * bars['character'].get('margin_relative', 0) * float(best_c.mean()))
    if best_n is not None:
        margin_n = max(margin_n, scale * bars['numbers'].get('margin_relative', 0) * float(best_n.mean()))
    for r in rows:
        ok = r['cer'] <= best_c + margin_c
        if bars['character'].get('absolute_max') is not None:
            ok &= r['cer'] <= bars['character']['absolute_max']
        if dense:
            if r['num'] is None or best_n is None:
                ok &= False
            else:
                ok &= r['num'] <= best_n + margin_n
                if bars['numbers'].get('absolute_max') is not None:
                    ok &= r['num'] <= bars['numbers']['absolute_max']
        r['p_bar'] = float(ok.mean())
    # only a measured route is routed; a pooled one that would clear the bar is a candidate to test, not a route
    qual = [r for r in measured if r['p_bar'] >= threshold]
    # §3a: cost per usable page = cost / P(read) + P(not read) x next route's (cost / P(read)); linear in the cost
    # vector, so it is computed per unit and priced once
    per = {r['route']: r['cost'] / max(1 - r['fail'].mean(), 1e-6) for r in qual}
    for r in rows:
        p_read = np.maximum(1 - r['fail'], 1e-6)
        others = {k: v for k, v in per.items() if k != r['route']}
        nxt = min(others.values(), key=lambda v: price(v, fees)) if others else r['cost'] / p_read.mean()
        r['next_route'] = min(others, key=lambda k: price(others[k], fees)) if others else r['route']
        comp = r['cost'][:, None] / p_read[None, :] + (1 - p_read)[None, :] * nxt[:, None]
        r['cost_usable_units'] = comp.mean(1)
        r['cost_usable_draws'] = comp[0] + comp[1] * fees['agy_month_usd'] + comp[2] * fees['claude_usd_per_weekly_point']
    metric = [r['num'] if dense and r['num'] is not None else r['cer'] for r in rows]
    comparable = [i for i, r in enumerate(rows) if r['basis'] == 'measured' and (not dense or r['num'] is not None)]
    if comparable:
        win = np.argmin(np.array([metric[i] for i in comparable]), 0)
        for j, i in enumerate(comparable):
            rows[i]['p_best'] = float((win == j).mean())
    if not qual:
        return dict(route=None)
    pick = min(qual, key=lambda r: (round(float(r['cost_usable_draws'].mean()), 9), -r['p_bar'], float(r['cer'].mean())))
    return dict(route=pick['route'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--table', required=True)
    ap.add_argument('--fit-dir', required=True)
    ap.add_argument('--costs', required=True)
    ap.add_argument('--bars', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--md', required=True)
    ap.add_argument('--fees', required=True, help='PRIVATE plan-fee file (agy_month_usd, claude_usd_per_weekly_point)')
    ap.add_argument('--private-md', required=True, help='the same table in dollars; write it outside the repo')
    ap.add_argument('--arabic', help='extra rows (build-arabic-rows.py) for a fit made with fit_ocr_v1_arabic.py (#7341)')
    ap.add_argument('--charts', help='comma list: route only these charts')
    ap.add_argument('--min-pages', type=int, default=MIN_PAGES, help='pages read in the chart for a route to be measured')
    a = ap.parse_args()
    globals()['MIN_PAGES'] = a.min_pages
    fees = json.load(open(a.fees))
    df = load(a.table, extra=a.arabic)
    costs, bars = json.load(open(a.costs)), json.load(open(a.bars))
    full = pickle.load(open(os.path.join(a.fit_dir, 'full.pkl'), 'rb'))
    ixa, pa, _ = full['acc']
    ixq, pq, _ = full['ref']
    has_num = os.path.exists(os.path.join(a.fit_dir, 'numbers.pkl'))  # an Arabic-only route run needs no numbers fit
    lvn, pn, _ = pickle.load(open(os.path.join(a.fit_dir, 'numbers.pkl'), 'rb')) if has_num else ({'eng': []}, None, None)
    spn = stratum_pages(df, lvn) if has_num else {}
    S = pa['mu_a'].shape[0]
    pick_n = np.linspace(0, pn['sub_a'].shape[0] - 1, S).astype(int) if has_num else None
    fam_of = dict(df[['engine', 'engine_family']].drop_duplicates().itertuples(index=False))
    cells_out, md, md_usd = [], [], []
    charts = a.charts.split(',') if a.charts else sorted(df.chart.unique())
    # a chart with alchemical rows (#7341) is two cells: the alchemical books at their own panel, and every other
    # book of the chart as a new panel (content 0); a chart without them is one cell at its majority panel
    cells_of = lambda d: ([(1, mode(d[d.alchemy == 1].panel)), (0, None)] if d.alchemy.any() else [(0, mode(d.panel))])
    for chart in charts:
        d = df[df.chart == chart]
        era, kind_ = mode(d.era), mode(d.kind)
        webs = [0, 1] if chart.startswith('english') else [int(round(d.fame_web.mean()))]
        for (alch, panel), dense in [(c, int(chart.endswith('-dense'))) for c in cells_of(d)]:
            strata = (GATE_CHARTS[chart],) if chart in GATE_CHARTS else None
            for web in webs:
                rows = []
                for r in costs['routes']:
                    e = r['engine']
                    b = basis(df, e, chart, strata)
                    if b is None or e not in fam_of:
                        continue
                    rng = np.random.default_rng(6740)
                    cell = dict(engine=e, family=fam_of[e], chart=chart, era=era, dense=dense, web=web, rng=rng,
                                kind=kind_, alchemy=alch)
                    cer = cell_cer(pa, ixa, panel=panel, **cell)
                    cell['rng'] = np.random.default_rng(6741)
                    fail = cell_fail(pq, ixq, panel=None, **cell)
                    num = None
                    if strata and has_num and e in lvn['eng']:
                        num = sum(number_rate(lvn, pn, o, e, strata[0], spn) for o in NUM)[pick_n]
                    rows.append(dict(route=r['route'], engine=e, basis=b, enabled=r['enabled'], cost=call_cost(r, costs),
                                     cer=cer, fail=fail, num=num))
                if not rows:
                    continue
                th = bars['threshold']
                mc, mn = bars['character']['margin'], bars['numbers']['margin']
                sens = {}
                for f in (0.5, 2.0):
                    tmp = [dict(r) for r in rows]
                    ch = decide(tmp, bars, th, mc * f, mn * f, dense, fees, scale=f)
                    sens[f'margin x{f}'] = ch['route'] if ch else None
                choice = decide(rows, bars, th, mc, mn, dense, fees)
                kind = 'number-dense' if dense else 'prose'
                fame = ('web transcription' if web else 'no web transcription') + ('; alchemy' if alch else '')
                pages = int(d[(d.dense == dense) & (d.fame_web == web) & (d.alchemy == alch)].page.nunique())
                route_rows = []
                for r in sorted(rows, key=lambda r: float(r['cost_usable_draws'].mean())):
                    route_rows.append(dict(route=r['route'], engine=r['engine'], basis=r['basis'], enabled=r['enabled'],
                                           cost_per_call=dict(zip(UNITS, [float(x) for x in r['cost']])),
                                           p_read=q(1 - r['fail']), cer=q(r['cer']),
                                           number_errors=q(r['num']) if r['num'] is not None else None,
                                           p_clears_bar=round(r['p_bar'], 3), next_route=r['next_route'],
                                           cost_per_usable_page=dict(zip(UNITS, [float(x) for x in r['cost_usable_units']])),
                                           p_best=round(r['p_best'], 3) if 'p_best' in r else None,
                                           _usd=float(r['cost_usable_draws'].mean()), _usd_call=price(r['cost'], fees)))
                best = max(route_rows, key=lambda r: r['p_best'] or 0.0)
                ch = next((r for r in route_rows if r['route'] == (choice or {}).get('route')), None)
                cells_out.append(dict(chart=chart, kind=kind, fame=fame, era=era, panel=panel, pages_in_cell=pages, alchemy=alch,
                                      choice=ch['route'] if ch else None, sensitivity=sens, best_quality=best['route'],
                                      routes=route_rows))
                for out, dollars in ((md, False), (md_usd, True)):
                    if ch:
                        cpc = f"${ch['_usd_call']:.5f}" if dollars else show_cost(np.array(list(ch['cost_per_call'].values())))
                        cpu = f"${ch['_usd']:.5f}" if dollars else show_cost(np.array(list(ch['cost_per_usable_page'].values())))
                        mid = (f"**{ch['route']}** | {cpc} | {ch['p_read'][1]:.2f} | {ch['cer'][1]:.4f} | "
                               + (f"{ch['number_errors'][1]:.3f} | " if dense else "— | ")
                               + f"{ch['p_clears_bar']:.2f} | {cpu} (then {ch['next_route']}) | {fmt(ch['p_best'])} | ")
                    else:
                        mid = "**none clears the bar** | | | | | | | | "
                    out.append(f"| {chart} | {kind} | {fame} | {pages} | " + mid
                               + f"{best['route']} ({fmt(best['p_best'])}) | {sens['margin x0.5'] or 'none'} / {sens['margin x2.0'] or 'none'} |")
    head = ("| chart | page kind | fame | pages measured | cheapest measured route clearing the bar | cost per call | "
            "P(read) | E[CER] | number errors per number | P(clears bar) | cost per usable page (fallback) | P(best) | "
            "best quality (P(best)) | choice at margin x0.5 / x2 |\n|" + "---|" * 14)
    for c in cells_out:  # dollars stay out of the committed file
        for r in c['routes']:
            r.pop('_usd'), r.pop('_usd_call')
    json.dump(dict(bars=bars, gpu_state=costs['gpu_state'], units=UNITS, quota_shares=costs['quota_shares'],
                   note='costs are in units (paid dollars, agy plan-month share, Claude weekly points); the choice was '
                        'made in dollars with the private plan fees', cells=cells_out), open(a.out, 'w'), indent=1)
    open(a.md, 'w').write(head + '\n' + '\n'.join(md) + '\n')
    open(a.private_md, 'w').write(head + '\n' + '\n'.join(md_usd) + '\n')
    print(head)
    print('\n'.join(md_usd))


if __name__ == '__main__':
    sys.exit(main())
