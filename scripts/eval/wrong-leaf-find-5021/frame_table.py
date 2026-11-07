#!/usr/bin/env python3
# PRIOR ART: none for this table — frame.py's output summarised; the risk score (leaf-shift-risk-5021.mjs) has no write groups.
"""frame_table.py FRAME.pkl OUT.json — translated pages by language: written alone, in a multi-page write group, and in
an all-identical-stamp group of more than 10 pages (Batch collector: one `now` per job of single-page requests)."""
import sys, json, re
import pandas as pd
df = pd.read_pickle(sys.argv[1])
coll = df.gsame & (df.gsize > 10)
df['frame'] = 'multi'; df.loc[df.gsize == 1, 'frame'] = 'single'; df.loc[coll, 'frame'] = 'collector'
def fam(l):
    l = str(l).lower()
    for k, v in [('chinese', 'Chinese'), ('tibetan', 'Tibetan'), ('japanese', 'Japanese'), ('korean', 'Korean'), ('sanskrit', 'Sanskrit'), ('latin', 'Latin'), ('german', 'German'), ('greek', 'Greek'), ('french', 'French'), ('italian', 'Italian'), ('english', 'English'), ('dutch', 'Dutch'), ('russian', 'Russian'), ('arabic', 'Arabic'), ('hebrew', 'Hebrew'), ('spanish', 'Spanish'), ('persian', 'Persian')]:
        if l.startswith(k): return v
    return 'other'
df['fam'] = df.lang.map(fam)
t = pd.crosstab(df.fam, df.frame); t['total'] = t.sum(axis=1); t['multi_share'] = (t.multi / t.total).round(3)
t = t.sort_values('total', ascending=False)
print(t.to_string()); print('ALL', t[['collector', 'multi', 'single', 'total']].sum().to_dict())
json.dump({'by_language': t.reset_index().to_dict(orient='records'), 'all': {k: int(v) for k, v in t[['collector', 'multi', 'single', 'total']].sum().items()}}, open(sys.argv[2], 'w'), indent=1)
