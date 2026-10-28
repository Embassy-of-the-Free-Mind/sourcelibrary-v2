#!/usr/bin/env python3
"""e5-table.py — #7567 E5 decision table: arm c (GPU draft → agy Flash low, image) against arm a (Flash-Lite draft → the
same correction), 20 books × 25 library pages per language. Committed BEFORE arm c's results exist (as e2-table.py was).

PRIOR ART: e2-table.py (E2's δ CER vs a with a paired bootstrap and the a2 − a noise floor, against typed references)
and judge-table.py (misleading / worse-than-draft from the blind Opus judge). E5's pages are our own library pages, which
have NO typed reference, so the CER side here is AGREEMENT, not accuracy (.claude/docs/eval-design.md): how far each
arm's text is from arm a's, against how far arm a is from itself on a repeat (a2, two pages a book).

  CER side (every page both arms delivered): d(x) = folded letter edit distance (score.py letters(), folded view;
    global alignment) from x to a, ÷ a's letters. Reported: mean d(c), mean d(a2) on the a2 pages, and the paired
    bootstrap 95% CI (10,000 resamples of BOOKS, seed 7567) of mean d(c) − mean d(a2) on those pages. c is "inside the
    repeat noise" when that CI's lower end ≤ 0. Agreement cannot say which of two texts is right: the judge does.
  Judge side (the 8-page-a-book judged sample, both arms delivered): misleading (not usable), worse than its own draft
    (c vs X, a vs L; judge-table.py's rule: draft usable and the correction not, or more weighted faults, 3 per
    omission/addition/bleed/order error and 1 per misread), and worse than what readers get now (vs L, the stored text).
  VERDICT per language, fixed here:
    pass  = misleading(c) ≤ misleading(a)  AND  worse-than-stored(c) ≤ worse-than-stored(a)
    fail  = otherwise. fr and it get the same rule: their lite read is the stored Flash-Lite draft.
  The table also prints head-to-head (pages where c has fewer / more weighted faults than a).

  e5-table.py <J> <out.json>        (J = the job's e5 dir)
"""
import json, os, random, sys
import edlib

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from score import letters  # noqa: E402

J, OUT = sys.argv[1], sys.argv[2]
pages = {p['slug']: p for p in json.load(open(os.path.join(J, 'panel.json')))['pages']}


def arm(a):
    d = os.path.join(J, 'arms', a)
    return {f[:-5]: json.load(open(os.path.join(d, f))) for f in os.listdir(d)} if os.path.isdir(d) else {}


A = {a: arm(a) for a in ('a', 'a2', 'c')}
txt = lambda a, s: (A[a].get(s) or {}).get('final') or ''


def dist(x, ref):
    r, h = letters(ref, True), letters(x, True)
    if not r: return None
    return min(1.0, edlib.align(h, r, mode='NW', task='distance')['editDistance'] / len(r)) if h else 1.0


def boot(rows, n=10000):
    """rows: [(book, value)]; 95% CI of the mean of value, resampling books."""
    by = {}
    for b, v in rows: by.setdefault(b, []).append(v)
    books = sorted(by); rng = random.Random(7567); ms = []
    for _ in range(n):
        vs = [v for b in (rng.choice(books) for _ in books) for v in by[b]]
        ms.append(sum(vs) / len(vs))
    ms.sort(); return [round(100 * ms[int(0.025 * n)], 2), round(100 * ms[int(0.975 * n)], 2)]


# ── judge ──
key = json.load(open(os.path.join(J, 'judge-key.json'))) if os.path.exists(os.path.join(J, 'judge-key.json')) else {}
V = {}
od = os.path.join(J, 'judge-run', 'judge', 'out')
for f in (os.listdir(od) if os.path.isdir(od) else []):
    r = json.load(open(os.path.join(od, f)))
    if r.get('verdict') and r['page_id'] in key: V[r['page_id']] = r['verdict']['versions']
faults = lambda v: 3 * (len(v['omissions']) + len(v['additions']) + len(v['cross_page_bleed']) + len(v['order_errors'])) + len(v['misreads'])
DRAFT = {'a': 'L', 'a2': 'L', 'c': 'X'}
J_ROWS = {}
for s, k in key.items():
    if s not in V: continue
    v = V[s]; lab = {a: l for l, arms in k['labels'].items() for a in arms}
    def view(a):
        if a in k['not_delivered'] or a not in lab: return None
        x = v[lab[a]]; return {'usable': bool(x['usable']), 'faults': faults(x), 'label': lab[a]}
    row = {a: view(a) for a in ('L', 'X', 'a', 'a2', 'c')}
    for a, d in DRAFT.items():
        x, y = row[a], row[d]
        if x is None: continue
        same = y is not None and x['label'] == y['label']
        x['worse_than_draft'] = bool(y) and not same and ((y['usable'] and not x['usable']) or x['faults'] > y['faults'])
        st = row['L']; same_st = st is not None and x['label'] == st['label']
        x['worse_than_stored'] = bool(st) and not same_st and ((st['usable'] and not x['usable']) or x['faults'] > st['faults'])
        x['better_than_stored'] = bool(st) and not same_st and ((x['usable'] and not st['usable']) or x['faults'] < st['faults'])
    J_ROWS[s] = row

res = {}
for lang in ['la', 'en', 'de', 'fr', 'it', 'all']:
    sl = [s for s in pages if lang == 'all' or pages[s]['lang'] == lang]
    both = [s for s in sl if txt('a', s) and txt('c', s)]
    dc = [(pages[s]['book_id'], dist(txt('c', s), txt('a', s))) for s in both]
    dc = [(b, x) for b, x in dc if x is not None]
    a2p = [s for s in both if txt('a2', s)]
    pair = [(pages[s]['book_id'], dist(txt('c', s), txt('a', s)) - dist(txt('a2', s), txt('a', s))) for s in a2p]
    t = {'pages': len(sl), 'both_delivered': len(both),
         'not_delivered': {a: sum(1 for s in sl if not txt(a, s)) for a in ('a', 'c')},
         'mean_d_c_vs_a': round(100 * sum(x for _, x in dc) / max(1, len(dc)), 2),
         'a2_pages': len(a2p),
         'mean_d_c_vs_a_on_a2_pages': round(100 * sum(dist(txt('c', s), txt('a', s)) for s in a2p) / max(1, len(a2p)), 2) if a2p else None,
         'mean_d_a2_vs_a': round(100 * sum(dist(txt('a2', s), txt('a', s)) for s in a2p) / max(1, len(a2p)), 2) if a2p else None,
         'ci_c_minus_a2': boot(pair) if len(pair) >= 5 else None}
    jr = [J_ROWS[s] for s in sl if s in J_ROWS and J_ROWS[s]['a'] and J_ROWS[s]['c']]
    cnt = lambda a, k: sum(1 for r in jr if r.get(a) and r[a].get(k))
    mis = lambda a: sum(1 for r in jr if r.get(a) is not None and not r[a]['usable'])
    t['judged'] = len(jr)
    t['misleading'] = {a: mis(a) for a in ('L', 'X', 'a', 'c')}
    t['a2_judged'] = sum(1 for r in jr if r.get('a2')); t['misleading_a_vs_a2_on_a2'] = [sum(1 for r in jr if r.get('a2') and not r['a']['usable']), sum(1 for r in jr if r.get('a2') and not r['a2']['usable'])]
    t['worse_than_draft'] = {a: cnt(a, 'worse_than_draft') for a in ('a', 'c')}
    t['worse_than_stored'] = {a: cnt(a, 'worse_than_stored') for a in ('a', 'c')}
    t['better_than_stored'] = {a: cnt(a, 'better_than_stored') for a in ('a', 'c')}
    t['c_fewer_faults_than_a'] = sum(1 for r in jr if r['c']['faults'] < r['a']['faults'])
    t['c_more_faults_than_a'] = sum(1 for r in jr if r['c']['faults'] > r['a']['faults'])
    t['verdict'] = ('pass' if t['misleading']['c'] <= t['misleading']['a'] and t['worse_than_stored']['c'] <= t['worse_than_stored']['a'] else 'fail') if jr else None
    res[lang] = t
json.dump({'by_lang': res, 'judge_rows': J_ROWS}, open(OUT, 'w'), indent=1)
for lang, t in res.items():
    print(f"{lang}: n {t['pages']} both {t['both_delivered']} | d(c,a) {t['mean_d_c_vs_a']}% | on {t['a2_pages']} a2 pages d(c,a) {t['mean_d_c_vs_a_on_a2_pages']}% vs d(a2,a) {t['mean_d_a2_vs_a']}% CI(c−a2) {t['ci_c_minus_a2']}"
          f" | judged {t['judged']}: misleading {t['misleading']} worse-than-draft {t['worse_than_draft']} worse-than-stored {t['worse_than_stored']} better-than-stored {t['better_than_stored']}"
          f" c<a {t['c_fewer_faults_than_a']} c>a {t['c_more_faults_than_a']} → {t['verdict']}")
