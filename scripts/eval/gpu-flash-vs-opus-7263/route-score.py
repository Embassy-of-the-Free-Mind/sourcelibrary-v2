#!/usr/bin/env python3
"""route-score.py — #7263 verdicts as a route-judge-format score.json, for router-table/build.py `evidence` entries.

PRIOR ART: scripts/eval/route-judge-6740/judge.mjs `score()` (writes results/<run>/score.json: cells -> routes -> accept,
wrong_text_pages, books, classes_k_of_n, CIs); build.py reads only accept, wrong_text_pages, books and classes_k_of_n.
That scorer reads its own accept/fidelity/taxonomy verdicts; these come from the 7522 transcription judge (usable +
fault lists), so the mapping is stated here and in every output:
  accept      = delivered and judged usable;
  wrong_text  = delivered and judged NOT usable (the reader is served text the page does not say: omissions, additions,
                bleed, order or meaning-changing misreads). A no-answer (CONTAIN, refusal, empty) is neither accepted nor
                wrong text — it is counted in n and named in `no_answer`;
  classes     = pages with at least one fault of that kind (omissions, additions, cross_page_bleed, order_errors, misreads).
Cells are <lang> (every page) and <lang>|<print|manuscript|unknown> (script-type.json), the key
scripts/eval/estimator/router-table/build.py expand_by_script reads from evidence/by-script/<this file's name>. One page per book, so books = n.

  route-score.py test  <J> <out.json>   this job: judge-test (O C C2 D X) + judge-testE (E)
  route-score.py e2    <J> <out.json>   #7567 E2 verdicts (results/verdicts-opus.jsonl.gz + judge-key.json), same panel
"""
import gzip, json, math, os, sys

MODE, J, OUT = sys.argv[1:4]
HERE = os.path.dirname(os.path.abspath(__file__)); E2R = os.path.join(HERE, '..', 'euro-gpu-correct-7567', 'results')
LANG = {p['slug']: p['lang'] for p in json.load(open(os.path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json')))['pages']}
ST = {k: v['script_type'] for k, v in json.load(open(os.path.join(J, 'script-type.json'))).items()}
FAULTS = ['omissions', 'additions', 'cross_page_bleed', 'order_errors', 'misreads']


def wilson(k, n, z=1.96):
    if n == 0: return [0.0, 1.0]
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [round((c - r) / d, 3), round((c + r) / d, 3)]


def collect(items, routes):
    """items: (slug, labels {lab: [arms]}, not_delivered [arms], versions {lab: verdict}); routes: arm -> route id."""
    cells = {}
    for slug, labels, nd, ver in items:
        seen = {}
        for lab, arms in labels.items():
            for a in arms: seen[a] = ver[lab]
        for a in nd: seen[a] = None
        for a, route in routes.items():
          if a not in seen: continue
          # one cell per language (all pages) and its by-script cut `<lang>|<script>` (router-table script_split scheme)
          for cell in (LANG[slug], f"{LANG[slug]}|{ST.get(slug, 'unknown')}"):
            v = seen[a]; R = cells.setdefault(cell, {}).setdefault(route, {'n': 0, 'acc': 0, 'wrong': 0, 'na': 0, 'cl': {f: 0 for f in FAULTS}, 'pages': []})
            R['n'] += 1
            if v is None: R['na'] += 1; R['pages'].append([slug, 'no-answer']); continue
            ok = bool(v.get('usable')); R['acc'] += ok; R['wrong'] += (not ok)
            for f in FAULTS: R['cl'][f] += bool(v.get(f))
            R['pages'].append([slug, 'accept' if ok else 'wrong_text'])
    out = {}
    for cell, rs in cells.items():
        out[cell] = {'task': 'ocr', 'lang': cell.split('|')[0], 'script_type': cell.split('|')[1] if '|' in cell else 'all', 'routes': {}}
        for route, R in rs.items():
            n = R['n']
            out[cell]['routes'][route] = {'n': n, 'books': n, 'accept': f"{R['acc']}/{n}", 'accept_rate': round(R['acc'] / n, 3) if n else None,
                'accept_ci': {'ci95': wilson(R['acc'], n), 'unit': 'book', 'units': n}, 'wrong_text_pages': f"{R['wrong']}/{n}",
                'wrong_text_ci': {'ci95': wilson(R['wrong'], n), 'unit': 'book', 'units': n}, 'no_answer': f"{R['na']}/{n}",
                'classes_k_of_n': {f: f"{c}/{n}" for f, c in R['cl'].items() if c}, 'pages': R['pages']}
    return out


if MODE == 'test':
    items = []
    for setname, keep in [('test', {'O', 'C', 'C2', 'D', 'X'}), ('testE', {'E'})]:
        base = os.path.join(J, f'judge-{setname}'); key = json.load(open(os.path.join(base, 'key.json')))['pages']
        for s, k in key.items():
            f = os.path.join(base, 'judge', 'out', f'{s}.json')
            v = (json.load(open(f)).get('verdict') or {}).get('versions') if os.path.exists(f) else None
            if not v: continue
            items.append((s, {l: [a for a in arms if a in keep] for l, arms in k['labels'].items()}, [a for a in k['not_delivered'] if a in keep], v))
    routes = {'O': 'lite>opus (stored)', 'X': 'gpu', 'C': 'gpu>agy-flash-low', 'C2': 'gpu>agy-flash-low (repeat)', 'D': 'gpu2>agy-flash-low+diff', 'E': 'agy-flash-low'}
    judge = 'Opus 5.5 via claude -p, scripts/eval/ocr-per-call-7522/judge.mjs unchanged, one call per page, image attached, arms blind and shuffled; E judged in a separate pass (E + O + C)'
else:
    key = json.load(open(os.path.join(E2R, 'judge-key.json')))
    ver = {r['page_id']: (r.get('verdict') or {}).get('versions') for r in (json.loads(l) for l in gzip.open(os.path.join(E2R, 'verdicts-opus.jsonl.gz'), 'rt'))}
    items = []
    for name, k in key.items():
        if k['group'] == 'noimg' or not ver.get(name): continue
        keep = {'lite': {'L', 'a', 'a2', 'f'}, 'gpu': {'G', 'X', 'b', 'c', 'd', 'e'}}[k['group']]
        items.append((k['slug'], {l: [a for a in arms if a in keep] for l, arms in k['labels'].items()}, [a for a in k['not_delivered'] if a in keep], ver[name]))
    routes = {'L': 'lite', 'a': 'lite>agy-flash-low', 'a2': 'lite>agy-flash-low (repeat)', 'f': 'lite>opus (stored)', 'G': 'gpu-glm', 'X': 'gpu',
              'b': 'gpu-glm>agy-flash-low', 'c': 'gpu>agy-flash-low', 'd': 'gpu-glm+gpu>agy-flash-low', 'e': 'agy-flash-low'}
    judge = '#7567 E2: Opus 5.5, ocr-per-call-7522/judge.mjs, lite packet (S L a a2 f e) and gpu packet (S G X b c d e) per page'
res = {'generated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'judge': judge,
       'mapping': 'accept = usable; wrong_text = delivered and not usable; no_answer counted in n, neither (route-score.py header)',
       'cells': collect(items, routes)}
json.dump(res, open(OUT, 'w'), separators=(',', ':'))
# the by-script copy build.py reads (same content: it holds both the whole-language and the per-script cells)
BS = os.path.join(HERE, '..', 'estimator', 'router-table', 'evidence', 'by-script', os.path.basename(OUT))
json.dump(res, open(BS, 'w'), separators=(',', ':'))
for c, x in sorted(res['cells'].items()):
    print(c, '  '.join(f"{r}: {v['accept']} wt {v['wrong_text_pages']} na {v['no_answer']}" for r, v in x['routes'].items()))
