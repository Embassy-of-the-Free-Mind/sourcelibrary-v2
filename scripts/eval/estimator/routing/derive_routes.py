#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/planner/planner_v0.py — ranks which TEST to run next by expected loss and value
# per quota point; it reads the estimators but proposes no routing and does not know what the routers do today (its
# incumbents are a hand map, stale for Chinese print since #7075). scripts/eval/build-routing-table.mjs renders the OCR
# table for people; scripts/audit/routing-drift.mjs compares the routers with the hand-written ledger. None turns the
# posteriors into a routing proposal checked against the tables the routers now read (#7170).
"""
derive_routes — what the estimators say each routing-table row should be, as a reviewable proposal (#7170).

WHO RUNS IT: a session about to change routing, after the planner or an estimator is refit. Local, no network, no
model call, no database:

    python3 scripts/eval/estimator/routing/derive_routes.py [--plan=FILE] [--ocr=FILE] [--date=YYYY-MM-DD]

It writes results/route-proposals-<date>.{json,md} beside this file and changes NO table. Adopting a proposal is a
hand edit of scripts/lib/ocr-routing-table.json (`route`) or scripts/lib/translation-routing-table.json, in a PR that
cites the proposal file; the routers read those files (tests/unit/routing-from-table.test.ts).

INPUTS. The newest planner result (scripts/eval/estimator/planner/results/plan-v0-*.json: per decision, the
incumbent, the leader, P(leader beats incumbent), expected loss per page, volume, and which arms are infeasible at
that volume) and the OCR estimator (scripts/eval/estimator/ocr/results/ocr-v0.json: per chart and engine, accuracy
and P(best)). The incumbent is read from the TABLES, not the planner: where they differ the row says STALE and the
planner should be re-run before anyone acts on it.

VERDICTS, per decision row:
  KEEP     the table's engine is the leader, or P(not best) < 0.10
  TEST     the evidence does not decide (P(leader beats incumbent) < 0.90); the planner names the test
  ADOPT    the evidence decides and the leader is an engine the router already runs on an allowed channel
  LANE     the evidence decides, the leader runs only through a subscription CLI lane (Opus, Sonnet, agy Gemini);
           the router would need to hold the book for that lane (as CLI_FLASH_OCR_HOLD does for OCR flash)
  PRICE    the evidence decides and the leader is a non-lite Gemini model on the paid API: forbidden without Derek
           (2026-10-08); the row says what it would cost
  STALE    the planner's incumbent is not what the table routes today

REFUSALS. For each OCR chart, the next reader for a page Gemini refused (RECITATION is a Gemini behaviour, so the
fallback is never a Gemini model): the most accurate MEASURED non-Gemini engine that has a lane in this repo, else
Opus through scripts/batch/claude-ocr.mjs, the reader that filled the Diels pages (#7141). Within-chart ranking only:
the v0 estimator's absolute levels carry a known 0.064 CER bias (#6740).

KNOWN LIMITS (v0): P(best) inside the non-Gemini subset is not computed (the estimator saves marginal P(best), not
draws); the subset is ranked by posterior median accuracy and the marginal P(best) is reported beside it.
"""
import argparse
import datetime as dt
import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
LITE, FLASH = 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'

# Planner display names -> engine ids the tables use.
TR_NAME = {'Flash-Lite 3.1': LITE, '3 Flash': FLASH, '3.8 Flash CLI': 'gemini-3.8-flash+agy-cli',
           'Opus 5.5': 'claude-opus-5-5', 'Sonnet 5.5': 'claude-sonnet-5-5', 'G4L CLI': 'gemini-4-argon-low+agy-cli'}
# Engines a Batch router can run, and the channel each must use (DECISIONS.md "All Gemini OCR (channel)").
BATCH_API_OK = {LITE}
CLI_LANES = {
    'claude-opus-5-5': {'ocr': 'scripts/batch/claude-ocr.mjs', 'translation': 'scripts/batch/claude-translate.mjs'},
    'claude-sonnet-5-5': {'ocr': 'scripts/batch/claude-ocr.mjs --model=sonnet', 'translation': 'scripts/batch/claude-translate.mjs --model=sonnet'},
    'gemini-3.8-flash+agy-cli': {'translation': 'scripts/batch/cli-translate.mjs'},
    'gemini-3-flash-preview': {'ocr': 'scripts/batch/cli-ocr.mjs (CLI_FLASH_OCR_HOLD)', 'translation': 'scripts/batch/cli-translate.mjs'},
}
# Non-Gemini OCR readers with a lane in this repo (the refusal fallback may only name one of these).
OCR_SPECIALIST_LANES = {
    'claude-opus-5-5': 'scripts/batch/claude-ocr.mjs',
    'claude-sonnet-5-5': 'scripts/batch/claude-ocr.mjs --model=sonnet',
    'paddleocr-vl-1.6': 'scripts/workers/paddle-zh-guarded-lane.mjs',
    'omnisyr': 'scripts/lib/syriac-kraken-lane.mjs',
    'sophro-defaultseg': 'scripts/lib/syriac-kraken-lane.mjs',
}
# OCR chart -> the routing-table row that holds its pages, and the language families of that chart.
CHART_ROW = {'latin': 'latin-script-print', 'english': 'latin-script-print', 'latin-script-other': 'latin-script-print',
             'greek': 'greek-print', 'chinese-print': 'chinese-print', 'chinese-manuscript': 'chinese-siku-manuscript',
             'syriac': 'syriac', 'syriac-print': 'syriac', 'hebrew': None, 'armenian': None}
CHART_FAMILY = {'greek': 'grc', 'chinese-print': 'zho'}
# Translation decision -> the language label the translation table is probed with.
TR_PROBE = {'translate Latin': 'Latin', 'translate German': 'German', 'translate Tibetan': 'Tibetan',
            'translate Greek': 'Greek', 'translate French': 'French', 'translate Italian': 'Italian',
            'translate Hebrew': 'Hebrew', 'translate Arabic': 'Arabic', 'translate Sanskrit': 'Sanskrit',
            'translate Persian': 'Persian', 'translate Pali': 'Pali', 'translate Chinese': 'Chinese'}
# Weekly subscription capacity in PAGES, from the planner's WEEK calls (constants) and pages per call:
# Opus/Sonnet 10 pages a call (claude-ocr/claude-translate default), agy one page a call.
PAGES_PER_CALL = {'claude': 10, 'gemini_low': 1}


def newest(pattern):
    files = sorted(glob.glob(os.path.join(ROOT, pattern)))
    if not files:
        raise SystemExit(f'no file matches {pattern}')
    return files[-1]


def load(path):
    with open(path) as f:
        return json.load(f)


def translation_engine(table, language):
    """The translation table's engine for a book labelled `language` (the routers' rule, re-stated for a probe)."""
    import re
    for row in table['rows']:
        prefixes = row['match'].get('language_prefix')
        if prefixes:
            alt = '|'.join(re.escape(p.strip().lower()).replace('\\ ', r'\s+') for p in prefixes)
            leads = row['match'].get('optional_lead') or []
            lead = '((' + '|'.join(re.escape(w) for w in leads) + r')\s+)?' if leads else ''
            if re.match(rf'^\s*{lead}({alt})\b', language, re.I):
                return row['engine'], row['id']
    return table['default']['engine'], 'default'


def ocr_incumbent(table, chart):
    row_id = CHART_ROW.get(chart)
    if not row_id:
        return None, None
    rows = {r['id']: r for r in table['rows']}
    row = rows.get(row_id)
    route = (row or {}).get('route') or {}
    fam = CHART_FAMILY.get(chart)
    if fam:
        for r in table['rows']:
            fams = (r.get('route') or {}).get('families') or {}
            if fam in fams:
                return r['route']['engine'], r['id']
    if route.get('engine'):
        return route['engine'], row_id
    if route.get('default'):
        return route['engine'], row_id
    return None, row_id  # a specialist lane row: the router does not choose its engine


def weeks_to_drain(engine, pages, constants):
    week = constants.get('WEEK', {})
    if engine.startswith('claude-'):
        cap = week.get('claude', 0) * PAGES_PER_CALL['claude']
    elif 'agy' in engine or engine == FLASH:
        cap = week.get('gemini_low', 0) * PAGES_PER_CALL['gemini_low']
    else:
        return None
    return round(pages / cap, 1) if cap else None


def verdict_for(row, incumbent, constants, stage):
    leader = TR_NAME.get(row['leader'], row['leader']) if stage == 'translation' else row['leader']
    planner_inc = TR_NAME.get(row['incumbent'], row['incumbent']) if stage == 'translation' else row['incumbent']
    out = {'leader': leader, 'planner_incumbent': planner_inc}
    if incumbent and planner_inc != incumbent:
        out.update(verdict='STALE', why=f'the planner assumed {planner_inc}; the table routes {incumbent}. Re-run the planner before acting.')
        return out
    if leader == incumbent or row['p_not_best'] < 0.10:
        out.update(verdict='KEEP', why='the routed engine leads' if leader == incumbent else f"P(not best) {row['p_not_best']:.2f} < 0.10")
        return out
    if not row.get('evidence_decides'):
        out.update(verdict='TEST', why=f"the planner's evidence does not decide (P(leader beats routed) {row['p_leader_beats_incumbent']:.2f}, "
                                       f"P(routed not best) {row['p_not_best']:.2f}); its test: {', '.join(row['arms'])}, n={row['n']}")
        return out
    infeasible = [TR_NAME.get(a, a) for a in (row.get('not_feasible_at_this_volume') or [])]
    w = weeks_to_drain(leader, row['pages'], constants)
    if leader in infeasible:
        out.update(verdict='TEST', why=f'the leader is not feasible at {row["pages"]:,} pages on the subscriptions')
    elif leader in BATCH_API_OK:
        out.update(verdict='ADOPT', why='the leader runs on the paid Batch API under the allowlist')
    elif leader in CLI_LANES and CLI_LANES[leader].get(stage):
        out.update(verdict='LANE', why=f"subscription lane {CLI_LANES[leader][stage]}; about {w} weeks of that subscription's capacity for {row['pages']:,} pages" if w else f"subscription lane {CLI_LANES[leader][stage]}")
    elif leader.startswith('gemini-'):
        out.update(verdict='PRICE', why='a non-lite Gemini model on the paid API: Derek decides (2026-10-08)')
    else:
        out.update(verdict='TEST', why=f'no lane in this repo runs {leader}')
    out['weeks_to_drain'] = w
    return out


def refusal_fallbacks(ocr):
    by_chart = {}
    for r in ocr['table']:
        by_chart.setdefault(r['chart'], []).append(r)
    out = []
    for chart, rows in sorted(by_chart.items()):
        cands = [r for r in rows if not r['engine'].startswith('gemini') and r['engine'] in OCR_SPECIALIST_LANES and r.get('basis') == 'measured']
        cands.sort(key=lambda r: -r['accuracy'][1])
        if cands:
            best = cands[0]
            out.append({'chart': chart, 'engine': best['engine'], 'lane': OCR_SPECIALIST_LANES[best['engine']],
                        'accuracy_median': best['accuracy'][1], 'p_best_marginal': best['p_best'], 'pages': best['pages'],
                        'runner_up': cands[1]['engine'] if len(cands) > 1 else None, 'basis': 'measured'})
        else:
            out.append({'chart': chart, 'engine': 'claude-opus-5-5', 'lane': OCR_SPECIALIST_LANES['claude-opus-5-5'],
                        'basis': 'unmeasured in this chart: Opus by default (filled the Diels pages by eye, #7141)'})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan')
    ap.add_argument('--ocr')
    ap.add_argument('--date', default=dt.date.today().isoformat())
    a = ap.parse_args()
    plan_path = a.plan or newest('scripts/eval/estimator/planner/results/plan-v0-*.json')
    ocr_path = a.ocr or os.path.join(ROOT, 'scripts/eval/estimator/ocr/results/ocr-v0.json')
    plan, ocr = load(plan_path), load(ocr_path)
    ocr_table = load(os.path.join(ROOT, 'scripts/lib/ocr-routing-table.json'))
    tr_table = load(os.path.join(ROOT, 'scripts/lib/translation-routing-table.json'))
    constants = plan.get('constants', {})

    rows = []
    for r in plan['rows']:
        stage = r['stage']
        if stage == 'translation':
            lang = TR_PROBE.get(r['decision'])
            inc, row_id = translation_engine(tr_table, lang) if lang else (None, None)
        elif stage == 'ocr':
            chart = r['decision'].split(' (')[0].replace('read ', '')
            inc, row_id = ocr_incumbent(ocr_table, chart)
        else:
            inc, row_id = None, None
        v = verdict_for(r, inc, constants, stage) if stage in ('ocr', 'translation') else {'verdict': 'KEEP', 'why': 'correction lanes are not routed by a table', 'leader': r['leader']}
        pa = r.get('p_best_all_engines')
        if pa and r.get('not_feasible_at_this_volume'):
            top = max(pa, key=pa.get)
            if top != r['leader']:   # the leader with every engine back in, for a decision small enough to fit (#6871)
                v['why'] += f"; with the capacity-filtered engines back in, {top} leads (P(best) {pa[top]:.2f}): a held frame small enough to fit can route there"
        rows.append({'stage': stage, 'decision': r['decision'], 'table_row': row_id, 'table_engine': inc,
                     'p_leader_beats_incumbent': r.get('p_leader_beats_incumbent'), 'p_not_best': r.get('p_not_best'),
                     'el_per_page': r.get('el_per_page'), 'pages': r.get('pages'), 'p_best': r.get('p_best'),
                     'p_best_all_engines': r.get('p_best_all_engines'), **v})

    result = {'date': a.date, 'issue': 7170, 'plan': os.path.relpath(plan_path, ROOT), 'ocr_estimator': os.path.relpath(ocr_path, ROOT),
              'tables': ['scripts/lib/ocr-routing-table.json', 'scripts/lib/translation-routing-table.json'],
              'rows': rows, 'refusal_fallbacks': refusal_fallbacks(ocr)}
    out = os.path.join(HERE, 'results', f'route-proposals-{a.date}')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + '.json', 'w') as f:
        json.dump(result, f, indent=1)
    with open(out + '.md', 'w') as f:
        f.write(render(result))
    counts = {}
    for r in rows:
        counts[r['verdict']] = counts.get(r['verdict'], 0) + 1
    print(f"{len(rows)} decisions: {counts}; {len(result['refusal_fallbacks'])} refusal fallbacks -> {os.path.relpath(out, ROOT)}.{{json,md}}")


def render(res):
    L = [f"# Routing proposals from the estimators, {res['date']} (#{res['issue']})", '',
         f"Generated by `scripts/eval/estimator/routing/derive_routes.py` from `{res['plan']}` and `{res['ocr_estimator']}`, "
         'against the tables the routers read today. Nothing here changes routing: adopting a row is a reviewed edit of the table.', '',
         '| stage | decision | table row | routed today | leader | P(leader > routed) | EL/page | pages | verdict | why |',
         '|---|---|---|---|---|---|---|---|---|---|']
    for r in res['rows']:
        p = r.get('p_leader_beats_incumbent')
        el = r.get('el_per_page')
        L.append(f"| {r['stage']} | {r['decision']} | {r['table_row'] or '—'} | {r['table_engine'] or '—'} | {r['leader']} | "
                 f"{'' if p is None else f'{p:.2f}'} | {'' if el is None else f'{el:.4f}'} | {r['pages'] or 0:,} | **{r['verdict']}** | {r['why']} |")
    L += ['', '## Refused pages: the next reader per chart', '',
          'Gemini refused the page (RECITATION), so the next reader is never Gemini. Within-chart ranking of measured engines that have a lane here.', '',
          '| chart | next reader | lane | median accuracy | marginal P(best) | basis |', '|---|---|---|---|---|---|']
    for r in res['refusal_fallbacks']:
        acc = r.get('accuracy_median')
        pb = r.get('p_best_marginal')
        L.append(f"| {r['chart']} | {r['engine']} | `{r['lane']}` | {'' if acc is None else f'{acc:.3f}'} | {'' if pb is None else f'{pb:.2f}'} | {r['basis']} |")
    return '\n'.join(L) + '\n'


if __name__ == '__main__':
    main()
