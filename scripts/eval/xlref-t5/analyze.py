# PRIOR ART: scripts/eval/translation-vs-reference/score.mjs writes results.json (arms, strata by lang/canonical/style,
# pairs, per_page) with bootstrap CIs from lib/paired-stats.mjs; scripts/eval/translation-ab-5606/noise-floor.py tests
# flash vs lite against an A-vs-A floor on rank margins. Neither joins the results to T5's extra layers: edition
# period, the served model, the six-dimension pass, the by-eye cause pass, corrected-OCR arms, cost per page at
# corpus scale, and the one-row-per-page-x-arm JSONL the quality dataset (#5531) takes. This does only that join.
"""analyze.py <results dir> — writes summary.json, pages.jsonl (page x arm) and prints the tables for the verdict."""
import json, sys, glob, os, random, math
from collections import Counter, defaultdict

R = sys.argv[1]
res = json.load(open(f'{R}/results.json'))
corr = json.load(open(f'{R}/results-corrected-ocr.json'))
recs = {f"{r['book_id']}_{r['page_number']:05d}": r for r in map(json.loads, open(f'{R}/work/records-arms.jsonl'))}
census = json.load(open(f'{R}/census.json'))
per = {p['id']: p for p in res['per_page']}
rng = random.Random(5695)

def boot(xs, B=4000):
    xs = [x for x in xs if x is not None]
    if not xs: return None
    m = sum(xs) / len(xs)
    bs = sorted(sum(rng.choice(xs) for _ in xs) / len(xs) for _ in range(B))
    return {'n': len(xs), 'mean': round(m, 3), 'ci': [round(bs[int(B * .025)], 3), round(bs[int(B * .975)], 3)]}
def wilson(k, n):
    if not n: return None
    z = 1.96; p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return {'k': k, 'n': n, 'rate': round(p, 3), 'ci': [round(max(0, c - h), 3), round(min(1, c + h), 3)]}
def page_metric(p, arm, f):
    a = p['arms'].get(arm)
    if not a: return None
    vs = [f(v) for v in a['by_judge'].values()]
    return sum(vs) / len(vs)
fid = lambda p, arm: (p['arms'].get(arm) or {}).get('fidelity')
rev = lambda v: 1.0 if v.get('reversal') else 0.0
fill = lambda v: 1.0 if any(i.get('kind') == 'unreadable_fill' for i in v.get('invention') or []) else 0.0
bnd = lambda v: 1.0 if any(i.get('kind') == 'boundary' for i in v.get('invention') or []) else 0.0
om = lambda v: 1.0 if v.get('omission') else 0.0

S = {'run_id': 'xlref-t5-2026-10', 'n_pages': len(recs), 'n_served': sum(1 for p in per.values() if fid(p, 'served') is not None),
     'gate': res['gate'], 'agreement': res['agreement'], 'reference_fit': res['reference_fit']}

# 1. reference set
S['reference_set'] = {
    'by_lang': Counter(r['lang'] for r in recs.values()), 'canonical': Counter(str(r['reference_meta']['canonical']) for r in recs.values()),
    'style': Counter(r['reference_meta']['style'] for r in recs.values()), 'licence_private': sum(1 for r in recs.values() if r['reference_meta']['private']),
    'translators': Counter(r['reference_meta']['translator'] for r in recs.values()), 'edition_period': Counter(r['edition']['period'] for r in recs.values()),
    'genre': Counter(r['reference_meta']['genre'] for r in recs.values())}

# 2. served by stratum (report only n >= 10)
def strat(name, keyf, arm='served'):
    g = defaultdict(list)
    for i, p in per.items():
        if fid(p, arm) is not None: g[keyf(recs[i])].append(p)
    out = {}
    for k, ps in sorted(g.items()):
        if len(ps) < 10: out[k] = {'n': len(ps), 'note': 'n < 10, not reported'}; continue
        out[k] = {'fidelity': boot([fid(p, arm) for p in ps]), 'share_ge4': wilson(sum(1 for p in ps if fid(p, arm) >= 4), len(ps)),
                  'share_le3': wilson(sum(1 for p in ps if fid(p, arm) <= 3), len(ps)),
                  'omission': boot([page_metric(p, arm, om) for p in ps]), 'reversal': boot([page_metric(p, arm, rev) for p in ps]),
                  'unreadable_fill': boot([page_metric(p, arm, fill) for p in ps]), 'boundary': boot([page_metric(p, arm, bnd) for p in ps])}
    return out
served_model = lambda r: ('flash' if 'flash-lite' not in (next(c for c in r['candidates'] if c['arm'] == 'served').get('model') or '') else 'lite')
S['served'] = {'all': strat('all', lambda r: 'all')['all'], 'by_lang': strat('lang', lambda r: r['lang']),
               'by_canonical': strat('canon', lambda r: 'canonical' if r['reference_meta']['canonical'] else 'non-canonical'),
               'by_reference_style': strat('style', lambda r: r['reference_meta']['style']),
               'by_edition_period': strat('period', lambda r: r['edition']['period']),
               'by_served_model': strat('model', served_model),
               'by_lang_canonical': strat('lc', lambda r: f"{r['lang']} / {'canonical' if r['reference_meta']['canonical'] else 'non-canonical'}")}
ok_fit = [i for i, p in per.items() if all(v not in ('wrong',) for v in p['reference_fit'].values())]
S['served']['fit_not_wrong_n'] = len(ok_fit)

# 3. arms: fidelity, reversals / 100 pages, cost
def cost_of(arm):
    fs = glob.glob(f'{R}/arms/{arm}/*.json')
    if arm in ('lite', 'lite2', 'flash'):
        d5606 = os.path.join(R, '..', 'translation-ab-5606-2026-10-02', 'arms', 'gemini', {'lite': 'lite-batch', 'lite2': 'lite-rerun-batch', 'flash': 'flash-batch'}[arm])
        b = [json.load(open(f)).get('cost_usd') for f in glob.glob(d5606 + '/*.json') if not f.endswith('failed.json')]
        b = [x for x in b if x is not None]
        r = [json.load(open(f)).get('cost_usd_batch_equiv') for f in fs]
        allc = b + [x for x in r if x is not None]
        return {'usd_per_page_batch': round(sum(allc) / len(allc), 5), 'n': len(allc)} if allc else None
    cs = [json.load(open(f)) for f in fs]; cs = [c for c in cs if c.get('cost_usd_batch_equiv') is not None]
    if not cs: return None
    return {'usd_per_page_batch': round(sum(c['cost_usd_batch_equiv'] for c in cs) / len(cs), 5), 'n': len(cs),
            'thinking_tokens_per_page': round(sum(c.get('thinkingTokens') or 0 for c in cs) / len(cs)), 'spent_realtime_usd': round(sum(c['cost_usd_realtime'] for c in cs), 4)}
S['arms'] = {}
for arm, a in res['arms'].items():
    ps = [p for p in per.values() if fid(p, arm) is not None]
    S['arms'][arm] = {'pages': a['pages'], 'fidelity': {'mean': a['fidelity']['mean'], 'ci': a['fidelity']['ci']},
                      'share_ge4': wilson(sum(1 for p in ps if fid(p, arm) >= 4), len(ps)),
                      'omission': a['omission'], 'reversals_per_100_pages': {'rate': round(a['reversal']['rate'] * 100, 1), 'ci': [round(x * 100, 1) for x in a['reversal']['ci']]},
                      'unreadable_fill': a['invention_by_kind']['unreadable_fill'], 'boundary': a['invention_by_kind']['boundary'],
                      'added_fact': a['invention_by_kind']['added_fact'], 'cost': cost_of(arm),
                      'by_lang': {L: (lambda q: boot([fid(p, arm) for p in q]))([p for p in ps if p['lang'] == L]) for L in ('Pali', 'Sanskrit', 'Chinese')},
                      'by_canonical': {k: boot([fid(p, arm) for p in ps if recs[p['id']]['reference_meta']['canonical'] == (k == 'canonical')]) for k in ('canonical', 'non-canonical')}}

# 4. levers against the A-vs-A floor (paired, same pages)
def pair(a, b, ids=None):
    ps = [p for p in per.values() if fid(p, a) is not None and fid(p, b) is not None and (ids is None or p['id'] in ids)]
    out = {'n': len(ps), 'fidelity_delta': boot([fid(p, a) - fid(p, b) for p in ps])}
    for name, f in (('reversal', rev), ('omission', om), ('unreadable_fill', fill), ('boundary', bnd)):
        out[name + '_delta_pp'] = (lambda x: x and {'mean': round(x['mean'] * 100, 1), 'ci': [round(v * 100, 1) for v in x['ci']]})(boot([page_metric(p, a, f) - page_metric(p, b, f) for p in ps]))
    k = f'{a}:{b}'; k2 = f'{b}:{a}'
    if k in res['pairs']: out['rank'] = res['pairs'][k]['pages']; out['sign_p'] = res['pairs'][k]['sign_test_p']
    elif k2 in res['pairs']:
        w = res['pairs'][k2]['pages']; out['rank'] = {'a_wins': w['b_wins'], 'ties': w['ties'], 'b_wins': w['a_wins']}; out['sign_p'] = res['pairs'][k2]['sign_test_p']
    return out
floor = pair('lite2', 'lite')
S['noise_floor_X1'] = floor
S['levers'] = {name: pair(a, b) for name, (a, b) in {
    'flash_vs_lite': ('flash', 'lite'), 'flash_vs_lite2': ('flash', 'lite2'), 'thinking_X2 (flash-think vs flash)': ('flash-think', 'flash'),
    'continuity_context (lite-ctx vs lite)': ('lite-ctx', 'lite'), 'check_and_fix (lite-check vs lite)': ('lite-check', 'lite'),
    'flash_vs_lite-check': ('flash', 'lite-check'), 'flash_vs_served': ('flash', 'served'), 'lite_vs_served': ('lite', 'served'),
    'opus_X3_vs_flash': ('opus', 'flash'), 'opus_X3_vs_served': ('opus', 'served'), 'opus_X3_vs_lite': ('opus', 'lite'), 'opus_X3_vs_flash-think': ('opus', 'flash-think')}.items()}
fd = abs(floor['fidelity_delta']['mean']); fci = max(abs(x) for x in floor['fidelity_delta']['ci'])
for k, v in S['levers'].items():
    d = v['fidelity_delta']
    v['beyond_floor'] = bool(d and (d['ci'][0] > 0 or d['ci'][1] < 0) and abs(d['mean']) > fci)
S['levers_by_lang'] = {L: {k: pair(a, b, {i for i, r in recs.items() if r['lang'] == L}) for k, (a, b) in {'flash_vs_lite': ('flash', 'lite'), 'lite2_vs_lite (floor)': ('lite2', 'lite'), 'flash-think_vs_flash': ('flash-think', 'flash'), 'lite-check_vs_lite': ('lite-check', 'lite')}.items()} for L in ('Pali', 'Sanskrit', 'Chinese')}
opus_ids = {p['id'] for p in per.values() if fid(p, 'opus') is not None}
S['X3_same_20_pages'] = {a: boot([fid(per[i], a) for i in opus_ids if fid(per[i], a) is not None]) for a in ('served', 'lite', 'flash', 'flash-think', 'opus')}

# 4b. X2 thinking — its own packet (flash vs flash with the model's dynamic thinking), same judges, same pages
th = json.load(open(f'{R}/results-thinking.json')); tper = {p['id']: p for p in th['per_page']}
tc = [json.load(open(f)) for f in glob.glob(f'{R}/arms/flash-thinkon/*.json')]
def tpair(ids=None):
    ps = [p for i, p in tper.items() if (ids is None or i in ids)]
    return {'n': len(ps), 'fidelity_delta': boot([fid(p, 'flash-thinkon') - fid(p, 'flash') for p in ps]),
            'reversal_delta_pp': (lambda x: {'mean': round(x['mean'] * 100, 1), 'ci': [round(v * 100, 1) for v in x['ci']]})(boot([page_metric(p, 'flash-thinkon', rev) - page_metric(p, 'flash', rev) for p in ps]))}
S['X2_thinking'] = {'gate_pass': th['gate'].get('pass'), 'agreement': th['agreement'],
    'budget_arm_note': 'arm flash-think sent thinkingBudget 2048: thinking was billed on 1 of 68 pages (2 tokens). It is a second no-thinking flash run = flash A-vs-A floor, see levers.',
    'flash_A_vs_A_floor': pair('flash-think', 'flash'),
    'arms': {a: {'fidelity': v['fidelity']['mean'], 'ci': v['fidelity']['ci'], 'reversals_per_100_pages': round(v['reversal']['rate'] * 100, 1), 'reversal_ci': [round(x * 100, 1) for x in v['reversal']['ci']], 'omission': v['omission']['rate'], 'unreadable_fill': v['invention_by_kind']['unreadable_fill']['rate']} for a, v in th['arms'].items()},
    'paired': tpair(), 'by_lang': {L: tpair({i for i, r in recs.items() if r['lang'] == L}) for L in ('Pali', 'Sanskrit', 'Chinese')},
    'rank': th['pairs']['flash:flash-thinkon']['pages'], 'sign_p': th['pairs']['flash:flash-thinkon']['sign_test_p'],
    'thinkingConfig': 'absent (model default, dynamic)', 'thinking_tokens_per_page': round(sum(c['thinkingTokens'] for c in tc) / len(tc)), 'pages_that_thought': sum(1 for c in tc if c['thinkingTokens']),
    'usd_per_page_batch': round(sum(c['cost_usd_batch_equiv'] for c in tc) / len(tc), 5)}

# 5. corrected OCR (judged against the corrected transcription)
cper = {p['id']: p for p in corr['per_page']}
imgp = {d['id']: d for d in map(json.loads, open(f'{R}/image-pass.jsonl'))}
def cpair(a, b, ids):
    ps = [p for i, p in cper.items() if i in ids and fid(p, a) is not None and fid(p, b) is not None]
    return {'n': len(ps), 'a_mean': boot([fid(p, a) for p in ps]), 'b_mean': boot([fid(p, b) for p in ps]), 'delta': boot([fid(p, a) - fid(p, b) for p in ps]),
            'reversal_delta_pp': (lambda x: {'mean': round(x['mean'] * 100, 1), 'ci': [round(v * 100, 1) for v in x['ci']]})(boot([page_metric(p, a, rev) - page_metric(p, b, rev) for p in ps]))}
allc = set(cper); ocrp = {i for i in allc if imgp[i]['primary_cause'] == 'ocr_misread'}; lowc = {i for i in allc if imgp[i]['why'] == 'low'}
S['corrected_ocr'] = {'gate': corr['gate'].get('gate_pass', corr['gate']), 'agreement': corr['agreement'], 'n_pages': len(allc),
    'all': {'lite-corr_vs_lite': cpair('lite-corr', 'lite', allc), 'flash-corr_vs_flash': cpair('flash-corr', 'flash', allc), 'lite-corr_vs_served': cpair('lite-corr', 'served', allc), 'flash-corr_vs_lite-corr': cpair('flash-corr', 'lite-corr', allc)},
    'pages_with_primary_cause_ocr': {'lite-corr_vs_lite': cpair('lite-corr', 'lite', ocrp), 'flash-corr_vs_flash': cpair('flash-corr', 'flash', ocrp)},
    'pages_with_other_primary_cause': {'lite-corr_vs_lite': cpair('lite-corr', 'lite', allc - ocrp), 'flash-corr_vs_flash': cpair('flash-corr', 'flash', allc - ocrp)},
    'low_pages_only': {'lite-corr_vs_lite': cpair('lite-corr', 'lite', lowc), 'served': boot([fid(cper[i], 'served') for i in lowc if fid(cper[i], 'served') is not None])},
    'arms': {a: {'fidelity': v['fidelity']['mean'], 'ci': v['fidelity']['ci'], 'reversal': v['reversal']['rate'], 'omission': v['omission']['rate']} for a, v in corr['arms'].items()}}

# 6. by-eye cause pass
low = [d for d in imgp.values() if d['why'] == 'low']; rnd = [d for d in imgp.values() if d['why'] == 'random']
causes = ['translation', 'ocr_misread', 'page_seam', 'reading_order', 'language_label', 'reference_or_judge', 'none', 'cant_tell']
S['image_pass'] = {'low_pages': {c: wilson(sum(1 for d in low if d['primary_cause'] == c), len(low)) for c in causes},
                   'random_pages': {c: wilson(sum(1 for d in rnd if d['primary_cause'] == c), len(rnd)) for c in causes},
                   'defect_level_low_pages': (lambda cc: {c: wilson(cc[c], sum(cc.values())) for c in cc})(Counter(x['cause'] for d in low for x in d['defects'])),
                   'pages_with_any_verified_ocr_error': wilson(sum(1 for d in imgp.values() if (d.get('ocr_errors_found') or 0) > 0), len(imgp)),
                   'secondary_language_label_or_reading_order': sum(1 for d in imgp.values() if set(d.get('secondary_causes') or []) & {'language_label', 'reading_order'}),
                   'legibility': Counter(d['legibility'] for d in imgp.values())}

# 7. six dimensions (separate pass, one judge; fidelity copied from the harness)
key = json.load(open(f'{R}/dimensions/key.json'))
dims = [json.loads(l) for f in sorted(glob.glob(f'{R}/dimensions/verdicts/*.jsonl')) for l in open(f) if l.strip()]
D = ['readability', 'register', 'terminology', 'ambiguity', 'transparency']
prof = defaultdict(lambda: defaultdict(list)); stance = defaultdict(Counter); who = Counter(); who_lang = defaultdict(Counter); diff = []
dim_rows = {}
for v in dims:
    k = key[v['id']]; L = recs[v['id']]['lang']; row = {}
    for lab in ('X', 'Y'):
        side = k[lab]
        for d in D: prof[(L, side)][d].append(v[lab][d]); prof[('all', side)][d].append(v[lab][d])
        stance[(L, side)][v[lab]['stance']] += 1; stance[('all', side)][v[lab]['stance']] += 1
        row[side] = v[lab]
    w = (v.get('disagreement') or {}).get('who'); w = k.get(w, w)  # X/Y -> served/reference
    who[w] += 1; who_lang[L][w] += 1
    row['who_right'] = w; row['point'] = (v.get('disagreement') or {}).get('point'); row['different_choice'] = v.get('different_choice'); row['choice_note'] = v.get('choice_note')
    for side in ('served', 'reference'):  # de-blind X/Y in the notes
        pass
    row['labels'] = k; dim_rows[v['id']] = row
    if v.get('different_choice'): diff.append(v['id'])
S['dimensions'] = {'profile': {f'{L} / {side}': {**({'fidelity': boot([fid(p, 'served') for p in per.values() if (L == 'all' or p['lang'] == L) and fid(p, 'served') is not None])['mean']} if side == 'served' else {'fidelity': None}),
                                                   **{d: round(sum(x) / len(x), 2) for d, x in ds.items()}, 'n': len(ds['readability']), 'stance': dict(stance[(L, side)])}
                               for (L, side), ds in sorted(prof.items())},
                   'meaning_disagreements_who_is_right': dict(who), 'by_lang': {L: dict(c) for L, c in who_lang.items()}, 'different_legitimate_choice_pages': len(diff)}

# 8. cost at corpus scale
tp = {L: census[L]['translated_pages'] for L in ('Sanskrit', 'Pali', 'Chinese')}
S['scale'] = {'translated_pages': tp, 'cost_to_retranslate_all_translated_pages_usd': {arm: {L: round(tp[L] * S['arms'][arm]['cost']['usd_per_page_batch'], 0) for L in tp} for arm in ('lite', 'flash', 'lite-check') if S['arms'][arm]['cost']},
              'flash_with_thinking_usd': {L: round(tp[L] * S['X2_thinking']['usd_per_page_batch'], 0) for L in tp},
              'note': 'lite-check cost is the CHECK pass only (add lite). Batch rate = realtime x 0.5. Opus ran on the subscription: no API price measured.'}

json.dump(S, open(f'{R}/summary.json', 'w'), indent=1, ensure_ascii=False, default=dict)

# 9. one row per page x arm, dataset-ready (#5531)
with open(f'{R}/pages.jsonl', 'w') as fo:
    for i, r in recs.items():
        p = per[i]; m = r['reference_meta']
        base = {'run_id': 'xlref-t5-2026-10', 'track': 'T5', 'id': i, 'book_id': r['book_id'], 'page_number': r['page_number'], 'page_url': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}",
                'lang': r['lang'], 'edition': r['edition'], 'licences': r['licences'], 'publishable': m['publishable'],
                'reference': {k: m.get(k) for k in ('title', 'translator', 'year', 'licence', 'style', 'style_note', 'canonical', 'genre', 'located', 'url', 'coverage_note')},
                'reference_fit': p['reference_fit'], 'source_sha16': None}
        for c in r['candidates']:
            a = p['arms'].get(c['arm'])
            if not a: continue
            row = {**base, 'arm': c['arm'], 'model': c.get('model'), 'prompt_version': c.get('prompt_version') or 13, 'generation_config': c.get('generation_config'),
                   'fidelity': a['fidelity'], 'by_judge': a['by_judge'], 'measure': 'judged against a human reference (two blind Opus judges)'}
            if c['arm'] == 'served':
                row['dimensions'] = dim_rows.get(i); row['image_pass'] = {k: imgp[i].get(k) for k in ('primary_cause', 'secondary_causes', 'ocr_errors_found', 'legibility', 'diagnosis')} if i in imgp else None
            if i in cper and c['arm'] in cper[i]['arms']: row['fidelity_against_corrected_transcription'] = cper[i]['arms'][c['arm']]['fidelity']
            fo.write(json.dumps(row, ensure_ascii=False) + '\n')
        if i in cper:
            for arm in ('lite-corr', 'flash-corr'):
                a = cper[i]['arms'].get(arm)
                if a: fo.write(json.dumps({**base, 'arm': arm, 'model': 'gemini-3.1-flash-lite' if arm == 'lite-corr' else 'gemini-3-flash-preview', 'prompt_version': 13, 'source': 'by-eye corrected transcription (image-pass.jsonl)', 'fidelity': a['fidelity'], 'by_judge': a['by_judge'], 'judged_against': 'corrected transcription'}, ensure_ascii=False) + '\n')

# ---- print ----
def f(b): return '—' if not b else f"{b['mean']:.2f} [{b['ci'][0]:.2f}, {b['ci'][1]:.2f}] (n={b['n']})"
print('SERVED');
for grp in ('by_lang', 'by_canonical', 'by_reference_style', 'by_edition_period', 'by_served_model', 'by_lang_canonical'):
    for k, v in S['served'][grp].items(): print(f"  {grp:18s} {k:28s}", f(v.get('fidelity')) if 'fidelity' in v else v, '| ≥4', v.get('share_ge4', {}).get('rate') if 'fidelity' in v else '', '| om', (v.get('omission') or {}).get('mean'), 'rev', (v.get('reversal') or {}).get('mean'), 'fill', (v.get('unreadable_fill') or {}).get('mean'), 'bnd', (v.get('boundary') or {}).get('mean'))
print('  all', f(S['served']['all']['fidelity']), S['served']['all']['share_ge4'], S['served']['all']['share_le3'])
print('ARMS')
for a, v in S['arms'].items(): print(f"  {a:12s} n={v['pages']} fid {v['fidelity']['mean']} {v['fidelity']['ci']} ≥4 {v['share_ge4']['rate']} om {v['omission']['rate']} rev/100 {v['reversals_per_100_pages']} fill {v['unreadable_fill']['rate']} bnd {v['boundary']['rate']} note {v['added_fact']['rate']} cost {v['cost']} | " + ' '.join(f"{L[:2]} {b['mean'] if b else None}" for L, b in v['by_lang'].items()) + ' | ' + ' '.join(f"{k[:5]} {b['mean'] if b else None}" for k, b in v['by_canonical'].items()))
print('FLOOR', json.dumps(S['noise_floor_X1']))
for k, v in S['levers'].items(): print('  ', k, 'n', v['n'], 'Δ', f(v['fidelity_delta']), 'rev pp', v['reversal_delta_pp'], 'om pp', v['omission_delta_pp'], 'fill', v['unreadable_fill_delta_pp'], 'bnd', v['boundary_delta_pp'], 'rank', v.get('rank'), 'p', v.get('sign_p'), 'BEYOND' if v['beyond_floor'] else '')
for L, d in S['levers_by_lang'].items():
    for k, v in d.items(): print('  ', L, k, f(v['fidelity_delta']), 'rev', v['reversal_delta_pp'])
print('X3 same 20', {k: v and v['mean'] for k, v in S['X3_same_20_pages'].items()})
print('X2', json.dumps(S['X2_thinking'], default=dict)[:1800])
print('CORR', json.dumps(S['corrected_ocr'], default=dict)[:2500])
print('IMG', json.dumps(S['image_pass'], default=dict))
print('DIM'); [print('  ', k, v) for k, v in S['dimensions']['profile'].items()]; print(S['dimensions']['meaning_disagreements_who_is_right'], S['dimensions']['by_lang'], S['dimensions']['different_legitimate_choice_pages'])
print('SCALE', S['scale'])
