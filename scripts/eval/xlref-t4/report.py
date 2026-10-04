#!/usr/bin/env python3
# PRIOR ART: scripts/eval/translation-vs-reference/score.mjs writes results.json (arms, strata by lang/style/canonical, pairs) and gallery.mjs a first-60-words gallery; neither writes the page x arm dataset with licences that #5695 addendum A asks for, strata by period/genre/served model, cause shares from the image check, or a gallery with aligned short quotes. This assembles those from the scorer's outputs; it scores nothing itself.
"""Assemble the #5695 T4 result files: pages.jsonl (page x arm, with licences), references.jsonl (open references only), summary.json and gallery.md."""
# python3 scripts/eval/xlref-t4/report.py <private work dir> <results dir>
import json, sys, os, random, math, shutil, collections, glob
W, R = sys.argv[1], sys.argv[2]
J = lambda p: json.load(open(p))
JL = lambda p: [json.loads(l) for l in open(p) if l.strip()]
pid = lambda r: f"{r['book_id']}_{r['page_number']:05d}"
recs = {pid(r): r for r in JL(f'{W}/work2/records-arms.jsonl')}
recs2 = {pid(r): r for r in JL(f'{W}/work2/records-p2.jsonl')}
res1, res2 = J(f'{R}/results.json'), J(f'{R}/results-packet2.json')
dims = {r['id']: r for r in J(f'{R}/dimensions.json')['per_page']}
img = {r['id']: r for r in J(f'{W}/imgcheck/all.json')}
sel = J(f'{W}/imgcheck/selection.json')
leak = {x['id']: x for x in J(f'{W}/work2/leak.json')}
REF_LEAK = {'6953af0577f38f6761bd92a5_210', '69afd049ae982b9d51d6dd32_292'}       # the reference English itself is on the page / facing pages
AID = {'69e7934280b52390feb18445_49', '69e9612a390d3ed634590dd2_365'}            # a facing Latin / French translation is in context
rng = random.Random(5695)
def boot(xs, it=10000):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2: return None
    ms = sorted(sum(rng.choice(xs) for _ in xs) / len(xs) for _ in range(it))
    return [round(ms[int(it * .025)], 3), round(ms[int(it * .975)], 3)]
def mean(xs):
    xs = [x for x in xs if x is not None]; return round(sum(xs) / len(xs), 3) if xs else None
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0, c - h), 3), round(min(1, c + h), 3)]
def period(r):
    y = r.get('period') or ''
    import re
    m = re.search(r'(\d+)(?:st|nd|rd|th)', y)
    if not m: return 'unknown'
    c = int(m.group(1)); bce = 'BCE' in y or 'BC' in y
    return 'before 1000' if bce or c <= 10 else '1000–1299' if c <= 13 else '1300–1599' if c <= 16 else '1600+'
GEN = {'kabbalah': 'kabbalah & mysticism', 'mysticism': 'kabbalah & mysticism', 'sufism': 'kabbalah & mysticism', 'magic': 'kabbalah & mysticism', 'poetry': 'poetry & adab', 'adab': 'poetry & adab', 'scripture': 'scripture, liturgy, law', 'liturgy': 'scripture, liturgy, law', 'halakha': 'scripture, liturgy, law', 'midrash': 'scripture, liturgy, law'}
def genre(r):
    g = (r.get('genre') or '').lower().split('|')[0].split('/')[0].split(',')[0].strip()
    return GEN.get(g, 'philosophy, science, history')
def armstat(per_page, arm, ids=None):
    rows = [p for p in per_page if arm in p['arms'] and (ids is None or p['id'] in ids)]
    f = [p['arms'][arm]['fidelity'] for p in rows if p['arms'][arm]['fidelity'] is not None]
    def rate(fn):
        v = [sum(1 for j in js if fn(j)) / len(js) for js in ([j for j in p['arms'][arm]['by_judge'].values() if j] for p in rows) if js]  # a judge may have no verdict on an arm (one opus cell)
        return {'rate': mean(v), 'ci': boot(v)}
    return {'pages': len(rows), 'fidelity': mean(f), 'ci': boot(f), 'share_ge4': mean([1 if x >= 4 else 0 for x in f]), 'share_le2': mean([1 if x <= 2 else 0 for x in f]),
            'omission': rate(lambda j: j['omission']), 'reversal': rate(lambda j: bool(j['reversal'])),
            'unreadable_fill': rate(lambda j: any(i['kind'] == 'unreadable_fill' for i in j['invention'])), 'boundary': rate(lambda j: any(i['kind'] == 'boundary' for i in j['invention']))}
pp1, pp2 = res1['per_page'], res2['per_page']

# ── page x arm rows ─────────────────────────────────────────────────────────────────────────────────────────
armmeta = {}
for f in glob.glob(f'{W}/work2/arms/*/*.json'):
    if f.endswith('.failed.json'): continue
    j = J(f); armmeta[(os.path.basename(os.path.dirname(f)), j['id'])] = j
rows = []
def emit(p, packet, rec):
    r = recs[p['id']]; m = r['reference_meta']; short = f"{r['book_id']}_{r['page_number']}"
    for arm, a in p['arms'].items():
        if arm.startswith('control:') or '#' in arm: continue
        if not any(c['arm'] == arm for c in rec['candidates']): continue  # score.mjs lists every arm on every page; opus exists on 20
        cand = next((c for c in rec['candidates'] if c['arm'] == arm), {})
        am = armmeta.get((arm, short), {})
        rows.append({'track': 'T4', 'id': p['id'], 'book_id': r['book_id'], 'page_number': r['page_number'], 'url': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}",
            'lang': r['lang'], 'book_title': r['book_title'], 'book_language_label': r.get('book_language_label'), 'period': r.get('period'), 'period_bucket': period(r), 'genre': r.get('genre'), 'genre_bucket': genre(r),
            'arm': arm, 'packet': packet, 'judged_against_source': rec.get('source_kind', 'ocr'),
            'model': cand.get('model') or am.get('model'), 'prompt_version': cand.get('prompt_version') or (am.get('prompt_ref') or {}).get('version'), 'generationConfig': am.get('generationConfig'),
            'input_tokens': am.get('inputTokens'), 'output_tokens': am.get('outputTokens'), 'thinking_tokens': am.get('thinkingTokens'), 'cost_usd': am.get('cost_usd'), 'context': am.get('context'),
            'fidelity': a['fidelity'], 'by_judge': a['by_judge'], 'reference_fit': p.get('reference_fit'), 'control_page': p.get('control'),
            'reference': {k: m.get(k) for k in ('title', 'translator', 'year', 'licence', 'licence_detail', 'private', 'style', 'canonical', 'located', 'url', 'coverage_note', 'source_edition')},
            'famous': r.get('famous'), 'licences': r['licences'], 'publishable': {'scan': r['licences'].get('scan_class'), 'our_text': True, 'reference_text': r['licences']['reference_publishable'], 'reference_non_commercial': 'NC' in (m.get('licence') or '')},
            'reference_in_translator_context': short in REF_LEAK, 'other_translation_in_context': short in AID,
            'image_check': ({k: img[p['id']].get(k) for k in ('primary_cause', 'secondary_causes', 'ocr_word_errors_per_100', 'fixed', 'summary')} if p['id'] in img else None),
            'text': cand.get('text')})
for p in pp1: emit(p, 1, recs[p['id']])
for p in pp2: emit(p, 2, recs2[p['id']])
open(f'{R}/pages.jsonl', 'w').write('\n'.join(json.dumps(x, ensure_ascii=False) for x in rows) + '\n')
refs = []
for i, r in recs.items():
    m = r['reference_meta']; pub = r['licences']['reference_publishable']
    refs.append({'id': i, 'book_id': r['book_id'], 'page_number': r['page_number'], 'lang': r['lang'], 'reference_meta': m, 'licences': r['licences'], 'align': r.get('align'), 'ocr_notes': r.get('ocr_notes'),
                 'source_text_ocr': r['source_text'], 'reference_text': r['reference_text'] if pub else None, 'reference_text_withheld': None if pub else 'in copyright (#5488): scores and ≤ 15-word quotes only'})
open(f'{R}/references.jsonl', 'w').write('\n'.join(json.dumps(x, ensure_ascii=False) for x in refs) + '\n')
os.makedirs(f'{R}/corrected-transcriptions', exist_ok=True)
for f in glob.glob(f'{W}/imgcheck/fixed/*.txt'): shutil.copy(f, f'{R}/corrected-transcriptions/')
json.dump(list(img.values()), open(f'{R}/image-check.json', 'w'), ensure_ascii=False, indent=1)
json.dump(list(leak.values()), open(f'{R}/context-leak-check.json', 'w'), ensure_ascii=False, indent=1)
shutil.copy(f'{W}/work2/failed-books.json', f'{R}/books-not-aligned.json')

# ── summary ─────────────────────────────────────────────────────────────────────────────────────────────────
S = {'n_pages': len(recs), 'by_lang': dict(collections.Counter(r['lang'] for r in recs.values())), 'references': {
    'open': sum(1 for r in recs.values() if not r['reference_meta']['private']), 'private': sum(1 for r in recs.values() if r['reference_meta']['private']),
    'by_licence': dict(collections.Counter(r['reference_meta']['licence'] for r in recs.values())), 'by_style': dict(collections.Counter(r['reference_meta']['style'] for r in recs.values())),
    'canonical': sum(1 for r in recs.values() if r['reference_meta'].get('canonical')), 'famous': sum(1 for r in recs.values() if r.get('famous')),
    'first_candidate_taken': sum(1 for r in recs.values() if (r['align'].get('candidate_index') or 0) == 0), 'translators': dict(collections.Counter(r['reference_meta']['translator'].split(' (')[0][:40] for r in recs.values()))}}
ids = lambda fn: {i for i, r in recs.items() if fn(i, r)}
short = lambda i: f"{recs[i]['book_id']}_{recs[i]['page_number']}"
strata = {'all': set(recs), 'Hebrew': ids(lambda i, r: r['lang'] == 'Hebrew'), 'Aramaic': ids(lambda i, r: r['lang'] == 'Aramaic'), 'Hebrew+Aramaic': ids(lambda i, r: r['lang'] in ('Hebrew', 'Aramaic')),
    'Arabic': ids(lambda i, r: r['lang'] == 'Arabic'), 'Persian': ids(lambda i, r: r['lang'] == 'Persian'),
    'canonical': ids(lambda i, r: r['reference_meta'].get('canonical')), 'famous classic': ids(lambda i, r: r.get('famous')), 'neither canonical nor famous': ids(lambda i, r: not r['reference_meta'].get('canonical') and not r.get('famous')),
    'excluding reference-in-context pages': ids(lambda i, r: short(i) not in REF_LEAK), 'excluding any translation-in-context pages': ids(lambda i, r: short(i) not in REF_LEAK | AID),
    'served by flash': ids(lambda i, r: r['candidates'][0]['model'] == 'gemini-3-flash-preview'), 'served by lite': ids(lambda i, r: 'lite' in r['candidates'][0]['model'])}
for k in ('literal', 'free', 'early-modern'): strata[f'reference style: {k}'] = ids(lambda i, r: r['reference_meta']['style'] == k)
for r in recs.values(): pass
for b in sorted({period(r) for r in recs.values()}): strata[f'period: {b}'] = ids(lambda i, r: period(r) == b)
for g in sorted({genre(r) for r in recs.values()}): strata[f'genre: {g}'] = ids(lambda i, r: genre(r) == g)
S['served_by_stratum'] = {k: {**armstat(pp1, 'served', v), 'reportable': len(v) >= 10} for k, v in strata.items()}
S['arms_packet1'] = {a: armstat(pp1, a) for a in ['served', 'prod-A', 'prod-B', 'flash-0', 'flash-think8k', 'lite-noctx']}
opus_ids = {p['id'] for p in pp1 if p['arms'].get('opus', {}).get('fidelity') is not None}
S['ceiling_20_pages'] = {a: armstat(pp1, a, opus_ids) for a in ['served', 'prod-A', 'flash-0', 'flash-think8k', 'opus']}
S['arms_by_lang'] = {l: {a: armstat(pp1, a, strata[l]) for a in ['served', 'prod-A', 'prod-B', 'flash-0']} for l in ['Hebrew+Aramaic', 'Arabic', 'Persian']}
def paired(per_page, a, b, ids=None):
    d = [p['arms'][a]['fidelity'] - p['arms'][b]['fidelity'] for p in per_page if a in p['arms'] and b in p['arms'] and (ids is None or p['id'] in ids) and None not in (p['arms'][a]['fidelity'], p['arms'][b]['fidelity'])]
    return {'n': len(d), 'delta': mean(d), 'ci': boot(d), 'pages_changed_by_1_or_more': sum(1 for x in d if abs(x) >= 1)}
S['noise_floor_A_vs_A'] = {'fidelity': paired(pp1, 'prod-A', 'prod-B'), 'prod_A': S['arms_packet1']['prod-A'], 'prod_B': S['arms_packet1']['prod-B'],
    'abs_page_delta_mean': mean([abs(p['arms']['prod-A']['fidelity'] - p['arms']['prod-B']['fidelity']) for p in pp1]),
    'judge_retest_prodA_packet1_vs_packet2_uncorrected_pages': paired([{'id': p['id'], 'arms': {'p1': p['arms']['prod-A'], 'p2': q['arms']['prod-A']}} for p in pp1 for q in pp2 if p['id'] == q['id'] and recs2[p['id']]['source_kind'] == 'ocr'], 'p1', 'p2')}
S['levers'] = {'flash_vs_lite': paired(pp1, 'flash-0', 'prod-A'), 'flash_vs_lite_B': paired(pp1, 'flash-0', 'prod-B'), 'thinking_8k_vs_flash0': paired(pp1, 'flash-think8k', 'flash-0'), 'no_context_vs_prodA': paired(pp1, 'lite-noctx', 'prod-A'), 'no_context_vs_prodB': paired(pp1, 'lite-noctx', 'prod-B'),
    'opus_vs_prodA': paired(pp1, 'opus', 'prod-A'), 'opus_vs_flash0': paired(pp1, 'opus', 'flash-0'), 'checkfix_vs_prodA': paired(pp2, 'lite-checkfix', 'prod-A')}
fixed = {i for i, r in recs2.items() if r['source_kind'] == 'corrected-by-eye'}; low = set(sel['low']); rnd = set(sel['random'])
S['corrected_transcription'] = {'pages': len(fixed), 'arms_judged_against_corrected_text': {a: armstat(pp2, a, fixed) for a in ['prod-A', 'flash-0', 'lite-fixocr', 'flash-fixocr', 'lite-checkfix']},
    'lite_fixocr_vs_prodA': paired(pp2, 'lite-fixocr', 'prod-A', fixed), 'flash_fixocr_vs_flash0': paired(pp2, 'flash-fixocr', 'flash-0', fixed), 'flash0_vs_prodA_on_uncorrected_ocr': paired(pp2, 'flash-0', 'prod-A', fixed), 'flash_fixocr_vs_lite_fixocr': paired(pp2, 'flash-fixocr', 'lite-fixocr', fixed),
    'low_pages_only': {'n': len(fixed & low), 'lite_fixocr_vs_prodA': paired(pp2, 'lite-fixocr', 'prod-A', fixed & low), 'flash_fixocr_vs_flash0': paired(pp2, 'flash-fixocr', 'flash-0', fixed & low)},
    'by_primary_cause': {c: {'n': len({i for i in fixed if img[i]['primary_cause'] == c}), 'lite_fixocr_vs_prodA': paired(pp2, 'lite-fixocr', 'prod-A', {i for i in fixed if img[i]['primary_cause'] == c})} for c in ['ocr_misread', 'translation']},
    'judge_blind_spot': {'note': 'the same prod-A and flash-0 outputs, judged against the OCR (packet 1) and against the corrected transcription (packet 2), on the corrected pages',
        'prodA_vs_ocr': mean([p['arms']['prod-A']['fidelity'] for p in pp1 if p['id'] in fixed]), 'prodA_vs_corrected': mean([p['arms']['prod-A']['fidelity'] for p in pp2 if p['id'] in fixed]),
        'flash0_vs_ocr': mean([p['arms']['flash-0']['fidelity'] for p in pp1 if p['id'] in fixed]), 'flash0_vs_corrected': mean([p['arms']['flash-0']['fidelity'] for p in pp2 if p['id'] in fixed])}}
def causes(group):
    c = collections.Counter(img[i]['primary_cause'] for i in group); n = len(group)
    return {'n': n, 'shares': {k: {'pages': v, 'share': round(v / n, 3), 'wilson95': wilson(v, n)} for k, v in c.most_common()}, 'ocr_word_errors_per_100_median': sorted(img[i]['ocr_word_errors_per_100'] for i in group)[n // 2], 'ocr_word_errors_per_100_mean': mean([img[i]['ocr_word_errors_per_100'] for i in group])}
pd = collections.Counter(d['cause'] for i in low for d in img[i].get('per_defect', []))
S['image_check'] = {'low_scoring_served_le3': causes(low), 'random_others': causes(rnd), 'per_defect_low_pages': dict(pd), 'per_defect_low_pages_ocr_share': {'k': pd['ocr_misread'], 'n': sum(pd.values()), 'share': round(pd['ocr_misread'] / sum(pd.values()), 3), 'wilson95': wilson(pd['ocr_misread'], sum(pd.values()))},
    'by_lang_low': {l: dict(collections.Counter(img[i]['primary_cause'] for i in low if recs[i]['lang'] == l)) for l in ['Hebrew', 'Aramaic', 'Arabic', 'Persian']}}
D = J(f'{R}/dimensions.json'); S['dimensions'] = {'profiles': D['profiles'], 'disagreements': D['disagreements'], 'legit_choice_pages': len(D['legit_choice_pages'])}
cost = {a: round(sum(v := [armmeta[(a, k)]['cost_usd'] for (x, k) in armmeta if x == a]) / len(v), 5) for a in ['prod-A', 'flash-0', 'flash-think8k', 'lite-noctx', 'lite-checkfix', 'lite-fixocr', 'flash-fixocr']}
think = mean([armmeta[(a, k)]['thinkingTokens'] for (a, k) in armmeta if a == 'flash-think8k'])
CORPUS = {'Hebrew': 55154, 'Aramaic': 365, 'Arabic': 56626, 'Persian': 13755}; tot = sum(CORPUS.values())
S['cost'] = {'per_page_realtime_usd': cost, 'thinking_tokens_mean_8k_arm': think, 'translated_pages_census_2026_10_03': CORPUS, 'translated_pages_total': tot,
    'at_corpus_scale_realtime_usd': {a: round(c * tot, 0) for a, c in cost.items()}, 'at_corpus_scale_batch_usd': {a: round(c * tot / 2, 0) for a, c in cost.items()}}
S['agreement'] = {'packet1': res1['agreement'], 'packet2': res2['agreement'], 'gate_packet1': res1['gate'], 'gate_packet2': res2['gate'], 'reference_fit_packet1': res1['reference_fit']}
S['served_states'] = {'span_different_or_T4': [p['id'] for p in pp1 if any(j['span'] == 'different' for j in p['arms']['served']['by_judge'].values())]}
json.dump(S, open(f'{R}/summary.json', 'w'), ensure_ascii=False, indent=1)

# ── gallery ─────────────────────────────────────────────────────────────────────────────────────────────────
def clip(t, n=15):
    w = str(t or '').split(); return ' '.join(w[:n]) + (' …' if len(w) > n else '')
order = sorted(pp1, key=lambda p: (-p['arms']['served']['fidelity'], p['id']))  # served is never null in this run
openp = [p for p in order if recs[p['id']]['licences']['reference_publishable']]
mid = len(openp) // 2
pick = [('Best 5', openp[:5]), ('Median 5', openp[mid - 2:mid + 3]), ('Worst 5', openp[-5:])]
L = ['# Gallery — #5695 T4 (Hebrew/Aramaic, Arabic, Persian): served English against a published translation', '',
     'Fifteen pages whose reference is open (so every row can be published): the 5 best, 5 median and 5 worst by fidelity of the SERVED English (mean of two blind Opus judges, 1–5). Quotes are ≤ 15 words. "Cause" comes from opening the page image (addendum 3) where the page was checked.', '']
gal = []
for title, ps in pick:
    L += [f'## {title}', '']
    for p in ps:
        r = recs[p['id']]; m = r['reference_meta']; a = p['arms']['served']; ic = img.get(p['id'])
        defects = [d for j in a['by_judge'].values() if j for d in j['defects']]
        majors = [d for d in defects if d['severity'] == 'major'] or defects
        cls = sorted({d['class'] for d in majors}) or ['none found']
        revs = [j['reversal'] for j in a['by_judge'].values() if j and j['reversal']]
        L += [f"### {r['book_title']} — [p. {r['page_number']}]({'https://sourcelibrary.org/book/' + r['book_id'] + '?page=' + str(r['page_number'])}) · {r['lang']} · fidelity {a['fidelity']} · `publishable: true`", '',
              f"- **Reference:** {m['translator']}, {m.get('year') or 'n.d.'} ({m['style']}; {m['licence']}){' · canonical' if m.get('canonical') else ''}{' · famous classic' if r.get('famous') else ''} · served by `{r['candidates'][0]['model']}`",
              f"- **Defect class:** {', '.join(cls)}" + (f" · **Cause (image opened):** {ic['primary_cause'].replace('_', ' ')}" + (f" (+ {', '.join(x.replace('_', ' ') for x in ic['secondary_causes'])})" if ic.get('secondary_causes') else '') + f"; OCR ≈ {ic['ocr_word_errors_per_100']} wrong words per 100" if ic else ' · image not opened (fidelity > 3 and not in the random 10)'),
              f"- **Diagnosis:** {ic['summary'] if ic else ('Neither judge located a defect; image not opened, so the transcription is unverified.' if not defects else 'Translation-level slips only, as far as the judges could tell from the transcription (image not opened): ' + clip(defects[0]['detail'], 30))}"]
        for d in majors[:2]: L.append(f"- **Judge:** {clip(d['detail'], 40)}")
        for v in revs[:1]: L.append(f"- **Reversal:** ours “{clip(v['candidate'])}” ↔ source/reference “{clip(v['source_or_reference'])}”")
        for e in (ic.get('evidence') or [])[:2] if ic else []: L.append(f"- **Image vs OCR:** image reads “{clip(e.get('image_reads'), 12)}”; OCR has “{clip(e.get('ocr_has'), 12)}”; ours “{clip(e.get('served_english'))}” — {clip(e.get('effect'), 25)}")
        L.append('')
        gal.append({'id': p['id'], 'group': title, 'fidelity': a['fidelity'], 'publishable': True, 'defect_classes': cls, 'cause': ic['primary_cause'] if ic else None})
L += ['## Two pages for a principles discussion (different legitimate choices, not errors)', '']
lc = [x for x in D['legit_choice_pages'] if recs[x['id']]['licences']['reference_publishable'] and x['stance_ours'] != x['stance_reference'] and (pp := next(p for p in pp1 if p['id'] == x['id']))['arms']['served']['fidelity'] >= 4]
lc.sort(key=lambda x: (0 if recs[x['id']]['lang'] != 'Arabic' else 1, x['id']))
seen = set(); chosen = []
for x in lc:
    if recs[x['id']]['lang'] in seen: continue
    seen.add(recs[x['id']]['lang']); chosen.append(x)
    if len(chosen) == 2: break
for x in chosen:
    r = recs[x['id']]; d = dims[x['id']]
    L += [f"### {r['book_title']} — [p. {r['page_number']}](https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}) · {r['lang']} · `publishable: true`", '',
          f"- **Ours:** stance *{x['stance_ours']}* — readability {d['ours']['readability']}, register {d['ours']['register']}, terminology {d['ours']['terminology']}, ambiguity {d['ours']['ambiguity']}, transparency {d['ours']['transparency']}; fidelity {d['ours']['fidelity']}",
          f"- **Reference ({r['reference_meta']['translator']}, {r['reference_meta'].get('year')}):** stance *{x['stance_reference']}* — readability {d['reference']['readability']}, register {d['reference']['register']}, terminology {d['reference']['terminology']}, ambiguity {d['reference']['ambiguity']}, transparency {d['reference']['transparency']}",
          f"- **The choice:** {x['note']}"]
    for g in d['disagreements'][:2]: L.append(f"- “{clip(g.get('source'), 12)}” → ours “{clip(g.get('ours'), 12)}” / reference “{clip(g.get('reference'), 12)}” — {g.get('right')}: {clip(g.get('why'), 30)}")
    L.append('')
open(f'{R}/gallery.md', 'w').write('\n'.join(L))
json.dump({'gallery': gal, 'principles_pages': [x['id'] for x in chosen]}, open(f'{R}/gallery.json', 'w'), indent=1)
print(json.dumps({k: S[k] for k in ['n_pages', 'by_lang', 'noise_floor_A_vs_A', 'levers', 'cost']}, indent=1)[:6000])
print('rows', len(rows), 'gallery', len(gal), 'principles', [x['id'] for x in chosen])
