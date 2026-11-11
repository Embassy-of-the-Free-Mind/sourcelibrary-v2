#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-error-to-translation-7611/score.py (carried/repaired/dropped with Wilson CIs) — this scores
# the #8358 image-at-translation test: the same outcomes per arm on the same spots, paired against the text arm, with a
# text-vs-text repeat as the noise floor, plus new translator errors, false leaf claims, the judge controls and tokens.
#   python3 score_t2.py <scratch>   -> prints markdown, writes <scratch>/t2/spot-rows.json
import json, math, os, sys, collections
S = sys.argv[1].rstrip('/')
K = {k['key']: k for k in json.load(open(f'{S}/t2/judge-key.json'))}
tasks = {t['key']: t for t in json.load(open(f'{S}/t2/tasks.json'))}
def wilson(k, n, z=1.96):
    if n == 0: return '—'
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return f'{k}/{n} ({100*p:.0f}%, {100*max(0,c-h):.0f}–{100*min(1,c+h):.0f}%)'
def J(key):
    f = f'{S}/t2/judged/{key}.json'
    return json.load(open(f))['result'] if os.path.exists(f) else None
main = {(k['arm'], k['task']): (key, J(key)) for key, k in K.items() if k['control'] is None}
missing = [k for k, (_, r) in main.items() if r is None]
out = []; P = lambda *a: out.append(' '.join(str(x) for x in a))
if missing: P('NOT JUDGED:', missing)
ARMS = ('text', 'image', 'text2')
# Spot outcomes.
rows = []
for (arm, tk), (key, r) in main.items():
    if r is None: continue
    for s, j in zip(tasks[tk]['spots'], r['spots']):
        rows.append({'arm': arm, 'task': tk, 'kind': tasks[tk]['kind'], 'stratum': tasks[tk]['stratum'], 'quote': s['quote'], 'carried_7611': s['outcome_7611'] == 'carried', 'outcome': j.get('outcome'), 'english_quote': j.get('english_quote'), 'reason': j.get('reason')})
def tab(sel, label):
    P(f'\n| {label} | arm | carried | repaired | dropped | other |\n|---|---|---|---|---|---|')
    for arm in ARMS:
        rs = [r for r in rows if r['arm'] == arm and sel(r)]; n = len(rs); c = collections.Counter(r['outcome'] for r in rs)
        P(f"| | {arm} | {wilson(c['carried'], n)} | {wilson(c['repaired'], n)} | {c['dropped']} | {c['other']} |")
tab(lambda r: r['kind'] == 'error' and r['carried_7611'], 'the 29 errors #7611 found carried')
tab(lambda r: r['kind'] == 'error', 'all 37 confirmed errors on these 18 pages')
tab(lambda r: r['kind'] == 'planted', '12 planted misreads (#7611 controls)')
idx = {(r['arm'], r['task'], r['quote']): r for r in rows}
def flips(a, b, sel):
    """Of the spots arm a carries, how many arm b repairs; of those a repairs, how many b carries."""
    base = [r for r in rows if r['arm'] == a and sel(r)]
    ca = [r for r in base if r['outcome'] == 'carried']; ra = [r for r in base if r['outcome'] == 'repaired']
    fixed = sum(idx.get((b, r['task'], r['quote']), {}).get('outcome') == 'repaired' for r in ca)
    broke = sum(idx.get((b, r['task'], r['quote']), {}).get('outcome') == 'carried' for r in ra)
    return fixed, len(ca), broke, len(ra)
for label, sel in (('confirmed errors (37)', lambda r: r['kind'] == 'error'), ('planted misreads (12)', lambda r: r['kind'] == 'planted'), ('both (49)', lambda r: r['kind'] in ('error', 'planted'))):
    f, n, b, m = flips('text', 'image', sel); f2, n2, b2, m2 = flips('text', 'text2', sel)
    P(f"\n**{label}.** Of the spots the text arm carries, the image arm repairs {wilson(f, n)}; the text arm run again repairs {wilson(f2, n2)} (noise). Of the spots the text arm repairs, the image arm carries {b}/{m}; the repeat {b2}/{m2}.")
# New errors and leaf claims per page.
P('\n| arm | pages | pages with a translator-side error that misleads or is wrong text | such errors | all listed errors | pages with a false leaf claim | false leaf claims | true leaf claims | page_matches false |\n|---|---:|---|---:|---:|---|---:|---:|---:|')
per = collections.defaultdict(dict)
for arm in ARMS:
    pg = [(tk, r) for (a, tk), (_, r) in main.items() if a == arm and r is not None]
    def tr_err(r): return [e for e in r.get('other_errors', []) if e.get('source') == 'translation' and e.get('severity') in ('misleads', 'wrong_text')]
    for tk, r in pg: per[arm][tk] = (len(tr_err(r)), sum(not c.get('true_of_page') for c in r.get('leaf_claims', [])))
    P(f"| {arm} | {len(pg)} | {wilson(sum(bool(tr_err(r)) for _, r in pg), len(pg))} | {sum(len(tr_err(r)) for _, r in pg)} | {sum(len(r.get('other_errors', [])) for _, r in pg)} | {wilson(sum(any(not c.get('true_of_page') for c in r.get('leaf_claims', [])) for _, r in pg), len(pg))} | {sum(sum(not c.get('true_of_page') for c in r.get('leaf_claims', [])) for _, r in pg)} | {sum(sum(bool(c.get('true_of_page')) for c in r.get('leaf_claims', [])) for _, r in pg)} | {sum(r.get('page_matches') is False for _, r in pg)} |")
for b in ('image', 'text2'):
    common = [tk for tk in per['text'] if tk in per[b]]
    more = sum(per[b][tk][0] > per['text'][tk][0] for tk in common); fewer = sum(per[b][tk][0] < per['text'][tk][0] for tk in common)
    lm = sum((per[b][tk][1] > 0) and not (per['text'][tk][1] > 0) for tk in common); lf = sum((per['text'][tk][1] > 0) and not (per[b][tk][1] > 0) for tk in common)
    P(f"{b} vs text, paired pages ({len(common)}): more translator errors on {more}, fewer on {fewer}; a false leaf claim only in {b} on {lm}, only in text on {lf}.")
for kind in ('error', 'clean', 'planted'):
    P(f"  by page kind {kind}: " + '; '.join(f"{arm}: tr-errors {sum(v[0] for tk, v in per[arm].items() if tasks[tk]['kind'] == kind)}, false leaf claims {sum(v[1] for tk, v in per[arm].items() if tasks[tk]['kind'] == kind)}" for arm in ARMS))
# The false leaf claims, listed.
P('\nFalse leaf claims:')
for (arm, tk), (key, r) in sorted(main.items()):
    for c in (r or {}).get('leaf_claims', []):
        if not c.get('true_of_page'): P(f"- {arm} {tk}: “{c.get('english_quote','')[:160]}” — {c.get('why','')[:200]}")
# Controls.
P('\n**Controls.**')
for key, k in K.items():
    c = k['control']
    if not c: continue
    r = J(key)
    if r is None: P('- control not judged', key, c['type']); continue
    if c['type'] == 'planted_english':
        hit = [e for e in r.get('other_errors', []) + [{'english_quote': s.get('english_quote', '')} for s in r.get('spots', []) if s.get('outcome') != 'repaired'] if c['new'] in (e.get('english_quote') or '')]
        P(f"- planted English {k['arm']} {k['task'][:16]} {c['old']}→{c['new']}: {'CAUGHT' if hit else 'MISSED'}")
    elif c['type'] == 'wrong_page':
        P(f"- wrong page {k['arm']} {k['task'][:16]}: page_matches={r.get('page_matches')} ({'CAUGHT' if r.get('page_matches') is False else 'MISSED'})")
    elif c['type'] == 'repeat':
        a = J(c['of']); same = sum(x.get('outcome') == y.get('outcome') for x, y in zip(a['spots'], r['spots']))
        trA = sum(e.get('source') == 'translation' and e.get('severity') in ('misleads', 'wrong_text') for e in a.get('other_errors', [])); trB = sum(e.get('source') == 'translation' and e.get('severity') in ('misleads', 'wrong_text') for e in r.get('other_errors', []))
        fA = sum(not x.get('true_of_page') for x in a.get('leaf_claims', [])); fB = sum(not x.get('true_of_page') for x in r.get('leaf_claims', []))
        P(f"- repeat {k['arm']} {k['task'][:16]}: spot outcomes agree {same}/{len(r['spots'])}; translator errors {trA} vs {trB}; false leaf claims {fA} vs {fB}")
# Tokens and calls per page.
P('')
for arm in ARMS:
    us, opened, calls = [], 0, 0
    for tk in tasks:
        x = json.load(open(f'{S}/t2/{arm}/{tk}.json')); calls += x['calls']
        opened += any(t in ('read_file', 'view_file') for t in x['tool_calls'])
        us.append([sum((u or {}).get(k) or 0 for u in x['usage']) for k in ('input', 'cache_read', 'output', 'thinking')])
    n = len(us); tot = sum(a + b + c + d for a, b, c, d in us) / n
    P(f"Tokens per page {arm} ({n} pages, {calls} calls, image opened on {opened}): input {sum(x[0] for x in us)/n:.0f} + cache_read {sum(x[1] for x in us)/n:.0f}, output {sum(x[2] for x in us)/n:.0f}, thinking {sum(x[3] for x in us)/n:.0f}; all {tot:.0f}.")
print('\n'.join(out))
json.dump(rows, open(f'{S}/t2/spot-rows.json', 'w'), ensure_ascii=False)
