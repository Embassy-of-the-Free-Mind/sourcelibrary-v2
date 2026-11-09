#!/usr/bin/env python3
# PRIOR ART: scripts/eval/ocr-error-to-translation-7611/score.py (Wilson CIs over spots, by stratum) — this scores the
# #8358 doubt-flag test instead: the judge's quote of each read at each known error is found in the read, and the doubt
# marks (⟦…⟧, and the live prompt's own <unclear>) are checked against its position. Read-only.
#   python3 score_t1.py <scratch>  -> prints markdown, writes <scratch>/t1/score.json
import json, math, os, re, sys, collections, difflib, unicodedata
S = sys.argv[1].rstrip('/')
N = lambda s: unicodedata.normalize('NFC', s or '')
K = {k['key']: k for k in json.load(open(f'{S}/t1/judge-key.json'))}
def wilson(k, n, z=1.96):
    if n == 0: return '—'
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return f'{k}/{n} ({100*p:.0f}%, {100*max(0,c-h):.0f}–{100*min(1,c+h):.0f}%)'
def J(key):
    f = f'{S}/t1/judged/{key}.json'
    return json.load(open(f))['result'] if os.path.exists(f) else None
def jtext(k):
    t = k['text']
    if k['planted']:
        p = [s for s in k['spans'] if s['kind'] == 'planted'][0]; t = t[:p['start']] + k['planted']['planted'] + t[p['end']:]
    return t
def locate(q, t):
    """(start, end) of the judge's quote in the read, exact, then whitespace-folded, then the best fuzzy block."""
    q = N(q).strip()
    if not q: return None
    i = t.find(q)
    if i >= 0: return (i, i + len(q))
    # whitespace-folded: map positions of the non-space characters
    idx = [j for j, c in enumerate(t) if not c.isspace()]; tf = ''.join(t[j] for j in idx); qf = re.sub(r'\s+', '', q)
    i = tf.find(qf)
    if i >= 0 and qf: return (idx[i], idx[i + len(qf) - 1] + 1)
    sm = difflib.SequenceMatcher(None, tf, qf, autojunk=False); m = sm.find_longest_match(0, len(tf), 0, len(qf))
    if m.size >= max(3, 0.6 * len(qf)):
        a = max(0, m.a - m.b); b = min(len(tf) - 1, a + len(qf) - 1); return (idx[a], idx[b] + 1)
    return None
def unclear_ranges(t):
    return [m.span(1) for m in re.finditer(r'<unclear>(.*?)</unclear>', t, re.S)]
ov = lambda r, spans: bool(r) and any(a < r[1] and r[0] < b for a, b in spans)
body = lambda t: re.sub(r'<(vocab|script|scan-quality|page-type|language|warning|meta|columns)>.*?</\1>', '', t, flags=re.S)
rows = []  # one per (arm, spot)
for key, k in K.items():
    if k['arm'] not in ('L', 'D'): continue
    res = J(key)
    if res is None: print('NOT JUDGED', key); continue
    t = jtext(k); unc = unclear_ranges(t)
    for s, r in zip(k['spots'], res['spots']):
        loc = locate(r.get('transcription_quote', ''), t)
        err = None
        if loc and not r.get('matches_page') and r.get('differing_text'):
            sub = t[loc[0]:loc[1]].find(N(r['differing_text']))
            err = (loc[0] + sub, loc[0] + sub + len(N(r['differing_text']))) if sub >= 0 else (locate(r['differing_text'], t) or loc)
        same_misread = re.sub(r'\s+', '', N(r.get('transcription_quote', ''))) == re.sub(r'\s+', '', N(s['quote']))
        rows.append({**s, 'arm': k['arm'], 'page_id': k['page_id'], 'quote_found': loc is not None, 'correct': bool(r.get('matches_page')),
                     'omitted': not N(r.get('transcription_quote', '')).strip(), 'same_misread': same_misread,
                     'mark_loc': ov(loc, k['marks']), 'mark_err': ov(err or loc, k['marks']) if not r.get('matches_page') else None,
                     'unclear_loc': ov(loc, unc), 'unclear_err': ov(err or loc, unc) if not r.get('matches_page') else None})
D = [r for r in rows if r['arm'] == 'D']; L = [r for r in rows if r['arm'] == 'L']
out = []
P = lambda *a: out.append(' '.join(str(x) for x in a))
P(f"spots scored: D {len(D)}, L {len(L)}; judge quote not found in the read: D {sum(not r['quote_found'] and not r['omitted'] for r in D)}, L {sum(not r['quote_found'] and not r['omitted'] for r in L)}; omitted by the read: D {sum(r['omitted'] for r in D)}, L {sum(r['omitted'] for r in L)}")
def strat(rows, fn, label):
    P(f'\n| {label} | n | D mark on the spot | D wrong there | D wrong AND marked | D mark or <unclear> on the spot | L <unclear> on the spot |')
    P('|---|---:|---|---|---|---|---|')
    groups = collections.defaultdict(list)
    for r in rows: groups[fn(r)].append(r)
    for g in sorted(groups, key=lambda g: -len(groups[g])) + ['**all**']:
        rs = rows if g == '**all**' else groups[g]
        Ls = [l for l in L if any(l['page_id'] == r['page_id'] and l['quote'] == r['quote'] for r in rs)]
        wrong = [r for r in rs if not r['correct']]
        P(f"| {g} | {len(rs)} | {wilson(sum(r['mark_loc'] for r in rs), len(rs))} | {wilson(len(wrong), len(rs))} | {wilson(sum(bool(r['mark_err']) for r in wrong), len(wrong))} | {wilson(sum(r['mark_loc'] or r['unclear_loc'] for r in rs), len(rs))} | {wilson(sum(l['unclear_loc'] for l in Ls), len(Ls))} |")
strat(D, lambda r: r['stratum'], 'stratum')
strat(D, lambda r: '#7611 carried' if r['outcome_7611'] == 'carried' else '#7611 repaired/dropped/other', '#7611 outcome')
# Accuracy at the spots, D vs L, paired.
pair = {(r['page_id'], r['quote'], r['image_reading']): r for r in L}
b = c = both = neither = 0
for r in D:
    l = pair.get((r['page_id'], r['quote'], r['image_reading']))
    if not l: continue
    if r['correct'] and l['correct']: both += 1
    elif r['correct']: b += 1
    elif l['correct']: c += 1
    else: neither += 1
P(f"\n**Reads at the 109 spots.** L right {wilson(sum(r['correct'] for r in L), len(L))}; D right {wilson(sum(r['correct'] for r in D), len(D))}. Paired: both right {both}, only D {b}, only L {c}, neither {neither} (McNemar discordant {b} vs {c}).")
P(f"Same misread as the #7611 transcription: L {wilson(sum(r['same_misread'] for r in L), len(L))}, D {wilson(sum(r['same_misread'] for r in D), len(D))}.")
cw = [r for r in D if r['outcome_7611'] == 'carried']
P(f"Carried spots where D's own read is wrong: {sum(not r['correct'] for r in cw)}/{len(cw)}, marked {sum(bool(r['mark_err']) for r in cw if not r['correct'])}; carried spots D marks at all: {sum(r['mark_loc'] for r in cw)}/{len(cw)}.")
# Mark rate and gating rate.
def rates(keys):
    chars = marks = pages_marked = pages_mu = 0
    for k in keys:
        t = body(k['text']); chars += len(re.sub(r'<[^>]+>', '', t)); marks += len(k['marks'])
        pages_marked += bool(k['marks']); pages_mu += bool(k['marks'] or unclear_ranges(k['text']))
    return chars, marks, pages_marked, pages_mu, len(keys)
err_pages = {k['page_id'] for k in K.values() if k['spots']}
for label, ks in (('pages with confirmed errors', [k for k in K.values() if k['arm'] == 'D' and k['page_id'] in err_pages]),
                  ('pages with no confirmed error', [k for k in K.values() if k['arm'] == 'D' and k['page_id'] not in err_pages])):
    ch, mk, pm, pmu, n = rates(ks)
    P(f"D on {label}: {mk} marks in {ch} characters = {1000*mk/max(1,ch):.1f} per 1,000; pages with ≥1 mark {wilson(pm, n)}; with ≥1 mark or <unclear> {wilson(pmu, n)}.")
ks = [k for k in K.values() if k['arm'] == 'L']; ch, mk, pm, pmu, n = rates(ks)
P(f"L (live prompt) on pages with confirmed errors: pages with ≥1 <unclear> {wilson(pmu, n)}.")
mk_per_page = sorted((len(k['marks']), k['page_id'][:10]) for k in K.values() if k['arm'] == 'D')
P(f"Marks per D page (sorted): {[m for m, _ in mk_per_page]}")
# Precision: share of checked spans the judge says MATCH the page, by kind.
kinds = collections.defaultdict(lambda: [0, 0])
for key, k in K.items():
    res = J(key)
    if res is None or k['arm'] not in ('L', 'D'): continue
    for s, r in zip(k['spans'], res['spans']):
        kk = (k['arm'], s['kind']); kinds[kk][1] += 1; kinds[kk][0] += bool(r.get('matches_page'))
P('\n| arm | span kind | judge: transcription matches the page |\n|---|---|---|')
for kk in sorted(kinds): P(f"| {kk[0]} | {kk[1]} | {wilson(*kinds[kk])} |")
# Controls.
P('\n**Controls.**')
pl = [(kinds[(a, 'planted')]) for a in ('L', 'D')]
P(f"Planted one-character misreads caught (judge says no match): {sum(n - k for k, n in pl)}/{sum(n for k, n in pl)}.")
misses = []
for key, k in K.items():
    res = J(key)
    if res is None or k['arm'] not in ('L', 'D'): continue
    for s, r in zip(k['spans'], res['spans']):
        if s['kind'] == 'planted' and r.get('matches_page'): misses.append((key, k['planted'], r.get('page_reading')))
for m in misses: P(f"- missed plant {m[0]}: {m[1]['orig']} → {m[1]['planted']}; judge read {m[2]}")
for key in sorted(os.listdir(f'{S}/t1/judged')):
    key = key[:-5]
    if key.startswith('WRONG-'):
        res = J(key); k = K[key[6:]]
        P(f"- wrong-page {key}: spots judged matching {sum(bool(r.get('matches_page')) for r in res['spots'])}/{len(res['spots'])}; spans matching {sum(bool(r.get('matches_page')) for r in res['spans'])}/{len(res['spans'])}")
    if key.startswith('REP-'):
        a, b2 = J(key), J(key[4:])
        sa = sum(x.get('matches_page') == y.get('matches_page') for x, y in zip(a['spots'], b2['spots'])); sp = sum(x.get('matches_page') == y.get('matches_page') for x, y in zip(a['spans'], b2['spans']))
        P(f"- repeat {key}: spots agree {sa}/{len(a['spots'])}, spans agree {sp}/{len(a['spans'])}")
# Harm: text distance D vs L against L vs L2, on the body text with tags and marks removed.
def clean(f):
    t = N(json.load(open(f))['text']); t = re.sub(r'<(vocab|script|scan-quality|page-type|language|warning|meta|columns)>.*?</\1>', '', t, flags=re.S)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>|[⟦⟧]', '', t)).strip()
def dist(a, b):
    return 1 - difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
ids = json.load(open(f'{S}/t1/ids.json')); dl, ll2 = [], []
for pid in ids:
    try:
        l, l2, d = clean(f'{S}/t1/L/{pid}.json'), clean(f'{S}/t1/L2/{pid}.json'), clean(f'{S}/t1/D/{pid}.json')
    except FileNotFoundError: continue
    dl.append(dist(l, d)); ll2.append(dist(l, l2))
med = lambda x: sorted(x)[len(x) // 2]
P(f"\n**Harm, text distance** (1 − difflib ratio, body text, tags and marks removed; {len(dl)} pages): L vs L2 median {med(ll2):.3f} mean {sum(ll2)/len(ll2):.3f}; L vs D median {med(dl):.3f} mean {sum(dl)/len(dl):.3f}. D further from L than L2 is on {sum(a > b for a, b in zip(dl, ll2))}/{len(dl)} pages.")
fails = {a: sum(1 for f in os.listdir(f'{S}/t1/{a}-failed')) if os.path.isdir(f'{S}/t1/{a}-failed') else 0 for a in ('L', 'L2', 'D')}
P(f"Reads cut before <<<END>>> after the built-in re-read (first pass): {fails}.")
# Tokens per page.
for a in ('L', 'L2', 'D'):
    us = []
    for pid in ids:
        f = f'{S}/t1/{a}/{pid}.json'
        if not os.path.exists(f): continue
        u = json.load(open(f))['usage']; us.append([sum((x or {}).get(k) or 0 for x in u) for k in ('input', 'cache_read', 'output', 'thinking')])
    n = len(us); P(f"Tokens per page {a} ({n} pages): input {sum(x[0] for x in us)/n:.0f} + cache_read {sum(x[1] for x in us)/n:.0f}, output {sum(x[2] for x in us)/n:.0f}, thinking {sum(x[3] for x in us)/n:.0f}.")
print('\n'.join(out))
json.dump(rows, open(f'{S}/t1/spot-rows.json', 'w'), ensure_ascii=False)
