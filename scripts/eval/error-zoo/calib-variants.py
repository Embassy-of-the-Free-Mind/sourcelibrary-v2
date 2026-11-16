#!/usr/bin/env python3
"""PRIOR ART: scripts/eval/error-zoo/calib-score.py (V0 here; it reports kappa under one rule and has no weighted score or rule variants).
Re-score the calibration set (#6420) under softer severity rules, no new reads.
Same loaders and critical definition as scripts/eval/error-zoo/calib-score.py.
Variants (each per page, then kappa between readers and re-read pairs):
  V0 current: any serious finding, or right_page no
  V1 sure only: drop findings marked sure:false
  V2 self-flagging demoted: a serious finding whose own explanation says the misreading is visibly broken
     (non-word, garbled, nonsense...) counts as major, not critical
  V3 = V1 + V2
  V4 two or more criticals on the page (V3 rules)
Also an MQM-style weighted score per 1,000 words (critical 25, major/moderate 5, minor 0; V3 rules) and the
Spearman correlation of that score between readers.
"""
import json, os, glob, re, math, collections as C
import sys
CAL = sys.argv[1] if len(sys.argv) > 1 else '/root/jobs/calibration-6420'
OUT = sys.argv[2] if len(sys.argv) > 2 else None
key = {k['packet']: k for k in (json.loads(l) for l in open(f'{CAL}/key.jsonl'))}

def load(run, name):
    rv = {}
    for f in glob.glob(f'{CAL}/runs/{run}/readers/{name}/reviews/*.json'):
        try: recs = json.load(open(f))
        except Exception: continue
        if isinstance(recs, list) and recs and recs[0].get('pages'):
            rv[os.path.basename(f)[:-5]] = recs[0]['pages'][0]
    return rv
def errs(p): return [*({**e, '_pane': 'ocr'} for e in (p.get('ocr_errors') or [])), *(p.get('tr_errors') or []), *(p.get('other') or [])]

SELF = re.compile(r"non-?word|not a (real )?word|no such word|not a .{0,20}word|nonsens|garbl|gibberish|meaningless|"
                  r"unreadable|obvious(ly)? (typo|misread|error)|visibly (wrong|broken)|reader (would|will|can) (see|notice|spot)|"
                  r"self-evident|clearly (a )?(typo|misread)|not a valid|unintelligible|broken (word|form|text)", re.I)
NARROW = re.compile(r"non-?word|not a (real )?word|no such word|meaningless|nonsens|gibberish|unintelligible", re.I)
def self_flag(e):  # OCR pane only: the transcription shows a visibly broken form. Fluent English over it (T7) stays critical.
    return e.get('_pane') == 'ocr' and bool(NARROW.search(str(e.get('problem') or ''))) and not re.search(r'drop|omit|missing|invent', str(e.get('problem') or ''), re.I)

def ncrit(p, sure=False, demote=False):
    n = 0
    for e in errs(p):
        if e.get('severity') != 'serious': continue
        if sure and e.get('sure') is False: continue
        if demote and self_flag(e): continue
        n += 1
    return n
def crit(p, **kw): return int(p.get('right_page') == 'no' or ncrit(p, **kw) > 0)
def crit2(p): return int(p.get('right_page') == 'no' or ncrit(p, sure=True, demote=True) >= 2)

HAN = re.compile(r'[㐀-鿿豈-﫿]')
def words(t):
    t = re.sub(r'<[^>]*>', ' ', t or '')
    h = len(HAN.findall(t))
    return h / 1.5 if h > len(t) / 3 else len([x for x in t.split() if re.search(r'\w', x)])
W = {}
for f in glob.glob(f'{CAL}/packets/p*.json'):
    pk = os.path.basename(f)[:-5]
    try: W[pk] = max(1, words(json.load(open(f))[0]['pages'][0].get('ocr')))
    except Exception: pass
def mqm(p, pk):
    s = 0
    if p.get('right_page') == 'no': s += 25
    for e in errs(p):
        sev = e.get('severity')
        if sev == 'serious':
            s += 5 if (e.get('sure') is False or self_flag(e)) else 25
        elif sev == 'moderate': s += 5
    return 1000 * s / W.get(pk, 300)

def kappa(a, b):
    n = len(a); po = sum(x == y for x, y in zip(a, b)) / n
    pe = sum((a.count(c) / n) * (b.count(c) / n) for c in set(a) | set(b))
    return (po - pe) / (1 - pe) if pe < 1 else float('nan')
def rank(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0] * len(v); i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]: j += 1
        for k in range(i, j + 1): r[o[k]] = (i + j) / 2
        i = j + 1
    return r
def spearman(a, b):
    ra, rb = rank(a), rank(b); n = len(a); ma, mb = sum(ra) / n, sum(rb) / n
    c = sum((x - ma) * (y - mb) for x, y in zip(ra, rb)); return c / math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))

R = {'opus': load('rubric', 'opus-rubric'), 'gem': load('rubric', 'gem-rubric'),
     'opus-r2': load('rubric-retest', 'opus-rubric-r2'), 'gem-r2': load('rubric-retest', 'gem-rubric-r2')}
V = {'V0 current': lambda p: crit(p), 'V1 sure only': lambda p: crit(p, sure=True),
     'V2 self-flagging demoted': lambda p: crit(p, demote=True), 'V3 sure + demoted': lambda p: crit(p, sure=True, demote=True),
     'V4 two+ criticals (V3)': crit2}
PAIRS = [('opus', 'gem', 'AB', 'Opus vs Gemini'), ('opus', 'opus-r2', None, 'Opus re-read'), ('gem', 'gem-r2', None, 'Gemini re-read')]

# span-level tallies
tally = C.Counter()
for rd in ('opus', 'gem'):
    for pk, p in R[rd].items():
        if key[pk]['block'] not in 'AB': continue
        for e in errs(p):
            if e.get('severity') == 'serious':
                tally[(rd, 'serious')] += 1; tally[(rd, 'unsure')] += e.get('sure') is False; tally[(rd, 'self-flag')] += self_flag(e)
print('serious spans, blocks A+B:', {f'{a} {b}': v for (a, b), v in sorted(tally.items())})

print('\n| rule | Opus critical rate | Gemini critical rate | Opus vs Gemini κ | Opus re-read κ | Gemini re-read κ |')
print('|---|---|---|---|---|---|')
for name, f in V.items():
    cells = []
    for a, b, blocks, _ in PAIRS:
        ps = [p for p in R[a] if p in R[b] and (not blocks or key[p]['block'] in blocks)]
        ca = [f(R[a][p]) for p in ps]; cb = [f(R[b][p]) for p in ps]
        cells.append((len(ps), sum(ca) / len(ps), sum(cb) / len(ps), kappa(ca, cb)))
    n, ra, rb, k = cells[0]
    print(f'| {name} | {ra:.0%} | {rb:.0%} | {k:.2f} (n {n}) | {cells[1][3]:.2f} (n {cells[1][0]}) | {cells[2][3]:.2f} (n {cells[2][0]}) |')

# consensus: a page is critical only if both families say so (V3 rules)
ps = [p for p in R['opus'] if p in R['gem'] and key[p]['block'] in 'AB']
f = V['V3 sure + demoted']
both = sum(f(R['opus'][p]) and f(R['gem'][p]) for p in ps); either = sum(f(R['opus'][p]) or f(R['gem'][p]) for p in ps)
print(f'\nconsensus (V3, both readers): {both}/{len(ps)} = {both/len(ps):.0%}; either reader: {either}/{len(ps)} = {either/len(ps):.0%}; disagreements {either-both}')
for s in ('random', 'top'):
    q = [p for p in ps if key[p]['stratum'] == s]
    print(f'  {s}: both {sum(f(R["opus"][p]) and f(R["gem"][p]) for p in q)}/{len(q)}, opus {sum(f(R["opus"][p]) for p in q)}, gem {sum(f(R["gem"][p]) for p in q)}, V0 opus {sum(V["V0 current"](R["opus"][p]) for p in q)}, V0 gem {sum(V["V0 current"](R["gem"][p]) for p in q)}')

print('\nMQM-style weighted score per 1,000 words (critical 25, major 5; V3 rules), Spearman between readers:')
for a, b, blocks, label in PAIRS:
    q = [p for p in R[a] if p in R[b] and (not blocks or key[p]['block'] in blocks)]
    ma = [mqm(R[a][p], p) for p in q]; mb = [mqm(R[b][p], p) for p in q]
    print(f'  {label}: ρ {spearman(ma, mb):.2f} (n {len(q)}); mean {sum(ma)/len(q):.0f} vs {sum(mb)/len(q):.0f} per 1k')
rnd = [p for p in ps if key[p]['stratum'] == 'random']
for rd in ('opus', 'gem'):
    tot = sum(mqm(R[rd][p], p) * W.get(p, 300) / 1000 for p in rnd); w = sum(W.get(p, 300) for p in rnd)
    print(f'  random stratum, {rd}: {1000*tot/w:.1f} weighted points per 1k words over {len(rnd)} pages')

# the self-flag spans, for reading
out = [dict(rd=rd, pk=pk, sure=e.get('sure'), cls=e.get('class'), problem=str(e.get('problem'))[:220])
       for rd in ('opus', 'gem') for pk, p in R[rd].items() if key[pk]['block'] in 'AB'
       for e in errs(p) if e.get('severity') == 'serious' and self_flag(e)]
json.dump(out, open(OUT or f'{CAL}/selfflag-spans.json', 'w'), ensure_ascii=False, indent=0)
print('self-flag spans written:', len(out))
