#!/usr/bin/env python3
"""triggers.py — #7263 amendment 1 §2: escalation triggers known before any Opus read, and the blended route.

PRIOR ART: none for escalation in this repo's evals (searched scripts/eval for 'escalat' and 'trigger': the router
frames route whole cells, route-judge-6740/judge.mjs; #6740's diffqa reverts spans, it does not route pages). The word
alignment is d-diff.mjs's idea (folded words, ſ→s, punctuation off), done here with difflib on the same keys.

  triggers.py <J> <set> <cheap arm> [--ref=O] [--out=FILE]
For each TEST page: T1 X↔Y draft disagreement (share of X words not matched), T2 cheap arm CONTAIN / no answer,
T3 change size (share of X words the cheap arm did not keep), T4 page kind from the cheap arm's tags, T5 language.
Thresholds for T1/T3: the 80th and 90th percentiles of the set's own distribution (no labels used).
Per trigger: recall of the cheap arm's not-usable pages, escalation rate, and the blended route (flagged pages take
the ref arm's outcome) with its Wilson interval, per language and pooled.
"""
import difflib, json, math, os, re, sys, unicodedata

J, SET, CHEAP = sys.argv[1], sys.argv[2], sys.argv[3]
opt = dict(a[2:].split('=', 1) for a in sys.argv[4:] if a.startswith('--'))
REF = opt.get('ref', 'O')
base = os.path.join(J, f'judge-{SET}')
key = json.load(open(os.path.join(base, 'key.json')))
arms = key['arms']


def jl(p): return {(r.get('page_id') or r.get('slug')): r for r in (json.loads(l) for l in open(p) if l.strip())}


X = jl(os.path.join(J, 'drafts', 'X.jsonl')); Y = jl(os.path.join(J, 'drafts', 'Y.jsonl'))
TAGLINE = re.compile(r'^\s*<(scan-quality|language|script|page-type|vocab|meta|warning|columns|page-num|sig|header|image-desc)\b[^>]*>.*</\1>\s*$', re.I)


def words(t):
    t = '\n'.join(l for l in (t or '').split('\n') if not TAGLINE.match(l))
    t = re.sub(r'<[^>]+>', ' ', t)
    return [k for k in (re.sub(r'[^\w]', '', unicodedata.normalize('NFC', w).lower().replace('ſ', 's')) for w in t.split()) if k]


def unmatched(a, b):
    if not a: return 1.0
    m = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return 1 - sum(x.size for x in m.get_matching_blocks()) / len(a)


def cheap_json(s):
    f = os.path.join(J, arms[CHEAP], s + '.json')
    return json.load(open(f)) if os.path.exists(f) else None


def wilson(k, n, z=1.96):
    if n == 0: return (0, 1)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return ((c - r) / d, (c + r) / d)


rows = []
for s, k in key['pages'].items():
    if not k['labels'] or REF in k['missing'] or CHEAP in k['missing']: continue
    f = os.path.join(base, 'judge', 'out', f'{s}.json')
    v = (json.load(open(f)).get('verdict') or {}).get('versions') if os.path.exists(f) else None
    if not v: continue
    out = {}
    for lab, who in k['labels'].items():
        for a in who: out[a] = bool(v[lab].get('usable'))
    for a in k['not_delivered']: out[a] = False
    cj = cheap_json(s) or {}; fin = cj.get('final') or ''
    xw = words(draft_text := (X.get(s, {}).get('text') or '')); yw = words(Y.get(s, {}).get('text') or '')
    tags = fin
    t4 = bool(re.search(r'<page-type>(?!text<)', tags) or '<columns>' in tags or '<margin>' in tags or re.search(r'^\|.*\|\s*$', tags, re.M) or '<warning>' in tags)
    rows.append({'slug': s, 'lang': k['lang'], 'cheap_ok': out[CHEAP], 'ref_ok': out[REF], 't1': unmatched(xw, yw),
                 't2': cj.get('outcome') in ('contain', 'no-answer') or not fin, 't3': unmatched(xw, words(fin)) if fin else 1.0, 't4': t4})


def pct(vals, q):
    v = sorted(vals); return v[min(len(v) - 1, int(q * len(v)))]


T1_80, T1_90 = pct([r['t1'] for r in rows], 0.8), pct([r['t1'] for r in rows], 0.9)
T3_80, T3_90 = pct([r['t3'] for r in rows], 0.8), pct([r['t3'] for r in rows], 0.9)
TRIG = {
    'T1>=p80': lambda r: r['t1'] >= T1_80, 'T1>=p90': lambda r: r['t1'] >= T1_90,
    'T2 contain/no-answer': lambda r: r['t2'],
    'T3>=p80': lambda r: r['t3'] >= T3_80, 'T3>=p90': lambda r: r['t3'] >= T3_90,
    'T4 page kind': lambda r: r['t4'],
    'T1p90|T2|T4': lambda r: r['t1'] >= T1_90 or r['t2'] or r['t4'],
    'T1p80|T2|T3p90': lambda r: r['t1'] >= T1_80 or r['t2'] or r['t3'] >= T3_90,
}
res = {'cheap': CHEAP, 'ref': REF, 'thresholds': {'T1_p80': T1_80, 'T1_p90': T1_90, 'T3_p80': T3_80, 'T3_p90': T3_90}, 'cells': {}}
for lang in ['la', 'en', 'de', 'all']:
    rs = [r for r in rows if lang == 'all' or r['lang'] == lang]
    if not rs: continue
    n = len(rs); bad = [r for r in rs if not r['cheap_ok']]
    c = {'n': n, 'cheap_usable': n - len(bad), 'ref_usable': sum(r['ref_ok'] for r in rs), 'triggers': {}}
    for name, t in TRIG.items():
        fl = [r for r in rs if t(r)]
        blended = sum((r['ref_ok'] if t(r) else r['cheap_ok']) for r in rs)
        c['triggers'][name] = {'flagged': len(fl), 'escalation_rate': round(len(fl) / n, 3), 'caught_bad': sum(1 for r in bad if t(r)), 'bad': len(bad),
                               'recall': round(sum(1 for r in bad if t(r)) / len(bad), 3) if bad else None, 'blended_usable': blended, 'blended_ci': wilson(blended, n)}
    res['cells'][lang] = c
json.dump({**res, 'pages': rows}, open(opt.get('out', os.path.join(base, f'triggers-{CHEAP}.json')), 'w'), indent=1)
print('thresholds', {k: round(v, 3) for k, v in res['thresholds'].items()})
for lang, c in res['cells'].items():
    print(f"== {lang} n {c['n']}: cheap {CHEAP} usable {c['cheap_usable']}, {REF} usable {c['ref_usable']}")
    for name, t in c['triggers'].items():
        print(f"   {name:16s} esc {t['escalation_rate']*100:5.1f}%  caught {t['caught_bad']}/{t['bad']}  blended usable {t['blended_usable']}/{c['n']} ({100*t['blended_ci'][0]:.0f}–{100*t['blended_ci'][1]:.0f}%)")
