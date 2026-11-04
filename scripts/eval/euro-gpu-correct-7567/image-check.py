#!/usr/bin/env python3
"""image-check.py — #7567 write-back guard: is the image the corrector read the leaf the live page serves?

PRIOR ART: scripts/eval/image-classifiers-and-splits docs and the split-leaf checks of #5771 compare a page with its
neighbours by text; none compares two files of one leaf. The panel's library images were exported for #6740 on
2026-10-26 from pages.photo, and on 2026-10-27 one book (Velser, 6a0b351d…) showed text and image a leaf apart. A read
is only written if its image is the served one: both files to grey, the served one resized to the bench one's
300-px-wide frame, Pearson correlation of the pixels. Calibrated on that book before use: same leaf (bench p18 vs
archived 18.jpg, two different files) and the next leaf (vs 17.jpg) — numbers in the run log.

  image-check.py <J> <S.jsonl> <out.jsonl>
"""
import io, json, os, sys, urllib.request
import numpy as np
from PIL import Image

J, SPATH, OUT = sys.argv[1:4]
W = 300


def grey(img, size=None):
    im = img.convert('L')
    if size is None: size = (W, max(1, round(im.height * W / im.width)))
    return np.asarray(im.resize(size, Image.BILINEAR), dtype=np.float32), size


def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def fetch(url):
    return Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'SourceLibrary-eval/1.0'}), timeout=60).read()))


def compare(bench_path, served):
    b = Image.open(bench_path); s = served
    ar_b, ar_s = b.height / b.width, s.height / s.width
    gb, size = grey(b); gs, _ = grey(s, size)
    return {'corr': round(corr(gb, gs), 4), 'aspect_bench': round(ar_b, 3), 'aspect_served': round(ar_s, 3)}


if __name__ == '__main__':
    with open(OUT, 'w') as o:
        for l in open(SPATH):
            r = json.loads(l)
            if not r.get('served_image'): continue
            row = {'slug': r['page_id'], 'served_image': r['served_image']}
            try: row.update(compare(os.path.join(J, 'img', r['page_id'] + '.jpg'), fetch(r['served_image'])))
            except Exception as e: row['error'] = str(e)[:200]  # noqa: BLE001
            o.write(json.dumps(row) + '\n')
