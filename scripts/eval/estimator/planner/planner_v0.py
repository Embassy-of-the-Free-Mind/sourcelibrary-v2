#!/usr/bin/env python3
# PRIOR ART: .claude/docs/quality-research-system.md §4 (the planner, designed, not built); the routing table
# scripts/lib/ocr-routing-table.json (#6688; its rows are the OCR decisions here, not rebuilt); estimator v2
# (report_v2.py, translation) and OCR v0 (report_ocr_v0.py, failures_v0.py) for the posteriors. Nothing ranks the open
# routing decisions by expected loss or prices the test that would settle one (#6740).
"""Planner v0: rank routing decisions by expected loss reduced per quota cost of the test that would resolve it (#6740).

For each decision (stage x language or script x page kind):
  q_e        posterior draws of quality for each available engine e (translation: two-family judge mean of the v2
             expected score; OCR: 1 - E[CER] from OCR v0; correction lanes: 1 - made-worse rate from failures v0)
  P(not best)        P(max_e q_e > q_incumbent)
  gap        E[max_e q_e - q_incumbent | not best]
  pages      reader-weighted pages the decision still governs (pages not yet read or translated, each book weighted by
             (read_count + 1) / (corpus mean + 1); volumes.mjs, read-only)
  EL         P(not best) x gap x pages, in page-fractions wrong (the common unit below)
  test       a within-round paired test: the incumbent plus the challengers with P(best) >= 0.10 (at most 3 arms),
             n pages chosen by preposterior simulation from {20, 30, 50, 80, 120, 200}
  EVSI(n)    expected loss removed by that test; value = EVSI x pages
  cost       quota: calls on each subscription as a share of one account-week (meter.json, #6561): Opus 4,250
             page-calls; Gemini thinking (Flash high, 4 Argon, judge) 33,600; Gemini Flash low 151,200; Sonnet half
             an Opus call. Paid API reads (Flash-Lite, 3 Flash) and GPU engines are listed in dollars, not quota.
  rank       value / cost; a decision is SETTLED (below the stop line) when P(not best) < 0.10 or its EVSI is under 1%
             of the largest.

Common unit (a choice, stated so it can be argued with): a page-fraction wrong. Translation fidelity s on 1-5 counts
(5 - s) / 4 of a page wrong; OCR accuracy a counts (1 - a); a made-worse or not-of-leaf rate counts the whole page.
Rules carried from estimator v1: plan only within-round paired tests that include the incumbent; an engine whose
family has no measured member in the cell is 'test first' and is never estimated.
"""
import argparse, json
import numpy as np

SIGMA_TR = 0.8        # sd of a per-page paired fidelity difference (points; #6545 intervals: +-0.3 at n = 25)
N_GRID = [20, 30, 50, 80, 120, 200]
WEEK = {'claude': 4250.0, 'gemini_thinking': 33600.0, 'gemini_low': 151200.0}
# translation engines: label in report_v2 -> (route kind for cost, available today?)
TR_ENGINES = {'Flash-Lite 3.1': ('api', True), '3 Flash': ('api', True), '3.8 Flash CLI': ('gemini_low', True),
              '3.1 Pro t128': ('api', False), '3.1 Pro high CLI': ('gemini_thinking', False),
              'Sonnet 5.5': ('sonnet', True), 'Opus 5.5': ('claude', True),
              'G4L CLI': ('gemini_thinking', False)}   # Argon: refused by agy-guard without AGY_ALLOW_HEAVY (#7075)
TR_PROD = {'gemini-3.1-flash-lite': 'Flash-Lite 3.1', 'gemini-3-flash-preview': '3 Flash'}
TR_LANG = {'latin': ('la', ['Latin']), 'greek': ('grc', ['Greek']), 'german': ('de', ['German']),
           'french': ('fr', ['French']), 'italian': ('it', ['Italian']), 'hebrew': ('he', ['Hebrew']),
           'arabic': ('ar', ['Arabic']), 'persian': ('fa', ['Persian']), 'sanskrit': ('sa', ['Sanskrit']),
           'pali': ('pi', ['Pali']), 'chinese': ('lzh', ['Chinese', 'Classical Chinese']),
           'tibetan': ('bo', ['Tibetan']), 'syriac': ('syc', ['Syriac'])}
# Capacity over one quarter (13 weeks) at half of each subscription (the rest is the lanes already running), from meter.json:
# Opus 4,250 page-calls per account-week x 3 accounts; Sonnet about twice that; Gemini Flash low 151,200 a week.
# An engine is a candidate for a decision only if the decision's raw queue fits (the issue's 'we can't test everything'
# has a twin: we can't route everything to the best model either).
CAP_Q = {'claude': 0.5 * 13 * 3 * 4250, 'sonnet': 0.5 * 13 * 3 * 8500, 'gemini_low': 0.5 * 13 * 151200,
         'gemini_thinking': 0.5 * 13 * 33600, 'api': float('inf'), 'gpu': float('inf')}
USD_PER_QUOTA_POINT = 10.0    # $10 of paid API or GPU counts like 1% of one account-week (a choice; see the docstring)
UNAVAILABLE_OCR = {'gemini-3.6-flash+antigravity-cli', 'gemini-3.7-flash+antigravity-cli'}   # withdrawn from agy 10-12
OCR_COST = lambda e: ('gemini_thinking' if ('high' in e or 'argon' in e) else 'gemini_low' if 'antigravity' in e
                      else 'claude' if 'opus' in e else 'sonnet' if 'sonnet' in e
                      else 'api' if e.startswith('gemini') or 'mistral' in e else 'gpu')
OCR_CHART_LANGS = {'latin': ['Latin'], 'english': ['English', 'Middle English'],
                   'latin-script-other': ['German', 'French', 'Italian', 'Dutch', 'Spanish', 'Portuguese', 'Danish'],
                   'greek': ['Greek'], 'chinese-manuscript': None, 'chinese-print': None, 'armenian': ['Armenian'],
                   'hebrew': ['Hebrew'], 'syriac': ['Syriac'], 'syriac-print': ['Syriac']}


def quota(calls, usd=0.0):
    """calls: {kind: n}. Share of one account-week, in percent, summed over subscriptions, plus dollars at
    USD_PER_QUOTA_POINT."""
    return usd / USD_PER_QUOTA_POINT + 100 * (calls.get('claude', 0) / WEEK['claude'] + 0.5 * calls.get('sonnet', 0) / WEEK['claude']
                  + calls.get('gemini_thinking', 0) / WEEK['gemini_thinking'] + calls.get('gemini_low', 0) / WEEK['gemini_low'])


def evsi(Q, inc, sigma, n, rng):
    """Preposterior value of a paired test of the engines in Q (draws x engines; column `inc` is the incumbent):
    observe each challenger's mean paired difference with noise sigma/sqrt(n), switch to the best observed if > 0."""
    S, E = Q.shape
    best = Q.max(1)
    loss_now = (best - Q[:, inc]).mean()
    d = Q - Q[:, [inc]] + rng.normal(0, sigma / np.sqrt(n), (S, E)) * (np.arange(E) != inc)
    pick = d.argmax(1)
    loss_after = (best - Q[np.arange(S), pick]).mean()
    return loss_now, loss_now - loss_after


def decide(Q, names, inc, sigma, rng, cost_of, pages):
    """Q: draws x engines in page-fractions RIGHT (higher better)."""
    i = names.index(inc)
    pbest = np.bincount(Q.argmax(1), minlength=len(names)) / Q.shape[0]
    p_not = float(1 - pbest[i])
    gap_all = Q.max(1) - Q[:, i]
    gap = float(gap_all[gap_all > 0].mean()) if (gap_all > 0).any() else 0.0
    ch = [j for j in np.argsort(-pbest) if j != i and pbest[j] >= 0.10][:2] or \
         [j for j in np.argsort(-Q.mean(0)) if j != i][:1]
    arms = [i] + list(ch)
    Qa = Q[:, arms]
    best_n, best_ratio, out = None, -np.inf, None
    for n in N_GRID:
        loss_now, gain = evsi(Qa, 0, sigma, n, rng)
        c = cost_of([names[j] for j in arms], n)
        ratio = gain * pages / max(c['quota_pct'], 0.05)
        if out is None or ratio > best_ratio:
            best_n, best_ratio, out = n, ratio, dict(n=n, evsi=gain, loss_now=loss_now, cost=c)
    lead = int(np.argmax(Q.mean(0)))
    p_lead = float((Q[:, lead] > Q[:, i]).mean()) if lead != i else 0.0
    return dict(incumbent=inc, leader=names[lead], p_leader_beats_incumbent=round(p_lead, 3),
                evidence_decides=bool(lead != i and p_lead >= 0.95),
                p_not_best=round(p_not, 3), gap_if_not_best=round(gap, 4),
                el_per_page=round(float(gap_all.mean()), 5), pages=round(pages), el=round(float(gap_all.mean()) * pages, 1),
                p_best={names[j]: round(float(pbest[j]), 3) for j in np.argsort(-pbest)[:4]},
                arms=[names[j] for j in arms], n=best_n, evsi_per_page=round(out['evsi'], 5),
                value=round(out['evsi'] * pages, 1), cost=out['cost'],
                value_per_quota=round(out['evsi'] * pages / max(out['cost']['quota_pct'], 0.05), 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tr-report', required=True)
    ap.add_argument('--tr-draws', required=True)
    ap.add_argument('--ocr-report', required=True)
    ap.add_argument('--ocr-draws', required=True)
    ap.add_argument('--failures', required=True)
    ap.add_argument('--volumes', required=True)
    ap.add_argument('--routing', required=True)
    ap.add_argument('--tr-pareto', required=True)
    ap.add_argument('--ocr-table', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rng = np.random.default_rng(6740)
    vol = {r['language']: r for r in json.load(open(a.volumes))['languages']}
    V = lambda langs, key: sum(vol.get(l, {}).get(key, 0) for l in langs)
    rows, test_first = [], []

    # ---------- translation: one decision per language ----------
    trr = json.load(open(a.tr_report))
    trd = np.load(a.tr_draws)
    known = {(t['language'], t['engine']): t for t in trr['what_we_know']}
    for c in json.load(open(a.tr_pareto))['charts']:
        if c['id'] not in TR_LANG:
            continue
        code, langs = TR_LANG[c['id']]
        inc = TR_PROD.get(c['production_engine'])
        if (code, inc) not in known:
            test_first.append(dict(stage='translation', decision=c['title'], why='language not in the estimator data'))
            continue
        names, cols = [], []
        names_all, cols_all = [], []     # every available measured engine, before the capacity filter (#6871)
        queue = V(langs, 'pages') - V(langs, 'pages_translated')
        infeasible = []
        for e, (kind, ok) in TR_ENGINES.items():
            t = known.get((code, e))
            if not ok or t is None:
                continue
            if t['untested_family']:
                test_first.append(dict(stage='translation', decision=f"{c['title']}: {e}",
                                       why='no measured member of its family in this script family (rule 2)'))
                continue
            S = min(len(trd[f'{code}|{e}']), len(trd[f'{code}|{e}|gemini-3.1-pro']))
            two = 0.5 * (trd[f'{code}|{e}'][:S] + trd[f'{code}|{e}|gemini-3.1-pro'][:S])   # two-family judge
            names_all.append(e)
            cols_all.append((5 - two) / 4)
            if e != inc and queue > CAP_Q['claude' if kind == 'claude' else kind]:
                infeasible.append(e)
                continue
            names.append(e)
            cols.append((5 - two) / 4)
        S = min(len(x) for x in cols)
        Q = 1 - np.stack([x[:S] for x in cols], 1)      # page-fraction right
        S_all = min(len(x) for x in cols_all)
        pb_all = np.bincount(np.stack([x[:S_all] for x in cols_all], 1).argmin(1), minlength=len(names_all)) / S_all

        def cost_tr(arms, n, inc=inc):
            calls, usd = {}, 0.0
            for e in arms:
                kind = TR_ENGINES[e][0]
                if e == inc:
                    continue          # the incumbent's stored English is the incumbent arm: no new call
                if kind == 'api':
                    usd += n * 0.002
                    continue
                calls[kind] = calls.get(kind, 0) + n
            # two-family judges, every arm: Opus (claude -p, batches of 3) + Gemini 3.8 high (agy, one item a call)
            calls['claude'] = calls.get('claude', 0) + n * len(arms) / 3
            calls['gemini_thinking'] = calls.get('gemini_thinking', 0) + n * len(arms)
            return dict(calls={k: round(v) for k, v in calls.items()}, usd=round(usd, 2), quota_pct=round(quota(calls, usd), 2))
        pages = V(langs, 'rw_untranslated')
        r = decide(Q, names, inc, SIGMA_TR / 4, rng, cost_tr, pages)
        r.update(stage='translation', decision=f"translate {c['title']}", unit='page-fraction (fidelity/4)',
                 basis={e: known[(code, e)]['basis'] for e in r['arms']},
                 judges='Opus + Gemini 3.8 Flash high (two families); alpha measured 0.60-0.63 on #6545: not settled',
                 queue_pages=queue, not_feasible_at_this_volume=infeasible,
                 # P(best) with the infeasible engines put back: the answer for a decision small enough to fit (a held
                 # frame of books), where the capacity filter above does not apply
                 p_best_all_engines={names_all[j]: round(float(pb_all[j]), 3) for j in np.argsort(-pb_all)[:4]})
        rows.append(r)

    # ---------- OCR accuracy: one decision per routing-table row with a chart ----------
    ocr = json.load(open(a.ocr_report))
    od = np.load(a.ocr_draws)
    ot = {(t['chart'], t['engine']): t for t in ocr['table']}
    routing = json.load(open(a.routing))
    import pandas as pd
    tab = pd.read_json(a.ocr_table, lines=True)
    tab = tab[tab.scored]
    for row in routing['rows']:
        charts = row.get('charts') or ([row['pareto']['chart']] if row.get('pareto') else [])
        if not charts:
            continue
        for chart in charts:
            inc = ocr['production'].get(chart)
            if row.get('pareto') and row['pareto'].get('chart') == chart:
                inc = row['pareto']['engine']
            names, cols = [], []
            for (ch, e), t in ot.items():
                if ch != chart or e in UNAVAILABLE_OCR:
                    continue
                if t['basis'] == 'untested':
                    test_first.append(dict(stage='ocr', decision=f'{chart}: {e}', why='untested family in this chart'))
                    continue
                if t['basis'] != 'measured' and e != inc:
                    continue
                names.append(e)
                cols.append(od[f'{chart}|{e}'])
            if inc not in names:
                test_first.append(dict(stage='ocr', decision=f'{chart}: incumbent {inc}', why='incumbent not measured'))
                continue
            S = min(len(x) for x in cols)
            Q = np.stack([x[:S] for x in cols], 1)
            # per-page paired sd of accuracy differences in this chart (incumbent vs others), from the table
            pv = tab[tab.chart == chart].pivot_table(index='page', columns='engine', values='cer')
            sds = [float((pv[inc] - pv[e]).dropna().std()) for e in names if e != inc and e in pv and inc in pv
                   and (pv[inc] - pv[e]).dropna().size >= 5]
            sds = [x for x in sds if np.isfinite(x)]
            sigma = float(np.median(sds)) if sds else 0.1

            def cost_ocr(arms, n, inc=inc):
                # new pages need a reference: one Opus read-from-image transcription corrected by eye per page (the
                # charts' current panels are what the posterior already holds), and every arm reads every page
                calls, usd = {'claude': n}, 0.0
                for e in arms:
                    k = OCR_COST(e)
                    if k in ('api', 'gpu'):
                        usd += n * 0.004
                    else:
                        calls[k] = calls.get(k, 0) + n
                return dict(calls=calls, usd=round(usd, 2), quota_pct=round(quota(calls, usd), 2),
                            note='n new pages: an Opus by-eye reference per page, every arm reads it, CER scores it')
            langs = OCR_CHART_LANGS.get(chart)
            if langs is None:     # Chinese: the routing-table census (pages with no text yet)
                pages = 330855 * (V(['Chinese'], 'rw_unread') / max(V(['Chinese'], 'pages') - V(['Chinese'], 'pages_ocr'), 1))
                pages = pages * (0.8 if chart == 'chinese-manuscript' else 0.2)
            else:
                pages = V(langs, 'rw_unread') / (2 if chart in ('syriac', 'syriac-print') else 1)
            r = decide(Q, names, inc, sigma, rng, cost_ocr, pages)
            r.update(stage='ocr', decision=f"read {chart} ({row['id']})", unit='page-fraction (CER)',
                     basis={e: ot[(chart, e)]['basis'] for e in r['arms']}, sigma_paired=round(sigma, 4),
                     judges='mechanical (CER against a typed reference); planted-reference check per #6304',
                     routing_status=row['status'])
            rows.append(r)

    # ---------- correction lanes: made-worse rates (failures v0) ----------
    fails = json.load(open(a.failures))
    mw = {(c['route'], c['script']): c for c in fails['cells'] if c['rate'] == 'made_worse'}
    for script, inc, langs in (('chinese', 'Opus corrects a specialist draft', None),
                               ('tibetan', 'Gemini 3.8 Flash low corrects a specialist draft', ['Tibetan'])):
        cand = [k for k in mw if k[1] == script and 'corrects' in k[0]]
        names = [k[0] for k in cand]
        if inc not in names:
            continue
        # posterior of each rate approximated by a beta matched to its 90% interval (the json keeps quantiles)
        cols = []
        for k in cand:
            lo, med, hi = mw[k]['est']
            sd = max((hi - lo) / 3.29, 1e-4)
            m = med
            kappa = max(m * (1 - m) / sd ** 2 - 1, 2)
            cols.append(1 - rng.beta(m * kappa, (1 - m) * kappa, 3000))
        Q = np.stack(cols, 1)
        pages = 4379 if script == 'chinese' else V(langs, 'rw_unread')   # chinese: the 4,379 table pages withheld

        def cost_corr(arms, n, inc=inc):
            calls = {}
            for e in arms:
                k = 'claude' if 'Opus' in e else 'sonnet' if 'Sonnet' in e else 'gemini_thinking' if ('high' in e or 'Pro' in e) else 'gemini_low'
                calls[k] = calls.get(k, 0) + n
            return dict(calls=calls, quota_pct=round(quota(calls), 2), note='scored against typed references (mechanical)')
        r = decide(Q, names, inc, 0.3, rng, cost_corr, pages)
        r.update(stage='correction', decision=f'correct {script} specialist drafts', unit='page made worse',
                 judges='mechanical against a reference; planted errors in the draft', basis={})
        rows.append(r)

    top = max(r['evsi_per_page'] * r['pages'] for r in rows) or 1
    for r in rows:
        r['settled'] = bool(r['p_not_best'] < 0.10 or r['value'] < 0.01 * top)
        r['why_below'] = ('the incumbent is best with P >= 0.90' if r['p_not_best'] < 0.10 else
                          'low volume: a test is worth under 1% of the top one; route on the estimate' if r['settled'] else '')
    rows.sort(key=lambda r: (r['settled'], -r['value_per_quota']))
    json.dump(dict(rows=rows, test_first=test_first, constants=dict(SIGMA_TR=SIGMA_TR, N_GRID=N_GRID, WEEK=WEEK, CAP_Q=CAP_Q, USD_PER_QUOTA_POINT=USD_PER_QUOTA_POINT)),
              open(a.out, 'w'), indent=1, default=float)
    print('| # | decision | in use | P(not best) | gap if not | pages (read-weighted) | EL | test: arms, n | quota % | value / quota | |')
    print('|---|---|---|---|---|---|---|---|---|---|---|')
    line = False
    for i, r in enumerate(rows[:25], 1):
        if r['settled'] and not line:
            print('| | **— stop line: below here the decision is settled enough —** | | | | | | | | | |')
            line = True
        print(f"| {i} | {r['decision']} | {r['incumbent']} | {r['p_not_best']:.2f} | {r['gap_if_not_best']:.3f} | "
              f"{r['pages']:,} | {r['el']:,.0f} | {' vs '.join(r['arms'])}, n={r['n']} | {r['cost']['quota_pct']} | "
              f"{r['value_per_quota']:,.0f} | {r['why_below'] if r['settled'] else 'evidence already favours ' + r['leader'] + ' (P ' + str(r['p_leader_beats_incumbent']) + '); the test confirms it in-round' if r['evidence_decides'] else ''} |")
    print(len(test_first), 'test-first entries:', json.dumps(test_first))


if __name__ == '__main__':
    main()
