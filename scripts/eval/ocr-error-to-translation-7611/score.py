#!/usr/bin/env python3
# Scores the #7611 "does the misread reach the English" judge: joins each judged spot to its adjudicated defect, and
# reports outcome shares with Wilson 95% CIs by stratum and class group. Read-only.
# PRIOR ART: scripts/eval/judge-compare-7611/run.mjs score (Wilson CIs) — different unit (spots, not verdicts) (#7611).
#   python3 score.py <scratch dir>   -> writes <scratch>/spots.json and prints the tables (markdown)
import json, glob, math, sys, collections
S = sys.argv[1].rstrip('/') + '/'
P = {p['id']: p for p in json.load(open(S + 'pages.json'))}
def wilson(k, n, z=1.96):
    if n == 0: return (0, 0, 0)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0, c - h), min(1, c + h))
def group(c):
    if c == 'O6': return 'O6 word change'
    if c == 'O5': return 'O5 dropped text'
    if c in ('O7', 'O11'): return 'O7/O11 numbers, titles, furniture'
    return 'other classes'
spots = []
for f in sorted(glob.glob(S + 'judged/*.json')):
    j = json.load(open(f)); key = j['key']
    if key.startswith('ctl-'): continue
    src, iid = key.split('-', 1)
    p = P[iid]
    defs = [d for d in p['defects'] if (d['in_source'] if src == 'live' else d['in_judged'])]
    for d, r in zip(defs, j['result']['spots']):
        spots.append({'item_id': iid, 'page_id': p['page_id'], 'book_id': p['book_id'], 'page_number': p['page_number'], 'english_from': 'live' if src == 'live' else 'flash-fill',
                      'provenance': p['provenance'] if src == 'live' else 'same (fresh Flash English of the judged text)', 'withheld': p['withheld'],
                      'stratum': p['stratum'], 'lang': p['lang'], 'opus_accept': p['opus_accept'], 'class': d['class'], 'group': group(d['class']), 'quote': d['quote'], **r})
json.dump(spots, open(S + 'spots.json', 'w'), ensure_ascii=False)
err = [s for s in spots if s['outcome'] != 'not_an_error' and not s['transcription_matches_image']]
print(f"judged spots {len(spots)} on {len({s['item_id'] for s in spots})} pages; judge says transcription matches image: {sum(s['transcription_matches_image'] for s in spots)}; outcome not_an_error: {sum(s['outcome']=='not_an_error' for s in spots)}")
print('all outcomes', collections.Counter(s['outcome'] for s in spots))
print(f"\nconfirmed errors (judge: transcription differs from the image): {len(err)}\n")
OUT = ['carried', 'repaired', 'dropped', 'other']
def table(by, rows, title):
    print(f"| {title} | n | carried | repaired | dropped | other | reader loses (misleads + wrong_text) |\n|---|---:|---|---|---|---:|---|")
    keys = sorted({by(s) for s in rows}, key=lambda k: -sum(by(s) == k for s in rows))
    for k in keys + ['all']:
        rs = rows if k == 'all' else [s for s in rows if by(s) == k]
        n = len(rs); c = collections.Counter(s['outcome'] for s in rs)
        def cell(o):
            p, lo, hi = wilson(c[o], n); return f"{c[o]} ({p:.0%}, {lo:.0%}–{hi:.0%})"
        bad = sum(s['severity'] in ('misleads', 'wrong_text') for s in rs); p, lo, hi = wilson(bad, n)
        print(f"| {'**all**' if k=='all' else k} | {n} | {cell('carried')} | {cell('repaired')} | {cell('dropped')} | {c['other']} | {bad} ({p:.0%}, {lo:.0%}–{hi:.0%}) |")
    print()
table(lambda s: s['stratum'], err, 'stratum')
table(lambda s: s['group'], err, 'class')
table(lambda s: 'Opus passed the page' if s['opus_accept'] else 'Opus failed the page', err, 'Opus verdict')
table(lambda s: s['english_from'] + ' / ' + s['provenance'], err, 'English made from')
print('severity of carried:', collections.Counter(s['severity'] for s in err if s['outcome'] == 'carried'))
print('carried with a translator note:', sum(bool(s.get('note')) for s in err if s['outcome'] == 'carried'), 'repaired with a note:', sum(bool(s.get('note')) for s in err if s['outcome'] == 'repaired'))
print('pages with >=1 carried error that misleads/wrong_text:', len({s['item_id'] for s in err if s['outcome'] == 'carried' and s['severity'] in ('misleads', 'wrong_text')}), 'of', len({s['item_id'] for s in err}))
