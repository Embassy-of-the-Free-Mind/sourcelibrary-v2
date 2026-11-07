#!/usr/bin/env python3
# PRIOR ART: call_signals.py (the L signal on the labelled, mostly Latin books); this measures the brief's B.4 candidates on
# the NATURAL Han/Tibetan set Opus judged (items/natural.jsonl), fit-half and held-out half reported apart, nothing fitted.
"""signals_natural.py FRAME.pkl NATURAL.jsonl NZQS_TEXT.json OUT.json"""
import sys, json, math
import pandas as pd, numpy as np
FR, NAT, NZ, OUT = sys.argv[1:5]
df = pd.read_pickle(FR)
text = (df.src >= 300) & (df.ty.fillna('text') == 'text') & (df.en > 0)
lr = np.log(df.en.clip(lower=1) / df.src.clip(lower=1))
df['res'] = lr - df.b.map(lr[text].groupby(df.b[text]).median())
df['Lp'] = (df.gsize >= 2) & (df.gpos < df.gsize - 1) & (df.src >= 300) & (df.res > 0.4)
first = df[df.Lp].groupby('grp').gpos.min()
df['afterL'] = df.gpos > df.grp.map(first)
idx = {(b, n): i for i, (b, n) in enumerate(zip(df.b, df.n))}
items = [json.loads(l) for l in open(NAT)]
held = {}
for f in ('zh', 'hanbo-L'):
    for l in open(f'{sys.argv[2].rsplit("/", 1)[0]}/{f}.jsonl'): r = json.loads(l); held[(r['book_id'], r['page'])] = r.get('half')
nz = {r['n']: r for r in json.load(open(NZ))}
rows = []
for it in items:
    k = (it['book_id'], it['page'])
    if it['y'] is None: continue
    if k in idx:
        r = df.iloc[idx[k]]
        h, tl, res, after, gsize = r.h, r.tl, r.res, bool(r.afterL), int(r.gsize)
    elif it['book_id'] == '6992cbd8018b80967354ba40':
        e = nz[it['page']]['en']; h, tl = e[:24], e[-24:]
        res, after, gsize = None, None, 5
    else: continue
    fam = 'Tibetan' if 'tibet' in str(it.get('language', '')).lower() else 'Han' if 'chin' in str(it.get('language', '')).lower() else 'other'
    rows.append({'y': it['y'], 'fam': fam, 'half': held.get(k, 'by-eye'), 'lead_ellipsis': h.lstrip().startswith(('...', '…')), 'trail_ellipsis': tl.rstrip().endswith(('...', '…')), 'res_gt_0.4': bool(res is not None and res > 0.4), 'res_lt_-0.4': bool(res is not None and res < -0.4), 'after_long_page_in_call': bool(after)})
def wilson(k, n, z=1.96):
    if not n: return None
    p = k / n; d = 1 + z*z/n; c = p + z*z/(2*n); h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return [int(k), int(n), round((c-h)/d, 3), round((c+h)/d, 3)]
out = {}
for fam in ('Han', 'Tibetan'):
    R = [r for r in rows if r['fam'] == fam]
    out[fam] = {s: {'recall': wilson(sum(r[s] for r in R if r['y'] == 1), sum(r['y'] == 1 for r in R)), 'false_flag': wilson(sum(r[s] for r in R if r['y'] == 0), sum(r['y'] == 0 for r in R))} for s in ('lead_ellipsis', 'trail_ellipsis', 'res_gt_0.4', 'res_lt_-0.4', 'after_long_page_in_call')}
json.dump(out, open(OUT, 'w'), indent=1); print(json.dumps(out, indent=1))
