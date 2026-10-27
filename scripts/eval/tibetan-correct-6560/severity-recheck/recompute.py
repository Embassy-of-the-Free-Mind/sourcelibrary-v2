#!/usr/bin/env python3
# PRIOR ART: profiles-diffqa/judge.mjs `score` (PR #7505) decides "severe introduced" per page from the span judge's
# own severe/minor label. This keeps its verdicts (which reading the leaf shows, the confirm judge, the whole-page
# judge, the 25% wreck rule) and swaps only the CLASS of each difference for classify.py's reader-impact class.
"""Recompute Derek's rule (severe on fewer than 2 of 10 pages) for #7505's variants under the new classes.

  python3 recompute.py hunks.jsonl.gz OUT.json

hunks.jsonl.gz: one row per (variant, page) from #7505's score with every hunk's verdicts (_judge-dump.mjs).
A page is severe when ANY of:
  span    a span of class severe where the span judge saw the draft on the leaf, AND the confirm judge did too
          (spans the span judge called "minor" were never sent to confirm: they count under one_judge only)
  page    the whole-page judge finds a wrong-text defect on the corrected text that it did not find on the draft,
          ignoring O8 (normalisation) defects
  wreck   more than 25% of the draft's syllables changed (the lane refuses these whole; #7505's rule)
"""
import gzip, json, re, sys
from collections import Counter, defaultdict
from classify import classify, load_hand

HAND = load_hand()
rows = [json.loads(l) for l in gzip.open(sys.argv[1], 'rt', encoding='utf-8')]
code = lambda d: (re.match(r'^[IOTDE]\d+', str(d.get('class') or '').upper()) or [None])[0] or 'E2'


def page_added(r, skip=('O8',)):
    a = [d for d in (r.get('page_defects_draft') or []) if code(d) not in skip]
    b = [d for d in (r.get('page_defects_text') or []) if code(d) not in skip]
    if r.get('page_defects_text') is None or r.get('page_defects_draft') is None:
        return False, []
    ca, cb = {code(d) for d in a}, {code(d) for d in b}
    return (len(b) > len(a) or bool(cb - ca)), b


def wilson(k, n, z=1.96):
    if not n:
        return [None, None]
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5)
    return [round((c - h) / d, 3), round((c + h) / d, 3)]


res, spans = {}, []
by_var = defaultdict(list)
for r in rows:
    by_var[r['variant']].append(r)
for v, rr in by_var.items():
    n = len(rr)
    pages = {'old': 0, 'new': 0, 'new_one_judge': 0, 'new_with_mantra': 0}
    why = Counter()
    cls_pages = defaultdict(set)
    cls_spans = Counter()
    for r in rr:
        sev_c = sev_1 = mantra = False
        for h in r.get('all_hunks') or []:
            if h['side'] != 'base':
                continue
            c = classify(h['base'] or '', h['arm'] or '', HAND)
            kind = c['class'] if c['class'] != 'severe' else f"severe:{c['sub']}"
            confirmed = h.get('confirm') == 'base'
            if h.get('diff') == 'severe' or h.get('line_hunk'):
                # #7505 counted it (one judge); the confirm judge settled it
                cls_spans[(kind, 'confirmed' if confirmed else 'one_judge')] += 1
                cls_pages[(kind, 'confirmed' if confirmed else 'one_judge')].add(r['uid'])
            else:
                cls_spans[(kind, 'judge_said_minor')] += 1
                cls_pages[(kind, 'judge_said_minor')].add(r['uid'])
            if v == 'A':
                spans.append({'uid': r['uid'], 'group': r['group'], 'page_number': r['page_number'], 'book_id': r['book_id'], **h, **c})
            if c['class'] == 'severe':
                sev_1 = True
                if confirmed:
                    sev_c = True
            if c['class'] == 'mantra' and confirmed:
                mantra = True
        pa, _ = page_added(r)
        wreck = bool(r.get('wreck'))
        new = sev_c or pa or wreck
        pages['old'] += bool(r.get('severe_introduced'))
        pages['new'] += new
        pages['new_one_judge'] += (sev_1 or pa or wreck)
        pages['new_with_mantra'] += (new or mantra)
        if new:
            why['+'.join(k for k, x in (('span', sev_c), ('page', pa), ('wreck', wreck)) if x)] += 1
        r['_new'] = new
    pooled = Counter(r.get('pooled') for r in rr)
    res[v] = {'pages': n, **{f'{k}_pages': x for k, x in pages.items()},
              **{f'{k}_per10': round(10 * x / n, 1) for k, x in pages.items()},
              'new_ci': wilson(pages['new'], n), 'severe_page_reasons': dict(why),
              'rule_severity_pass': pages['new'] < 0.2 * n,
              'pooled_bsw': [pooled['better'], pooled['same'], pooled['worse']],
              'span_classes': {f'{k}|{j}': [x, len(cls_pages[(k, j)])] for (k, j), x in sorted(cls_spans.items())}}
json.dump({'variants': res, 'arm_A_draft_win_spans': spans}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
print('variant | pages | severe pages #7505 (per 10) | new: confirmed (per 10) [95%] | new: one judge | new + mantra letters | reasons')
for v, x in res.items():
    print(f"{v:7} | {x['pages']} | {x['old_pages']} ({x['old_per10']}) | {x['new_pages']} ({x['new_per10']}) {x['new_ci']} | {x['new_one_judge_pages']} ({x['new_one_judge_per10']}) | {x['new_with_mantra_pages']} ({x['new_with_mantra_per10']}) | {x['severe_page_reasons']}")
