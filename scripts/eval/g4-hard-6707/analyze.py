#!/usr/bin/env python3
# PRIOR ART: ocr-pareto-6293/analyze-cli-effort.py — same seeded bootstrap and paired stats; this adds the chart's 1 - mean CER accuracy and the Amendment 4 decision rule per panel.
# Amendment 4.1 (#6707): G4L vs stored comparators on one panel. Accuracy = 1 - mean capped CER over scored pages
# (the chart's measure); a failed read (ONE FAILURE RULE) is counted, not scored. Paired on pages both answered:
# median delta CER (G4L - other; negative = G4L better), 2,000-resample bootstrap seeded as analyze-cli-effort.py.
import json, sys, statistics as st, hashlib, random, math
panel, g4file, out = sys.argv[1:4]
CFG = {
 'syr-ms':  dict(chart='syriac', thr=0.010, ref38='gemini-3.8-flash+antigravity-cli', best='sophro-defaultseg', flash3='gemini-3-flash-preview', prod='gemini-3.1-flash-lite'),
 'syr-print': dict(chart='syriac-print', thr=0.018, ref38='gemini-3.8-flash+antigravity-cli', best='omnisyr', flash3=None, prod='omnisyr'),
 'zh-ms':   dict(chart='chinese-manuscript', thr=0.010, ref38='gemini-3.8-flash+antigravity-cli', best='paddleocr-vl-1.6', flash3='gemini-3-flash-preview', prod='gemini-3.1-flash-lite'),
 'greek':   dict(chart='greek', thr=0.010, ref38='gemini-3.8-flash+antigravity-cli', best='gemini-3.7-flash+antigravity-cli', flash3='gemini-3-flash-preview', prod='gemini-3-flash-preview'),
 'greekalt': dict(chart='greek', thr=0.010, ref38='gemini-3.8-flash+antigravity-cli', best='gemini-3.7-flash+antigravity-cli', flash3='gemini-3-flash-preview', prod='gemini-3-flash-preview'),
 'zh-print':dict(chart='chinese-print', thr=0.010, ref38='gemini-3.8-flash+antigravity-cli', best='qwen3-vl-8b', flash3='gemini-3-flash-preview', prod='gemini-3.1-flash-lite'),
}[panel]
S = '/mnt/HC_Volume_105839809/jobs/g4-hard2-6707'
G4 = 'gemini-4-argon-low+antigravity-cli'
rows = json.load(open(f'{S}/an/rows-main.json'))[CFG['chart']]
g4 = json.load(open(g4file))           # {page: {cer|None, failure|None, unit}}
pages = sorted(g4)
unit = {p: g4[p].get('unit', p) for p in pages}
by = {}
for r in rows:
    if r['page'] in g4: by.setdefault(r['engine'], {})[r['page']] = {'cer': r['cer'], 'failure': r['failure']}
by[G4] = {p: {'cer': g4[p]['cer'], 'failure': g4[p]['failure']} for p in pages}
def seed(*k): return int(hashlib.sha256('|'.join(k).encode()).hexdigest()[:12], 16)
def boot(xs, s, f):
    rnd = random.Random(s); bs = sorted(f(rnd.choices(xs, k=len(xs))) for _ in range(2000)); return [round(bs[49], 4), round(bs[1949], 4)]
def acc_ci(e):
    sc = {p: v['cer'] for p, v in by[e].items() if v['cer'] is not None}
    groups = {}
    for p, c in sc.items(): groups.setdefault(unit[p], []).append(c)
    G = list(groups.values()); rnd = random.Random(seed(panel, e, 'acc')); bs = []
    for _ in range(2000):
        xs = [c for g in rnd.choices(G, k=len(G)) for c in g]; bs.append(1 - st.mean(xs))
    bs.sort()
    fails = {}
    for v in by[e].values():
        if v['failure']: fails[v['failure']] = fails.get(v['failure'], 0) + 1
    return {'n_read': len(by[e]), 'n_scored': len(sc), 'accuracy': round(1 - st.mean(sc.values()), 3) if sc else None,
            'ci95': [round(bs[49], 3), round(bs[1949], 3)] if sc else None, 'failures': fails,
            'median_cer': round(st.median(sc.values()), 4) if sc else None}
def sign_p(w, l):
    n = w + l; return None if not n else round(min(1.0, 2 * sum(math.comb(n, i) for i in range(min(w, l) + 1)) / 2 ** n), 4)
def paired(x, y):
    a, b = by[x], by.get(y, {})
    both = [p for p in pages if p in a and p in b and a[p]['cer'] is not None and b[p]['cer'] is not None]
    if not both: return None
    d = [a[p]['cer'] - b[p]['cer'] for p in both]; w, l = sum(v < 0 for v in d), sum(v > 0 for v in d)
    md = st.median(d); c = boot(d, seed(panel, x, y), st.median)
    verdict = 'better' if c[1] < 0 and abs(md) > CFG['thr'] else 'worse' if c[0] > 0 and abs(md) > CFG['thr'] else 'same'
    return {'n': len(both), 'wins': w, 'losses': l, 'ties': len(d) - w - l, 'median_delta': round(md, 4), 'median_delta_ci95': c,
            'mean_delta': round(st.mean(d), 4), 'mean_delta_ci95': boot(d, seed(panel, x, y) + 1, st.mean), 'sign_p': sign_p(w, l), 'verdict': verdict}
res = {'panel': panel, 'chart': CFG['chart'], 'n_pages': len(pages), 'noise_floor': CFG['thr'], 'comparators': CFG, 'arms': {}, 'paired': {}}
for e in sorted(by, key=lambda e: -(acc_ci(e)['accuracy'] or -1)):
    if len(by[e]) == len(pages): res['arms'][e] = acc_ci(e)
for k in ('ref38', 'best', 'flash3', 'prod'):
    y = CFG[k]
    if y and y in by and (k in ('ref38', 'best') or y not in (CFG['ref38'], CFG['best'])): res['paired'][f'{k}:{y}'] = paired(G4, y)
json.dump(res, open(out, 'w'), indent=1)
print(json.dumps({'arms': {e: (v['accuracy'], v['ci95'], v['n_scored'], v['failures']) for e, v in list(res['arms'].items())[:8]},
                  'paired': {k: v and (v['median_delta'], v['median_delta_ci95'], f"{v['wins']}/{v['losses']}/{v['ties']}", v['verdict']) for k, v in res['paired'].items()}}, indent=1))
