# PRIOR ART: scripts/eval/translation-vs-reference/gallery.mjs prints 5 best / median / worst with the FIRST 60 words of
# each text and the judge's reason for all arms. #5695 asks per item for the defect class, a one-sentence diagnosis by
# cause (OCR vs translation vs seam vs label, from the by-eye image pass), `publishable`, and two pages where ours and
# the reference make different legitimate choices (from the six-dimension pass). This joins those layers.
"""gallery.py <results dir> — writes gallery.md + gallery.json (15 served pages + 2 principles pages)."""
import json, sys, glob, re
from collections import Counter
R = sys.argv[1]
res = json.load(open(f'{R}/results.json')); recs = {f"{r['book_id']}_{r['page_number']:05d}": r for r in map(json.loads, open(f'{R}/work/records-arms.jsonl'))}
img = {d['id']: d for d in map(json.loads, open(f'{R}/image-pass.jsonl'))}
key = json.load(open(f'{R}/dimensions/key.json'))
dims = {v['id']: v for f in sorted(glob.glob(f'{R}/dimensions/verdicts/*.jsonl')) for v in map(json.loads, filter(str.strip, open(f)))}
pages = [p for p in res['per_page'] if (p['arms'].get('served') or {}).get('fidelity') is not None]
pages.sort(key=lambda p: (-p['arms']['served']['fidelity'], p['id']))
n = len(pages); mid = n // 2
def prefer_img(ps, k):  # same fidelity tier: pages the image pass opened come first (they carry a by-eye cause)
    return sorted(ps, key=lambda p: (p['id'] not in img, p['id']))[:k]
best = prefer_img([p for p in pages if p['arms']['served']['fidelity'] == pages[0]['arms']['served']['fidelity']], 5)
medf = pages[mid]['arms']['served']['fidelity']
median = prefer_img([p for p in pages if p['arms']['served']['fidelity'] == medf], 5)
worst = pages[-5:][::-1]
def words(t, k): w = str(t or '').split(); return ' '.join(w[:k]) + (' …' if len(w) > k else '')
def top_defect(p):
    c = Counter()
    for v in p['arms']['served']['by_judge'].values():
        for d in v.get('defects') or []: c[d['class']] += 2 if d.get('severity') == 'major' else 1
        if v.get('reversal'): c['T8'] += 2
        for i in v.get('invention') or []:
            if i['kind'] in ('boundary', 'unreadable_fill'): c['T5' if i['kind'] == 'boundary' else 'T7'] += 1
    return c.most_common(1)[0][0] if c else 'none found'
NAME = {'T9': 'T9 quiet omission', 'T8': 'T8 sense inverted', 'T5': 'T5 continuity leak (next/previous page)', 'T7': 'T7 fluent over garble', 'T10': 'T10 invented scholarship', 'T1': 'T1 truncated', 'T6': 'T6 seam'}
def item(p, tier):
    r = recs[p['id']]; m = r['reference_meta']; s = p['arms']['served']; ip = img.get(p['id'])
    details = []
    for j, v in s['by_judge'].items():
        if v.get('reversal'): details.append(f"reversal — ours: “{words(v['reversal']['candidate'], 15)}” vs source/reference: “{words(v['reversal']['source_or_reference'], 15)}”")
        for d in sorted(v.get('defects') or [], key=lambda d: d.get('severity') != 'major')[:2]: details.append(f"{d['class']} ({d.get('severity')}): {d['detail']}")
    seen = []; [seen.append(x) for x in details if x not in seen]
    d = top_defect(p)
    return {'tier': tier, 'id': p['id'], 'page_url': f"https://sourcelibrary.org/book/{r['book_id']}?page={r['page_number']}", 'work': r['edition']['title'], 'lang': r['lang'],
            'reference': f"{m['translator']}, {m.get('year')} ({m['style']})", 'reference_licence': m['licence'], 'scan_licence': r['licences']['scan'], 'publishable': m['publishable'],
            'canonical': m['canonical'], 'served_fidelity': s['fidelity'], 'by_judge': {j: v['fidelity'] for j, v in s['by_judge'].items()},
            'defect_class': NAME.get(d, d), 'cause': ip['primary_cause'] if ip else 'not opened (image pass covered fidelity ≤ 3 and 10 random others)',
            'diagnosis': ip['diagnosis'] if ip else None, 'judge_notes': seen[:3],
            'source_quote': words(re.sub(r'<[^>]+>', ' ', r['source_text']), 30), 'reference_quote': words('\n'.join(x for x in r['reference_text'].split('\n') if not x.startswith('[context]')), 15 if m['private'] else 40),
            'ours_quote': words(re.sub(r'<[^>]+>', ' ', next(c['text'] for c in r['candidates'] if c['arm'] == 'served')), 40)}
G = [item(p, 'best') for p in best] + [item(p, 'median') for p in median] + [item(p, 'worst') for p in worst]
# principles pages: different legitimate choices, ours accurate (fidelity >= 4), judge says both defensible
cand = []
for i, v in dims.items():
    k = key[i]; p = next(x for x in pages if x['id'] == i); who = (v.get('disagreement') or {}).get('who')
    if v.get('different_choice') and who in ('both_defensible', 'none') and p['arms']['served']['fidelity'] >= 4:
        so = v['X'] if k['X'] == 'served' else v['Y']; rf = v['Y'] if k['X'] == 'served' else v['X']
        if so['stance'] != rf['stance']: cand.append((p, v, so, rf, k))
cand.sort(key=lambda c: (-c[0]['arms']['served']['fidelity'], c[0]['lang'], c[0]['id']))
pick = []; langs = set()
for c in cand:
    if c[0]['lang'] not in langs: pick.append(c); langs.add(c[0]['lang'])
    if len(pick) == 2: break
def deblind(t, k): return re.sub(r'\b([XY])\b', lambda m: 'ours' if k[m.group(1)] == 'served' else 'the reference', t or '')
P = [{**item(p, 'principles'), 'ours_profile': so, 'reference_profile': rf, 'choice_note': deblind(v.get('choice_note'), k), 'point': deblind((v.get('disagreement') or {}).get('point'), k)} for p, v, so, rf, k in pick]
json.dump({'gallery': G, 'principles': P, 'selection': 'served arm, sorted by mean fidelity of two blind judges; within a tied tier pages the image pass opened are listed first; worst = lowest 5'}, open(f'{R}/gallery.json', 'w'), indent=1, ensure_ascii=False)
L = ['# T5 gallery — served English vs a published reference (Sanskrit, Pali, classical Chinese)', '',
     f'{n} served pages, two blind Opus judges. Every reference here is open (CC0 or pre-1931 public domain), so every item is `publishable: true`. Quotes are openings of each text (≤ 40 words), not aligned spans; the judges\' notes quote the exact places.', '']
for tier, title in (('best', 'Best 5'), ('median', f'Median 5 (fidelity {medf})'), ('worst', 'Worst 5')):
    L += [f'## {title}', '']
    for g in [x for x in G if x['tier'] == tier]:
        L += [f"### {g['work']} — [page]({g['page_url']}) · {g['lang']} · fidelity {g['served_fidelity']} · publishable: {str(g['publishable']).lower()}",
              f"- **Reference:** {g['reference']}; {g['reference_licence'][:60]} · scan: {g['scan_licence']}",
              f"- **Defect class:** {g['defect_class']} · **cause:** {g['cause']}",
              f"- **Diagnosis:** {g['diagnosis'] or (g['judge_notes'][0] if g['judge_notes'] else 'the judges found nothing wrong')}"]
        L += [f"- Judges: {x}" for x in g['judge_notes'][:2]]
        L += ['', '| source | reference | ours |', '|---|---|---|', f"| {g['source_quote']} | {g['reference_quote']} | {g['ours_quote']} |".replace('\n', ' '), '']
L += ['## Two pages for a principles discussion (different legitimate choices, not errors)', '']
for g in P:
    L += [f"### {g['work']} — [page]({g['page_url']}) · {g['lang']} · ours fidelity {g['served_fidelity']}", f"- **Reference:** {g['reference']} — stance **{g['reference_profile']['stance']}**; ours — stance **{g['ours_profile']['stance']}**",
          f"- **The choice:** {g['choice_note']}", f"- Profiles (readability / register / terminology / ambiguity / transparency): ours {[g['ours_profile'][d] for d in ('readability','register','terminology','ambiguity','transparency')]}, reference {[g['reference_profile'][d] for d in ('readability','register','terminology','ambiguity','transparency')]}",
          '', '| source | reference | ours |', '|---|---|---|', f"| {g['source_quote']} | {g['reference_quote']} | {g['ours_quote']} |".replace('\n', ' '), '']
open(f'{R}/gallery.md', 'w').write('\n'.join(L))
for g in G + P: print(g['tier'], g['lang'][:2], g['served_fidelity'], g['work'][:38], '|', g['defect_class'][:22], '|', g['cause'][:14], '|', (g['diagnosis'] or '')[:110])
