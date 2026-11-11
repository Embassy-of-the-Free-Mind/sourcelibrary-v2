#!/usr/bin/env python3
# PRIOR ART: evidence/derive_backfill.py (turns stored verdict files into router evidence; it reads #7568 and #7517 rows,
# not a router-confirm result) and scripts/eval/router-next-7263/split_evidence.py (cuts evidence by script from a page
# list; this frame is print by construction, so no cut is needed). No model calls.
"""Router evidence from the V4 run on latin-lite/print (#7263, PR #8000), which the brief's job ships as the cell's decision.

  python3 scripts/eval/estimator/router-table/evidence/derive_v4_latin_7263.py   (repo root)

Writes evidence/router-v4-latin-lite-7263.score.json and its evidence/by-script/ twin, from
scripts/eval/results/router-v4-latin-lite/latin-lite-print-2026-11-03.json: one page per book, 30 books, every arm on the
same page, a refused arm serves the stored text. The result file keeps no defect classes per page, so classes_k_of_n is
empty: rules.json hard_floor counts no invented-text pages from this source (unmeasured here, not zero).

The English arms (E1-E4, english-2026-11-03.json) are NOT pooled. The router's Latin translation cell, latin-tr-first, is
FIRST English over stored OCR, judged by the route judge; E1-E4 re-translate pages that have English, three of them over
another transcription, and their outcome is the #5274 judge's end-to-end rate, not accept k/n. They are quoted under
`english_not_pooled` so the file carries them.
"""
import json

D = 'scripts/eval/estimator/router-table/evidence/'
R = 'scripts/eval/results/router-v4-latin-lite/'
CELL = 'latin-lite-v4'
ROUTES = {'served': 'lite', 'B': 'lite>agy-flash-low', 'C': 'agy-flash-low@4-read'}

v = json.load(open(R + 'latin-lite-print-2026-11-03.json'))
e = json.load(open(R + 'english-2026-11-03.json'))
n = v['pages']
if n != 30 or len({p['book_id'] for p in v['per_page']}) != n:
    raise SystemExit(f'expected 30 pages in 30 books, got {n}')
routes = {}
for arm, route in ROUTES.items():
    a = v['arms'][arm]
    # recount from the pages: the arm's summary must agree with its per-page verdicts
    k, w = sum(p[arm]['accept'] for p in v['per_page']), sum(p[arm]['wrong'] for p in v['per_page'])
    if f'{k}/{n}' != a['accepted'] or w != a['wrong_text_pages']:
        raise SystemExit(f'{arm}: {k}/{n} wrong {w} against the summary {a["accepted"]} wrong {a["wrong_text_pages"]}')
    routes[route] = dict(n=n, books=n, accept=f'{k}/{n}', wrong_text_pages=f'{w}/{n}', classes_k_of_n={}, served=a['served_outcomes'], defects=a['defects'])
head = dict(generated_by=D + 'derive_v4_latin_7263.py', source=R + 'latin-lite-print-2026-11-03.json (scripts/eval/router-confirm/confirm.mjs, PR #8000)',
            judge='claude -p --model opus, judgeAbsolute, blind, image open', controls=v['controls'], frame=f"30 fresh Latin print books, seed {v['seed']}, one body page each; none in the cell's earlier evidence",
            english_not_pooled=dict(why='no router cell for re-translating a page (latin-tr-first is first English); see the header', arms=e['arms'], vs_E1=e['vs_E1'], gate=e['gate']))
json.dump(dict(head, cells={CELL: dict(task='ocr', lang='Latin', routes=routes)}), open(D + 'router-v4-latin-lite-7263.score.json', 'w'), indent=1)
json.dump(dict(head, cells={f'{CELL}|print': dict(task='ocr', lang='Latin', routes=routes)}), open(D + 'by-script/router-v4-latin-lite-7263.score.json', 'w'), indent=1)
print({r: x['accept'] for r, x in routes.items()})
