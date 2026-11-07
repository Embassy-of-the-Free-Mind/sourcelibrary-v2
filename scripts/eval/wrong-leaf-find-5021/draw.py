#!/usr/bin/env python3
# PRIOR ART: scripts/eval/shift-screen-5021/gate-items.mjs / select-screen.mjs (draw items for leaf-shift-screen-5021
# build from the risk score); this draws from the write-group frame (frame.py) instead, which the risk score lacks.
"""
draw.py FRAME.pkl OUT_DIR — seeded (5021) items for scripts/audit/leaf-shift-screen-5021.mjs build:
  single.jsonl   500 pages, uniform over pages written ALONE (no neighbour written within 2 s): the control (B.2)
  zh.jsonl       300 pages from Chinese books written in multi-page groups (B.3): 200 from gemini-3.1-flash-lite-preview
                 groups of 6-20 pages, 100 from the other multi-page Chinese writes; at most 2 pages a book; each item
                 carries half: 'fit' or 'held' by book (sealed held-out half, seeded).
Pages need both neighbours translated-or-transcribed in the frame (n-1, n+1 present) and English >= 200 chars.
"""
import sys, json, os
import pandas as pd, numpy as np
df = pd.read_pickle(sys.argv[1]); OUT = sys.argv[2]; os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(5021)
key = set(zip(df.b, df.n))
ok = df.apply(lambda r: (r.b, r.n - 1) in key and (r.b, r.n + 1) in key, axis=1) if len(df) < 0 else None
df['nb'] = [((b, n - 1) in key and (b, n + 1) in key) for b, n in zip(df.b, df.n)]
base = df[df.nb & (df.en >= 200) & (df.wh == 0) & (df.hu == 0)]
collector = base.gsame & (base.gsize > 10)
single = base[base.gsize == 1]
s = single.sample(500, random_state=5021)
with open(f'{OUT}/single.jsonl', 'w') as f:
    for r in s.itertuples(): f.write(json.dumps({'book_id': r.b, 'page': int(r.n), 'arm': 'single', 'language': r.lang, 'model': r.m if isinstance(r.m, str) else None, 'pv': r.pv if isinstance(r.pv, str) else None}) + '\n')
zh = base[base.lang.str.contains('chinese', case=False) & (base.gsize > 1) & ~collector]
a = zh[(zh.m == 'gemini-3.1-flash-lite-preview') & zh.gsize.between(6, 20)]
b = zh.drop(a.index)
def take(frame, n, seed):
    frame = frame.sample(frac=1, random_state=seed)
    frame = frame[frame.groupby('b').cumcount() < 2]
    return frame.head(n)
pa, pb = take(a, 200, 1), take(b, 100, 2)
books = sorted(set(pa.b) | set(pb.b)); rng.shuffle(books)
held = set(books[: len(books) // 2])
with open(f'{OUT}/zh.jsonl', 'w') as f:
    for arm, fr in (('zh-preview-6-20', pa), ('zh-other-multi', pb)):
        for r in fr.itertuples(): f.write(json.dumps({'book_id': r.b, 'page': int(r.n), 'arm': arm, 'half': 'held' if r.b in held else 'fit', 'language': r.lang, 'model': r.m if isinstance(r.m, str) else None, 'pv': r.pv if isinstance(r.pv, str) else None, 'gsize': int(r.gsize), 'gpos': int(r.gpos)}) + '\n')
print('single frame', len(single), 'zh frame', len(zh), 'preview 6-20', len(a), 'drawn', len(pa), len(pb), 'books', len(books), 'held books', len(held))
