#!/usr/bin/env python3
"""ndl-koten-lines.py <ndl output root> <out dir> — NDL古典籍OCR page JSON -> one text file per page.

NDL's <bid>/json/<stem>.json is a list of GROUPS, each a list of [x0, y0, x1, y1, text] lines already in
reading order. Written as one line per NDL line, a blank line between groups; the file is named by the
page number (<stem> is the zero-padded page number the lane's fetch gave the image). Idempotent.
Part of the NDL lane (#4925), called by scripts/gpu/ndl-koten-box.sh collect; runs anywhere with python3.
"""
import json, os, sys, glob

src, dst = sys.argv[1], sys.argv[2]
n = 0
for f in glob.glob(os.path.join(src, '**', 'json', '*.json'), recursive=True):
    bid = os.path.basename(os.path.dirname(os.path.dirname(f)))
    pn = int(os.path.basename(f).split('.')[0].split('_')[0])
    groups = json.load(open(f, encoding='utf-8'))
    if isinstance(groups, dict):  # the `-a` output shape: {"contents": [...], "imginfo": {...}}
        groups = groups.get('contents', [])
    blocks = ['\n'.join(str(line[4]) for line in g if len(line) >= 5 and str(line[4]).strip()) for g in groups]
    text = '\n\n'.join(b for b in blocks if b)
    os.makedirs(os.path.join(dst, bid), exist_ok=True)
    with open(os.path.join(dst, bid, f'{pn}.txt'), 'w', encoding='utf-8') as fh:
        fh.write(text + ('\n' if text else ''))
    n += 1
print(f'{n} pages written to {dst}')
