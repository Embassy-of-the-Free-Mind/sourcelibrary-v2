#!/usr/bin/env python3
# PRIOR ART: scripts/audit/leaf-shift-risk-5021.mjs (write blocks = consecutive pages within 2 s; it keeps no write
# times, so neither "identical stamp" nor the gap between a block's pages can be read back from its output).
"""
frame.py WALK_DIR OUT.pkl — load walk.mjs output into one table and assign write groups.
grp: consecutive translated page_numbers of one book whose translation.updated_at lies within 2 s of the previous
page's (leaf-shift.mjs ABSORB_SAME_BLOCK_MS). gsize/gpos: size of the group and position in it. same: the page's
stamp equals the previous page's to the millisecond (one `now` per write: the worker's block bulkWrite from
2026-04-08, batch-collector's per-job `now`, split swap). gap: ms since the previous page's stamp.
"""
import glob, gzip, json, sys
import pandas as pd, numpy as np
W, OUT = sys.argv[1], sys.argv[2]
books = {b['id']: b for b in map(json.loads, open(f'{W}/books.jsonl'))}
rows = []
for f in sorted(glob.glob(f'{W}/pages.s*.jsonl.gz')):
    for l in gzip.open(f, 'rt'):
        r = json.loads(l); rows.append((r['b'], r.get('n'), r.get('t'), r.get('m'), str(r.get('pv')) if r.get('pv') is not None else None, r.get('ty'), r.get('wh', 0), r.get('hu', 0), r.get('en', 0), r.get('src', 0), r.get('h', ''), r.get('tl', ''), r.get('hr', 0)))
df = pd.DataFrame(rows, columns=['b', 'n', 't', 'm', 'pv', 'ty', 'wh', 'hu', 'en', 'src', 'h', 'tl', 'hr'])
df = df[df.n.notna()].copy(); df['n'] = df.n.astype(int)
df['lang'] = df.b.map(lambda x: books.get(x, {}).get('language') or '?')
df = df.sort_values(['b', 'n']).reset_index(drop=True)
t = df.t.astype('float')
prev_same_book = df.b.eq(df.b.shift()) & df.n.eq(df.n.shift() + 1)
gap = (t - t.shift()).abs()
df['gap'] = np.where(prev_same_book, gap, np.nan)
link = prev_same_book & (gap <= 2000)
df['same'] = (prev_same_book & (gap == 0)).astype(int)
df['grp'] = (~link).cumsum()
df['gsize'] = df.groupby('grp').n.transform('size')
df['gpos'] = df.groupby('grp').cumcount()
df['gsame'] = df.groupby('grp').same.transform('sum') == (df.gsize - 1)  # every link in the group is an identical stamp
df['date'] = pd.to_datetime(df.t, unit='ms', errors='coerce')
df.to_pickle(OUT)
print(len(df), 'pages', df.b.nunique(), 'books')
