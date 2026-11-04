#!/usr/bin/env python3
# PRIOR ART: block-page-guard.mjs blockAbsorptions (|own| > 0.5 and |two| < 0.2, per call at write time) and
# leaf-shift.mjs absorptionsOf (the same per book, with number/name corroboration). Both need the next page's source
# length to match; this measures the looser CALL-level shape onset.py found (one long page before the call's end, the
# call's final page re-read alone) on stored data, in any script.
"""
call_signals.py LABELS.jsonl FRAME.pkl OUT.json
Per write group of 2-8 pages: L = some page before the last has log(EN/SRC) - k > THR (k: the book's median over text
pages with SRC >= 300); T = the page after the group was written alone 0-60 s after the group. Positives: labelled groups
whose slide starts inside (onset.py); negatives: groups of the same books with no page labelled other than own.
Frame rates of L, T, L|T by language family on the whole library (FRAME.pkl).
"""
import sys, json, math, statistics, collections
import pandas as pd, numpy as np
LAB, FR, OUT = sys.argv[1:4]
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z*z/n; c = p + z*z/(2*n); h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return [k, n, round(p, 3), round((c-h)/d, 3), round((c+h)/d, 3)]
res = {}
for THR in (0.3, 0.4, 0.5):
    pos = collections.Counter(); neg = collections.Counter(); P = N = 0
    for l in open(LAB):
        b = json.loads(l)
        ps = sorted([p for p in b['pages'] if p.get('t') is not None], key=lambda p: p['n'])
        rr = [math.log(max(1, p['en']) / p['src']) for p in ps if p['src'] >= 300 and (p.get('ty') or 'text') == 'text']
        if len(rr) < 5: continue
        k = statistics.median(rr)
        groups, cur = [], []
        for p in ps:
            if cur and p['n'] == cur[-1]['n'] + 1 and abs(p['t'] - cur[-1]['t']) <= 2000: cur.append(p)
            else:
                if cur: groups.append(cur)
                cur = [p]
        if cur: groups.append(cur)
        gsz = {p['n']: len(g) for g in groups for p in g}; by = {p['n']: p for p in ps}
        for g in groups:
            if not 2 <= len(g) <= 8: continue
            ys = [p.get('y') for p in g]
            L = any(p['src'] >= 300 and math.log(max(1, p['en']) / p['src']) - k > THR for p in g[:-1])
            nx = by.get(g[-1]['n'] + 1)
            T = bool(nx and gsz.get(nx['n']) == 1 and 0 < (nx['t'] - g[-1]['t']) / 1000 <= 60)
            if 'next' in ys and ys.index('next') > 0:
                P += 1; pos['L'] += L; pos['T'] += T; pos['L|T'] += L or T
            elif all(y in (None, 'own') for y in ys):
                N += 1; neg['L'] += L; neg['T'] += T; neg['L|T'] += L or T
    res[f'thr{THR}'] = {s: {'recall': wilson(pos[s], P), 'flag_rate_clean_groups': wilson(neg[s], N)} for s in ('L', 'T', 'L|T')}
# Library frame rates (THR 0.4): groups of 2-8 pages, all books.
df = pd.read_pickle(FR)
df = df[(df.gsize >= 2) & (df.gsize <= 8) | (df.gsize == 1)]
text = (df.src >= 300) & (df.ty.fillna('text') == 'text') & (df.en > 0)
lr = np.log(df.en.clip(lower=1) / df.src.clip(lower=1))
k = lr[text].groupby(df.b[text]).median()
df['res'] = lr - df.b.map(k)
df['notlast'] = df.gpos < df.gsize - 1
df['L'] = (df.gsize >= 2) & df.notlast & (df.src >= 300) & (df.res > 0.4)
g = df[df.gsize >= 2].groupby('grp').agg(b=('b', 'first'), lang=('lang', 'first'), n_last=('n', 'max'), t_last=('t', 'max'), L=('L', 'any'), size=('n', 'size'))
sg = df[df.gsize == 1]
single = dict(zip(zip(sg.b, sg.n), sg.t))  # a dict: (book, n) can repeat in the frame (two pages share a number)
nxt = np.array([single.get(key, np.nan) for key in zip(g.b, g.n_last + 1)], dtype=float)
g['T'] = (nxt - g.t_last.values > 0) & (nxt - g.t_last.values <= 60000)
fam = lambda s: next((v for kk, v in [('chinese', 'Chinese'), ('tibetan', 'Tibetan'), ('japanese', 'Japanese'), ('korean', 'Korean'), ('latin', 'Latin'), ('german', 'German'), ('greek', 'Greek'), ('french', 'French'), ('english', 'English'), ('italian', 'Italian'), ('russian', 'Russian'), ('sanskrit', 'Sanskrit'), ('hebrew', 'Hebrew'), ('arabic', 'Arabic')] if str(s).lower().startswith(kk)), 'other')
g['fam'] = g.lang.map(fam)
t = g.groupby('fam').agg(groups=('L', 'size'), pages=('size', 'sum'), L=('L', 'mean'), T=('T', 'mean'))
t['L|T'] = g.assign(x=g.L | g['T']).groupby('fam').x.mean()
res['library_groups_2_8_thr0.4'] = t.round(4).reset_index().to_dict(orient='records')
res['library_all'] = {'groups': int(len(g)), 'pages': int(g['size'].sum()), 'L': round(float(g.L.mean()), 4), 'T': round(float(g['T'].mean()), 4), 'L|T': round(float((g.L | g['T']).mean()), 4), 'pages_in_L|T_groups': int(g[g.L | g['T']]['size'].sum())}
json.dump(res, open(OUT, 'w'), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != 'library_groups_2_8_thr0.4'}, indent=1)); print(t.round(3).to_string())
