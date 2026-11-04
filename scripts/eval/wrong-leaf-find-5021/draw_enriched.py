#!/usr/bin/env python3
# PRIOR ART: draw.py (uniform draws from the write-group frame); call_signals.py (the L signal). This draws where L says a
# slide could have started, to collect NATURAL Han and Tibetan positives (B.3), not a rate.
"""
draw_enriched.py FRAME.pkl EXCLUDE.jsonl,… OUT.jsonl — seeded (50214) pages from Chinese (400) and Tibetan (100) write
groups of 2-8 pages that hold an over-long page (log(EN/SRC) - k > 0.4, not the group's last): the page right after it
and one later page of the same group, at most 2 pages a book; half 'fit' / 'held' by book. Not a rate sample.
"""
import sys, json
import pandas as pd, numpy as np
FR, EXC, OUT = sys.argv[1:4]
excl = set()
for f in EXC.split(','):
    for l in open(f): r = json.loads(l); excl.add((r['book_id'], r['page']))
df = pd.read_pickle(FR)
df = df[df.lang.str.contains('chinese|tibetan', case=False, regex=True)].copy()
text = (df.src >= 300) & (df.ty.fillna('text') == 'text') & (df.en > 0)
lr = np.log(df.en.clip(lower=1) / df.src.clip(lower=1))
df['res'] = lr - df.b.map(lr[text].groupby(df.b[text]).median())
df = df[(df.gsize >= 2) & (df.gsize <= 8)]
df['Lp'] = (df.gpos < df.gsize - 1) & (df.src >= 300) & (df.res > 0.4)
first = df[df.Lp].groupby('grp').gpos.min()
df['after'] = df.gpos > df.grp.map(first)
cand = df[df.after & (df.en >= 200) & (df.wh == 0)]
cand = cand[[(b, n) not in excl for b, n in zip(cand.b, cand.n)]]
rng = np.random.default_rng(50214)
out = []
for fam, n in (('chinese', 400), ('tibetan', 100)):
    c = cand[cand.lang.str.contains(fam, case=False)].sample(frac=1, random_state=50214)
    c = c[c.groupby('b').cumcount() < 2].head(n)
    books = sorted(set(c.b)); rng.shuffle(books); held = set(books[: len(books) // 2])
    for r in c.itertuples(): out.append({'book_id': r.b, 'page': int(r.n), 'arm': f'{fam}-L', 'half': 'held' if r.b in held else 'fit', 'language': r.lang, 'model': r.m if isinstance(r.m, str) else None, 'gsize': int(r.gsize), 'gpos': int(r.gpos)})
    print(fam, 'candidates', int(cand.lang.str.contains(fam, case=False).sum()), 'drawn', len(c), 'books', len(books))
with open(OUT, 'w') as f:
    for r in out: f.write(json.dumps(r) + '\n')
