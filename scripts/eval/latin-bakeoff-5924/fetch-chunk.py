#!/usr/bin/env python3
"""fetch-chunk.py — the images of one backlog manifest chunk, long side capped at 2,400 px as in the bake-off (#5924).

PRIOR ART: scripts/eval/latin-bakeoff-5924/prep.py (the same cap for the 99 reference leaves, from files already fetched);
scripts/gpu/paddle-zh-run.py fetches inside its runner. This fetches a chunk ahead of read.py.
  fetch-chunk.py <chunk.tsv> <img dir> [--parallel 8]      errors: <img dir>/_fetch-errors.tsv
"""
import concurrent.futures as cf, io, os, sys, urllib.request
from PIL import Image

tsv, d = sys.argv[1], sys.argv[2]
par = int(sys.argv[sys.argv.index('--parallel') + 1]) if '--parallel' in sys.argv else 8
os.makedirs(d, exist_ok=True)
rows = [l.rstrip('\n').split('\t') for l in open(tsv) if l.strip()]
UA = 'Mozilla/5.0 (X11; Linux x86_64) SourceLibrary-ocr/5924'


def one(r):
    pid, url = r[0], r[3]; out = os.path.join(d, pid + '.jpg')
    if os.path.exists(out): return None
    try:
        b = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=120).read()
        im = Image.open(io.BytesIO(b)).convert('RGB'); w, h = im.size
        if max(w, h) > 2400: s = 2400 / max(w, h); im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
        im.save(out + '.part', 'JPEG', quality=92); os.rename(out + '.part', out); return None
    except Exception as e:  # noqa: BLE001
        return f'{pid}\t{url}\t{str(e)[:200]}'


with cf.ThreadPoolExecutor(par) as ex: errs = [e for e in ex.map(one, rows) if e]
if errs: open(os.path.join(d, '_fetch-errors.tsv'), 'a').write('\n'.join(errs) + '\n')
print(f'{len(rows)} rows, {len(errs)} fetch errors')
