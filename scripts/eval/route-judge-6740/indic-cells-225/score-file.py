#!/usr/bin/env python3
# PRIOR ART: scripts/eval/estimator/router-table/evidence/derive_backfill_all.py (writes the same score-file shape from
# older tests' own files; it has no reader for a paired-arm.mjs paired-score.json) and paired-arm.mjs score (the k/n
# this copies, unchanged). backfill-test-verdicts.mjs routeJudgeDir reads `<results>/score.json`; rules.json evidence
# entries point at it.
"""score.json for the #225 indic OCR cell tests, from paired-arm.mjs's paired-score.json (no model calls).

  python3 score-file.py scripts/eval/route-judge-6740/results/indic-ocr-cells-225
"""
import gzip
import json, sys, os

D = sys.argv[1]
P = json.load(open(os.path.join(D, 'paired-score.json')))
C = P['judges']['opus']['cells']
SERVED = {
    ('tamil', 'agy'): 'agy gemini-3.8-flash-low reads the image alone (cli-ocr.mjs read, live OCR prompt), one page a call',
    ('tamil', 'ia>agy'): "the Internet Archive's own OCR of the leaf (_djvu.xml) as the draft, agy gemini-3.8-flash-low corrects with the image",
    ('tamil', 'surya>agy'): 'Surya 2 (gex45, no lane guards) drafts, agy gemini-3.8-flash-low corrects with the image',
    ('series', 'gpu2>agy'): 'the bound english-gpu-7263 route: LightOnOCR + Surya 2 drafts and their word diff, agy gemini-3.8-flash-low reconciles (d-diff.mjs arm D)',
    ('series', 'agy'): 'agy gemini-3.8-flash-low reads the image alone (cli-ocr.mjs read, live OCR prompt), one page a call',
}
LANG = {'tamil': 'Tamil', 'series': 'Pali/Sanskrit (romanized)'}
import collections
# per page: the classes the judge named (any severity, once a page) and whether it named a wrong_text defect, as
# derive_backfill_all.py route() counts them; build.py's hard floor reads classes_k_of_n.
key = json.load(open(os.path.join(D, 'key.json')))
VD = {}
for line in gzip.open(os.path.join(D, 'verdicts-opus.jsonl.gz'), 'rt', encoding='utf-8'):
    if line.strip():
        r = json.loads(line)
        if r.get('verdict') and isinstance(r['verdict'].get('accept'), bool): VD[r['id']] = r['verdict']
CLS = {}
for k in key:
    v = VD.get(k['judged_as'])
    if k['kind'] != 'item' or not v: continue
    cs = {d.get('class') for d in v.get('defects') or [] if d.get('class')}
    wt = any(d.get('severity') == 'wrong_text' for d in v.get('defects') or [])
    c = CLS.setdefault((k['cell'], k['route']), [collections.Counter(), collections.Counter(), 0])
    c[0].update(cs); c[2] += 1
    if wt: c[1].update(cs)
def classes(cell, r):
    c = CLS.get((cell, r))
    if not c: return {}, {}
    return ({x: f'{k}/{c[2]}' for x, k in c[0].most_common()}, {x: f'{k}/{c[2]}' for x, k in c[1].most_common()})
out = {
    'generated_by': 'scripts/eval/route-judge-6740/indic-cells-225/score-file.py from paired-score.json (paired-arm.mjs score); no model calls',
    'provenance': '#225 (job indic-ocr-tests-225, 2026-11-13). tamil: 40 books of campaign indic-tamil-print-2026-11 (20 Kovilur Andavar, 20 Toronto), one middle-third text page each. series: 24 romanized Pali/Sanskrit text-edition volumes of campaign indic-translation-series-2026-11 (PTS, HOS), one diacritic-dense page each.',
    'judge': 'claude-opus-5-5 route judge (judge.mjs judgePrompt), one output a call, image attached, blind arm names; series judge_note: every dropped or wrong diacritic is a defect',
    'mapping': 'route judge: accept = verdict.accept; wrong_text = a wrong_text defect on the page',
    'cells': {},
}
for cell, X in C.items():
    routes = {}
    for r, x in X['routes'].items():
        routes[r] = {k: x[k] for k in ('n', 'books', 'accept', 'wrong_text_pages', 'accept_wilson', 'wrong_text_wilson', 'fidelity_mean', 'words', 'misleads_per_1k', 'wrong_text_per_1k') if k in x}
        routes[r]['served'] = SERVED.get((cell, r), '')
        routes[r]['classes_k_of_n'], routes[r]['wrong_text_classes'] = classes(cell, r)
        routes[r]['control_passed'] = X['controls'].get(r, {}).get('passed')
    out['cells'][cell] = {'task': 'ocr', 'lang': LANG.get(cell, cell), 'script_type': 'print', 'pages': max(x['n'] for x in X['routes'].values()),
                          'noise_floor': X.get('noise_floor'), 'against_baseline': X.get('against_baseline'), 'routes': routes}
json.dump(out, open(os.path.join(D, 'score.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote', os.path.join(D, 'score.json'))

# The by-script copy build.py reads (script_split.evidence_dir/<results dir>--score.json): every page drawn is PRINT (the
# Tamil leaves and the series volumes were looked at by eye; no manuscript, no lithograph). Paired counts (#7701): each arm
# against agy alone on the pages both were judged on, from key.json items joined to verdicts-opus.jsonl.gz.
V = {}
for line in gzip.open(os.path.join(D, 'verdicts-opus.jsonl.gz'), 'rt', encoding='utf-8'):
    if line.strip():
        r = json.loads(line)
        if r.get('verdict') and isinstance(r['verdict'].get('accept'), bool): V[r['id']] = r['verdict']['accept']
acc = {}
for k in key:
    if k['kind'] == 'item' and k['judged_as'] in V: acc.setdefault((k['cell'], k['route']), {})[k['page_id']] = V[k['judged_as']]
bs = {'source': '#225 indic-ocr-cells-225 (score-file.py)', 'cells': {}}
for cell, X in out['cells'].items():
    c = {'routes': {r: {kk: x[kk] for kk in ('n', 'books', 'accept', 'wrong_text_pages', 'classes_k_of_n', 'wrong_text_classes')} for r, x in X['routes'].items()}, 'paired': {}}
    base = acc.get((cell, 'agy'), {})
    for r in X['routes']:
        if r == 'agy': continue
        a = acc.get((cell, r), {}); shared = [p for p in a if p in base]
        c['paired'][f'{r}|agy'] = {'n': len(shared), 'books': len(shared),
            'both': sum(a[p] and base[p] for p in shared), 'a_only': sum(a[p] and not base[p] for p in shared),
            'b_only': sum(base[p] and not a[p] for p in shared), 'neither': sum(not a[p] and not base[p] for p in shared)}
    bs['cells'][f'{cell}|print'] = c
BS = os.path.join(os.path.dirname(__file__), '../../estimator/router-table/evidence/by-script', os.path.basename(os.path.normpath(D)) + '--score.json')
json.dump(bs, open(BS, 'w'), ensure_ascii=False, indent=1)
print('wrote', os.path.normpath(BS))

# defect-rates.json (the shape latin-flash3-live-route-8632 used): per cell and arm, defects per 1,000 words from
# paired-score.json, for the write-up's `defect_rates` header. The rule itself runs nightly over the evidence store
# (defect-rate.py --store-rows) once backfill-test-verdicts.mjs has put these verdicts there.
dr = {'about': 'Defect rates per 1,000 words by arm, Opus route judge, from paired-score.json (#225). words = the judged text\'s words (Tamil: whitespace tokens; quote CER-like counts per word with care, non-latin-text-operations.md).', 'cells': {}}
for cell, X in C.items():
    dr['cells'][cell] = {r: {k: x.get(k) for k in ('n', 'words', 'misleads_per_1k', 'wrong_text_per_1k', 'fidelity_mean', 'accept')} for r, x in X['routes'].items()}
json.dump(dr, open(os.path.join(D, 'defect-rates.json'), 'w'), ensure_ascii=False, indent=1)
print('wrote', os.path.join(D, 'defect-rates.json'))
