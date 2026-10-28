#!/usr/bin/env python3
"""judge-table.py — #7567 E2: the blind Opus judge's verdicts per arm (misleading, worse than its draft), per language.

PRIOR ART: scripts/eval/ocr-per-call-7522/score.mjs (usable / omission / addition / bleed / order / misreads per arm,
from the same judge.mjs verdicts). This adds the issue's two counts. The pages are every panel page except the manuscript
(the judge reads the image, so a stale reference does not matter here).
  misleading       = the judge did not call the version usable (a reader would not be served what the page says).
  worse than draft = the draft was usable and the correction is not, or the correction carries more faults, counting
                     3 for each omission, addition, cross-page bleed or order error and 1 for each misread.
                     a, a2, f, a-noimg vs L; b vs G; c vs X; d vs the better of G and X. A label shared with the draft
                     (an UNCHANGED answer) is never worse. Arms the judge did not see on a page (no text) are counted
                     as not delivered, and as misleading.
  judge-table.py <J> <out.json>
"""
import json, os, sys

J, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
pages = {p['slug']: p for p in json.load(open(os.path.join(HERE, 'panel.json')))['pages']}
SKIP = {'dta-lindnerin_kochbuch_1780-p34', 'dta-lindnerin_kochbuch_1780-p48'}
key = json.load(open(os.path.join(J, 'judge-key.json')))
V = {}
for f in os.listdir(os.path.join(J, 'judge-run', 'judge', 'out')):
    r = json.load(open(os.path.join(J, 'judge-run', 'judge', 'out', f)))
    if r.get('verdict') and r['page_id'] in key: V[r['page_id']] = r['verdict']['versions']
DRAFT = {'a': ['L'], 'a2': ['L'], 'f': ['L'], 'b': ['G'], 'c': ['X'], 'd': ['G', 'X'], 'a-noimg': ['L'], 'b-noimg': ['G']}
PRIO = {'lite': 0, 'gpu': 1, 'noimg': 2}
faults = lambda v: 3 * (len(v['omissions']) + len(v['additions']) + len(v['cross_page_bleed']) + len(v['order_errors'])) + len(v['misreads'])
structural = lambda v: len(v['omissions']) + len(v['additions']) + len(v['cross_page_bleed']) + len(v['order_errors'])

rows = {}   # (slug, arm) -> verdict summary; an arm judged in several packets keeps the lite, then the gpu verdict
noimg = {}  # (slug, arm) -> verdict summary inside the no-image packet only (image vs no-image compared in one call)
for name, k in sorted(key.items(), key=lambda kv: (PRIO[kv[1]['group']], kv[0])):
    if name not in V or k['slug'] in SKIP: continue
    v = V[name]
    lab_of = {a: lab for lab, arms in k['labels'].items() for a in arms}
    for a in list(lab_of) + k['not_delivered']:
        if a in k['not_delivered']:
            if k['group'] == 'noimg': noimg[(k['slug'], a)] = {'delivered': False, 'usable': False, 'faults': 99}
            if (k['slug'], a) not in rows: rows[(k['slug'], a)] = {'delivered': False, 'usable': False}
            continue
        x = v[lab_of[a]]
        r = {'delivered': True, 'usable': bool(x['usable']), 'faults': faults(x), 'structural': structural(x), 'misreads': len(x['misreads']), 'label': lab_of[a]}
        ds = [d for d in DRAFT.get(a, []) if d in lab_of]
        if ds:
            dv = [v[lab_of[d]] for d in ds]
            best = min(dv, key=faults)
            same = any(lab_of[d] == lab_of[a] for d in ds)
            r['worse'] = (not same) and ((any(y['usable'] for y in dv) and not x['usable']) or faults(x) > faults(best))
            r['better'] = (not same) and ((x['usable'] and not any(y['usable'] for y in dv)) or faults(x) < faults(best))
        if k['group'] == 'noimg': noimg[(k['slug'], a)] = r
        if (k['slug'], a) not in rows: rows[(k['slug'], a)] = r

res = {}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    L = {}
    for (s, a), r in rows.items():
        if lang != 'all' and pages[s]['lang'] != lang: continue
        t = L.setdefault(a, {'n': 0, 'not_delivered': 0, 'misleading': 0, 'structural_pages': 0, 'misreads': 0, 'worse': 0, 'better': 0, 'vs_draft_n': 0})
        t['n'] += 1; t['not_delivered'] += not r['delivered']; t['misleading'] += not r['usable']
        if r['delivered']: t['structural_pages'] += r['structural'] > 0; t['misreads'] += r['misreads']
        if 'worse' in r: t['vs_draft_n'] += 1; t['worse'] += r['worse']; t['better'] += r['better']
    res[lang] = L
NI = {}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    for img, no in (('a', 'a-noimg'), ('b', 'b-noimg')):
        ps = [s for (s, a) in noimg if a == no and (lang == 'all' or pages[s]['lang'] == lang) and (s, img) in noimg]
        if not ps: continue
        t = {'n': len(ps), 'misleading_image': sum(not noimg[(s, img)]['usable'] for s in ps), 'misleading_noimage': sum(not noimg[(s, no)]['usable'] for s in ps),
             'image_fewer_faults': sum(noimg[(s, img)].get('faults', 99) < noimg[(s, no)].get('faults', 99) for s in ps),
             'noimage_fewer_faults': sum(noimg[(s, img)].get('faults', 99) > noimg[(s, no)].get('faults', 99) for s in ps),
             'noimage_worse_than_draft': sum(bool(noimg[(s, no)].get('worse')) for s in ps), 'image_worse_than_draft': sum(bool(noimg[(s, img)].get('worse')) for s in ps)}
        NI.setdefault(lang, {})[img] = t
json.dump({'image_vs_noimage_judged': NI, 'by_lang': res, 'rows': {f'{s}|{a}': r for (s, a), r in rows.items()}}, open(OUT, 'w'), indent=1)
for lang, d in NI.items():
    for img, t in d.items(): print(f"  [no-image, {lang}] {img}: n={t['n']} misleading image {t['misleading_image']} vs no-image {t['misleading_noimage']}; fewer faults: image {t['image_fewer_faults']}, no-image {t['noimage_fewer_faults']}; worse than draft: image {t['image_worse_than_draft']}, no-image {t['noimage_worse_than_draft']}")
for lang, L in res.items():
    print(f'== {lang}')
    for a, t in sorted(L.items(), key=lambda kv: kv[1]['misleading'] / max(1, kv[1]['n'])):
        print(f"  {a:6s} n={t['n']:3d} misleading {t['misleading']:3d} ({100*t['misleading']/t['n']:4.1f}%)  not delivered {t['not_delivered']}  "
              f"structural {t['structural_pages']}  misreads {t['misreads']}" + (f"  worse/better than draft {t['worse']}/{t['better']} of {t['vs_draft_n']}" if t['vs_draft_n'] else ''))
