#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/score.mjs writes results.json (arms, strata by lang/style, pairs) and
# gallery.mjs a 5/5/5 gallery; neither writes the #5695-addendum outputs: one JSONL row per page x arm with licences
# and `publishable`, the six-dimension profile (addendum B), period strata, the noise floor table, or cost at scale.
"""#5695 T3: fold results.json + dimension verdicts + image check into pages.jsonl (page x arm, Zenodo-ready) and summary.json."""
import json, random, sys, collections, statistics as st
R = sys.argv[1]; DIMS = sys.argv[2]; DKEY = sys.argv[3]
d = json.load(open(R + '/results.json'))
recs = {f"{r['book_id']}_{int(r['page_number']):05d}": r for r in map(json.loads, open(R + '/records.jsonl'))}
raw = {}
for a in ['L1', 'L2', 'F0', 'FT', 'NC', 'O']:
    raw[a] = {json.loads(l)['id']: json.loads(l) for l in open(f'{R}/raw/{a}.jsonl')}
dkey = json.load(open(DKEY)); dims = {}
for l in open(DIMS):
    x = json.loads(l); s = 'A' if dkey[x['id']] == 'served=A' else 'B'; r = 'B' if s == 'A' else 'A'
    dims[x['id']] = {'served': x[s], 'reference': x[r], 'ours_right_ref_wrong': x[f'{s}_right_{r}_wrong'], 'ref_right_ours_wrong': x[f'{r}_right_{s}_wrong'], 'different_legitimate_choice': x.get('different_legitimate_choice'), 'note': x.get('note')}
img = {json.loads(l)['id']: json.loads(l) for l in open(R + '/image-check.jsonl')}
period = lambda y: '16c or earlier' if y < 1600 else '17c' if y < 1700 else '18c' if y < 1800 else '19c'
rows = []
for p in d['per_page']:
    r = recs[p['id']]; m = r['reference_meta']; b = r['book_meta']
    open_ref = (not m['private']) and m['licence'].startswith('public-domain')
    for arm, v in p['arms'].items():
        if v.get('fidelity') is None: continue  # arm not run on this page (O is 20 pages)
        js = {j: x for j, x in v['by_judge'].items() if x}; served = next((c for c in r['candidates'] if c['arm'] == 'served'), {}) if arm == 'served' else raw[arm][p['id']]
        row = {'track': 'T3', 'id': p['id'], 'book_id': r['book_id'], 'page_number': r['page_number'], 'url': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}",
               'lang': r['lang'], 'year': b.get('year'), 'period': period(int(b.get('year') or 0)), 'genre': b.get('genre'), 'book_title': b.get('title'), 'author': b.get('author'),
               'arm': arm, 'arm_model': served.get('model'), 'arm_prompt_version': served.get('prompt_version'), 'thinking_tokens': served.get('thinking_tokens'), 'usd': served.get('usd'),
               'measure': 'judged against a human reference (2 blind Opus judges)',
               'fidelity': v['fidelity'], 'fidelity_by_judge': {j: x['fidelity'] for j, x in js.items()},
               'omission': st.mean(1 if x['omission'] else 0 for x in js.values()), 'reversal': st.mean(1 if x.get('reversal') else 0 for x in js.values()),
               'invention_kinds': sorted({i['kind'] for x in js.values() for i in (x.get('invention') or [])}),
               'defect_classes': sorted({f"{q['class']}:{q['severity']}" for x in js.values() for q in (x.get('defects') or [])}),
               'reference_fit': p['reference_fit'],
               'reference': {k: m.get(k) for k in ['title', 'translator', 'year', 'licence', 'private', 'style', 'canonical', 'indirect', 'url', 'located', 'coverage_note']},
               'licences': {'scan': b.get('scan_licence'), 'scan_provider': b.get('scan_provider'), 'our_text': 'CC-BY-SA-4.0', 'reference': m['licence'], 'reference_publishable': open_ref},
               'publishable': open_ref, 'ocr_note': r.get('ocr_note'), 'page_selection': r.get('page_selection')}
        if arm == 'served' and p['id'] in dims:
            row['dimensions'] = {'served': {**dims[p['id']]['served'], 'fidelity': v['fidelity']}, 'reference': dims[p['id']]['reference'], 'measure': 'one Opus judge, blind A/B, addendum-B rubric; fidelity copied from the reference judges'}
        if p['id'] in img and arm in ('served', 'L1'):
            row['image_check'] = {'primary_cause': img[p['id']]['primary_cause_served' if arm == 'served' else 'primary_cause_L1'], 'n_ocr_meaning_errors': img[p['id']]['n_ocr_meaning_errors']}
        rows.append(row)
open(R + '/pages.jsonl', 'w').write(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in rows))

rng = random.Random(5695)
def ci(xs, B=4000):
    if not xs: return None
    ms = sorted(st.mean(rng.choices(xs, k=len(xs))) for _ in range(B))
    return [round(st.mean(xs), 3), round(ms[int(.025 * B)], 3), round(ms[int(.975 * B)], 3), len(xs)]
S = {}
sv = [r for r in rows if r['arm'] == 'served']
def strat(key, f):
    g = collections.defaultdict(list)
    for r in sv: g[f(r)].append(r)
    S[key] = {k: {'fidelity': ci([r['fidelity'] for r in v]), 'fid_ge4': ci([1 if r['fidelity'] >= 4 else 0 for r in v]), 'omission': ci([r['omission'] for r in v]), 'reversal': ci([r['reversal'] for r in v])} for k, v in sorted(g.items())}
strat('lang', lambda r: r['lang']); strat('period', lambda r: r['period']); strat('style', lambda r: r['reference']['style'])
strat('indirect', lambda r: 'indirect' if r['reference'].get('indirect') else 'direct'); strat('served_model', lambda r: 'flash' if 'lite' not in (r['arm_model'] or '') else 'lite')
strat('script', lambda r: (r['ocr_note'] or {}).get('script', '?')); strat('all', lambda r: 'all')
arms = {}
for a in ['served', 'L1', 'L2', 'F0', 'FT', 'NC', 'O']:
    v = [r for r in rows if r['arm'] == a]
    arms[a] = {'n': len(v), 'fidelity': ci([r['fidelity'] for r in v]), 'fid_ge4': ci([1 if r['fidelity'] >= 4 else 0 for r in v]), 'omission_per100': ci([100 * r['omission'] for r in v]), 'reversal_per100': ci([100 * r['reversal'] for r in v]),
               'unreadable_fill_per100': round(100 * st.mean(1 if 'unreadable_fill' in r['invention_kinds'] else 0 for r in v), 1), 'boundary_per100': round(100 * st.mean(1 if 'boundary' in r['invention_kinds'] else 0 for r in v), 1),
               'usd_per_page': round(st.mean(r['usd'] for r in v), 5) if v[0].get('usd') is not None else None, 'thinking_tokens_per_page': round(st.mean(r['thinking_tokens'] or 0 for r in v)) if v[0].get('thinking_tokens') is not None else None}
by = {a: {r['id']: r for r in rows if r['arm'] == a} for a in arms}
def paired(a, b, f):
    ids = [i for i in by[a] if i in by[b]]
    return ci([f(by[b][i]) - f(by[a][i]) for i in ids])
P = {}
for a, b in [('L1', 'L2'), ('L1', 'F0'), ('L1', 'FT'), ('F0', 'FT'), ('L1', 'NC'), ('served', 'L1'), ('L1', 'O'), ('F0', 'O'), ('FT', 'O'), ('served', 'O')]:
    P[f'{b} minus {a}'] = {'fidelity': paired(a, b, lambda r: r['fidelity']), 'omission_per100': paired(a, b, lambda r: 100 * r['omission']), 'reversal_per100': paired(a, b, lambda r: 100 * r['reversal']), 'pages_abs_fid_diff_ge1': sum(1 for i in by[a] if i in by[b] and abs(by[a][i]['fidelity'] - by[b][i]['fidelity']) >= 1)}
D = {}
DIM = ['fidelity', 'readability', 'register', 'terminology', 'ambiguity', 'transparency']
for lang in sorted({r['lang'] for r in sv}) + ['ALL']:
    v = [r for r in sv if 'dimensions' in r and (lang == 'ALL' or r['lang'] == lang)]
    D[lang] = {'n': len(v), 'served': {k: round(st.mean(r['dimensions']['served'][k] for r in v), 2) for k in DIM}, 'reference': {k: round(st.mean(r['dimensions']['reference'][k] for r in v), 2) for k in DIM[1:]},
               'stance_served': dict(collections.Counter(r['dimensions']['served']['stance'] for r in v)), 'stance_reference': dict(collections.Counter(r['dimensions']['reference']['stance'] for r in v))}
threats = {'pages_ours_right_reference_wrong': sum(1 for x in dims.values() if x['ours_right_ref_wrong']), 'pages_reference_right_ours_wrong': sum(1 for x in dims.values() if x['ref_right_ours_wrong']), 'n_dims': len(dims),
           'reference_fit': d['reference_fit'], 'canonical_pages': sum(1 for r in sv if r['reference'].get('canonical')), 'indirect_pages': sum(1 for r in sv if r['reference'].get('indirect')),
           'draw_pages': sum(1 for r in sv if (r['page_selection'] or {}).get('method') == 'draw'), 'agreement': d['agreement']}
samp = json.load(open(R + '/image-check-sample.json'))
IC = {}
for g in ['low', 'random']:
    rs = [img[i] for i in samp[g] if i in img]
    IC[g] = {'n': len(rs), 'primary_cause_served': dict(collections.Counter(r['primary_cause_served'] for r in rs)), 'primary_cause_L1': dict(collections.Counter(r['primary_cause_L1'] for r in rs)),
             'defect_causes_served': dict(collections.Counter(q['cause'] for r in rs for q in r['served_defects'])), 'defect_causes_L1': dict(collections.Counter(q['cause'] for r in rs for q in r['l1_defects'])),
             'pages_with_ocr_meaning_error': sum(1 for r in rs if r['n_ocr_meaning_errors'] > 0)}
json.dump({'n_pages': len(sv), 'strata_served': S, 'arms': arms, 'paired': P, 'dimensions': D, 'threats': threats, 'image_check': IC}, open(R + '/summary.json', 'w'), indent=1, ensure_ascii=False)
print(len(rows), 'rows')
