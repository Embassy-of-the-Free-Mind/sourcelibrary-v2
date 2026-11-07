#!/usr/bin/env python3
# PRIOR ART: scripts/eval/shift-screen-5021/select-screen.mjs (orders the screen by the risk score; Han barely reaches its
# top). This orders by the brief: Chinese first, then readers' books, from the write-group frame (frame.py).
"""
queue.py FRAME.pkl READERS.json EXCLUDE_KEYS.txt OUT_DIR — chunked item files (1,000 items) for leaf-shift-screen-5021 build:
  zh-NNN.jsonl       Chinese pages in gemini-3.1-flash-lite-preview write groups of 6-20 (the 農政全書 shape), book order
                     shuffled (seed 5021), page order kept.
  readers-NNN.jsonl  readers' books (human_read_count > 0), most-read first: pages AFTER an over-long page (log EN/SRC - k
                     > 0.4) in the same 2-8-page write group (call_signals.py L), the slide's carry pages.
Skips withheld, human-edited, English < 200 chars, pages in EXCLUDE_KEYS (book:page, already screened) and pages
without both neighbours in the frame.
"""
import sys, json, os
import pandas as pd, numpy as np
FR, READERS, EXC, OUT = sys.argv[1:5]
os.makedirs(OUT, exist_ok=True)
excl = set(open(EXC).read().split())
df = pd.read_pickle(FR)
key = set(zip(df.b, df.n))
df = df[(df.wh == 0) & (df.hu == 0) & (df.en >= 200) & (df.gsize >= 2) & ~(df.gsame & (df.gsize > 10))]
df = df[[((b, n - 1) in key and (b, n + 1) in key and f'{b}:{n}' not in excl) for b, n in zip(df.b, df.n)]]
def dump(prefix, fr, arm):
    rows = [{'book_id': r.b, 'page': int(r.n), 'arm': arm, 'language': r.lang, 'gsize': int(r.gsize), 'gpos': int(r.gpos)} for r in fr.itertuples()]
    for i in range(0, len(rows), 1000):
        with open(f'{OUT}/{prefix}-{i // 1000:03d}.jsonl', 'w') as f:
            for x in rows[i:i + 1000]: f.write(json.dumps(x) + '\n')
    print(prefix, len(rows), 'items', fr.b.nunique(), 'books')
zh = df[df.lang.str.contains('chinese', case=False) & (df.m == 'gemini-3.1-flash-lite-preview') & df.gsize.between(6, 20)]
books = sorted(zh.b.unique()); np.random.default_rng(5021).shuffle(books)
order = {b: i for i, b in enumerate(books)}
dump('zh', zh.assign(o=zh.b.map(order)).sort_values(['o', 'n']), 'scale-zh')
reads = json.load(open(READERS))
text = (df.src >= 300) & (df.ty.fillna('text') == 'text')
lr = np.log(df.en.clip(lower=1) / df.src.clip(lower=1))
df = df.assign(res=lr - df.b.map(lr[text].groupby(df.b[text]).median()))
small = df[df.gsize <= 8]
first = small[(small.gpos < small.gsize - 1) & (small.src >= 300) & (small.res > 0.4)].groupby('grp').gpos.min()
rd = small[small.b.isin(reads) & (small.gpos > small.grp.map(first))]
rd = rd.assign(o=rd.b.map(reads).astype(float) * -1).sort_values(['o', 'b', 'n'])
dump('readers', rd, 'scale-readers')
