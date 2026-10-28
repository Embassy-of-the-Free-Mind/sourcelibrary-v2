#!/usr/bin/env python3
"""add-evidence.py — #7263: this job's TEST verdicts and #7567 E2's, as router-table evidence (rules.json), then build.

PRIOR ART: scripts/eval/estimator/router-table/rules.json `cells[].routes[].evidence` ({score, cell, route}) — the
format build.py pools; entries for the 2026-10-26 router tests were added by hand. This writes them from the two
score files route-score.py made, one source per route and cell so no page is counted twice:
  - new cells <language>-gpu-7263 (la en de fr it; build.py splits each into /print, /manuscript, /unknown from the
    by-script copies route-score.py writes): gpu, gpu>agy-flash-low (C), gpu2>agy-flash-low+diff (D), agy-flash-low (E), lite>opus (O, stored) from
    this job's TEST when the cell has them there, else from E2; lite, lite>agy-flash-low and the GLM routes from E2.
  - existing latin-lite / german-lite: E2's lite (L), lite>agy-flash-low (a) and lite>opus (f) on the same panel.
Idempotent: entries pointing at these two score files are replaced, never duplicated.

  add-evidence.py        (repo root) edits rules.json in place; prints the cells touched
"""
import json, os

R = 'scripts/eval/estimator/router-table/rules.json'
T = 'scripts/eval/gpu-flash-vs-opus-7263/results/score-test-7263.json'
E2 = 'scripts/eval/gpu-flash-vs-opus-7263/results/score-e2-7567.json'
rules = json.load(open(R)); t = json.load(open(T))['cells']; e2 = json.load(open(E2))['cells']
NAME = {'la': 'Latin', 'en': 'English', 'de': 'German', 'fr': 'French', 'it': 'Italian'}
DRAFT = {'la': 'PERO-OCR', 'en': 'LightOnOCR-3-1B', 'de': 'CHURRO-3B', 'fr': 'Surya 2', 'it': 'LightOnOCR-3-1B'}
SECOND = {'la': 'Surya 2', 'en': 'Surya 2', 'de': 'dots.ocr', 'fr': 'LightOnOCR-3-1B', 'it': 'Surya 2'}
MINE = (T, E2)


def ev(cell, route, prefer_test=True, min_n=10):
    for path, sc in ([(T, t), (E2, e2)] if prefer_test else [(E2, e2)]):
        r = sc.get(cell, {}).get('routes', {}).get(route)
        if r and r['n'] >= min_n: return [{'score': path, 'cell': cell, 'route': route}]
    return []


touched = []
for lang in ['la', 'en', 'de', 'fr', 'it']:
    c = lang; cid = f'{NAME[lang].lower()}-gpu-7263'
    routes = [
        {'id': 'lite', 'stage': 'none', 'evidence': ev(c, 'lite', False)},
        {'id': 'lite>agy-flash-low', 'stage': 'agy', 'evidence': ev(c, 'lite>agy-flash-low', False)},
        {'id': 'lite>opus', 'stage': 'opus-img@10', 'evidence': ev(c, 'lite>opus (stored)')},
        {'id': 'gpu', 'stage': 'none', 'evidence': ev(c, 'gpu')},
        {'id': 'gpu>agy-flash-low', 'stage': 'agy', 'evidence': ev(c, 'gpu>agy-flash-low')},
        {'id': 'gpu2>agy-flash-low+diff', 'stage': 'agy', 'evidence': ev(c, 'gpu2>agy-flash-low+diff')},
        {'id': 'agy-flash-low', 'stage': 'agy', 'evidence': ev(c, 'agy-flash-low')},
        {'id': 'gpu-glm>agy-flash-low', 'stage': 'agy', 'evidence': ev(c, 'gpu-glm>agy-flash-low', False)},
    ]
    routes = [r for r in routes if r['evidence'] or r['id'] == 'lite']
    cell = {'id': cid, 'title': f'{NAME[lang]}, GPU draft ({DRAFT[lang]}; second draft {SECOND[lang]}) — #7567 panel, #7263',
            'current': 'lite', 'pages_waiting': 0,
            '_pages_waiting': 'not measured here: the panel is one page per book across the corpus; the unread backlog per language is not split by this cell',
            '_evidence': 'one page per book (books = n). TEST verdicts (#7263) where present, else #7567 E2 on the same panel; no route counts both. GPU card time (about 1-5 s a page beside another tenant, #7567 E1) is not priced by stage none.',
            'routes': routes}
    rules['cells'] = [x for x in rules['cells'] if x['id'] != cid] + [cell]; touched.append(cid)

for cid, c in [('latin-lite', 'la'), ('german-lite', 'de')]:
    cell = next(x for x in rules['cells'] if x['id'] == cid)
    for r in cell['routes']:
        src = {'lite': 'lite', 'lite>agy-flash-low': 'lite>agy-flash-low', 'lite>opus': 'lite>opus (stored)'}.get(r['id'])
        if not src: continue
        r['evidence'] = [e for e in r.get('evidence', []) if e['score'] not in MINE] + ev(c, src, False)
    touched.append(cid)
# rules.json is laid out by hand (one cell header line, one line per route): rewrite only the touched cells' blocks.
def block(cell):
    head = {k: v for k, v in cell.items() if k != 'routes'}
    h = json.dumps(head, ensure_ascii=False)[1:-1]
    rs = ',\n'.join('        ' + json.dumps(r, ensure_ascii=False) for r in cell['routes'])
    return f'    {{ {h},\n      "routes": [\n{rs} ] }}'
lines = open(R).read().split('\n')
starts = [i for i, l in enumerate(lines) if l.startswith('    { "id": ')]
end_cells = next(i for i in range(len(lines) - 1, -1, -1) if lines[i] == '  ]')
spans = {json.loads('{' + lines[i].strip()[1:].split(', "title"')[0] + '}')['id']: (i, (starts[j + 1] if j + 1 < len(starts) else end_cells)) for j, i in enumerate(starts)}
cells = {c['id']: c for c in rules['cells']}
new_tail = [cid for cid in touched if cid not in spans]
for cid in sorted((c for c in touched if c in spans), key=lambda c: -spans[c][0]):
    a, b = spans[cid]; last = b == end_cells
    lines[a:b] = (block(cells[cid]) + ('' if last and not new_tail else ',')).split('\n')
end_cells = next(i for i in range(len(lines) - 1, -1, -1) if lines[i] == '  ]')
if new_tail:
    if not lines[end_cells - 1].endswith(','): lines[end_cells - 1] += ','
    lines[end_cells:end_cells] = (',\n'.join(block(cells[c]) for c in new_tail)).split('\n')
open(R, 'w').write('\n'.join(lines))
json.load(open(R))  # still valid JSON
print('cells touched:', touched)
